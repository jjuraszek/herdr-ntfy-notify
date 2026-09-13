import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const execFileAsync = promisify(execFile);

// Fake `herdr`: logs every argv (fields joined by `|`), prints the canned tab
// list for `tab list`, fails when the marker file exists.
const FAKE_HERDR = `#!/bin/sh
printf '%s|' "$@" >> "$HERDR_FAKE_LOG"; printf '\\n' >> "$HERDR_FAKE_LOG"
[ -f "$HERDR_FAKE_FAIL" ] && exit 1
if [ "$1" = tab ] && [ "$2" = list ]; then cat "$HERDR_FAKE_TABS"; fi
exit 0
`;

const FAKE_HERDR_LIST_THEN_FAIL = `#!/bin/sh
printf '%s|' "$@" >> "$HERDR_FAKE_LOG"; printf '\\n' >> "$HERDR_FAKE_LOG"
if [ "$1" = tab ] && [ "$2" = list ]; then cat "$HERDR_FAKE_TABS"; exit 0; fi
exit 1
`;

export function harness({ armed = ["w1:t1"], tabs = [{ tab_id: "w1:t1", label: "label" }], tabsRaw, fail = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ntfy-h-"));
  const bin = join(dir, "herdr");
  writeFileSync(bin, FAKE_HERDR, { mode: 0o755 });
  const tabsPath = join(dir, "tabs.json");
  writeFileSync(tabsPath, tabsRaw ?? JSON.stringify({ id: 1, result: { type: "tab_list", tabs } }));
  const stateDir = join(dir, "state");
  mkdirSync(stateDir);
  if (armed !== null) {
    writeFileSync(join(stateDir, "armed.json"), JSON.stringify({ tabs: armed }));
  }
  const failPath = join(dir, "fail");
  if (fail) {
    writeFileSync(failPath, "");
  }
  const log = join(dir, "herdr.log");
  return {
    dir,
    stateDir,
    env: {
      HERDR_BIN_PATH: bin,
      HERDR_FAKE_LOG: log,
      HERDR_FAKE_TABS: tabsPath,
      HERDR_FAKE_FAIL: failPath,
      HERDR_PLUGIN_STATE_DIR: stateDir,
      HERDR_TAB_ID: "w1:t1",
    },
    calls() {
      if (!existsSync(log)) {
        return [];
      }
      return readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("|").slice(0, -1));
    },
    armed() {
      return JSON.parse(readFileSync(join(stateDir, "armed.json"), "utf8")).tabs;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const defaults = harness();
process.on("exit", () => defaults.cleanup());

async function run(script, args, env, h = defaults) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [join(root, script), ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: { PATH: process.env.PATH, ...h.env, ...env },
      },
    );
    return { status: 0, stdout, stderr };
  } catch (error) {
    return { status: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function withNtfy(fn) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ url: req.url, headers: req.headers, body });
      res.writeHead(200).end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.close();
  }
}

const event = (status) =>
  JSON.stringify({ data: { agent: "pi", display_agent: "Pi", agent_status: status } });
const context = JSON.stringify({ workspace_label: "ws", tab_label: "tab" });

