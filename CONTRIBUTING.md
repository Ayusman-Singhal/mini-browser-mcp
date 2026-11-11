# Contributing

Thanks for wanting to improve Mini Browser MCP! Contributions are welcome.

## Getting started

```
git clone https://github.com/Ayusman-Singhal/mini-browser-mcp.git
cd mini-browser-mcp
npm install
npm test
```

Load the extension from `extension/` (Chrome: Load unpacked; Firefox: `python build.py` +
temporary add-on) and test against a real browser session.

## How the code is laid out

| File | What it is |
|---|---|
| `server.js` | MCP server (JSON-RPC over stdio) + WebSocket bridge on 127.0.0.1 |
| `extension/background.js` | Extension: connects to the server, runs commands, enforces guard rails |
| `extension/manifest.json` | Source manifest; `build.py` splits it into Firefox and Chrome variants |
| `test.js` | Smoke test that fakes the extension end-to-end |
| `build.py` | Builds `dist/` (.xpi for Firefox, .zip for Chrome) |

## Guidelines

- Keep it small: this project's whole point is being a *mini* browser MCP. Propose bigger ideas
  in an issue before writing lots of code.
- Guard rails first: any change that relaxes the agent-tabs-only, submit, CAPTCHA, or password
  guards needs strong justification.
- `dist/` is generated — don't edit it or commit it.
- Run `npm test` before pushing. CI runs the same test on Node 18, 20 and 22.

## Submitting

1. Open an issue (bug report or feature idea) if one doesn't exist yet.
2. Fork, create a branch, make the change.
3. `npm test` passes.
4. Open a pull request with a short description of what and why.

## Reporting bugs

Include: OS, browser + version, the tool call and its error text, and any relevant console output
(server stderr or the extension console). Redact anything private from page content.
