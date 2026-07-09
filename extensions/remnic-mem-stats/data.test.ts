import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, classifyPath, parseMemoryFile, scanMemories, dirSizeBytes } from "./data.ts";
import { statSync } from "node:fs";

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  mkdirSync(join(dir, "decisions", "2026-07-08"), { recursive: true });
  writeFileSync(
    join(dir, "decisions", "2026-07-08", "d1.md"),
    `---\nid: d1\ncategory: decision\ncreated: 2026-07-08T10:00:00.000Z\nupdated: 2026-07-08T10:00:00.000Z\nconfidence: 0.95\nstatus: active\ntags: [trial, remnic]\n---\n\nInitiating a two-week trial of remnic.\n[Attributes: x: y]\n`,
  );
  mkdirSync(join(dir, "namespaces", "proj", "facts", "2026-07-09"), { recursive: true });
  writeFileSync(
    join(dir, "namespaces", "proj", "facts", "2026-07-09", "f1.md"),
    `---\nid: f1\ncategory: fact\ncreated: 2026-07-09T09:00:00.000Z\n---\n\nqmd needs local GGUF models.\n`,
  );
  // noise that must be skipped
  mkdirSync(join(dir, "state"), { recursive: true });
  writeFileSync(join(dir, "state", "meta.md"), "not a memory");
  writeFileSync(join(dir, "profile.md"), "profile");
  return dir;
}

test("parseFrontmatter splits fm and body, parses inline array", () => {
  const { fm, body } = parseFrontmatter("---\nid: a\ntags: [x, y]\n---\n\nhello\n");
  assert.equal(fm.id, "a");
  assert.deepEqual(fm.tags, ["x", "y"]);
  assert.equal(body.trim(), "hello");
});

test("classifyPath handles default and namespaced paths", () => {
  assert.deepEqual(classifyPath(join("decisions", "2026-07-08", "d1.md")), { categoryDir: "decisions", namespace: "default" });
  assert.deepEqual(classifyPath(join("namespaces", "proj", "facts", "2026-07-09", "f1.md")), { categoryDir: "facts", namespace: "proj" });
  assert.equal(classifyPath(join("state", "meta.md")), null);
});

test("parseMemoryFile extracts fields + clean preview", () => {
  const dir = fixtureDir();
  const rec = parseMemoryFile(join(dir, "decisions", "2026-07-08", "d1.md"), dir);
  assert.ok(rec);
  assert.equal(rec!.id, "d1");
  assert.equal(rec!.category, "decision");
  assert.equal(rec!.namespace, "default");
  assert.equal(rec!.confidence, 0.95);
  assert.deepEqual(rec!.tags, ["trial", "remnic"]);
  assert.equal(rec!.preview, "Initiating a two-week trial of remnic.");
  assert.ok(rec!.size > 0);
  rmSync(dir, { recursive: true, force: true });
});

test("scanMemories finds memories across namespaces, skips state/profile", () => {
  const dir = fixtureDir();
  const recs = scanMemories(dir);
  const ids = recs.map((r) => r.id).sort();
  assert.deepEqual(ids, ["d1", "f1"]);
  const f1 = recs.find((r) => r.id === "f1")!;
  assert.equal(f1.namespace, "proj");
  assert.equal(f1.category, "fact");
  rmSync(dir, { recursive: true, force: true });
});

test("dirSizeBytes counts only real memory files, excludes profile.md and state/*", () => {
  const dir = fixtureDir();
  const d1Size = statSync(join(dir, "decisions", "2026-07-08", "d1.md")).size;
  const f1Size = statSync(join(dir, "namespaces", "proj", "facts", "2026-07-09", "f1.md")).size;
  const total = dirSizeBytes(dir);
  assert.equal(total, d1Size + f1Size);
  rmSync(dir, { recursive: true, force: true });
});
