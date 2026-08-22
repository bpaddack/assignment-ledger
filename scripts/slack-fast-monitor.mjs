#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { connectSlackMcp } from "./slack-mcp-client.mjs";
import { connectWebexMcp } from "./webex-mcp-client.mjs";

const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(projectPath, "config", "tracker.json"), "utf8"));
const ledgerCli = join(projectPath, "scripts", "ledger-cli.mjs");
const dataPath = join(projectPath, "data", "assignment-ledger");
const lockPath = join(dataPath, "fast-monitor.lock");
const monitorId = "slack_fast_lane";
const workspace = config.workspace.host;
const manager = config.manager;
const webexAccount = config.webex?.account || "ghost-webex";
const assigneeById = new Map(config.assignees.map((person) => [person.slackUserId, person]));
const assigneeByWebexId = new Map(config.assignees.map((person) => [person.webexPersonId, person]).filter(([id]) => id));
const cadenceMs = Math.max(1, Number(config.monitor.fastCadenceMinutes) || 5) * 60_000;
function configuredWindowSeconds(value, fallbackMinutes, minimumMinutes = 1) {
  return Math.max(minimumMinutes, Number(value) || fallbackMinutes) * 60;
}

const overlapSeconds = configuredWindowSeconds(config.monitor.fastOverlapMinutes, 10);
const searchOverlapSeconds = configuredWindowSeconds(config.monitor.searchOverlapMinutes, 24 * 60, 24 * 60);

mkdirSync(dataPath, { recursive: true });

const actionPattern = /\b(please|can you|could you|would you|will you|need you to|i need you|take (?:a )?look|review|approve|send|share|provide|confirm|update|create|prepare|complete|finish|follow up|follow-up|investigate|check|fix|schedule|draft|own|handle|let me know|what do you think|do you agree|are you able)\b/i;
const weakActionPattern = /\b(action|task|input|feedback|decision|approval|due|by (?:today|tomorrow|monday|tuesday|wednesday|thursday|friday)|when can|status)\b/i;
const greetingPattern = /^\s*(hi|hello|hey|good (morning|afternoon|evening)|how are you)[!,.?\s]*$/i;

function parseArgs(values) {
  const args = new Set(values);
  const sinceIndex = values.indexOf("--since-ts");
  const sinceTs = sinceIndex >= 0 ? String(values[sinceIndex + 1] || "") : "";
  if (sinceTs && !/^\d{10}(?:\.\d{1,6})?$/.test(sinceTs)) throw new Error("--since-ts must be a Slack timestamp such as 1787338792.042789.");
  return { watch: args.has("--watch"), full: args.has("--full"), dryRun: args.has("--dry-run"), probe: args.has("--probe"), verbose: args.has("--verbose"), sinceTs };
}

function slackTs(date = new Date()) { return (date.getTime() / 1000).toFixed(6); }
function tsToIso(ts) { return new Date(Number(ts) * 1000).toISOString(); }
function minusSeconds(ts, seconds) { return (Math.max(0, Number(ts) - seconds)).toFixed(6); }
function permalink(channel, ts) { return `https://${workspace}/archives/${channel}/p${String(ts).replace(".", "")}`; }
function webexGuid(id) {
  const value = String(id || "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  try {
    const decoded = Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
    const guid = decoded.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0];
    if (guid) return guid;
  } catch { /* fall through to the validation error below */ }
  throw new Error(`Invalid Webex identifier: ${value}`);
}
function webexMessageLink(roomId, messageId) { return `webexteams://im?space=${webexGuid(roomId)}&message=${webexGuid(messageId)}`; }
function normalizeText(value) { return String(value || "").replace(/<@([A-Z0-9]+)>/g, (_, id) => assigneeById.get(id)?.name || (id === manager.slackUserId ? manager.name : `@${id}`)).replace(/\s+/g, " ").trim(); }
function semanticText(value) { return String(value || "").replace(/<https?:\/\/[^>|]+(?:\|([^>]+))?>/gi, "$1").replace(/https?:\/\/\S+/gi, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); }
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

