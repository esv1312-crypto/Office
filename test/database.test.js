import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("PostgreSQL event history is ordered and retained by event time", async () => {
  const source = await readFile(new URL("../src/database.js", import.meta.url), "utf8");
  assert.match(source, /ORDER BY created_at DESC,id DESC LIMIT 500/);
  assert.match(source, /const eventTime=payload\?\.ts \|\| payload\?\.createdAt \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(source, /INSERT INTO ai_office_events\(task_id,event_type,payload,created_at\)/);
  assert.match(source, /DELETE FROM ai_office_events WHERE id IN \(SELECT id FROM ai_office_events ORDER BY created_at DESC,id DESC OFFSET 500\)/);
});
