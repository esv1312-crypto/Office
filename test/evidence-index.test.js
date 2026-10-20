import test from "node:test";
import assert from "node:assert/strict";
import { extractEvidenceIndex } from "../src/evidence-index.js";

test("extracts evidence written inline on the EVIDENCE INDEX header", () => {
  const result = extractEvidenceIndex(
    "Report\nEVIDENCE INDEX: task completed | FACT | src/server.js | task.completed event | runtime confirms completion"
  );
  assert.deepEqual(result, [
    "task completed | FACT | src/server.js | task.completed event | runtime confirms completion"
  ]);
});

test("extracts evidence written on lines after the EVIDENCE INDEX header", () => {
  const result = extractEvidenceIndex("Report\nEVIDENCE INDEX:\n- finding | FACT | src/a.js | fn() | source confirms it");
  assert.deepEqual(result, ["- finding | FACT | src/a.js | fn() | source confirms it"]);
});

test("returns empty when the EVIDENCE INDEX is absent, empty, or mentioned only in prose", () => {
  assert.deepEqual(extractEvidenceIndex("Report without evidence"), []);
  assert.deepEqual(extractEvidenceIndex("FACT: the worker omitted the required evidence index."), []);
  assert.deepEqual(extractEvidenceIndex("Report\nEVIDENCE INDEX:"), []);
});
