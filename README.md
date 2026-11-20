# Mini Browser MCP

[![CI](https://github.com/Ayusman-Singhal/mini-browser-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ayusman-Singhal/mini-browser-mcp/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-blue.svg)](package.json)
[![M8ven Score](https://m8ven.ai/badge/mcp/ayusman-singhal-mini-browser-mcp-1a4a07?v=e05c1734d93580d8cf66c3e160940775)](https://m8ven.ai/mcp/ayusman-singhal-mini-browser-mcp-1a4a07?s=readme)

A small local MCP server plus a browser extension. It lets Claude Code (or any MCP client) read
and control your normal browser, with your logins.

```
Claude Code  --stdio-->  server.js  --ws://127.0.0.1:8765-->  extension (background.js)  -->  your tabs
```

Works in Chrome, Edge, Brave, Opera, Vivaldi and Arc (any Chromium browser). Firefox 121+ works
too (see below). Safari is not supported.

<p align="center">
  <img src="docs/demo.gif" alt="Mini Browser MCP searching Wikipedia: opens its own window, types a query, refuses to submit without the user's confirm, then submits and reads the result" width="880">
</p>

<p align="center">⭐ If this project is useful, please star the repo — it helps others find it!</p>

## Quick start

```
claude mcp add -s user mini-browser -- npx -y mini-browser-mcp
```

Then load the extension (step 3 of [Setup](#setup) below) and start a new Claude Code session.
Prefer running from source? Full instructions are in Setup.

## Why

Browser-automation MCPs usually run a separate, logged-out browser: you have to sign in to every
site again, and captchas pop up on every second page. This one drives **your** browser instead,
so your sessions are already there — while guard rails keep the agent inside its own tabs.

## Tools

| Tool | What it does |
|---|---|
| `tabs_list` | List open tabs |
| `tab_open` | Open a URL in a new tab |
| `tab_close` | Close a tab |
| `navigate` | Load a URL in a tab, or `back` / `forward` |
| `page_text` | Visible page text, in parts for long pages |
| `page_elements` | Numbered list of links, buttons and inputs |
| `click` | Click by number, CSS selector or visible text |
| `type` | Type into an input, optionally submit |
| `scroll` | Scroll up, down, top or bottom |
| `screenshot` | JPEG of a tab (visible part, or full page up to 6000 px) |
| `upload_file` | Attach local files to a file input, e.g. a video upload (needs `confirm`, Chromium only) |
| `press_keys` | Real keyboard input in the focused element, reaches shadow DOM (Enter needs `confirm`, Chromium only) |
| `click_at` | Real click at a screenshot point, for elements not in `page_elements` (guarded, Chromium only) |
| `browsers_list` | List browsers running the extension and which one is in control |
| `browser_select` | Move control to another connected browser |

When `tabId` is left out, the tool uses the active tab.

## Setup

1. Clone this repository and install the server dependency:
   ```
   git clone https://github.com/Ayusman-Singhal/mini-browser-mcp.git
   cd mini-browser-mcp
   npm install
   ```
2. Register it with Claude Code (all projects):
   ```
   claude mcp add -s user mini-browser -- node /path/to/mini-browser-mcp/server.js
   ```
3. Load the extension:
   - **Chrome / Edge / Brave:** open `chrome://extensions` (Edge: `edge://extensions`), turn on
     **Developer mode**, click **Load unpacked**, pick the `extension` folder.
   - **Firefox / Zen:** run `python build.py`, then either
     - *permanent:* set `xpinstall.signatures.required` to `false` in `about:config`, open
       `about:addons` > gear > **Install Add-on From File**, pick
       `dist/mini-browser-mcp-<version>-firefox.xpi`; or
     - *temporary:* `about:debugging#/runtime/this-firefox` > **Load Temporary Add-on** > pick
       `dist/firefox/manifest.json` (removed when the browser restarts).

     Then click the toolbar icon once and allow access to all websites. An orange **!** badge
     means the server is connected but site access is still off.
   - **Chrome build without Firefox keys:** `dist/chrome/` (Load unpacked) or the `-chrome.zip`.
4. Start a new Claude Code session. The extension icon shows a green **ON** badge once the server
   is running and connected. It retries every 30 seconds; click the icon to retry now.

## How it compares

| | **Mini Browser MCP** | Playwright / Puppeteer MCP | browser-use style agents |
|---|---|---|---|
| Browser | **Your own, already logged in** | Fresh automation browser | Separate profile |
| Logins & cookies | ✅ your existing sessions | ❌ sign in again everywhere | ⚠️ depends on profile |
| CAPTCHA / bot checks | Detected → pauses and asks you | You solve it in the automation window | Usually manual |
| Guard rails | Enforced by the extension (agent tabs only, submit/confirm, no passwords) | Full control, no guard rails | Policy layer in the agent |
| Runs where | Local, `127.0.0.1` only | Local or remote | Local |
| Install | npm + one extension | npm | Python + npm |

The trade-off: automation frameworks are more flexible and run headless on servers;
Mini Browser MCP is for **letting an agent work inside the browser you actually use**,
safely. The two complement each other.

## Guard rails (enforced by the extension)

- **Agent tabs only.** The agent opens its tabs in its own window. It can list, read and control
  only those tabs and pop-ups they open. Your other tabs are never listed, read or changed.
- **Submit guard.** Clicks on submit-like buttons (join, submit, send, pay, delete, sign up,
  connect, accept, ...) and `type` with `submit` are refused unless the call has `confirm: true`.
  The agent is told to set `confirm` only after you say yes in chat.
- **CAPTCHA guard.** If a page shows a CAPTCHA or bot check, clicks, typing and scrolling are
  refused and reads carry a warning, so the agent stops and asks you to solve it.
- **Passwords.** Password fields are never typed into.
- **Web pages only.** Only `http` and `https` URLs open; `javascript:`, `file:`, `data:`,
  `about:` and browser pages are refused.
- **No private windows.** The manifest sets `"incognito": "not_allowed"`.
- **Paired extension only (server).** The first `chrome-extension://` and the first
  `moz-extension://` origin that connect are saved in `~/.mini-browser-mcp/allowed-origins.json`.
  Any other extension is refused. Delete that file to pair again (for example after a reinstall).

## Several browsers

You can run the extension in more than one browser at the same time (for example Brave and Chrome).
All of them stay connected to the server. One is **in control** (badge **ON**); the others wait on
**standby** (badge **WAIT**) instead of retrying in a loop. A browser that starts later never takes over
a running session by itself.

To switch, click the extension icon:

- **Control this browser** (in a standby browser) moves control here.
- **Let the other browser control** (in the browser in control) steps aside.

Or ask the agent: it can call `browsers_list` and `browser_select`. Agent tabs stay in the browser that
opened them; after switching, the agent opens new tabs in the browser now in control.

## Notes

- The server listens only on `127.0.0.1` and only accepts connections whose `Origin` is a browser
  extension, so web pages cannot connect to it.
- Only one MCP session can own the browser at a time (one port). A second session reports
  "Port 8765 is already in use. Retrying in 30s." and picks the port up automatically once
  the other session exits. Set `MINI_BROWSER_PORT` on the server and change `PORT` in
  `extension/background.js` to run another pair.
- If two browsers both run the extension (say Chrome and Firefox), the first one connected owns
  the session and stays in charge; the other is refused until that browser closes. The extension
  keeps retrying, so it takes over automatically when the first browser disconnects.
- Clicks and typing are synthetic DOM events. Most sites accept them; a few that check for real
  user input will not. Browser pages such as `chrome://` and the extension store cannot be scripted.
- Page content is untrusted. Treat it as data, not as instructions.

## Development

```
npm test          # smoke test: starts the server, fakes the extension, checks the MCP round trip
python build.py   # builds dist/ (Firefox .xpi and Chrome .zip from extension/)
```

The source of truth for the extension is `extension/`; `dist/` is generated by `build.py` and not
committed. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to send changes.

## License

[MIT](LICENSE) — free to use, modify and distribute.
