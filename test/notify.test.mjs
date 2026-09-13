import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const execFileAsync = promisify(execFile);

async function run(script, args, env) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [join(root, script), ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HERDR_NTFY_SET_TITLE: "0", ...env },
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

test("blocked publishes priority 4 with title and generic body", async () => {
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

test("run.sh reaches the script via sh and forwards args", async () => {
  const { stderr } = await execFileAsync(
    "/bin/sh",
    [join(root, "run.sh"), "notify.mjs"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HERDR_NTFY_SET_TITLE: "0",
        HERDR_PLUGIN_EVENT_JSON: event("blocked"),
      },
    },
  );
  // No NTFY_TOPIC: stderr proves run.sh located node and executed the script.
  assert.match(stderr, /missing NTFY_TOPIC/);
});

test("malformed event, null context, unreadable state and missing topic exit 0", async () => {
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
  const stateDir = mkdtempSync(join(tmpdir(), "ntfy-state-"));
  try {
    writeFileSync(join(stateDir, "enabled"), "enabled", { mode: 0o000 });
    const broken = await run("notify.mjs", [], {
      NTFY_TOPIC: "x",
      HERDR_PLUGIN_STATE_DIR: stateDir,
      HERDR_PLUGIN_EVENT_JSON: event("blocked"),
    });
    assert.equal(broken.status, 0);
    assert.match(broken.stderr, /^ntfy-notify: EACCES/);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
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

test("config dir .env is loaded and disabled state suppresses publishing", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "ntfy-cfg-"));
  const stateDir = mkdtempSync(join(tmpdir(), "ntfy-state-"));
  try {
    await withNtfy(async (server, requests) => {
      writeFileSync(
        join(configDir, ".env"),
        `NTFY_SERVER=${server} # inline comment\nNTFY_TOPIC="from-dotenv" # quoted\nNTFY_TOKEN='tk#1'\n`,
      );
      const env = {
        HERDR_PLUGIN_CONFIG_DIR: configDir,
        HERDR_PLUGIN_STATE_DIR: stateDir,
        HERDR_PLUGIN_EVENT_JSON: event("blocked"),
      };
      assert.equal((await run("notify.mjs", [], env)).status, 0);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, "/from-dotenv");
      assert.equal(requests[0].headers.authorization, "Bearer tk#1");

      const off = await run("toggle.mjs", ["off"], env);
      assert.equal(off.status, 0);
      assert.match(off.stdout, /disabled/);
      assert.equal(readFileSync(join(stateDir, "enabled"), "utf8").trim(), "disabled");
      assert.equal((await run("notify.mjs", [], env)).status, 0);
      assert.equal(requests.length, 1);

      const on = await run("toggle.mjs", ["on"], env);
      assert.match(on.stdout, /enabled/);
      assert.equal((await run("notify.mjs", [], env)).status, 0);
      assert.equal(requests.length, 2);

      const flipped = await run("toggle.mjs", [], env);
      assert.match(flipped.stdout, /disabled/);
      assert.ok(existsSync(join(stateDir, "enabled")));
    });
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
});
