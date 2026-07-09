import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function readJsonSafe(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function home(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || homedir();
}

function defaultConfigPath(env: NodeJS.ProcessEnv): string {
  return env.REMNIC_CONFIG_PATH || join(home(env), ".config", "remnic", "config.json");
}

export function resolveMemoryDir(env: NodeJS.ProcessEnv = process.env, configPath?: string): string {
  if (env.REMNIC_MEMORY_DIR) return env.REMNIC_MEMORY_DIR;
  const cfg = readJsonSafe(configPath ?? defaultConfigPath(env));
  const fromCfg = cfg?.remnic?.memoryDir;
  if (typeof fromCfg === "string" && fromCfg) return fromCfg;
  return join(home(env), ".remnic", "memory");
}

export function resolveDaemon(
  env: NodeJS.ProcessEnv = process.env,
  configPath?: string,
): { url: string; token: string } {
  const cfg = readJsonSafe(configPath ?? defaultConfigPath(env));
  const url = (env.REMNIC_DAEMON_URL || cfg?.server?.url || "http://127.0.0.1:4318").replace(/\/$/, "");
  const token = env.REMNIC_PI_AUTH_TOKEN || cfg?.server?.authToken || "";
  return { url, token };
}

export function resolveRatingsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.REMNIC_MEMSTATS_RATINGS) return env.REMNIC_MEMSTATS_RATINGS;
  return join(home(env), ".remnic", "mem-stats", "ratings.jsonl");
}
