# Per-tab opt-in notifications with a `* ` tab-label indicator

**Ticket:** [#1](https://github.com/jjuraszek/herdr-ntfy-notify/issues/1)
**Goal:** Replace the global default-on switch with per-Herdr-tab opt-in arming, default off, with the armed state shown as a leading `* ` on the tab label.
**Release:** 1.1.0

## Problem

Today one state file (`$HERDR_PLUGIN_STATE_DIR/enabled`) turns the plugin on or off for every tab, and it defaults to on. The user runs several agents in parallel and wants pushes only for the tab they walked away from. The terminal-title indicator (`setWindowTitleIndicator`: sets `ntfy on` when enabled, clears the title when disabled) is global, so it cannot show which tabs notify.

All Herdr facts below are verified against Herdr **0.9.0** (git tag `v0.9.0` of `herdrdev/herdr`); pi-quiver facts against `jjuraszek/pi-quiver` commit `f6962ef`.

## Verified facts the design relies on

| Fact | Source |
|---|---|
| Every runtime plugin command receives `HERDR_TAB_ID` "when available"; it is absent only when no workspace is active | Herdr 0.9.0 plugins docs; `src/app/api/plugins/mod.rs` `merge_plugin_context` -> `current_plugin_context`. Reproducible check: bind an action whose command is `sh -c 'echo $HERDR_TAB_ID >> /tmp/tab'` and compare with the `focused: true` entry of `herdr tab list` |
| For `pane.agent_status_changed`, `HERDR_TAB_ID` is the tab containing the pane that changed, not the focused tab | `src/app/api/plugins/context.rs` `plugin_context_for_event` -> `plugin_context_for_public_pane_id` |
| Action invocations (keybinding and `herdr plugin action invoke`) get `HERDR_TAB_ID` = the active workspace's active tab | `handle_plugin_action_invoke` (same file as above). Contradicts #1's "CLI invoke carries no tab" - the ticket AC "exit non-zero from CLI" is dropped |
| `herdr tab list` prints `{"id":..., "result":{"type":"tab_list","tabs":[{tab_id, workspace_id, number, label, focused, pane_count, agent_status}]}}`; the list spans all workspaces | live 0.9.0 output |
| `herdr tab rename <TAB_ID> <LABEL>...` sets a string label; there is no reset-to-automatic | `herdr tab rename --help`; socket schema `tab.rename` |
| Tab ids are strings `w<ws>:t<base36 counter>` (`w1:t1D`), contain `:`. The per-workspace counter `next_public_tab_number` is persisted in the session snapshot and restored, so ids are never reused within a server's session file and survive restart. A fresh server (snapshot deleted) restarts counters | `src/persist/snapshot.rs:63-65, 297-298`; live output |
| Automatic labels are the tab number as a string (`"1"`, `"2"`); `TabInfo` has no automatic-vs-custom flag | live `herdr tab list` output; socket schema `TabInfo` |
| `herdr tab rename` stores the string verbatim as a custom label, including `""`; an empty custom label renders empty, not as the number | `src/workspace.rs:446-452` (`tab_display_name`: `custom_name.unwrap_or(tab_idx + 1)`), `:1006-1008` (`set_custom_name`) |
| pi-quiver's Herdr tab sink is claim-once: it renames only while the live label equals its last write (`if (live !== this.lastWritten) { this.state = "backed-off"; return; }` pattern); a foreign label flips it to `backed-off` for the rest of the pi session | `pi-quiver@f6962ef` `extensions/session-name.ts:499-545`, `lib/herdr-tab.ts` |

## Decisions

| Question | Decision |
|---|---|
| CLI/SSH `plugin action invoke` | Acts on the focused tab, same as the keybinding. No detection of invocation source. |
| Default | Off. A tab that was never armed never notifies. The old `enabled` file is ignored, not migrated or deleted. |
| Arming lifecycle | Sticky. Armed until toggled off; every `blocked`/`done` on an armed tab pushes. The event hook never writes state or renames tabs. |
| Ticket AC "re-apply `* ` on next blocked/done event" | **Dropped.** The hook stays a filter + POST with no `herdr` spawn (AGENTS.md: hook never blocks Herdr), and pi-quiver - the only known foreign renamer - never overwrites a label it did not write. Recovery after a manual rename: run `enable` on the tab; step 4 of the toggle re-adds the prefix. Documented in README. |
| Ticket AC `HERDR_NTFY_ENABLED=1/0` override, "CLI invoke exits non-zero" | Dropped (see rows above and the `HERDR_TAB_ID` fact). |
| Indicator | `* ` prefix on the tab label, the only indicator. `setTerminalTitle`, `HERDR_NTFY_SET_TITLE`, `HERDR_NTFY_TITLE` are removed. |
| `HERDR_NTFY_ENABLED` | Removed. The per-tab toggle is the only control. |
| Stale tab ids | Pruned on every toggle/enable/disable using the `herdr tab list` call already needed for the label. No startup hook. |
| pi-quiver | Accepted: arming freezes pi-quiver auto-naming for that tab until the pi session restarts. Follow-up filed in pi-quiver (see Out of scope). |

## Design

### State: `lib.mjs`

- State file `$HERDR_PLUGIN_STATE_DIR/armed.json` (XDG fallback kept as today), shape `{"tabs": ["w1:t1D", ...]}`.
- `readArmed()` -> `Set<string>`; missing or unreadable file (including `EACCES`), unparsable JSON, or `tabs` not an array of strings -> empty set. Never throws, prints nothing.
- `writeArmed(set)` -> `mkdir -p` the dir, write `armed.json.<pid>.tmp` in the same directory, `renameSync` over `armed.json`. Readers never see a partial file. Two concurrent toggles are read-modify-write races: last writer wins and one arming can be lost - accepted (toggles are human-driven).
- `herdr(args)` -> `{ ok: boolean, json: any | null }`. Generalizes the existing `spawnSync` pattern (`setWindowTitleIndicator`, `lib.mjs:86-115`). Executable: `HERDR_BIN_PATH` when set (no fall-through on non-zero exit or spawn error), else `herdr` from `PATH`. `ok` = spawned and exited 0. `json` = `JSON.parse(stdout)` when that succeeds, else `null` (rename prints no JSON; `ok` alone decides success). Never throws.
- `stripPrefix(label)` -> removes exactly one leading `* `; `addPrefix(label)` -> `label` if it already starts with `* `, else `"* " + label`. Shared by toggle and hook.
- Deleted: `modeEnabled`, `setMode`, `setWindowTitleIndicator`, `envFlag` (no callers remain), all reads of `HERDR_NTFY_SET_TITLE`, `HERDR_NTFY_TITLE`, `HERDR_NTFY_ENABLED`.

### Toggle: `toggle.mjs`

Arguments unchanged, all current spellings kept: no arg -> toggle; `on`/`enable`/`enabled` -> arm; `off`/`disable`/`disabled` -> disarm.

1. `HERDR_TAB_ID` missing -> stderr `ntfy-notify: no active tab`, exit 1, nothing written.
2. `{ok, json} = herdr(["tab","list"])`. Valid iff `ok` and `Array.isArray(json?.result?.tabs)` and the current tab id is in it. Valid: `live = Set(tabs[].tab_id)`, `armed = readArmed() ∩ live`, `label = tabs.find(tab_id).label`. Invalid (spawn failure, non-zero exit, unparsable or unexpected JSON, tab absent - race with a close): `armed = readArmed()` (no prune), `label = null`, one stderr line.
3. Flip or set membership of `HERDR_TAB_ID` in `armed`. `writeArmed(armed)`. Write failure -> stderr `ntfy-notify: cannot write <path>: <code>`, exit 1, no rename.
4. If `label !== null`: `newLabel = arm ? addPrefix(label) : stripPrefix(label)`. Call `herdr(["tab","rename", tabId, newLabel])` only when `newLabel !== label` (one argv for the label so spaces survive). `!ok` -> stderr line, still exit 0.
5. stdout `ntfy-notify: <tabId> armed|disarmed`, exit 0.

`toggle.mjs` gets a top-level `try/catch` like `notify.mjs:4-9` so any other exception is one stderr line + exit 1, never a stack trace.

State is the truth; the label is a best-effort mirror.

### Hook: `notify.mjs`

Check order inside the existing exit-0 boundary: parse `HERDR_PLUGIN_EVENT_JSON` and `HERDR_PLUGIN_CONTEXT_JSON` -> status = `statusFromEvent(event) ?? statusFromContext(context)` (existing fallback kept) in {`blocked`,`done`} -> `HERDR_TAB_ID` present and in `readArmed()` -> `loadDotEnv()` and `NTFY_TOPIC` -> POST. An unarmed tab exits before reading `.env`. No `herdr` spawn on this path.

Body: `namedTabLabel` receives `stripPrefix(context.tab_label)`, so the numeric-label drop still fires for an armed default tab (`* 1` -> `1` -> dropped) and a named armed tab renders `ws - Fix E-2588`, not `ws - * Fix E-2588`. Title unchanged.

### Manifest and version

- `herdr-plugin.toml`: version `1.1.0`; `min_herdr_version = "0.9.0"` (was `0.7.0`; every fact above is verified at 0.9.0 and nothing older was checked); action descriptions "Toggle/arm/disarm ntfy notifications for this tab". Commands unchanged (`/bin/sh run.sh toggle.mjs ...`).
- `package.json`: version `1.1.0`.
- `CHANGELOG.md`: the current `## Unreleased` block (run.sh node probing, exit-0 boundary, enable/disable actions, test suite, README rework) is promoted into `## 1.1.0` together with the per-tab entries; the default flip (was on for all, now off per tab) is called out as breaking.

## Edge cases

| Case | Behavior |
|---|---|
| Hook: no `HERDR_TAB_ID`, malformed or unreadable `armed.json`, unarmed tab | exit 0, no POST, nothing on stderr |
| Toggle: `herdr tab list` fails, returns unexpected JSON, or omits this tab (race with close) | state written, no prune, no rename, stderr note, exit 0 |
| Toggle: `herdr tab rename` fails | state already written, stderr note, exit 0 |
| Toggle: state dir unwritable | stderr line, exit 1, no rename |
| Label already starts with `* ` when arming | unchanged, never `* * ` |
| Arming a tab with an automatic label (`"1"`) | label becomes the custom label `* 1`; disarm leaves custom `1`, which no longer follows Herdr renumbering. Accepted (no reset-to-automatic API) and documented in README |
| Label is exactly `* ` when disarming | renamed to `""` (empty custom label, stays empty) |
| Disarm a tab with no prefix (someone renamed it while armed) | state cleared, no rename |
| Prune vs current tab | prune runs on the pre-flip set; the current tab is added/removed after, so it can never be pruned away |
| Prefix removed by another rename while armed | no repair; tab stays armed, keeps notifying. Run `enable` to restore the marker |
| Two toggles at once (keybinding + phone SSH) | last writer wins; one arming may be lost; unique tmp names keep the file itself intact |
| Two Herdr servers sharing one plugin state dir | a toggle in server A prunes ids that only exist in server B. Accepted: one Herdr server per plugin state dir |
| Tab closed while armed | id pruned on the next toggle of any tab |
| Herdr restart | ids restored from the snapshot; armed set stays valid. Snapshot deleted -> counters restart; stale armed ids could match new tabs until the next toggle prunes/overwrites them. Accepted |
| Upgrade from 0.1.0 | all tabs start disarmed; old `enabled` file inert |

## Testing (`test/notify.test.mjs`, existing child-process pattern)

- Fake `herdr` executable in a temp dir, passed via `HERDR_BIN_PATH`: appends every argv to an invocation log, prints canned `tab list` JSON from a fixture file, exits non-zero when a marker file says so. Replaces the `HERDR_NTFY_SET_TITLE=0` stub in `run()`; `run()` also seeds `HERDR_TAB_ID` and an `armed.json` containing it by default, so publish-path tests keep working. Tests that need an unarmed tab override that.
- Existing tests adjusted: `blocked publishes` / `done publishes` / `unreachable server` (`test/notify.test.mjs:55-100, 164-172`) rely on the seeded armed default; the `run.sh` smoke test (`:103-120`) keeps asserting `missing NTFY_TOPIC`, which stays reachable because the seeded tab is armed; the unreadable-state case (`:133-148`) now asserts exit 0 with empty stderr instead of `ntfy-notify: EACCES`; the dotenv assertions from `:174-213` (config-dir `.env`, inline comments, quoted `#` in `NTFY_TOKEN`) move to a standalone armed-tab test; only the global `enabled` assertions are deleted.
- notify: armed tab + `blocked` -> one POST; unarmed tab -> no POST, exit 0; no `HERDR_TAB_ID` -> exit 0; malformed `armed.json` -> exit 0; armed tab A does not notify for tab B's event; `tab_label` `* 1` -> body `ws`; `tab_label` `* Fix` -> body `ws - Fix`; invocation log empty after any hook run (no `herdr` spawn).
- toggle: `toggle` arms (state contains id, rename log shows `* label`) then disarms (id gone, rename log shows `label`); `on`/`off`/`enabled`/`disabled` idempotent; seeded stale id pruned while the current tab (absent from the stale list fixture's armed set) is still added; `* label` never doubled; disarm of a no-prefix label issues no rename; `tab list` failing still writes state and exits 0 with no rename; `tab list` returning non-JSON -> same; no `HERDR_TAB_ID` -> exit 1 and no state file; unwritable state dir -> exit 1.

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `README.md` (toggle section: per-tab, default off, `* ` indicator, CLI acts on focused tab, pi-quiver interaction, automatic-label pinning, `enable` restores a lost marker, state file path, Herdr >= 0.9.0; remove terminal-title and `HERDR_NTFY_ENABLED` text), `CHANGELOG.md` (promote `Unreleased` into 1.1.0; default flip called out as breaking), `.env.example` (remove `HERDR_NTFY_ENABLED`, `HERDR_NTFY_SET_TITLE`, `HERDR_NTFY_TITLE`), `AGENTS.md` (layout row for `lib.mjs`; rules bullet: state lives in `armed.json`, hook never spawns `herdr`; testing paragraph: `HERDR_BIN_PATH` stub replaces `HERDR_NTFY_SET_TITLE=0`)
- Derived / memory docs invalidated: none

Materiality bar: `reference/documentation-impact.md` in the brainstorming skill directory.

## Out of scope

- pi-quiver prefix awareness (compare labels modulo a leading `* `, preserve it on rename). Tracked as a GitHub issue on `jjuraszek/pi-quiver`, filed right after this spec is committed.
- Startup hook or `tab.renamed` hook to re-apply `* ` after restarts or foreign renames.
- Explicit tab-id argument for CLI targeting; per-pane arming; configurable marker glyph; `HERDR_NTFY_ENABLED` in any form.
- Migration of the 0.1.0 `enabled` file.

## Open questions

None.
