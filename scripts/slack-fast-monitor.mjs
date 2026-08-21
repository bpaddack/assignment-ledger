#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { connectSlackMcp } from "./slack-mcp-client.mjs";

const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(projectPath, "config", "tracker.json"), "utf8"));
const ledgerCli = join(projectPath, "scripts", "ledger-cli.mjs");
const dataPath = join(projectPath, "data", "assignment-ledger");
const lockPath = join(dataPath, "fast-monitor.lock");
const monitorId = "slack_fast_lane";
const workspace = config.workspace.host;
const manager = config.manager;
const assigneeById = new Map(config.assignees.map((person) => [person.slackUserId, person]));
const cadenceMs = Math.max(1, Number(config.monitor.fastCadenceMinutes) || 5) * 60_000;
const overlapSeconds = Math.max(60, Number(config.monitor.fastOverlapMinutes) || 600);

mkdirSync(dataPath, { recursive: true });

const actionPattern = /\b(please|can you|could you|would you|will you|need you to|i need you|take (?:a )?look|review|approve|send|share|provide|confirm|update|create|prepare|complete|finish|follow up|follow-up|investigate|check|fix|schedule|draft|own|handle|let me know|what do you think|do you agree|are you able)\b/i;
const weakActionPattern = /\b(action|task|input|feedback|decision|approval|due|by (?:today|tomorrow|monday|tuesday|wednesday|thursday|friday)|when can|status)\b/i;
const greetingPattern = /^\s*(hi|hello|hey|good (morning|afternoon|evening)|how are you)[!,.?\s]*$/i;

function parseArgs(values) {
  const args = new Set(values);
  return { watch: args.has("--watch"), full: args.has("--full"), dryRun: args.has("--dry-run"), probe: args.has("--probe"), verbose: args.has("--verbose") };
}

function slackTs(date = new Date()) { return (date.getTime() / 1000).toFixed(6); }
function tsToIso(ts) { return new Date(Number(ts) * 1000).toISOString(); }
function minusSeconds(ts, seconds) { return (Math.max(0, Number(ts) - seconds)).toFixed(6); }
function permalink(channel, ts) { return `https://${workspace}/archives/${channel}/p${String(ts).replace(".", "")}`; }
function normalizeText(value) { return String(value || "").replace(/<@([A-Z0-9]+)>/g, (_, id) => assigneeById.get(id)?.name || (id === manager.slackUserId ? manager.name : `@${id}`)).replace(/\s+/g, " ").trim(); }
function concise(value) { const text = normalizeText(value); return text.length > 360 ? `${text.slice(0, 357)}…` : text; }

