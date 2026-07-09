import { test } from "node:test";
import assert from "node:assert/strict";
import { getHealth } from "./health.ts";

function fakeFetch(payload: any, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => payload })) as unknown as typeof fetch;
}

test("getHealth maps daemon payload", async () => {
  const h = await getHealth(
    { url: "http://127.0.0.1:4318", token: "t" },
    fakeFetch({ ok: true, searchBackend: "qmd", memoryDir: "/m", qmd: { active: true, degraded: false } }),
  );
  assert.equal(h.reachable, true);
  assert.equal(h.searchBackend, "qmd");
  assert.equal(h.qmdActive, true);
  assert.equal(h.qmdDegraded, false);
  assert.equal(h.memoryDir, "/m");
});

test("getHealth returns unreachable on throw", async () => {
  const throwing = (async () => { throw new Error("conn refused"); }) as unknown as typeof fetch;
  const h = await getHealth({ url: "http://127.0.0.1:4318", token: "t" }, throwing);
  assert.equal(h.reachable, false);
});
