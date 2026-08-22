import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { automatedJiraNotification, configuredWindowSeconds, dueDateFromText, latestCapturedSlackTs, managerAddressed, requestType, semanticText, webexGuid, webexMessageLink } from "../scripts/slack-fast-monitor.mjs";

const tracker = JSON.parse(readFileSync(new URL("../config/tracker.json", import.meta.url), "utf8"));

test("fast monitor resolves relative due dates from the source message in the configured timezone", () => {
  const sourceTs = String(Date.parse("2026-08-18T16:00:00-04:00") / 1000);
  assert.equal(dueDateFromText("Please send this tomorrow", sourceTs), "2026-08-19");
  assert.equal(dueDateFromText("Please send this today", sourceTs), "2026-08-18");
});

test("fast monitor recognizes direct manager addressing and request types", () => {
  assert.equal(managerAddressed(`<@${tracker.manager.slackUserId}> can you review this?`), true);
  assert.equal(managerAddressed(`${tracker.manager.name.split(" ")[0]}, what do you think?`), true);
  assert.equal(requestType("Can you approve this?"), "approval");
  assert.equal(requestType("What do you think?"), "input");
});

test("fast monitor excludes Jira automation and ignores URL query punctuation", () => {
  assert.equal(automatedJiraNotification({ appId: "A2RPP3NFR", botId: "B9PUPSKC5", text: "Automation for Jira commented on a Request you are watching" }), true);
  assert.equal(semanticText("Notification https://splunk.atlassian.net/browse/DBO-30170?focusedCommentId=1").includes("?"), false);
  assert.equal(requestType(semanticText("Notification https://example.test/item?x=1")), "task");
});

test("fast monitor converts configured minutes to seconds and keeps a full-day search overlap", () => {
  assert.equal(configuredWindowSeconds(10, 10), 600);
  assert.equal(configuredWindowSeconds(600, 10), 36_000);
  assert.equal(configuredWindowSeconds(undefined, 1440, 1440), 86_400);
});

test("recovery scans anchor to the newest durable Slack capture across both ledgers", () => {
  assert.equal(latestCapturedSlackTs({ assignmentKeys: ["slack-C1-1787338792.042789"], myTaskKeys: ["slack-inbound-D1-1787339465.016809"] }), "1787339465.016809");
  assert.equal(latestCapturedSlackTs({ assignmentKeys: ["slack-C1-1787338792.042789-U03QQN007JM"], myTaskKeys: [] }), "1787338792.042789");
});

test("Webex source links target the captured message instead of only opening its space", () => {
  const roomId = "Y2lzY29zcGFyazovL3VzL1JPT00vOTg5NjQ0MTAtOWQ4Mi0xMWYxLTllYjYtNGZiZTlkODE5NzUz";
  const messageId = "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvOThkODU2MjAtOWQ4Mi0xMWYxLTg1MDItMGZlMTkzOTZjMTRk";
  assert.equal(webexGuid(roomId), "98964410-9d82-11f1-9eb6-4fbe9d819753");
  assert.equal(webexGuid(messageId), "98d85620-9d82-11f1-8502-0fe19396c14d");
  assert.equal(
    webexMessageLink(roomId, messageId),
    "webexteams://im?space=98964410-9d82-11f1-9eb6-4fbe9d819753&message=98d85620-9d82-11f1-8502-0fe19396c14d",
  );
});
