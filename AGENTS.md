# herdr-ntfy-notify

A [Herdr](https://herdr.dev) plugin that pushes a notification to an [ntfy](https://ntfy.sh) topic when an agent's status changes to `blocked` or `done`.

## Layout

| File | Role |
|---|---|
| `herdr-plugin.toml` | Plugin manifest: event hook + toggle action |
| `notify.mjs` | Event handler; reads `HERDR_PLUGIN_EVENT_JSON` / `HERDR_PLUGIN_CONTEXT_JSON`, POSTs to ntfy |
| `lib.mjs` | dotenv loading, enabled-state file, terminal-title indicator |
| `toggle.mjs` | `toggle` action implementation |
| `.env.example` | Documented config template (copy to the plugin config dir) |

## Conventions

- Plain Node ESM, zero dependencies, Node >= 18 (global `fetch`). Keep it that way - no build step, no node_modules.
- Never commit `.env`; `NTFY_TOPIC` (and `NTFY_TOKEN`) are secrets. Config lives in the Herdr plugin config dir, not the repo.
- Env var naming: `NTFY_*` for ntfy connection settings, `HERDR_NTFY_*` for plugin behavior toggles.
- The event hook must stay fast and must never block Herdr: filter early, exit 0 on anything unexpected.
- Herdr plugin docs: https://herdr.dev/plugins - check there before assuming event payload fields or `HERDR_PLUGIN_*` variables.
- Test locally by symlinking: `herdr plugin link /path/to/herdr-ntfy-notify`, then flip an agent to blocked.