test("blocked on an armed tab publishes priority 4 with title and generic body", async () => {
  await withNtfy(async (server, requests) => {
    const r = await run("notify.mjs", [], {
      NTFY_SERVER: server,
      NTFY_TOPIC: "t1",
      NTFY_TOKEN: "tk_abc",
      HERDR_PLUGIN_EVENT_JSON: event("blocked"),
      HERDR_PLUGIN_CONTEXT_JSON: context,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(requests.length, 1);
    const [req] = requests;
    assert.equal(req.url, "/t1");
    assert.equal(req.headers.title, "Pi is blocked");
    assert.equal(req.headers.priority, "4");
    assert.equal(req.headers.tags, "warning");
    assert.equal(req.headers.authorization, "Bearer tk_abc");
    assert.equal(req.body, "ws - tab");
  });
});

test("done publishes priority 3", async () => {
  await withNtfy(async (server, requests) => {
    const r = await run("notify.mjs", [], {
      NTFY_SERVER: server,
      NTFY_TOPIC: "t2",
      HERDR_PLUGIN_EVENT_JSON: event("done"),
      HERDR_PLUGIN_CONTEXT_JSON: context,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(requests[0].headers.title, "Pi is done");
    assert.equal(requests[0].headers.priority, "3");
    assert.equal("authorization" in requests[0].headers, false);
  });
});

test("working and idle are filtered without a request", async () => {
  await withNtfy(async (server, requests) => {
    for (const status of ["working", "idle", "unknown"]) {
      const r = await run("notify.mjs", [], {
        NTFY_SERVER: server,
        NTFY_TOPIC: "t3",
        HERDR_PLUGIN_EVENT_JSON: event(status),
      });
      assert.equal(r.status, 0);
      assert.equal(r.stderr, "");
    }
    assert.equal(requests.length, 0);
  });
});

test("unarmed tab, other armed tab, missing tab id: exit 0, silent, no request", async () => {
  const h = harness({ armed: ["w1:t9"] });
  try {
    await withNtfy(async (server, requests) => {
      const base = { NTFY_SERVER: server, NTFY_TOPIC: "t4", HERDR_PLUGIN_EVENT_JSON: event("blocked") };
      for (const env of [base, { ...base, HERDR_TAB_ID: "" }]) {
        const r = await run("notify.mjs", [], env, h);
        assert.equal(r.status, 0);
        assert.equal(r.stderr, "");
      }
      assert.equal(requests.length, 0);
    });
  } finally {
    h.cleanup();
  }
});

test("malformed and unreadable armed.json: exit 0, silent, no request", async () => {
  const h = harness({ armed: null });
  try {
    await withNtfy(async (server, requests) => {
      const env = { NTFY_SERVER: server, NTFY_TOPIC: "t5", HERDR_PLUGIN_EVENT_JSON: event("blocked") };
      writeFileSync(join(h.stateDir, "armed.json"), "{oops");
      let r = await run("notify.mjs", [], env, h);
      assert.equal(r.status, 0);
      assert.equal(r.stderr, "");
      if (process.getuid?.() !== 0) {
        writeFileSync(join(h.stateDir, "armed.json"), JSON.stringify({ tabs: ["w1:t1"] }));
        chmodSync(join(h.stateDir, "armed.json"), 0o000);
        r = await run("notify.mjs", [], env, h);
        assert.equal(r.status, 0);
        assert.equal(r.stderr, "");
      }
      assert.equal(requests.length, 0);
    });
  } finally {
    h.cleanup();
  }
});

test("prefixed tab labels render without the marker", async () => {
  await withNtfy(async (server, requests) => {
    const base = { NTFY_SERVER: server, NTFY_TOPIC: "t6", HERDR_PLUGIN_EVENT_JSON: event("done") };
    await run("notify.mjs", [], {
      ...base,
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ workspace_label: "ws", tab_label: "* 1" }),
    });
    await run("notify.mjs", [], {
      ...base,
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ workspace_label: "ws", tab_label: "* Fix E-2588" }),
    });
    assert.deepEqual(
      requests.map((r) => r.body),
      ["ws", "ws - Fix E-2588"],
    );
  });
});

test("the hook never spawns herdr", async () => {
  const h = harness();
  try {
    await withNtfy(async (server) => {
      await run("notify.mjs", [], { NTFY_SERVER: server, NTFY_TOPIC: "t7", HERDR_PLUGIN_EVENT_JSON: event("blocked") }, h);
    });
    assert.deepEqual(h.calls(), []);
  } finally {
    h.cleanup();
  }
});

test("run.sh reaches the script via sh and forwards args", async () => {
  const { stderr } = await execFileAsync(
    "/bin/sh",
    [join(root, "run.sh"), "notify.mjs"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        ...defaults.env,
        HERDR_PLUGIN_EVENT_JSON: event("blocked"),
      },
    },
  );
  // No NTFY_TOPIC: stderr proves run.sh located node and executed the script.
  assert.match(stderr, /missing NTFY_TOPIC/);
});

test("malformed event, null context and missing topic exit 0", async () => {
  assert.equal(
    (await run("notify.mjs", [], { NTFY_TOPIC: "x", HERDR_PLUGIN_EVENT_JSON: "garbage" })).status,
    0,
  );
  assert.equal(
    (
      await run("notify.mjs", [], {
        NTFY_TOPIC: "x",
        HERDR_PLUGIN_EVENT_JSON: "null",
        HERDR_PLUGIN_CONTEXT_JSON: "null",
      })
    ).status,
    0,
  );
  const r = await run("notify.mjs", [], { HERDR_PLUGIN_EVENT_JSON: event("blocked") });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /NTFY_TOPIC/);
});

async function closedPort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

test("unreachable server exits 0 with one stderr line", async () => {
  const r = await run("notify.mjs", [], {
    NTFY_SERVER: `http://127.0.0.1:${await closedPort()}`,
    NTFY_TOPIC: "x",
    HERDR_PLUGIN_EVENT_JSON: event("blocked"),
  });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /^ntfy publish failed: /);
  assert.equal(r.stderr.trim().split("\n").length, 1);
});

