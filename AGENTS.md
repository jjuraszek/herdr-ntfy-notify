# herdr-ntfy-notify

A [Herdr](https://herdr.dev) plugin that pushes a notification to an [ntfy](https://ntfy.sh) topic when an agent's status changes to `blocked` or `done`. Installed with `herdr plugin install jjuraszek/herdr-ntfy-notify`; discoverable on the Herdr marketplace via the `herdr-plugin` repo topic.

<!-- agents-core:begin v3-herdr - adapted from the pi-quiver/pi-cohort/pi-gauntlet/pi-condense shared core v3 (pi API -> Herdr/ntfy API, Linear -> GitHub issues). Edit AGENTS.core.md, then re-sync the block below. -->
## Ground Truth Before Reasoning

User instructions outrank skill and AGENTS.md guidance; on conflict, follow the user. Configured gates (design approval, ship verification) still run; a user instruction that already names the gated action satisfies its confirmation.

Never guess Herdr's plugin API, event payload shapes, `HERDR_PLUGIN_*` variables, or ntfy's publish API - read the source. Herdr plugin truth: https://herdr.dev/plugins (manifest fields, hook contracts, event payloads; `/llms.txt` indexes the docs) and the installed CLI (`herdr plugin --help`). ntfy truth: https://docs.ntfy.sh/publish. Other third-party APIs: never state a signature, config key, flag, or version-specific behavior from memory - verify in current docs (Context7 `resolve-library-id` then `query-docs`). If the source contradicts your assumption, the source wins; if it is missing, say so and ask - do not fabricate. Check the request's premise before acting: if the source contradicts it, say so once with evidence, then follow the user's decision.

The same rule applies to state you set up yourself. Before asserting that a job, publish, CI run, or process is in some state, run the command that shows it in this turn (`gh run view`, `herdr plugin list`, `git status`). A summary of what you started is a plan, not an observation.

## Authorization

An instruction that names an action and its parameters is the approval for that action ("release patch", "close #12 with a comment") - do it, then report. Ask only when a parameter is ambiguous or a safety check fails; say what failed, don't fix it silently. Once the design is settled, finish the authorized work before asking - the user approves a concrete result. Reversible, read-only, and already-authorized actions need no permission. Agent-initiated writes to a tracker or to files outside the repo keep their gate.

## Communication Style

**North star: sharp, human-readable, example-driven, condense.** Sharp = exact, no hedging (name the file/SHA/value). Human-readable = written like a person, not a report. Example-driven = a small before/after beats a paragraph. Condense = every sentence earns its place. One term per concept: name a thing once, reuse that name. A reply carries its substance inline - never point at tool outputs, finding numbers, or earlier turns the reader didn't see; restate in one sentence.

| Regime | Surfaces | Format |
|---|---|---|
| Human-facing comms | chat, commit messages, PR/issue bodies and comments, review feedback | no scaffolding (no Options/TL;DR templates, no headings on short comments); bullets over prose; end on the ask, not a summary |
| LLM-readable artifacts | AGENTS.md, README, CHANGELOG, specs, plans, skill/agent/prompt files, non-obvious-why code comments | tables, headings, explicit field references, code blocks; density still binds; optimize for unambiguous retrieval |

**Suppress process narration.** No intent classification, phase/routing announcements, tool/subagent preamble, status narration, pleasantries. **Output instead:** outcomes, decisions needing input, verification results, blockers. Start with the substance.

ASCII punctuation everywhere (chat, comments, commits, docs, code): `-` not em-dash, `...` not the ellipsis glyph, straight quotes; non-ASCII only for a justified visual mark. State what you did or will do; don't pad with what you won't do, what stays unchanged, or alternatives nobody asked about. No closing summaries.

## Code & Documentation Discipline

- **Code is a liability.** Add only what the task requires. No premature abstractions, no helpers for hypothetical reuse, no fallbacks for branches that can't happen, no commented-out alternatives.
- **No new machinery if not essential.** Reuse an existing field, channel, or code path (plus a small discriminant if needed) over a new sibling construct; new machinery must earn its place by being impossible or misleading to express with what exists.
- **No belt-and-suspenders.** Validate a thing once, at the boundary that owns it - not at every layer.
- **Delete dead code, don't comment it out.** When a change supersedes code, remove the old path in the same commit. Branch from the deletion commit if reversibility matters.
- **Comments are stock, not flow.** Record the durable why, never task context, tickets, or callers. Good: `// output is never empty for a real dispatch`. Bad: `// #12: gate on this so the classifier doesn't no-op`. No docstrings on self-evident params/returns, no banner comments.
- **Surface, don't auto-fix.** A bug fix doesn't drag in surrounding cleanup; mention adjacent issues separately.
- **Docs are a current contract, present tense.** No "upcoming"/"pending" in a current-state guide - planned work lives in `doc/specs/`, `doc/plans/`, or the issue; history lives in `CHANGELOG.md` and commit bodies, never in AGENTS.md or a guide. Doc updates ride with the commit that makes them stale. Editing a doc puts the smallest unit you touch - bullet, row, heading block - in scope: its paths resolve, its commands match the source, its framing is present tense; stale content outside that unit: flag, don't fix.
- **AGENTS.md is always-on essentials plus routing, not the manual.** Route detail to `doc/` or `README.md` and link it; add an inline pointer only when critical or high-frequency. README and AGENTS.md stay in sync where they overlap.
- **Markdown tables use compact `|---|` separators.** Never padded columns.

## Ticket convention

Work is tracked in GitHub issues on this repo - plain `gh issue` CLI, no template gate. Creating or editing an issue happens on a user instruction naming it; status transitions and comments likewise.

<!-- agents-core:end v3-herdr -->

## Layout

| File | Role |
|---|---|
| `herdr-plugin.toml` | Plugin manifest: `pane.agent_status_changed` event hook + `toggle` / `enable` / `disable` actions; all commands run via `/bin/sh run.sh` |
| `run.sh` | POSIX sh launcher: locates `node` (mise shims, Homebrew, nvm) when `PATH` is bare (launchd/systemd), then execs the named script |
| `notify.mjs` | Event handler; reads `HERDR_PLUGIN_EVENT_JSON` / `HERDR_PLUGIN_CONTEXT_JSON`, filters to `blocked`/`done`, POSTs to ntfy |
| `lib.mjs` | dotenv loading, enabled-state file, terminal-title indicator |
| `toggle.mjs` | `toggle` / `enable` / `disable` action implementation (`on` / `off` / no arg) |
| `.env.example` | Documented config template; users copy it to the plugin config dir |
| `test/notify.test.mjs` | `node --test` suite: publishes against an in-process HTTP server, filter, exit codes, dotenv, toggle state |
| `scripts/check-agents-core.mjs` | Guards the shared-core block in this file against `AGENTS.core.md`; `--fix` re-syncs |
| `.github/workflows/test.yml` | CI: core check, `node --check`, tests on ubuntu + macos, Node 18 + 22 |

## Rules

- **Zero dependencies, plain Node ESM, Node >= 18 (global `fetch`).** No build step, no `node_modules` - a dependency must be argued for, not added.
- **The event hook stays fast and never blocks Herdr**: filter on status early, exit 0 on anything unexpected (missing config, malformed event JSON), no retries, no waiting.
- **Never commit `.env`.** `NTFY_TOPIC` and `NTFY_TOKEN` are secrets; config lives in the Herdr plugin config dir (`herdr plugin config-dir jjuraszek.ntfy-notify`), not the repo.
- **Env var naming:** `NTFY_*` for ntfy connection settings, `HERDR_NTFY_*` for plugin behavior toggles; document every key in `.env.example`.
- **Message bodies stay generic** (`workspace - tab`, status in the title) - the ntfy topic is a shared secret on the public server, so no task content in pushes.
- **Version lives in two places** - `herdr-plugin.toml` and `package.json` - bump both in the same commit, plus a `CHANGELOG.md` entry.
- **A user-visible change** updates `README.md` and `CHANGELOG.md` (`## Unreleased` or the version being cut) in the same commit.

## Testing

```sh
npm test                                            # node --test test/*.test.mjs - offline, in-process ntfy stub
node scripts/check-agents-core.mjs                  # shared-core block in sync (--fix to rewrite)
node --check notify.mjs lib.mjs toggle.mjs          # syntax
```

Live check against the real server (publish + poll back):

```sh
T="selftest-$RANDOM"; NTFY_TOPIC="$T" \
HERDR_PLUGIN_EVENT_JSON='{"data":{"agent":"pi","display_agent":"Pi","agent_status":"blocked"}}' \
HERDR_PLUGIN_CONTEXT_JSON='{"workspace_label":"ws","tab_label":"tab"}' \
node notify.mjs && curl -s "https://ntfy.sh/$T/json?poll=1"
```

End-to-end: `herdr plugin link /path/to/herdr-ntfy-notify`, flip a real agent to blocked, watch the phone. Tests spawn the scripts as child processes with `HERDR_NTFY_SET_TITLE=0` so they never call `herdr`; a new behavior gets a case in `test/notify.test.mjs`.

## Release

Manual: bump `herdr-plugin.toml` + `package.json`, promote the `CHANGELOG.md` section, commit `Release X.Y.Z`, tag `vX.Y.Z`, push with tags. Distribution is the GitHub repo itself (`herdr plugin install jjuraszek/herdr-ntfy-notify`); no npm publish.

## Routing

| Want to ... | Read |
|---|---|
| Install, configure, toggle, security model | [`README.md`](README.md) |
| What changed across versions | [`CHANGELOG.md`](CHANGELOG.md) |
| Config keys | [`.env.example`](.env.example) |
| Herdr plugin mechanics (hooks, events, config/state dirs) | https://herdr.dev/plugins |
| ntfy publish API (headers, priority, auth) | https://docs.ntfy.sh/publish |
| Change the shared core | edit [`AGENTS.core.md`](AGENTS.core.md), run `node scripts/check-agents-core.mjs --fix` |
