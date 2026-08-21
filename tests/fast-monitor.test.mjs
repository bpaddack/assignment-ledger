import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { automatedJiraNotification, dueDateFromText, managerAddressed, requestType, semanticText } from "../scripts/slack-fast-monitor.mjs";

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