test("config dir .env is loaded for an armed tab", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "ntfy-cfg-"));
  try {
    await withNtfy(async (server, requests) => {
      writeFileSync(
        join(configDir, ".env"),
        `NTFY_SERVER=${server} # inline comment\nNTFY_TOPIC="from-dotenv" # quoted\nNTFY_TOKEN='tk#1'\n`,
      );
      const env = { HERDR_PLUGIN_CONFIG_DIR: configDir, HERDR_PLUGIN_EVENT_JSON: event("blocked") };
      assert.equal((await run("notify.mjs", [], env)).status, 0);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, "/from-dotenv");
      assert.equal(requests[0].headers.authorization, "Bearer tk#1");
    });
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test("toggle arms then disarms the current tab and mirrors the label", async () => {
  const h = harness({ armed: [] });
  try {
    const on = await run("toggle.mjs", [], {}, h);
    assert.equal(on.status, 0, on.stderr);
    assert.equal(on.stdout.trim(), "ntfy-notify: w1:t1 armed");
    assert.deepEqual(h.armed(), ["w1:t1"]);
    assert.deepEqual(h.calls(), [["tab", "list"], ["tab", "rename", "w1:t1", "* label"]]);

    writeFileSync(h.env.HERDR_FAKE_TABS, JSON.stringify({ id: 2, result: { type: "tab_list", tabs: [{ tab_id: "w1:t1", label: "* label" }] } }));
    const off = await run("toggle.mjs", [], {}, h);
    assert.equal(off.status, 0, off.stderr);
    assert.equal(off.stdout.trim(), "ntfy-notify: w1:t1 disarmed");
    assert.deepEqual(h.armed(), []);
    assert.deepEqual(h.calls().slice(2), [["tab", "list"], ["tab", "rename", "w1:t1", "label"]]);
  } finally {
    h.cleanup();
  }
});

test("on/enabled and off/disabled are idempotent and never double the marker", async () => {
  const h = harness({ armed: ["w1:t1"], tabs: [{ tab_id: "w1:t1", label: "* label" }] });
  try {
    for (const arg of ["on", "enabled", "enable"]) {
      const r = await run("toggle.mjs", [arg], {}, h);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(h.armed(), ["w1:t1"]);
    }
    assert.deepEqual(h.calls(), [["tab", "list"], ["tab", "list"], ["tab", "list"]]);

    writeFileSync(h.env.HERDR_FAKE_TABS, JSON.stringify({ id: 3, result: { type: "tab_list", tabs: [{ tab_id: "w1:t1", label: "label" }] } }));
    for (const arg of ["off", "disabled", "disable"]) {
      const r = await run("toggle.mjs", [arg], {}, h);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(h.armed(), []);
    }
    // A no-prefix label on disarm issues no rename.
    assert.deepEqual(h.calls().slice(3), [["tab", "list"], ["tab", "list"], ["tab", "list"]]);
  } finally {
    h.cleanup();
  }
});

test("stale ids are pruned while the current tab is still added", async () => {
  const h = harness({
    armed: ["w1:t7", "w2:t2"],
    tabs: [{ tab_id: "w1:t1", label: "1" }, { tab_id: "w2:t2", label: "other" }],
  });
  try {
    const r = await run("toggle.mjs", [], {}, h);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(h.armed(), ["w1:t1", "w2:t2"]);
    assert.deepEqual(h.calls()[1], ["tab", "rename", "w1:t1", "* 1"]);
  } finally {
    h.cleanup();
  }
});

test("tab list failing or returning non-JSON still writes state, no prune, no rename, exit 0", async () => {
  for (const opts of [{ fail: true }, { tabsRaw: "not json" }, { tabs: [{ tab_id: "w9:t9", label: "x" }] }]) {
    const h = harness({ armed: ["w1:t7"], ...opts });
    try {
      const r = await run("toggle.mjs", ["on"], {}, h);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr.trim().split("\n").length, 1);
      assert.deepEqual(h.armed(), ["w1:t1", "w1:t7"]);
      assert.deepEqual(h.calls(), [["tab", "list"]]);
    } finally {
      h.cleanup();
    }
  }
});

test("rename failing after a successful list keeps state and exits 0", async () => {
  const h = harness({ armed: [] });
  try {
    writeFileSync(join(h.dir, "herdr"), FAKE_HERDR_LIST_THEN_FAIL, { mode: 0o755 });
    const r = await run("toggle.mjs", ["on"], {}, h);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /rename/);
    assert.deepEqual(h.armed(), ["w1:t1"]);
  } finally {
    h.cleanup();
  }
});

test("no HERDR_TAB_ID exits 1 and writes nothing", async () => {
  const h = harness({ armed: null });
  try {
    const r = await run("toggle.mjs", [], { HERDR_TAB_ID: "" }, h);
    assert.equal(r.status, 1);
    assert.equal(r.stderr.trim(), "ntfy-notify: no active tab");
    assert.equal(existsSync(join(h.stateDir, "armed.json")), false);
    assert.deepEqual(h.calls(), []);
  } finally {
    h.cleanup();
  }
});

test("unwritable state dir exits 1 with a stderr line and no rename", { skip: process.getuid?.() === 0 }, async () => {
  const h = harness({ armed: [] });
  try {
    chmodSync(h.stateDir, 0o500);
    const r = await run("toggle.mjs", ["on"], {}, h);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^ntfy-notify: cannot write .*armed\.json: EACCES/);
    assert.deepEqual(h.calls(), [["tab", "list"]]);
  } finally {
    chmodSync(h.stateDir, 0o700);
    h.cleanup();
  }
});
