// Toolbar popup: shows whether this browser is in control and lets the user switch.
const $ = (id) => document.getElementById(id);
const ask = (cmd) => chrome.runtime.sendMessage({ cmd });

async function refresh() {
  const s = await ask('status').catch(() => null);
  const show = (id, on) => { $(id).hidden = !on; };
  ['control', 'release', 'access', 'reconnect'].forEach((id) => show(id, false));
  $('others').hidden = true;

  if (!s || !s.connected) {
    $('dot').className = 'dot';
    $('state').textContent = 'Not connected';
    $('detail').textContent = 'Waiting for the MCP server. Start your MCP client (for example Claude Code), then retry.';
    show('reconnect', true);
    return;
  }

  const others = s.others || [];
  if (others.length) {
    $('others').replaceChildren(...others.map((o) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      const role = document.createElement('span');
      name.textContent = `${o.name} (#${o.id})`;
      role.textContent = o.active ? 'in control' : 'standby';
      li.append(name, role);
      return li;
    }));
    $('others').hidden = false;
  }

  if (s.active) {
    $('dot').className = 'dot on';
    $('state').textContent = `${s.name} is in control`;
    $('detail').textContent = others.length
      ? 'The agent works in this browser. Other browsers wait on standby.'
      : 'The agent works in this browser.';
    show('release', others.length > 0);
    show('access', !s.siteAccess);
  } else {
    $('dot').className = 'dot wait';
    $('state').textContent = `${s.name} is on standby`;
    const boss = others.find((o) => o.active);
    $('detail').textContent = boss
      ? `${boss.name} is in control right now.`
      : 'No browser is in control right now.';
    show('control', true);
  }
}

$('control').addEventListener('click', async () => { await ask('activate'); setTimeout(refresh, 300); });
$('release').addEventListener('click', async () => { await ask('release'); setTimeout(refresh, 300); });
$('reconnect').addEventListener('click', async () => { await ask('reconnect'); setTimeout(refresh, 800); });
$('access').addEventListener('click', async () => {
  // Must run inside the click handler: Firefox only shows the prompt for a user gesture.
  await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
  refresh();
});
chrome.runtime.onMessage.addListener((m) => { if (m?.cmd === 'state-changed') refresh(); });
refresh();
