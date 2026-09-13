import { addPrefix, armedPath, herdr, readArmed, stripPrefix, writeArmed } from "./lib.mjs";

const ARM = ["on", "enable", "enabled"];
const DISARM = ["off", "disable", "disabled"];

try {
  main();
} catch (error) {
  console.error(`ntfy-notify: ${error.message}`);
  process.exit(1);
}

function main() {
  const tabId = process.env.HERDR_TAB_ID?.trim();
  if (!tabId) {
    console.error("ntfy-notify: no active tab");
    process.exit(1);
  }

  const { ok, json } = herdr(["tab", "list"]);
  const tabs = ok && Array.isArray(json?.result?.tabs) ? json.result.tabs : [];
  const current = tabs.find((tab) => tab?.tab_id === tabId);

  let armed = readArmed();
  let label = null;
  if (current) {
    const live = new Set(tabs.map((tab) => tab?.tab_id));
    armed = new Set([...armed].filter((id) => live.has(id)));
    label = String(current.label ?? "");
  } else {
    console.error("ntfy-notify: herdr tab list unavailable; state updated, label left as is");
  }

  const requested = process.argv[2]?.trim().toLowerCase();
  const arm = ARM.includes(requested) ? true : DISARM.includes(requested) ? false : !armed.has(tabId);
  if (arm) {
    armed.add(tabId);
  } else {
    armed.delete(tabId);
  }

  try {
    writeArmed(armed);
  } catch (error) {
    console.error(`ntfy-notify: cannot write ${armedPath()}: ${error.code ?? error.message}`);
    process.exit(1);
  }

  if (label !== null) {
    const newLabel = arm ? addPrefix(label) : stripPrefix(label);
    if (newLabel !== label && !herdr(["tab", "rename", tabId, newLabel]).ok) {
      console.error("ntfy-notify: herdr tab rename failed; state updated, label left as is");
    }
  }

  console.log(`ntfy-notify: ${tabId} ${arm ? "armed" : "disarmed"}`);
}
