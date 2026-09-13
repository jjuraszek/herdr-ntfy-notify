# Changelog

## 0.1.0

- First release: `pane.agent_status_changed` event hook pushes to an ntfy topic when an agent goes `blocked` (priority 4) or `done` (priority 3).
- `toggle` action flips notifications on/off from Herdr's command palette and reflects the state in the terminal title.
- Config via `.env` in the plugin config dir (`herdr plugin config-dir jjuraszek.ntfy-notify`): `NTFY_TOPIC` required, `NTFY_SERVER` / `NTFY_TOKEN` optional.
