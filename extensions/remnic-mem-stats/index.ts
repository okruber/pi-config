// extensions/remnic-mem-stats/index.ts
// remnic-mem-stats — /mem-stats local dashboard for the Remnic memory trial.
// Rating-only: reads the memory store + daemon health, never mutates the store.
// Boots a loopback-only, key-gated HTTP server and opens it in the browser.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveMemoryDir, resolveDaemon, resolveRatingsPath } from "./config.ts";
import { startServer } from "./server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, args, { detached: true, stdio: "ignore" }).unref(); } catch { /* ignore */ }
}

export default function (pi: any): void {
  let server: { url: string; port: number; close: () => Promise<void> } | null = null;

  async function ensureServer(): Promise<string> {
    if (server) return server.url;
    server = await startServer({
      memoryDir: resolveMemoryDir(),
      ratingsPath: resolveRatingsPath(),
      daemon: resolveDaemon(),
      publicDir: join(HERE, "public"),
      key: randomBytes(24).toString("hex"),
    });
    return server.url;
  }

  pi.registerCommand("mem-stats", {
    description: "Open the local Remnic memory dashboard (browse + rate captured memories)",
    handler: async (_args: string, ctx: any) => {
      try {
        const url = await ensureServer();
        openBrowser(url);
        if (ctx?.hasUI) {
          ctx.ui.notify(`🧠 /mem-stats → ${url}`, "info");
          ctx.ui.setStatus("mem-stats", `🧠 mem-stats: ${server?.port}`);
        }
      } catch (err) {
        ctx?.ui?.notify?.(`mem-stats failed: ${(err as Error).message}`, "error");
      }
    },
  });

  pi.on("session_shutdown", async () => {
    if (server) { await server.close().catch(() => {}); server = null; }
  });
}