function automatedJiraNotification(message) {
  return message.appId === "A2RPP3NFR" || message.botId === "B9PUPSKC5" || /\b(?:Automation for Jira|Jira Cloud)\b/i.test(message.text);
}

export { automatedJiraNotification, configuredWindowSeconds, dueDateFromText, latestCapturedSlackTs, managerAddressed, requestType, semanticText, webexGuid, webexMessageLink };

function webexMessageShape(message, room, dmTargetId = null) {
  const created = String(message.created || "");
  return {
    id: String(message.id || ""),
    roomId: String(message.roomId || room.id || ""),
    roomType: message.roomType || room.type,
    roomTitle: room.title || "Webex space",
    personId: String(message.personId || ""),
    personEmail: String(message.personEmail || ""),
    text: normalizeText(message.text || ""),
    rawText: String(message.html || message.text || ""),
    created,
    ts: created ? String(Date.parse(created) / 1000) : "",
    dmTargetId,
  };
}

function webexMentionedAssignees(rawText) {
  const ids = new Set();
  for (const [id, person] of assigneeByWebexId) {
    if (rawText.includes(id) || rawText.toLowerCase().includes(person.webexEmail.toLowerCase()) || new RegExp(`\\b${person.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(rawText)) ids.add(id);
  }
  return [...ids];
}

function webexManagerAddressed(rawText) {
  return rawText.includes(manager.webexPersonId)
    || rawText.toLowerCase().includes(manager.webexEmail.toLowerCase())
    || new RegExp(`\\b${manager.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b|(?:^|[,:]\\s*)${manager.name.split(" ")[0]}(?:[,:]|\\s)`, "i").test(rawText);
}

function messageShape(message, fallbackChannel) {
  const channelId = message.channel_id || message.channel?.id || fallbackChannel;
  const userValue = message.user_id || message.user;
  return {
    channelId,
    ts: String(message.ts || message.timestamp || ""),
    userId: typeof userValue === "string" ? userValue : userValue?.id,
    botId: message.bot_id || message.botId || null,
    appId: message.app_id || message.appId || null,
    subtype: message.subtype || null,
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

async function conversationHistoryAll(client, channel, oldest, latest) {
  const messages = []; let cursor = null;
  do {
    const page = await client.call("slack_conversation_history", { workspace, channel, oldest, latest, inclusive: true, limit: 200, slim: true, ...(cursor ? { cursor } : {}) });
    messages.push(...(page.messages || []));
    cursor = page.next_cursor || page.response_metadata?.next_cursor || null;
  } while (cursor);
  return messages;
}

function latestCapturedSlackTs(state) {
  const timestamps = [...(state.assignmentKeys || []), ...(state.myTaskKeys || [])]
    .map((key) => String(key).match(/-(\d{10}(?:\.\d{1,6})?)(?:-[A-Z0-9]+)?$/)?.[1])
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps).toFixed(6) : "";
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
    const result = await client.call("slack_user_profile", { workspace, identifier: userId });
    const user = result.user || result.profile || result;
    const name = user.profile?.display_name || user.profile?.real_name || user.display_name || user.real_name || user.name || userId;
    cache.set(userId, name); return name;
  } catch { cache.set(userId, userId); return userId; }
}

async function webexProfileName(client, personId, personEmail, cache) {
  if (!personId) return personEmail || "Unknown requester";
  if (cache.has(personId)) return cache.get(personId);
  try {
    const result = await client.call("webex_person_profile", { account: webexAccount, person_id: personId });
    const person = result.person || result.profile || result;
    const name = person.displayName || person.nickName || person.emails?.[0] || personEmail || personId;
    cache.set(personId, name); return name;
  } catch { cache.set(personId, personEmail || personId); return personEmail || personId; }
}

async function scanWebex(client, { options, state, initialOldest, ceilingTs, knownAssignments, knownMyTasks, knownCandidates }) {
  const assignments = [], myTasks = [], candidates = [], cursors = {};
  const ceilingIso = new Date(Number(ceilingTs) * 1000).toISOString();
  const cursorOldest = (key, windowSeconds = overlapSeconds) => minusSeconds(state.cursors?.[key] || initialOldest, windowSeconds);
  const roomsOldest = options.full ? initialOldest : cursorOldest("webex:rooms", searchOverlapSeconds);
  const roomsResult = await client.call("webex_rooms", { account: webexAccount, max: 100, limit: 1000 });
  const rooms = (roomsResult.rooms || []).filter((room) => !room.lastActivity || Date.parse(room.lastActivity) / 1000 >= Number(roomsOldest));
  const roomMessages = await mapLimit(rooms, 8, async (room) => {
    const roomCursorKey = `webex:room:${room.id}`;
    const oldest = options.full ? initialOldest : state.cursors?.[roomCursorKey] ? cursorOldest(roomCursorKey) : roomsOldest;
    const [messagesResult, membersResult] = await Promise.all([
      client.call("webex_messages", { account: webexAccount, room: room.id, after: new Date(Number(oldest) * 1000).toISOString(), before: ceilingIso, max: 1000 }),
      room.type === "direct" ? client.call("webex_room_members", { account: webexAccount, room: room.id, max: 10 }) : Promise.resolve({ memberships: [] }),
    ]);
    const dmTargetId = room.type === "direct"
      ? membersResult.memberships?.find((membership) => membership.personId !== manager.webexPersonId)?.personId || null
      : null;
    cursors[roomCursorKey] = ceilingTs;
    return (messagesResult.messages || []).map((message) => webexMessageShape(message, room, dmTargetId));
  });
  cursors["webex:rooms"] = ceilingTs;

  const profileCache = new Map(config.assignees.map((person) => [person.webexPersonId, person.name]).filter(([id]) => id));
  profileCache.set(manager.webexPersonId, manager.name);
  const messages = roomMessages.flat();
  for (const message of messages) {
    const lowerBound = options.full ? Number(initialOldest) : Number(cursorOldest(`webex:room:${message.roomId}`));
    if (!message.id || !message.text || !message.ts || Number(message.ts) < lowerBound || Number(message.ts) > Number(ceilingTs) || greetingPattern.test(message.text)) continue;
    const link = webexMessageLink(message.roomId, message.id);
    const actionableText = semanticText(message.text);
    const strong = actionPattern.test(actionableText) || (actionableText.includes("?") && !/^\s*(thanks?|thank you)\b/i.test(actionableText));
    const medium = strong || weakActionPattern.test(actionableText);
    if (message.personId === manager.webexPersonId) {
      const targets = new Set(webexMentionedAssignees(message.rawText));
      if (message.dmTargetId && assigneeByWebexId.has(message.dmTargetId)) targets.add(message.dmTargetId);
      for (const targetId of targets) {
        const suffix = targets.size > 1 ? `-${targetId}` : "";
        const dedupeKey = `webex-${message.id}${suffix}`;
        if (knownAssignments.has(dedupeKey)) continue;
        const person = assigneeByWebexId.get(targetId);
        if (strong) assignments.push({ source: "webex", assignee: person.name, assignment: concise(message.text), threadUrl: link, assignedAt: message.created, dueDate: dueDateFromText(message.text, message.ts), dedupeKey });
        else if (!knownCandidates.has(dedupeKey)) candidates.push({ dedupeKey, ledger: "delegated", channelId: message.roomId, messageTs: message.created, authorId: message.personId, targetId, text: concise(message.text), threadUrl: link, reason: medium ? "Webex direct report addressed; requires semantic confirmation." : "Webex direct report addressed without an explicit action phrase; requires contextual review." });
      }
    } else if (message.personId) {
      const directlyAddressed = message.roomType === "direct" || webexManagerAddressed(message.rawText);
      if (!directlyAddressed) continue;
      const dedupeKey = `webex-inbound-${message.id}`;
      if (knownMyTasks.has(dedupeKey)) continue;
      if (strong) myTasks.push({ source: "webex", requester: await webexProfileName(client, message.personId, message.personEmail, profileCache), requestType: requestType(actionableText), task: concise(message.text), threadUrl: link, askedAt: message.created, dueDate: dueDateFromText(message.text, message.ts), dedupeKey });
      else if (!knownCandidates.has(dedupeKey)) candidates.push({ dedupeKey, ledger: "inbound", channelId: message.roomId, messageTs: message.created, authorId: message.personId, targetId: manager.webexPersonId, text: concise(message.text), threadUrl: link, reason: medium ? "Manager addressed in Webex; requires semantic confirmation." : "Manager addressed in Webex without an explicit action phrase; requires contextual review." });
    }
  }
  return { roomsChecked: rooms.length, messagesChecked: messages.length, assignments, myTasks, candidates, cursors };
}

async function runCycle(options) {
  if (!options.probe && !options.full) {
    const control = JSON.parse(ledgerCommand(["get-monitor-control"]));
    if (!control.enabled) return { monitorId, skipped: true, reason: "paused", startedAt: new Date().toISOString(), durationMs: 0 };
  }
  if (!options.probe) acquireLock();
  const startedAt = new Date().toISOString(); const ceilingTs = slackTs();
  let client, webexClient;
  try {
    client = await connectSlackMcp();
    const current = await client.call("slack_current_user", { workspace });
    const currentId = current.user_id || current.user?.id || current.id;
    if (currentId && currentId !== manager.slackUserId) throw new Error(`Slack is authenticated as ${currentId}, not configured manager ${manager.slackUserId}.`);
    try {
      webexClient = await connectWebexMcp();
      const accounts = await webexClient.call("webex_accounts");
      const webexPersonId = accounts.account_profile?.id;
      if (webexPersonId && webexPersonId !== manager.webexPersonId) throw new Error(`Webex is authenticated as ${webexPersonId}, not configured manager ${manager.webexPersonId}.`);
    } catch (error) {
      if (options.probe) throw error;
      console.error(`Webex scan unavailable: ${error instanceof Error ? error.message : error}`);
      await webexClient?.close().catch(() => {}); webexClient = null;
    }
    if (options.probe) return { probe: "ok", workspace, slackUserId: currentId || manager.slackUserId, webexAccount, webexPersonId: manager.webexPersonId };

    const state = JSON.parse(ledgerCommand(["get-fast-monitor-state", "--monitor-id", monitorId]));
    const knownAssignments = new Set(state.assignmentKeys || []), knownMyTasks = new Set(state.myTaskKeys || []), knownCandidates = new Set(state.candidateKeys || []);
    const lastCapturedTs = latestCapturedSlackTs(state);
    const recoveryAnchor = options.sinceTs || lastCapturedTs;
    const initialOldest = options.full && recoveryAnchor
      ? minusSeconds(recoveryAnchor, overlapSeconds)
      : minusSeconds(ceilingTs, Math.max(overlapSeconds, 15 * 60));
    const cursorOldest = (key, windowSeconds = overlapSeconds) => minusSeconds(state.cursors?.[key] || initialOldest, windowSeconds);
    const afterDate = new Date(Number(options.full ? initialOldest : cursorOldest("search:outbound", searchOverlapSeconds)) * 1000).toISOString().slice(0, 10);
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
      const messages = await conversationHistoryAll(client, im.id, oldest, ceilingTs);
      return { im, messages };
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
      const lowerBound = options.full ? Number(initialOldest) : Math.min(Number(cursorOldest("search:outbound", searchOverlapSeconds)), Number(cursorOldest("search:inbound", searchOverlapSeconds)));
      if (!message.text || !message.ts || Number(message.ts) < lowerBound || Number(message.ts) > Number(ceilingTs) || greetingPattern.test(message.text) || automatedJiraNotification(message)) continue;
      const link = permalink(message.channelId, message.threadTs || message.ts);
      const actionableText = semanticText(message.text);
      const strong = actionPattern.test(actionableText) || (actionableText.includes("?") && !/^\s*(thanks?|thank you)\b/i.test(actionableText));
      const medium = strong || weakActionPattern.test(actionableText);
      if (message.userId === manager.slackUserId) {
        const targets = new Set(mentionedAssignees(message.rawText));
        if (message.dmUserId && assigneeById.has(message.dmUserId)) targets.add(message.dmUserId);
        for (const targetId of targets) {
          const suffix = targets.size > 1 ? `-${targetId}` : "";
          const dedupeKey = `slack-${message.channelId}-${message.ts}${suffix}`;
          if (knownAssignments.has(dedupeKey)) continue;
          const person = assigneeById.get(targetId);
          if (strong) assignments.push({ source: "slack", assignee: person.name, assignment: concise(message.text), threadUrl: link, assignedAt: tsToIso(message.ts), dueDate: dueDateFromText(message.text, message.ts), dedupeKey });
          else if (!knownCandidates.has(dedupeKey)) candidates.push({ dedupeKey, ledger: "delegated", channelId: message.channelId, messageTs: message.ts, authorId: message.userId, targetId, text: concise(message.text), threadUrl: link, reason: medium ? "Direct report addressed; requires semantic confirmation." : "Direct report addressed without an explicit action phrase; requires contextual review." });
        }
      } else if (message.userId) {
        const directlyAddressed = Boolean(message.dmUserId) || managerAddressed(message.rawText);
        if (!directlyAddressed) continue;
        const dedupeKey = `slack-inbound-${message.channelId}-${message.ts}`;
        if (knownMyTasks.has(dedupeKey)) continue;
        if (strong) myTasks.push({ source: "slack", requester: await profileName(client, message.userId, profileCache), requestType: requestType(actionableText), task: concise(message.text), threadUrl: link, askedAt: tsToIso(message.ts), dueDate: dueDateFromText(message.text, message.ts), dedupeKey });
        else if (!knownCandidates.has(dedupeKey)) candidates.push({ dedupeKey, ledger: "inbound", channelId: message.channelId, messageTs: message.ts, authorId: message.userId, targetId: manager.slackUserId, text: concise(message.text), threadUrl: link, reason: medium ? "Manager addressed; requires semantic confirmation." : "Manager addressed without an explicit action phrase; requires contextual review." });
      }
    }

    let webex = { roomsChecked: 0, messagesChecked: 0, assignments: [], myTasks: [], candidates: [], cursors: {} };
    if (webexClient) {
      try { webex = await scanWebex(webexClient, { options, state, initialOldest, ceilingTs, knownAssignments, knownMyTasks, knownCandidates }); }
      catch (error) { console.error(`Webex scan failed without advancing its cursors: ${error instanceof Error ? error.message : error}`); }
    }
    assignments.push(...webex.assignments); myTasks.push(...webex.myTasks); candidates.push(...webex.candidates); Object.assign(cursors, webex.cursors);
    const payload = { monitorId, runId: crypto.randomUUID(), startedAt, finishedAt: new Date().toISOString(), ceilingTs, conversationsChecked: activeIms.length + 3 + webex.roomsChecked, messagesChecked: seenMessages.size + webex.messagesChecked, assignments, myTasks, candidates, cursors, outcome: "success" };
    if (!options.dryRun) {
      const inputPath = join(dataPath, `fast-cycle-${payload.runId}.json`);
      try { writeFileSync(inputPath, JSON.stringify(payload), "utf8"); ledgerCommand(["apply-fast-monitor-cycle", "--input", inputPath]); } finally { rmSync(inputPath, { force: true }); }
    }
    return { monitorId, runId: payload.runId, startedAt, finishedAt: payload.finishedAt, ceilingTs, recoveryAnchor: options.full ? recoveryAnchor || null : null, scanOldest: initialOldest, conversationsChecked: payload.conversationsChecked, messagesChecked: payload.messagesChecked, assignments: assignments.length, myTasks: myTasks.length, candidates: candidates.length, cursorCount: Object.keys(cursors).length, outcome: payload.outcome, durationMs: Date.now() - Date.parse(startedAt), dryRun: options.dryRun };
  } finally {
    await Promise.all([client?.close().catch(() => {}), webexClient?.close().catch(() => {})]);
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
