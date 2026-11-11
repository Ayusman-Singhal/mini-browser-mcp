// Mini Browser MCP extension.
// Connects to the local MCP server over WebSocket and runs its commands.
//
// Guard rails (enforced here, not just by the agent):
// - Agent tabs only: the agent can see and use only tabs it opened (in its own window),
//   plus pop-ups those tabs open. Your other tabs are never listed, read or changed.
// - Submit guard: clicks on submit-like buttons (join, submit, pay, delete, ...) and
//   typing with submit are refused unless the call carries confirm: true.
//   The agent must ask you in chat before it sends confirm: true.
// - CAPTCHA guard: when a page shows a CAPTCHA or bot check, clicks, typing and
//   scrolling are refused and reads carry a warning, so the agent stops and asks you.
// - Password fields are never typed into.
// - Only http and https pages can be opened (no javascript:, file:, data:, about: or browser pages).
// - Private windows are never used ("incognito": "not_allowed" in the manifest).

const PORT = 8765;
const URL_WS = `ws://127.0.0.1:${PORT}`;

// Firefox and Zen expose Firefox-only APIs (tabs.captureTab) on `browser`.
const FF = globalThis.browser && globalThis.browser.tabs && globalThis.browser.tabs.captureTab ? globalThis.browser : null;

// Site access. Firefox MV3 does not grant <all_urls> until the user allows it.
const ALL_SITES = { origins: ['<all_urls>'] };
async function hasSiteAccess() {
  try { return await chrome.permissions.contains(ALL_SITES); } catch { return true; }
}
async function requireSiteAccess() {
  if (!(await hasSiteAccess())) {
    throw new Error('Site access is off. Click the Mini Browser MCP icon in the toolbar and allow access to all websites, then retry.');
  }
}

const RISKY_WORDS =
  '\\b(submit|send|post|publish|join|apply|enrol+|confirm|pay|buy|purchase|checkout|order|' +
  'delete|remove|sign ?up|register|create account|accept|agree|subscribe|withdraw|transfer|' +
  'connect|link account|authori[sz]e|allow|upload|claim|save)\\b';

let ws = null;
let pingTimer = null;

let connected = false;

async function setBadge(on = connected) {
  connected = on;
  if (!on) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Mini Browser MCP: waiting for server' });
    return;
  }
  if (await hasSiteAccess()) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#1a7f37' });
    chrome.action.setTitle({ title: 'Mini Browser MCP: connected' });
  } else {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#b54708' });
    chrome.action.setTitle({ title: 'Mini Browser MCP: connected, but site access is off. Click to allow.' });
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  try {
    ws = new WebSocket(URL_WS);
  } catch {
    return;
  }
  ws.onopen = () => {
    setBadge(true);
    clearInterval(pingTimer);
    // WebSocket traffic keeps the Chrome service worker alive. Firefox and Zen suspend idle
    // event pages, so also make a cheap extension API call, which resets that idle timer.
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
      chrome.runtime.getPlatformInfo().catch(() => {});
    }, 20000);
  };
  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    try {
      const result = await run(msg.method, msg.params || {});
      ws.send(JSON.stringify({ id: msg.id, result }));
    } catch (e) {
      ws.send(JSON.stringify({ id: msg.id, error: String(e?.message || e) }));
    }
  };
  ws.onclose = () => {
    setBadge(false);
    clearInterval(pingTimer);
    setTimeout(connect, 3000);
  };
  ws.onerror = () => {}; // onclose follows
}

// Wake up and retry while the server is not running.
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.action.onClicked.addListener(() => {
  // Ask for site access first: Firefox only shows the prompt inside the click handler.
  chrome.permissions.request(ALL_SITES).catch(() => false).then(() => setBadge());
  connect();
});
chrome.permissions.onAdded?.addListener(() => setBadge());
chrome.permissions.onRemoved?.addListener(() => setBadge());
connect();

// ---------- Agent tabs (kept in session storage so a worker restart keeps them) ----------

const store = chrome.storage.session;
const getState = () => store.get({ owned: [], windowId: null, last: null });

async function ownTab(id) {
  const s = await getState();
  if (!s.owned.includes(id)) s.owned.push(id);
  await store.set({ owned: s.owned, last: id });
}

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.openerTabId == null) return;
  const s = await getState();
  if (s.owned.includes(tab.openerTabId)) await ownTab(tab.id); // pop-up from an agent tab
});
chrome.tabs.onRemoved.addListener(async (id) => {
  const s = await getState();
  if (!s.owned.includes(id)) return;
  await store.set({ owned: s.owned.filter((x) => x !== id), last: s.last === id ? null : s.last });
});
chrome.windows.onRemoved.addListener(async (id) => {
  const s = await getState();
  if (s.windowId === id) await store.set({ windowId: null });
});

