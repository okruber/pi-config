import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import {
  scanMemories, aggregateStats, readRatings, appendRating, accuracySummary, readMemoryBody, dirSizeBytes,
  type MemoryRecord, type RatingRecord, type Verdict,
} from "./data.ts";
import { getHealth } from "./health.ts";

export interface ServerOpts {
  memoryDir: string;
  ratingsPath: string;
  daemon: { url: string; token: string };
  publicDir: string;
  key: string;
}

const VERDICTS: Verdict[] = ["good", "junk", "miscategorized"];
const STATIC: Record<string, string> = { "/app.js": "text/javascript", "/styles.css": "text/css" };

function hasKey(req: IncomingMessage, url: URL, key: string): boolean {
  if (url.searchParams.get("key") === key) return true;
  const cookie = req.headers.cookie || "";
  return cookie.split(";").some((c) => c.trim() === `mskey=${key}`);
}

function sendJson(res: ServerResponse, status: number, body: any): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
}

function listRows(records: MemoryRecord[], ratings: Map<string, RatingRecord>) {
  return records
    .slice()
    .sort((a, b) => (b.created || "").localeCompare(a.created || ""))
    .map((r) => ({
      id: r.id, category: r.category, namespace: r.namespace, created: r.created,
      preview: r.preview, tags: r.tags, verdict: ratings.get(r.id)?.verdict ?? null,
    }));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startServer(opts: ServerOpts): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const path = url.pathname;

      if (!hasKey(req, url, opts.key)) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }

      // static shell (set cookie so subsequent asset/API calls work without ?key)
      if (path === "/" || path === "/index.html") {
        const html = readFileSync(join(opts.publicDir, "index.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html", "set-cookie": `mskey=${opts.key}; Path=/; SameSite=Strict` });
        res.end(html);
        return;
      }
      if (STATIC[path]) {
        const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
        res.writeHead(200, { "content-type": STATIC[path] });
        res.end(readFileSync(join(opts.publicDir, safe)));
        return;
      }

      if (path === "/api/stats") {
        const records = scanMemories(opts.memoryDir);
        sendJson(res, 200, { ...aggregateStats(records), sizeBytes: dirSizeBytes(opts.memoryDir) });
        return;
      }
      if (path === "/api/memories") {
        const records = scanMemories(opts.memoryDir);
        sendJson(res, 200, listRows(records, readRatings(opts.ratingsPath)));
        return;
      }
      if (path === "/api/memory") {
        const id = url.searchParams.get("id") || "";
        const rec = scanMemories(opts.memoryDir).find((r) => r.id === id);
        if (!rec) { sendJson(res, 404, { error: "not found" }); return; }
        sendJson(res, 200, { ...rec, body: readMemoryBody(rec.path), verdict: readRatings(opts.ratingsPath).get(id)?.verdict ?? null });
        return;
      }
      if (path === "/api/health") {
        sendJson(res, 200, await getHealth(opts.daemon));
        return;
      }
      if (path === "/api/accuracy-summary") {
        const records = scanMemories(opts.memoryDir);
        sendJson(res, 200, { markdown: accuracySummary(records, readRatings(opts.ratingsPath)) });
        return;
      }
      if (path === "/api/rate" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body.memoryId || !VERDICTS.includes(body.verdict)) { sendJson(res, 400, { error: "bad request" }); return; }
        const rec = scanMemories(opts.memoryDir).find((r) => r.id === body.memoryId);
        const rating: RatingRecord = {
          memoryId: body.memoryId, verdict: body.verdict, note: String(body.note || ""),
          ts: new Date().toISOString(), category: rec?.category ?? "", namespace: rec?.namespace ?? "",
        };
        appendRating(opts.ratingsPath, rating);
        sendJson(res, 200, { ok: true, rating });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: String((err as Error).message || err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/?key=${opts.key}`,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
