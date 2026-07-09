import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.ts";

let dir: string, srv: { url: string; port: number; close: () => Promise<void> }, base: string, key = "secretkey";

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "srv-"));
  mkdirSync(join(dir, "mem", "decisions", "2026-07-08"), { recursive: true });
  writeFileSync(join(dir, "mem", "decisions", "2026-07-08", "d1.md"), `---\nid: d1\ncategory: decision\ncreated: 2026-07-08T10:00:00.000Z\n---\n\nTrial decision body.\n`);
  mkdirSync(join(dir, "public"), { recursive: true });
  writeFileSync(join(dir, "public", "index.html"), "<html>ok</html>");
  writeFileSync(join(dir, "public", "app.js"), "// app");
  writeFileSync(join(dir, "public", "styles.css"), "body{}");
  srv = await startServer({
    memoryDir: join(dir, "mem"),
    ratingsPath: join(dir, "ratings.jsonl"),
    daemon: { url: "http://127.0.0.1:59999", token: "x" }, // unreachable on purpose
    publicDir: join(dir, "public"),
    key,
  });
  base = `http://127.0.0.1:${srv.port}`;
});

after(async () => {
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
});

test("rejects API without key (403)", async () => {
  const r = await fetch(`${base}/api/stats`);
  assert.equal(r.status, 403);
});

test("serves stats with key", async () => {
  const r = await fetch(`${base}/api/stats?key=${key}`);
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(s.total, 1);
  assert.equal(s.byCategory.decision, 1);
});

test("lists memories and reads one with body", async () => {
  const list = await (await fetch(`${base}/api/memories?key=${key}`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "d1");
  const one = await (await fetch(`${base}/api/memory?key=${key}&id=d1`)).json();
  assert.match(one.body, /Trial decision body/);
});

test("POST /api/rate persists and shows on memories verdict", async () => {
  const r = await fetch(`${base}/api/rate?key=${key}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ memoryId: "d1", verdict: "good", note: "solid" }),
  });
  assert.equal(r.status, 200);
  const list = await (await fetch(`${base}/api/memories?key=${key}`)).json();
  assert.equal(list[0].verdict, "good");
});

test("health endpoint reports unreachable daemon gracefully", async () => {
  const h = await (await fetch(`${base}/api/health?key=${key}`)).json();
  assert.equal(h.reachable, false);
});

test("serves static shell with key", async () => {
  const r = await fetch(`${base}/?key=${key}`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /ok/);
});
