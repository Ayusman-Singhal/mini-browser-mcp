# Security Policy

This project controls a real browser, so security issues are taken seriously.

## Reporting a vulnerability

Please report privately instead of a public issue: use GitHub's
**Report a vulnerability** button on the Security tab, or contact the maintainer directly.

Please do not open public issues for exploitable behavior.

## Scope / what counts

Especially interesting:

- Ways a web page could connect to or inject into the WebSocket server (`127.0.0.1:8765`).
- Ways the agent could reach tabs it did not open, private windows, or password fields.
- Ways to bypass the submit guard, the CAPTCHA guard, or the URL scheme allow-list.
- Any path where the pairing file could be spoofed by another local process.

## Design notes

- The server binds to `127.0.0.1` only, and refuses connections whose `Origin` is not a
  browser-extension origin; the first chrome and moz extension origins are pinned
  (trust on first use) to `~/.mini-browser-mcp/allowed-origins.json`.
- The extension enforces its guard rails itself (not just via the server), and the manifest
  sets `"incognito": "not_allowed"`.
- The user is expected to run this locally on a machine they trust; it is not hardened against
  a local attacker with access to your user account.
