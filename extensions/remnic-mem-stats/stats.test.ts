import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateStats } from "./data.ts";
import type { MemoryRecord } from "./data.ts";

function rec(over: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "x", category: "fact", namespace: "default", created: "2026-07-09T00:00:00.000Z",
    updated: "2026-07-09T00:00:00.000Z", tags: [], confidence: null, status: null,
    lifecycleState: null, path: "/x", preview: "", size: 0, ...over,
  };
}

test("aggregateStats counts totals, categories, namespaces, day buckets, last24h", () => {
  const now = Date.parse("2026-07-09T12:00:00.000Z");
  const recs = [
    rec({ id: "a", category: "decision", created: "2026-07-09T11:00:00.000Z" }),
    rec({ id: "b", category: "fact", namespace: "proj", created: "2026-07-09T01:00:00.000Z" }),
    rec({ id: "c", category: "fact", created: "2026-07-07T10:00:00.000Z" }),
  ];
  const s = aggregateStats(recs, now);
  assert.equal(s.total, 3);
  assert.equal(s.categories, 2);
  assert.equal(s.namespaces, 2);
  assert.equal(s.byCategory.fact, 2);
  assert.equal(s.byNamespace.proj, 1);
  assert.equal(s.last24h, 2);
  assert.equal(s.lastCaptureAt, "2026-07-09T11:00:00.000Z");
  assert.equal(s.byDay.find((d) => d.day === "2026-07-09")!.count, 2);
});

test("aggregateStats sums sizeBytes from record sizes", () => {
  const now = Date.parse("2026-07-09T12:00:00.000Z");
  const recs = [
    rec({ id: "a", size: 100 }),
    rec({ id: "b", size: 250 }),
    rec({ id: "c", size: 50 }),
  ];
  const s = aggregateStats(recs, now);
  assert.equal(s.sizeBytes, 400);
});

test("aggregateStats handles empty store", () => {
  const s = aggregateStats([], Date.parse("2026-07-09T12:00:00.000Z"));
  assert.equal(s.total, 0);
  assert.equal(s.lastCaptureAt, null);
  assert.deepEqual(s.byCategory, {});
  assert.equal(s.sizeBytes, 0);
});
