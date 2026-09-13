import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const pluginRoot = dirname(fileURLToPath(import.meta.url));

export function loadDotEnv(path) {
  const paths = path ? [path] : defaultDotEnvPaths();
  for (const candidate of paths) {
    loadDotEnvFile(candidate);
  }
}

function defaultDotEnvPaths() {
  const paths = [];
  if (process.env.HERDR_PLUGIN_CONFIG_DIR) {
    paths.push(join(process.env.HERDR_PLUGIN_CONFIG_DIR, ".env"));
  }
  paths.push(join(pluginRoot, ".env"));
  return [...new Set(paths)];
}

function loadDotEnvFile(path) {
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const equals = line.indexOf("=");
    if (equals === -1) {
      continue;
    }
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = parseValue(value);
  }
}

const PREFIX = "* ";

export function armedPath() {
  if (process.env.HERDR_PLUGIN_STATE_DIR) {
    return join(process.env.HERDR_PLUGIN_STATE_DIR, "armed.json");
  }
  const stateHome =
    process.env.XDG_STATE_HOME ||
    (process.env.HOME ? join(process.env.HOME, ".local", "state") : pluginRoot);
  return join(stateHome, "herdr-ntfy-notify", "armed.json");
}

// Any problem reading state means "nothing armed": the hook must stay silent.
export function readArmed() {
  try {
    const tabs = JSON.parse(readFileSync(armedPath(), "utf8"))?.tabs;
    if (!Array.isArray(tabs) || !tabs.every((id) => typeof id === "string")) {
      return new Set();
    }
    return new Set(tabs);
  } catch {
    return new Set();
  }
}

export function writeArmed(tabs) {
  const path = armedPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ tabs: [...tabs].sort() })}\n`, "utf8");
  renameSync(tmp, path);
}

export function herdr(args) {
  try {
    const bin = process.env.HERDR_BIN_PATH ?? "herdr";
    const result = spawnSync(bin, args, { encoding: "utf8" });
    let json = null;
    try {
      json = JSON.parse(result.stdout);
    } catch {
      json = null;
    }
    return { ok: !result.error && result.status === 0, json };
  } catch {
    return { ok: false, json: null };
  }
}

export function stripPrefix(label) {
  const text = String(label ?? "");
  return text.startsWith(PREFIX) ? text.slice(PREFIX.length) : text;
}

export function addPrefix(label) {
  const text = String(label ?? "");
  return text.startsWith(PREFIX) ? text : PREFIX + text;
}

// Quoted values keep everything inside the quotes; unquoted values stop at
// the first whitespace-prefixed `#`, matching dotenv's inline comment rule.
function parseValue(value) {
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    if (end !== -1) {
      return value.slice(1, end);
    }
  }
  return value.replace(/\s+#.*$/, "").trim();
}
