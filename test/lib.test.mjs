import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addPrefix, armedPath, herdr, readArmed, stripPrefix, writeArmed } from "../lib.mjs";

function withStateDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "ntfy-lib-"));
  process.env.HERDR_PLUGIN_STATE_DIR = dir;
  try {
    return fn(dir);
  } finally {
    delete process.env.HERDR_PLUGIN_STATE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("armedPath is armed.json under HERDR_PLUGIN_STATE_DIR", () => {
  withStateDir((dir) => {
    assert.equal(armedPath(), join(dir, "armed.json"));
  });
});

test("readArmed returns an empty set for missing, unreadable or malformed files", () => {
  withStateDir((dir) => {
    assert.deepEqual(readArmed(), new Set());
    writeFileSync(join(dir, "armed.json"), "{not json");
    assert.deepEqual(readArmed(), new Set());
    writeFileSync(join(dir, "armed.json"), JSON.stringify({ tabs: "w1:t1" }));
    assert.deepEqual(readArmed(), new Set());
    writeFileSync(join(dir, "armed.json"), JSON.stringify({ tabs: ["w1:t1", 7] }));
    assert.deepEqual(readArmed(), new Set());
    writeFileSync(join(dir, "armed.json"), JSON.stringify({ tabs: ["w1:t1", "w2:t3"] }));
    assert.deepEqual(readArmed(), new Set(["w1:t1", "w2:t3"]));
    if (process.getuid?.() !== 0) {
      chmodSync(join(dir, "armed.json"), 0o000);
      assert.deepEqual(readArmed(), new Set());
    }
  });
});

test("writeArmed writes {tabs:[...]} atomically and leaves no tmp file", () => {
  withStateDir((dir) => {
    writeArmed(new Set(["w1:t2", "w1:t1"]));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "armed.json"), "utf8")), {
      tabs: ["w1:t1", "w1:t2"],
    });
    assert.deepEqual(readdirSync(dir), ["armed.json"]);
    assert.deepEqual(readArmed(), new Set(["w1:t1", "w1:t2"]));
  });
});

test("writeArmed creates the state dir when missing", () => {
  withStateDir((dir) => {
    process.env.HERDR_PLUGIN_STATE_DIR = join(dir, "nested", "deeper");
    writeArmed(new Set());
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "nested", "deeper", "armed.json"), "utf8")), {
      tabs: [],
    });
  });
});

test("herdr() reports ok + parsed json, ok + null json, and failures without throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ntfy-bin-"));
  try {
    const bin = join(dir, "herdr");
    writeFileSync(bin, '#!/bin/sh\n[ "$1" = json ] && echo \'{"a":1}\'\n[ "$1" = text ] && echo plain\n[ "$1" = fail ] && exit 3\n[ "$1" = failjson ] && { echo \'{"b":2}\'; exit 2; }\nexit 0\n', { mode: 0o755 });
    process.env.HERDR_BIN_PATH = bin;
    assert.deepEqual(herdr(["json"]), { ok: true, json: { a: 1 } });
    assert.deepEqual(herdr(["text"]), { ok: true, json: null });
    assert.deepEqual(herdr(["fail"]), { ok: false, json: null });
    assert.deepEqual(herdr(["failjson"]), { ok: false, json: { b: 2 } });
    process.env.HERDR_BIN_PATH = "";
    assert.deepEqual(herdr(["json"]), { ok: false, json: null });
    process.env.HERDR_BIN_PATH = join(dir, "does-not-exist");
    assert.deepEqual(herdr(null), { ok: false, json: null });
    assert.deepEqual(herdr(["json"]), { ok: false, json: null });
  } finally {
    delete process.env.HERDR_BIN_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stripPrefix removes exactly one leading marker; addPrefix never doubles", () => {
  assert.equal(stripPrefix("* Fix"), "Fix");
  assert.equal(stripPrefix("* * Fix"), "* Fix");
  assert.equal(stripPrefix("Fix"), "Fix");
  assert.equal(stripPrefix("* "), "");
  assert.equal(stripPrefix(undefined), "");
  assert.equal(addPrefix("Fix"), "* Fix");
  assert.equal(addPrefix("* Fix"), "* Fix");
  assert.equal(addPrefix("1"), "* 1");
});
