# Changelog

## 0.5.5

- Every tool now declares MCP tool annotations: `title`, `readOnlyHint`, `destructiveHint`,
  `idempotentHint` and `openWorldHint`, set to match real behaviour (so hosts can warn before
  invoking destructive tools like `tab_close`).
- Tests moved to `tests/server.test.js` and extended to 24 checks: every declared tool is now
  exercised end to end through the relay, and the annotations are asserted.
- README: npx quick start, comparison table, star call-to-action.

## 0.5.4

- Sticky extension connection: the first browser to connect owns the session. A second
  browser running the extension is refused (with a message) until the first one
  disconnects, instead of both fighting over the WebSocket and losing agent-tab state.
- MCP `initialize` negotiates the protocol version properly: echoes a requested version
  if supported, otherwise answers with `2025-06-18`.
- The server retries binding its port every 30 s when another session holds it, instead
  of staying broken until restarted.
- `build.py` fails fast when `extension/manifest.json` and `package.json` versions
  disagree.
- CI also runs `python build.py`.

## 0.5.3

- First public release.
- MCP server (10 tools: tabs, navigate, page_text, page_elements, click, type, scroll,
  screenshot) with a companion extension for Chromium browsers and Firefox 121+.
- Guard rails: agent tabs only, submit guard, CAPTCHA guard, no password typing,
  http(s)-only URLs, no private windows, trust-on-first-use extension pairing.
- Published on npm as `mini-browser-mcp`.
