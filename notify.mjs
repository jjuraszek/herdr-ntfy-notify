import { loadDotEnv, modeEnabled } from "./lib.mjs";

// Anything unexpected exits 0: this hook must never surface as a Herdr failure.
try {
  await main();
} catch (error) {
  console.error(`ntfy-notify: ${error.message}`);
}
process.exit(0);

async function main() {
  loadDotEnv();
  if (!modeEnabled()) {
    return;
  }

  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) {
    console.error("missing NTFY_TOPIC");
    return;
  }

  const context = readJsonEnv("HERDR_PLUGIN_CONTEXT_JSON");
  const event = readJsonEnv("HERDR_PLUGIN_EVENT_JSON");
  const status = statusFromEvent(event) ?? statusFromContext(context);

  if (!["done", "blocked"].includes(status)) {
    return;
  }

  try {
    await sendNtfy(topic, context, event, status);
  } catch (error) {
    console.error(`ntfy publish failed: ${error.message}`);
  }
}

function readJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error(`invalid ${name}: ${error.message}`);
    return {};
  }
}

function statusFromEvent(event) {
  const status = event?.data?.agent_status;
  return typeof status === "string" ? status.toLowerCase() : undefined;
}

function statusFromContext(context) {
  const direct = context.focused_pane_status ?? context.agent_status ?? context.status;
  if (typeof direct === "string") {
    return direct.toLowerCase();
  }

  const eventStatus =
    context.event?.status ??
    context.event?.agent_status ??
    context.event?.pane?.agent_status ??
    context.event?.pane?.agent?.status;
  if (typeof eventStatus === "string") {
    return eventStatus.toLowerCase();
  }

  return undefined;
}

function agentLabel(context, event) {
  const raw =
    event?.data?.display_agent ??
    event?.data?.agent ??
    context.focused_pane_agent ??
    context.agent ??
    "agent";
  return titleCase(raw);
}

function contextLabel(context, event) {
  const workspace =
    context.workspace_label ?? event?.data?.workspace_id ?? context.workspace_id ?? "workspace";
  const tab = namedTabLabel(context.tab_label);
  return tab ? `${workspace} - ${tab}` : workspace;
}

function namedTabLabel(label) {
  const text = String(label ?? "").trim();
  if (!text || /^\d+$/.test(text)) {
    return undefined;
  }
  return text;
}

function titleCase(value) {
  const text = String(value).trim();
  if (!text) {
    return "Agent";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function sendNtfy(topic, context, event, status) {
  const server = (process.env.NTFY_SERVER ?? "https://ntfy.sh").replace(/\/+$/, "");
  const token = process.env.NTFY_TOKEN?.trim();
  const agent = agentLabel(context, event);
  const blocked = status === "blocked";

  const headers = {
    Title: `${agent} is ${status}`,
    Priority: blocked ? "4" : "3",
    Tags: blocked ? "warning" : "white_check_mark",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${server}/${topic}`, {
    method: "POST",
    headers,
    body: contextLabel(context, event),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${body}`);
  }
}
