# Changelog

## Unreleased

- Plugin commands no longer depend on `PATH`: all manifest entries run via `/bin/sh run.sh`, which probes mise shims, Homebrew and nvm locations for a `node` binary when `command -v node` fails. Fixes hooks failing to spawn (`No such file or directory (os error 2)`) when Herdr runs under launchd/systemd with a bare `PATH`.

- Hook never exits non-zero: one top-level boundary catches everything (failed or timed-out publish via 5 s `AbortSignal.timeout`, `null` event/context JSON, unreadable state file), logs one stderr line and exits 0, per the never-block-Herdr rule.
- `.env` parser honors dotenv inline comments (`NTFY_TOPIC=abc # note`) and keeps `#` inside quoted values.
- `enable` / `disable` actions next to `toggle` (`herdr plugin action invoke jjuraszek.ntfy-notify.disable`) - set the state outright without seeing the terminal title.
- `npm test`: `node --test` suite against an in-process ntfy stub (publish headers/body, status filter, exit-0 paths, dotenv from `HERDR_PLUGIN_CONFIG_DIR`, toggle state file). CI on ubuntu + macos, Node 18 + 22, plus `scripts/check-agents-core.mjs` guarding the shared AGENTS core.
- Repo hygiene aligned with the pi-* siblings: `CONTRIBUTING.md`, issue and PR templates, FUNDING; logo downscaled from 3.1 MB to 230 KB.
- README: fixed the toggle keybinding (`[[keys.command]]` with `type = "plugin_action"`, not the invented `[keybinds]` table) and the unverified "command palette" claim; documented `herdr plugin action invoke jjuraszek.ntfy-notify.toggle`. New sections: when it fires (`blocked`/`done`/`idle` semantics), remote-access layering (Tailscale / Mosh / Herdr / keep-awake), troubleshooting.

## 0.1.0

- First release: `pane.agent_status_changed` event hook pushes to an ntfy topic when an agent goes `blocked` (priority 4) or `done` (priority 3).
- `toggle` action flips notifications on/off (`herdr plugin action invoke`) and reflects the state in the terminal title.
- Config via `.env` in the plugin config dir (`herdr plugin config-dir jjuraszek.ntfy-notify`): `NTFY_TOPIC` required, `NTFY_SERVER` / `NTFY_TOKEN` optional.