function localDateParts(ts) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: manager.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Number(ts) * 1000));
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}
function dateString(year, month, day) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function addLocalDays(parts, days) { const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)); return dateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()); }
function dueDateFromText(text, ts) {
  const parts = localDateParts(ts);
  if (/\btomorrow\b/i.test(text)) return addLocalDays(parts, 1);
  if (/\btoday\b|\beod\b|\bend of day\b/i.test(text)) return addLocalDays(parts, 0);
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return dateString(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
  if (us) { let year = us[3] ? Number(us[3]) : parts.year; if (year < 100) year += 2000; return dateString(year, Number(us[1]), Number(us[2])); }
  return "";
}

function requestType(text) {
  if (/\bapprove|approval\b/i.test(text)) return "approval";
  if (/\breview|take (?:a )?look\b/i.test(text)) return "review";
  if (/\binput|feedback|what do you think|do you agree|decision\b/i.test(text)) return "input";
  if (text.includes("?")) return "question";
  return "task";
}

export { dueDateFromText, managerAddressed, requestType };

function messageShape(message, fallbackChannel) {
  const channelId = message.channel_id || message.channel?.id || fallbackChannel;
  const userValue = message.user_id || message.user;
  return {
    channelId,
    ts: String(message.ts || message.timestamp || ""),
    userId: typeof userValue === "string" ? userValue : userValue?.id,
    text: normalizeText(message.text || message.content || message.message),
    threadTs: String(message.thread_ts || message.ts || ""),
  };
}

function mentionedAssignees(rawText) {
  const ids = new Set();
  for (const [id, person] of assigneeById) {
    if (rawText.includes(`<@${id}>`) || new RegExp(`\\b${person.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(rawText)) ids.add(id);
  }
  return [...ids];
}

function managerAddressed(rawText) {
  return rawText.includes(`<@${manager.slackUserId}>`) || new RegExp(`(?:^|\\b)@?${manager.slackHandle}\\b|\\b${manager.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b|(?:^|[,:]\\s*)${manager.name.split(" ")[0]}(?:[,:]|\\s)`, "i").test(rawText);
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length); let next = 0;
  async function worker() { while (next < items.length) { const index = next++; output[index] = await mapper(items[index], index); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

function ledgerCommand(args) {
  const result = spawnSync(process.execPath, [ledgerCli, ...args], { cwd: projectPath, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Ledger command failed.");
  return result.stdout.trim();
}

function acquireLock() {
  try { const fd = openSync(lockPath, "wx"); writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); closeSync(fd); return; } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let stale = true;
    try { const lock = JSON.parse(readFileSync(lockPath, "utf8")); process.kill(lock.pid, 0); stale = Date.now() - Date.parse(lock.startedAt) > 30 * 60_000; } catch { stale = true; }
    if (!stale) throw new Error("The fast monitor is already running; this cycle was skipped to prevent overlap.");
    rmSync(lockPath, { force: true });
    return acquireLock();
  }
}

async function listAllIms(client) {
  const ims = []; let cursor = null;
  do { const page = await client.call("slack_list_ims", { workspace, limit: 1000, ...(cursor ? { cursor } : {}) }); ims.push(...(page.ims || [])); cursor = page.next_cursor || null; } while (cursor);
  return ims.filter((im) => !im.is_deleted && im.id);
}

async function searchAll(client, query) {
  const first = await client.call("slack_search", { workspace, query, count: 100, page: 1, highlight: false });
  const pages = Number(first.page_count) || 1;
  const rest = pages > 1 ? await mapLimit(Array.from({ length: pages - 1 }, (_, index) => index + 2), 6, (page) => client.call("slack_search", { workspace, query, count: 100, page, highlight: false })) : [];
  return [first, ...rest].flatMap((page) => page.messages || []);
}

async function profileName(client, userId, cache) {
  if (!userId) return "Unknown requester";
  if (cache.has(userId)) return cache.get(userId);
  try {
    const result = await client.call("slack_user_profile", { workspace, user: userId });
    const user = result.user || result.profile || result;
    const name = user.profile?.display_name || user.profile?.real_name || user.display_name || user.real_name || user.name || userId;
    cache.set(userId, name); return name;
  } catch { cache.set(userId, userId); return userId; }
}

async function runCycle(options) {
  if (!options.probe && !options.full) {
    const control = JSON.parse(ledgerCommand(["get-monitor-control"]));
    if (!control.enabled) return { monitorId, skipped: true, reason: "paused", startedAt: new Date().toISOString(), durationMs: 0 };
  }
  if (!options.probe) acquireLock();
  const startedAt = new Date().toISOString(); const ceilingTs = slackTs();
  let client;
  try {
    client = await connectSlackMcp();
    const current = await client.call("slack_current_user", { workspace });
    const currentId = current.user_id || current.user?.id || current.id;
    if (currentId && currentId !== manager.slackUserId) throw new Error(`Slack is authenticated as ${currentId}, not configured manager ${manager.slackUserId}.`);
    if (options.probe) return { probe: "ok", workspace, userId: currentId || manager.slackUserId };

    const state = JSON.parse(ledgerCommand(["get-fast-monitor-state", "--monitor-id", monitorId]));
    const knownAssignments = new Set(state.assignmentKeys || []), knownMyTasks = new Set(state.myTaskKeys || []), knownCandidates = new Set(state.candidateKeys || []);
    const initialOldest = minusSeconds(ceilingTs, options.full ? 15 * 60 : Math.max(overlapSeconds, 15 * 60));
    const cursorOldest = (key) => minusSeconds(state.cursors?.[key] || initialOldest, overlapSeconds);
    const afterDate = new Date(Number(options.full ? initialOldest : cursorOldest("search:outbound")) * 1000).toISOString().slice(0, 10);
    const [ims, outboundSearch, inboundMentionSearch, inboundNameSearch] = await Promise.all([
      listAllIms(client),
      searchAll(client, `from:@${manager.slackHandle} after:${afterDate}`),
      searchAll(client, `"<@${manager.slackUserId}>" after:${afterDate}`),
      searchAll(client, `"${manager.name}" after:${afterDate}`),
    ]);

    const imOldest = cursorOldest("ims:updated");
    const activeIms = options.full ? ims : ims.filter((im) => !im.updated || Number(im.updated) / 1000 >= Number(imOldest));
    const dmMessages = await mapLimit(activeIms, 16, async (im) => {
      const oldest = options.full ? initialOldest : cursorOldest(`dm:${im.id}`);
      const result = await client.call("slack_conversation_history", { workspace, channel: im.id, oldest, latest: ceilingTs, inclusive: false, limit: 200, slim: true });
      return { im, messages: result.messages || [] };
    });

    const assignments = [], myTasks = [], candidates = [], cursors = { "search:outbound": ceilingTs, "search:inbound": ceilingTs, "ims:updated": ceilingTs };
    const seenMessages = new Map();
    for (const raw of [...outboundSearch, ...inboundMentionSearch, ...inboundNameSearch]) {
      const message = messageShape(raw); if (message.channelId && message.ts) seenMessages.set(`${message.channelId}:${message.ts}`, { ...message, rawText: String(raw.text || raw.content || ""), dmUserId: null });
    }
    for (const { im, messages } of dmMessages) {
      cursors[`dm:${im.id}`] = ceilingTs;
      for (const raw of messages) { const message = messageShape(raw, im.id); if (message.ts) seenMessages.set(`${im.id}:${message.ts}`, { ...message, rawText: String(raw.text || ""), dmUserId: im.user }); }
    }

    const profileCache = new Map(config.assignees.map((person) => [person.slackUserId, person.name])); profileCache.set(manager.slackUserId, manager.name);
    for (const message of seenMessages.values()) {
      const lowerBound = options.full ? Number(initialOldest) : Math.min(Number(cursorOldest("search:outbound")), Number(cursorOldest("search:inbound")));
      if (!message.text || !message.ts || Number(message.ts) < lowerBound || Number(message.ts) > Number(ceilingTs) || greetingPattern.test(message.text)) continue;
      const link = permalink(message.channelId, message.threadTs || message.ts);
      const strong = actionPattern.test(message.text) || (message.text.includes("?") && !/^\s*(thanks?|thank you)\b/i.test(message.text));
      const medium = strong || weakActionPattern.test(message.text);
      if (message.userId === manager.slackUserId) {
        const targets = new Set(mentionedAssignees(message.rawText));
        if (message.dmUserId && assigneeById.has(message.dmUserId)) targets.add(message.dmUserId);
        for (const targetId of targets) {
          const suffix = targets.size > 1 ? `-${targetId}` : "";
          const dedupeKey = `slack-${message.channelId}-${message.ts}${suffix}`;
          if (knownAssignments.has(dedupeKey)) continue;
          const person = assigneeById.get(targetId);
          if (strong) assignments.push({ assignee: person.name, assignment: concise(message.text), threadUrl: link, assignedAt: tsToIso(message.ts), dueDate: dueDateFromText(message.text, message.ts), dedupeKey });
          else if (!knownCandidates.has(dedupeKey)) candidates.push({ dedupeKey, ledger: "delegated", channelId: message.channelId, messageTs: message.ts, authorId: message.userId, targetId, text: concise(message.text), threadUrl: link, reason: medium ? "Direct report addressed; requires semantic confirmation." : "Direct report addressed without an explicit action phrase; requires contextual review." });
        }
      } else if (message.userId) {
        const directlyAddressed = Boolean(message.dmUserId) || managerAddressed(message.rawText);
        if (!directlyAddressed) continue;
        const dedupeKey = `slack-inbound-${message.channelId}-${message.ts}`;
        if (knownMyTasks.has(dedupeKey)) continue;
        if (strong) myTasks.push({ requester: await profileName(client, message.userId, profileCache), requestType: requestType(message.text), task: concise(message.text), threadUrl: link, askedAt: tsToIso(message.ts), dueDate: dueDateFromText(message.text, message.ts), dedupeKey });
        else if (!knownCandidates.has(dedupeKey)) candidates.push({ dedupeKey, ledger: "inbound", channelId: message.channelId, messageTs: message.ts, authorId: message.userId, targetId: manager.slackUserId, text: concise(message.text), threadUrl: link, reason: medium ? "Manager addressed; requires semantic confirmation." : "Manager addressed without an explicit action phrase; requires contextual review." });
      }
    }

    const payload = { monitorId, runId: crypto.randomUUID(), startedAt, finishedAt: new Date().toISOString(), ceilingTs, conversationsChecked: activeIms.length + 3, messagesChecked: seenMessages.size, assignments, myTasks, candidates, cursors, outcome: "success" };
    if (!options.dryRun) {
      const inputPath = join(dataPath, `fast-cycle-${payload.runId}.json`);
      try { writeFileSync(inputPath, JSON.stringify(payload), "utf8"); ledgerCommand(["apply-fast-monitor-cycle", "--input", inputPath]); } finally { rmSync(inputPath, { force: true }); }
    }
    return { monitorId, runId: payload.runId, startedAt, finishedAt: payload.finishedAt, ceilingTs, conversationsChecked: payload.conversationsChecked, messagesChecked: payload.messagesChecked, assignments: assignments.length, myTasks: myTasks.length, candidates: candidates.length, cursorCount: Object.keys(cursors).length, outcome: payload.outcome, durationMs: Date.now() - Date.parse(startedAt), dryRun: options.dryRun };
  } finally {
    await client?.close().catch(() => {});
    if (!options.probe) rmSync(lockPath, { force: true });
  }
}

const options = parseArgs(process.argv.slice(2));
async function main() {
  if (!options.watch) {
    try { const result = await runCycle(options); console.log(JSON.stringify(result)); }
    catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
    return;
  }
  while (options.watch) {
    const cycleStarted = Date.now();
    try { const result = await runCycle(options); console.log(JSON.stringify(result)); }
    catch (error) { console.error(error instanceof Error ? error.message : error); }
    const remaining = Math.max(1_000, cadenceMs - (Date.now() - cycleStarted));
    await new Promise((resolveWait) => setTimeout(resolveWait, remaining));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
