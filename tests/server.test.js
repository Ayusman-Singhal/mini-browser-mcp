// Smoke test: starts server.js, fakes the extension, checks the MCP round trip,
// the tool annotations, and that every declared tool relays end to end.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18765;
// Own pin file, so the fake extension never pairs with the real server config.
const PIN_FILE = path.join(os.tmpdir(), `mbm-test-pins-${process.pid}.json`);
fs.rmSync(PIN_FILE, { force: true });
const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  cwd: ROOT,
  env: { ...process.env, MINI_BROWSER_PORT: String(PORT), MINI_BROWSER_PIN_FILE: PIN_FILE },
  stdio: ['pipe', 'pipe', 'inherit'],
});

const waiting = new Map();
let buf = '';
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    waiting.get(msg.id)?.(msg);
  }
});
let id = 0;
const rpc = (method, params) => new Promise((res) => {
  const n = ++id;
  waiting.set(n, res);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, label) => { console.log(ok ? 'PASS' : 'FAIL', label); if (!ok) process.exitCode = 1; };

await sleep(500);

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
check(init.result?.serverInfo?.name === 'mini-browser', 'initialize');
check(init.result?.protocolVersion === '2025-06-18', 'protocol version echoed');

const older = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } });
check(older.result?.protocolVersion === '2025-03-26', 'older supported version echoed');

const unknown = await rpc('initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 't', version: '0' } });
check(unknown.result?.protocolVersion === '2025-06-18', 'unsupported version falls back');

const list = await rpc('tools/list', {});
check(list.result?.tools?.length === 10, `tools/list (${list.result?.tools?.length} tools)`);

// Every tool must declare all four hints as explicit booleans, plus a title.
const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
const missing = (list.result?.tools || [])
  .filter((t) => !t.annotations || typeof t.annotations.title !== 'string' ||
    HINTS.some((h) => typeof t.annotations[h] !== 'boolean'))
  .map((t) => t.name);
check(missing.length === 0, `all tools carry title + four boolean hints${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);

const noExt = await rpc('tools/call', { name: 'tabs_list', arguments: {} });
check(noExt.result?.isError && /not connected/.test(noExt.result.content[0].text), 'error when extension missing');

// A web page origin must be refused.
const refused = await new Promise((res) => {
  const bad = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'https://evil.example' });
  bad.on('open', () => { bad.close(); res(false); });
  bad.on('error', () => res(true));
});
check(refused, 'web page origin refused');

// Fake extension: answers every method so each tool's relay path can be exercised.
const TAB = { id: 1, active: true, title: 'Hi', url: 'https://x.test' };
const fake = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'chrome-extension://abc' });
await new Promise((r) => fake.on('open', r));
fake.on('message', (d) => {
  const m = JSON.parse(d);
  const ok = (result) => fake.send(JSON.stringify({ id: m.id, result }));
  switch (m.method) {
    case 'tabs_list': return ok([TAB]);
    case 'tab_open': return ok({ ...TAB, id: 2, title: 'New' });
    case 'tab_close': return ok('closed');
    case 'navigate': return ok(TAB);
    case 'page_text': return ok('Hello page');
    case 'page_elements': return ok('2 elements\n[1] a "x"');
    case 'click':
      return m.params?.index === 9
        ? fake.send(JSON.stringify({ id: m.id, error: 'No element [9]' }))
        : ok('clicked a "x"');
    case 'type': return ok('typed into input');
    case 'scroll': return ok('scrolled to 100');
    case 'screenshot': return ok({ image: 'data:image/jpeg;base64,QUJD' });
    default: return ok('ok');
  }
});
await sleep(200);

const tabs = await rpc('tools/call', { name: 'tabs_list', arguments: {} });
check(/x\.test/.test(tabs.result?.content?.[0]?.text), 'tabs_list relayed');

// A second extension must be refused while one is connected (no connection fighting).
const secondAnswered = await new Promise((res) => {
  const second = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'moz-extension://def' });
  second.on('message', () => res(true));
  second.on('open', () => second.send(JSON.stringify({ id: 999, method: 'tabs_list' })));
  second.on('error', () => res(false));
  setTimeout(() => res(false), 2000);
});
await sleep(200);
const still = await rpc('tools/call', { name: 'tabs_list', arguments: {} });
check(!secondAnswered && !still.result?.isError, 'second extension refused, original keeps the session');

const shot = await rpc('tools/call', { name: 'screenshot', arguments: {} });
check(shot.result?.content?.[0]?.type === 'image' && shot.result.content[0].data === 'QUJD', 'screenshot becomes image content');

const click = await rpc('tools/call', { name: 'click', arguments: { index: 9 } });
check(click.result?.isError && /No element/.test(click.result.content[0].text), 'extension error relayed');

// Exercise every declared tool end to end through the relay.
const TOOL_ARGS = {
  tabs_list: {},
  tab_open: { url: 'https://x.test' },
  tab_close: { tabId: 1 },
  navigate: { tabId: 1, url: 'https://x.test' },
  page_text: {},
  page_elements: {},
  click: { index: 1 },
  type: { index: 1, text: 'hi' },
  scroll: { direction: 'down' },
  screenshot: {},
};
for (const tool of list.result.tools) {
  const args = TOOL_ARGS[tool.name];
  const r = await rpc('tools/call', { name: tool.name, arguments: args });
  const content = r.result?.content?.[0];
  const wantImage = tool.name === 'screenshot';
  check(!r.result?.isError && content &&
    content.type === (wantImage ? 'image' : 'text'),
  `tool relay: ${tool.name}`);
}

fake.close();
srv.stdin.end();
