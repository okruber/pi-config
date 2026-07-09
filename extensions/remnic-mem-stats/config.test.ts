import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMemoryDir, resolveDaemon, resolveRatingsPath, readJsonSafe } from "./config.ts";

test("resolveMemoryDir prefers env override", () => {
  assert.equal(resolveMemoryDir({ REMNIC_MEMORY_DIR: "/x/mem" }, "/nope.json"), "/x/mem");
});

test("resolveMemoryDir reads remnic.memoryDir from config", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const cfg = join(dir, "config.json");
  writeFileSync(cfg, JSON.stringify({ remnic: { memoryDir: "/from/config" } }));
  assert.equal(resolveMemoryDir({}, cfg), "/from/config");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveMemoryDir falls back to ~/.remnic/memory", () => {
  const r = resolveMemoryDir({ HOME: "/home/olle" }, "/missing.json");
  assert.equal(r, "/home/olle/.remnic/memory");
});

test("resolveDaemon reads server.authToken and defaults url", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const cfg = join(dir, "config.json");
  writeFileSync(cfg, JSON.stringify({ server: { authToken: "tok123" } }));
  const d = resolveDaemon({}, cfg);
  assert.equal(d.token, "tok123");
  assert.equal(d.url, "http://127.0.0.1:4318");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveRatingsPath uses env override then HOME default", () => {
  assert.equal(resolveRatingsPath({ REMNIC_MEMSTATS_RATINGS: "/r.jsonl" }), "/r.jsonl");
  assert.equal(resolveRatingsPath({ HOME: "/home/olle" }), "/home/olle/.remnic/mem-stats/ratings.jsonl");
});

test("readJsonSafe returns null on missing/invalid", () => {
  assert.equal(readJsonSafe("/definitely/missing.json"), null);
});