async function getTab(tabId) {
  const s = await getState();
  const id = tabId ?? s.last ?? s.owned[s.owned.length - 1];
  if (id == null) throw new Error('No agent tab yet. Use tab_open first.');
  if (!s.owned.includes(id)) throw new Error(`Tab ${id} was not opened by the agent. Only agent tabs can be used.`);
  await store.set({ last: id });
  return chrome.tabs.get(id);
}

// ---------- Helpers ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForLoad(tabId, { checkNow = false, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    if (checkNow) {
      chrome.tabs.get(tabId).then((t) => {
        if (t.status === 'complete' && t.url && t.url !== 'about:blank') done();
      }, done);
    }
  });
}

// Only web pages. Blocks javascript:, file:, data:, about:, browser and extension pages.
function normalizeUrl(url) {
  const raw = String(url || '').trim();
  const full = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let u;
  try { u = new URL(full); } catch { throw new Error(`Not a valid URL: ${raw}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error(`Only http and https pages can be opened (got ${u.protocol}).`);
  }
  return u.href;
}

const tabInfo = (t) => ({ id: t.id, active: t.active, title: t.title, url: t.url });

// Run pageAction in every frame (or the given frames). Returns [{ frameId, result }].
// Web apps often render inside iframes, so reads cover all frames.
async function inFrames(tabId, action, opts, frameIds) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  const exec = () => chrome.scripting.executeScript({
    target,
    func: pageAction,
    args: [action, { ...opts, riskyWords: RISKY_WORDS }],
  });
  let res;
  try {
    res = await exec();
  } catch (e) {
    // Zen / Firefox: a tab opened in the background can refuse scripts for a moment after load
    // ("An unexpected error occurred"). Wait briefly and try once more.
    await sleep(1200);
    res = await exec();
  }
  return res.filter((r) => r && r.result != null).sort((a, b) => a.frameId - b.frameId);
}

// Run in one frame and surface its error.
async function inFrame(tabId, frameId, action, opts) {
  const [r] = await inFrames(tabId, action, opts, [frameId]);
  const out = r?.result;
  if (out && out.error) throw new Error(out.error);
  return out;
}

async function assertNoCaptcha(tabId) {
  const res = await inFrames(tabId, 'captcha', {});
  const hit = res.find((r) => r.result.captcha);
  if (hit) {
    throw new Error(`BLOCKED: CAPTCHA or bot check detected (${hit.result.captcha}). Ask the user to solve it, then continue.`);
  }
}

// Find which frame should receive a click/type: by element number, or first frame with a match.
async function targetFrame(tabId, p) {
  if (p.index != null) {
    const { elementMap = {} } = await store.get('elementMap');
    const hit = elementMap[`${tabId}:${p.index}`];
    if (!hit) throw new Error(`No element [${p.index}]. Run page_elements again.`);
    return { frameId: hit[0], opts: { ...p, index: hit[1] } };
  }
  const res = await inFrames(tabId, 'has', p);
  // Best match across all frames, so an exact "Back" in a frame beats "Submit feedback" on top.
  const hit = res.filter((r) => r.result.found).sort((a, b) => a.result.score - b.result.score)[0];
  if (!hit) throw new Error(p.selector ? `No element matches ${p.selector}` : `No button or link with text "${p.text}"`);
  return { frameId: hit.frameId, opts: p };
}

const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms)),
]);

// Screenshot through the DevTools protocol. Chrome shows a short "started debugging" bar
// while attached; we detach right after the capture.
async function debuggerShot(tabId, fullPage) {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    const send = (method, params) => chrome.debugger.sendCommand(target, method, params);
    let params = { format: 'jpeg', quality: 70, fromSurface: true };
    if (fullPage) {
      const m = await send('Page.getLayoutMetrics');
      const size = m.cssContentSize || m.contentSize;
      const width = Math.ceil(size.width);
      const height = Math.min(Math.ceil(size.height), 6000); // keep the image a sane size
      const scale = Math.min(1, 1280 / width);
      params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale } };
    }
    const r = await withTimeout(send('Page.captureScreenshot', params), 10000, 'screenshot');
    return `data:image/jpeg;base64,${r.data}`;
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

// Firefox / Zen: tabs.captureTab works on background tabs and can capture the full page.
async function firefoxShot(tabId, fullPage) {
  const opts = { format: 'jpeg', quality: 70 };
  if (fullPage) {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }),
    });
    const width = Math.max(1, r?.result?.w || 1280);
    const height = Math.min(Math.max(1, r?.result?.h || 800), 6000);
    opts.rect = { x: 0, y: 0, width, height };
    opts.scale = Math.min(1, 1280 / width);
  }
  return withTimeout(FF.tabs.captureTab(tabId, opts), 10000, 'screenshot');
}

const captchaNote = (c) =>
  c ? `WARNING: CAPTCHA or bot check detected (${c}). Stop and ask the user to solve it.\n\n` : '';

// ---------- Commands ----------

const NEEDS_SITE_ACCESS = new Set(['page_text', 'page_elements', 'click', 'type', 'scroll', 'screenshot']);

async function run(method, p) {
  if (NEEDS_SITE_ACCESS.has(method)) await requireSiteAccess();
  switch (method) {
    case 'tabs_list': {
      const s = await getState();
      const tabs = await Promise.all(s.owned.map((id) => chrome.tabs.get(id).catch(() => null)));
      return tabs.filter(Boolean).map(tabInfo);
    }
    case 'tab_open': {
      const url = normalizeUrl(p.url);
      const s = await getState();
      let tab = null;
      if (s.windowId != null) {
        tab = await chrome.tabs.create({ windowId: s.windowId, url, active: true }).catch(() => null);
      }
      if (!tab) {
        const win = await chrome.windows.create({ url, focused: true });
        await store.set({ windowId: win.id });
        // Zen (and some other browsers) copy pinned or "Essentials" tabs into every new window,
        // so win.tabs[0] can be one of the user's own tabs. Take only the tab we asked for.
        const fresh = (win.tabs || []).filter((t) => !t.pinned);
        tab = fresh.find((t) => t.pendingUrl === url || t.url === url) || (fresh.length === 1 ? fresh[0] : null);
        if (!tab) tab = await chrome.tabs.create({ windowId: win.id, url, active: true });
      }
      await ownTab(tab.id);
      await waitForLoad(tab.id, { checkNow: true });
      return tabInfo(await chrome.tabs.get(tab.id));
    }
    case 'tab_close': {
      const tab = await getTab(p.tabId);
      await chrome.tabs.remove(tab.id);
      return 'closed';
    }
    case 'navigate': {
      const tab = await getTab(p.tabId);
      const loaded = waitForLoad(tab.id);
      if (p.url === 'back') await chrome.tabs.goBack(tab.id);
      else if (p.url === 'forward') await chrome.tabs.goForward(tab.id);
      else await chrome.tabs.update(tab.id, { url: normalizeUrl(p.url) });
      await loaded;
      return tabInfo(await chrome.tabs.get(tab.id));
    }
    case 'page_text': {
      const tab = await getTab(p.tabId);
      const res = await inFrames(tab.id, 'text', {});
      const main = res.find((r) => r.frameId === 0)?.result || { title: tab.title, url: tab.url };
      const captcha = res.find((r) => r.result.captcha)?.result.captcha;
      const text = res
        .filter((r) => r.result.text && r.result.text.trim())
        .map((r) => (r.frameId === 0 ? r.result.text : `\n--- frame: ${r.result.url} ---\n${r.result.text}`))
        .join('\n');
      const offset = p.offset || 0;
      const max = p.maxChars || 20000;
      const chunk = text.slice(offset, offset + max);
      const end = offset + chunk.length;
      const more = end < text.length ? `\n\n[more: call again with offset ${end}]` : '';
      return `${captchaNote(captcha)}${main.title}\n${main.url}\n[chars ${offset}-${end} of ${text.length}]\n\n${chunk}${more}`;
    }
    case 'page_elements': {
      const tab = await getTab(p.tabId);
      const res = await inFrames(tab.id, 'elements', { maxItems: p.maxItems || 200 });
      const captcha = res.find((r) => r.result.captcha)?.result.captcha;
      const elementMap = {};
      const lines = [];
      let n = 0;
      for (const r of res) {
        if (r.frameId !== 0 && r.result.items?.length) lines.push(`--- frame: ${r.result.url} ---`);
        (r.result.items || []).forEach((item, i) => {
          n++;
          elementMap[`${tab.id}:${n}`] = [r.frameId, i + 1];
          lines.push(`[${n}] ${item}`);
        });
      }
      await store.set({ elementMap });
      return `${captchaNote(captcha)}${tab.title}\n${tab.url}\n${n} elements\n\n${lines.join('\n')}`;
    }
    case 'click': {
      const tab = await getTab(p.tabId);
      await assertNoCaptcha(tab.id);
      const t = await targetFrame(tab.id, p);
      const r = await inFrame(tab.id, t.frameId, 'click', t.opts);
      await sleep(600);
      return r;
    }
    case 'type': {
      const tab = await getTab(p.tabId);
      await assertNoCaptcha(tab.id);
      const t = await targetFrame(tab.id, p);
      const r = await inFrame(tab.id, t.frameId, 'type', { clear: true, ...t.opts });
      if (p.submit) await sleep(600);
      return r;
    }
    case 'scroll': {
      const tab = await getTab(p.tabId);
      await assertNoCaptcha(tab.id);
      const res = await inFrames(tab.id, 'scroll', p);
      return res.map((r) => r.result).filter((s) => typeof s === 'string' && !s.startsWith('nothing')).join('\n') || 'nothing to scroll';
    }
    case 'screenshot': {
      const tab = await getTab(p.tabId);
      // First choice: DevTools protocol. Works when the window is hidden and can capture the full page.
      if (chrome.debugger) {
        try {
          return { image: await debuggerShot(tab.id, p.fullPage === true) };
        } catch (e) {
          console.warn('debugger screenshot failed, falling back:', e);
        }
      }
      // Firefox / Zen: no DevTools protocol for extensions; captureTab does the same job.
      if (FF) {
        try {
          return { image: await firefoxShot(tab.id, p.fullPage === true) };
        } catch (e) {
          console.warn('captureTab failed, falling back:', e);
        }
      }
      if (!tab.active) {
        await chrome.tabs.update(tab.id, { active: true }); // agent window only
        await sleep(300);
      }
      const capture = () => chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
      try {
        return { image: await capture() };
      } catch {
        // Capture fails when the window is minimized or hidden: bring the agent window up and retry.
        await chrome.windows.update(tab.windowId, { state: 'normal', focused: true });
        await sleep(500);
        return { image: await capture() };
      }
    }
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// ---------- Runs inside the page ----------
// Must be self-contained: it is serialized and injected by chrome.scripting.

function pageAction(action, opts) {
  try {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const labelOf = (el) =>
      (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
        el.getAttribute('title') || el.getAttribute('alt') || el.name || '')
        .replace(/\s+/g, ' ').trim().slice(0, 80);
    const describe = (el) => `${el.tagName.toLowerCase()} "${labelOf(el)}"`;

    const detectCaptcha = () => {
      const frame = [...document.querySelectorAll('iframe')].find((f) =>
        /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|captcha/i.test(f.src || '') &&
        !/size=invisible/i.test(f.src || '') && visible(f));
      if (frame) {
        try { return `captcha frame from ${new URL(frame.src).hostname}`; } catch { return 'captcha frame'; }
      }
      const widget = [...document.querySelectorAll('.g-recaptcha,.h-captcha,.cf-turnstile,#challenge-form,#cf-challenge-running')]
        .find((e) => visible(e) && e.getAttribute('data-size') !== 'invisible');
      if (widget) return 'captcha widget on page';
      const head = `${document.title} ${(document.body?.innerText || '').slice(0, 3000)}`.toLowerCase();
      const m = head.match(/verify you are human|verify you're human|i'?m not a robot|checking your browser|just a moment\.\.\.|press and hold|are you a robot|unusual traffic|complete the security check/);
      return m ? `page says "${m[0]}"` : null;
    };

    const captcha = detectCaptcha();
    if (action === 'captcha') return { captcha };
    if (captcha && ['click', 'type', 'scroll'].includes(action)) {
      return { error: `BLOCKED: CAPTCHA or bot check detected (${captcha}). Ask the user to solve it, then continue.` };
    }

    // Text matches, best first: exact label, then label starting with the text, then containing it.
    const textHits = () => {
      const t = opts.text.toLowerCase().trim();
      const sel = 'a,button,[role=button],[role=link],[role=tab],[role=menuitem],summary,label,input[type=submit],input[type=button]';
      return [...document.querySelectorAll(sel)]
        .filter((e) => visible(e))
        .map((el) => {
          const l = labelOf(el).toLowerCase();
          const score = l === t ? 0 : l.startsWith(t) ? 1 : l.includes(t) ? 2 : -1;
          return { el, score, len: l.length };
        })
        .filter((h) => h.score >= 0)
        .sort((a, b) => a.score - b.score || a.len - b.len);
    };

    const find = () => {
      if (opts.index != null) {
        const el = document.querySelector(`[data-mbm="${opts.index}"]`);
        if (!el) throw new Error(`No element [${opts.index}]. Run page_elements again.`);
        return el;
      }
      if (opts.selector) {
        const el = document.querySelector(opts.selector);
        if (!el) throw new Error(`No element matches ${opts.selector}`);
        return el;
      }
      if (opts.text) {
        const hits = textHits();
        if (!hits.length) throw new Error(`No button or link with text "${opts.text}"`);
        return hits[0].el;
      }
      throw new Error('Give index, selector or text');
    };

    const blocked = (what) => ({
      error: `BLOCKED: ${what} looks like a submit or irreversible action. Ask the user in chat; only after they say yes, repeat the call with confirm: true.`,
    });

    switch (action) {
      case 'has':
        if (opts.text) {
          const hits = textHits();
          return hits.length ? { found: true, score: hits[0].score } : { found: false };
        }
        try { find(); return { found: true, score: 0 }; } catch { return { found: false }; }

      case 'text':
        return { title: document.title, url: location.href, captcha, text: document.body?.innerText || '' };

      case 'elements': {
        const sel = 'a[href],button,input:not([type=hidden]),textarea,select,summary,' +
          '[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],' +
          '[contenteditable=""],[contenteditable=true],[onclick]';
        document.querySelectorAll('[data-mbm]').forEach((e) => e.removeAttribute('data-mbm'));
        const lines = [];
        let n = 0;
        for (const el of document.querySelectorAll(sel)) {
          if (!visible(el)) continue;
          n++;
          el.setAttribute('data-mbm', String(n));
          const tag = el.tagName.toLowerCase();
          const kind = el.getAttribute('type') || el.getAttribute('role') || '';
          const href = tag === 'a' ? (el.getAttribute('href') || '').slice(0, 100) : '';
          const r = el.getBoundingClientRect();
          const off = r.bottom < 0 || r.top > innerHeight ? ' (offscreen)' : '';
          lines.push(`${tag}${kind ? ' ' + kind : ''} "${labelOf(el)}"${href ? ' -> ' + href : ''}${off}`);
          if (n >= opts.maxItems) break;
        }
        return { title: document.title, url: location.href, captcha, items: lines };
      }

      case 'click': {
        const el = find();
        // Check the full text, not the 80-char label, so a card ending in "Submit clip" is caught.
        const fullText = `${el.innerText || ''} ${el.value || ''} ${el.getAttribute('aria-label') || ''}`;
        const isSubmit = (el.type === 'submit' && el.form) || new RegExp(opts.riskyWords, 'i').test(fullText);
        if (isSubmit && opts.confirm !== true) return blocked(describe(el));
        el.scrollIntoView({ block: 'center' });
        el.click();
        return `clicked ${describe(el)}`;
      }

      case 'type': {
        const el = find();
        if (el.type === 'password' || /password/i.test(el.autocomplete || '')) {
          return { error: 'BLOCKED: password field. The user must type passwords themselves.' };
        }
        if (opts.submit && opts.confirm !== true) return blocked(`typing into ${describe(el)} with submit`);
        el.scrollIntoView({ block: 'center' });
        el.focus();
        if (el.isContentEditable) {
          if (opts.clear) document.execCommand('selectAll');
          document.execCommand('insertText', false, opts.text);
        } else {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
            : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
          // Native setter so React and similar frameworks see the change.
          const setValue = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setValue.call(el, (opts.clear ? '' : el.value) + opts.text);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (opts.submit) {
          if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
          else for (const type of ['keydown', 'keypress', 'keyup']) {
            el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }
        }
        return `typed into ${describe(el)}${opts.submit ? ' and submitted' : ''}`;
      }

      case 'scroll': {
        // Scroll the page, or the biggest scrollable panel when the page itself does not scroll.
        let box = document.scrollingElement || document.documentElement;
        if (box.scrollHeight - box.clientHeight < 10) {
          let best = null;
          let room = 10;
          for (const el of document.querySelectorAll('body *')) {
            const extra = el.scrollHeight - el.clientHeight;
            if (extra > room && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && visible(el)) {
              best = el;
              room = extra;
            }
          }
          if (!best) return 'nothing to scroll';
          box = best;
        }
        const step = box.clientHeight * 0.8 * (opts.pages || 1);
        if (opts.direction === 'top') box.scrollTop = 0;
        else if (opts.direction === 'bottom') box.scrollTop = box.scrollHeight;
        else box.scrollTop += opts.direction === 'up' ? -step : step;
        return `${location.hostname}: scrolled to ${Math.round(box.scrollTop)} of ${box.scrollHeight - box.clientHeight}`;
      }
    }
    return { error: `Unknown page action: ${action}` };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}
