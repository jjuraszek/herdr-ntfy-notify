# Changelog

## Unreleased

- Hook never exits non-zero: a failed or timed-out ntfy publish (5 s `AbortSignal.timeout`) logs one line to stderr and exits 0, per the never-block-Herdr rule.
- `enable` / `disable` actions next to `toggle` (`herdr plugin action invoke jjuraszek.ntfy-notify.disable`) - set the state outright without seeing the terminal title.
- `npm test`: `node --test` suite against an in-process ntfy stub (publish headers/body, status filter, exit-0 paths, dotenv from `HERDR_PLUGIN_CONFIG_DIR`, toggle state file). CI on ubuntu + macos, Node 18 + 22, plus `scripts/check-agents-core.mjs` guarding the shared AGENTS core.
- Repo hygiene aligned with the pi-* siblings: `CONTRIBUTING.md`, issue and PR templates, FUNDING; logo downscaled from 3.1 MB to 230 KB.
- README: fixed the toggle keybinding (`[[keys.command]]` with `type = "plugin_action"`, not the invented `[keybinds]` table) and the unverified "command palette" claim; documented `herdr plugin action invoke jjuraszek.ntfy-notify.toggle`. New sections: when it fires (`blocked`/`done`/`idle` semantics), remote-access layering (Tailscale / Mosh / Herdr / keep-awake), troubleshooting.

## 0.1.0

- First release: `pane.agent_status_changed` event hook pushes to an ntfy topic when an agent goes `blocked` (priority 4) or `done` (priority 3).
- `toggle` action flips notifications on/off from Herdr's command palette and reflects the state in the terminal title.
- Config via `.env` in the plugin config dir (`herdr plugin config-dir jjuraszek.ntfy-notify`): `NTFY_TOPIC` required, `NTFY_SERVER` / `NTFY_TOKEN` optional.
