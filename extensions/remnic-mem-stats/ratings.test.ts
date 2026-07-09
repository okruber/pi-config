import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRatings, appendRating, accuracySummary } from "./data.ts";
import type { MemoryRecord, RatingRecord } from "./data.ts";

function tmpRatings(): string {
  return join(mkdtempSync(join(tmpdir(), "rate-")), "sub", "ratings.jsonl");
}
function rec(over: Partial<MemoryRecord>): MemoryRecord {
  return { id: "x", category: "fact", namespace: "default", created: "", updated: "", tags: [], confidence: null, status: null, lifecycleState: null, path: "/x", preview: "", size: 0, ...over };
}

test("appendRating creates dirs and readRatings returns latest-wins", () => {
  const p = tmpRatings();
  appendRating(p, { memoryId: "m1", verdict: "junk", note: "", ts: "2026-07-09T10:00:00Z", category: "fact", namespace: "default" });
  appendRating(p, { memoryId: "m1", verdict: "good", note: "changed mind", ts: "2026-07-09T11:00:00Z", category: "fact", namespace: "default" });
  appendRating(p, { memoryId: "m2", verdict: "miscategorized", note: "", ts: "2026-07-09T10:30:00Z", category: "decision", namespace: "proj" });
  const map = readRatings(p);
  assert.equal(map.get("m1")!.verdict, "good");
  assert.equal(map.get("m1")!.note, "changed mind");
  assert.equal(map.get("m2")!.verdict, "miscategorized");
  assert.ok(readFileSync(p, "utf8").trim().split("\n").length === 3);
  rmSync(join(p, "..", ".."), { recursive: true, force: true });
});

test("readRatings on missing file returns empty map", () => {
  assert.equal(readRatings("/missing/ratings.jsonl").size, 0);
});

test("accuracySummary reports totals and per-category rates", () => {
  const recs = [rec({ id: "m1", category: "fact" }), rec({ id: "m2", category: "decision" }), rec({ id: "m3", category: "fact" })];
  const ratings = new Map<string, RatingRecord>([
    ["m1", { memoryId: "m1", verdict: "good", note: "", ts: "", category: "fact", namespace: "default" }],
    ["m2", { memoryId: "m2", verdict: "junk", note: "", ts: "", category: "decision", namespace: "default" }],
  ]);
  const md = accuracySummary(recs, ratings);
  assert.match(md, /Rated:\s*2\s*\/\s*3/);
  assert.match(md, /good/i);
  assert.match(md, /junk/i);
});
