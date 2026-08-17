import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Totals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  totalTokens: number;
  cost: number;
  requests: number;
  hitRequests: number;
}

export interface DayBucket extends Totals {
  day: string;
  byProvider: Map<string, number>;
}

export interface KeyBucket extends Totals {
  key: string;
}

export interface Report {
  days: DayBucket[];
  models: KeyBucket[];
  providers: KeyBucket[];
  totals: Totals;
  windowDays: number | "all";
  firstDay: string;
  lastDay: string;
  filesScanned: number;
  entriesCounted: number;
  duplicatesSkipped: number;
  malformedLines: number;
  scanMs: number;
}

interface RawUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  totalTokens?: number;
  cost?: { total?: number };
}

export const UNKNOWN_PROVIDER = "unknown";
export const UNKNOWN_MODEL = "unknown";

function emptyTotals(): Totals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 0,
    cost: 0,
    requests: 0,
    hitRequests: 0,
  };
}

export function cacheTokenShare(t: Totals): number {
  const promptTokens = t.cacheRead + t.cacheWrite + t.input;
  return promptTokens > 0 ? t.cacheRead / promptTokens : 0;
}

export function cacheRequestRate(t: Totals): number {
  return t.requests > 0 ? t.hitRequests / t.requests : 0;
}

function localDay(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function listSessionFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(current, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(full);
      else if (name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function addUsage(t: Totals, u: RawUsage): number {
  const input = u.input ?? 0;
  const output = u.output ?? 0;
  const cacheRead = u.cacheRead ?? 0;
  const cacheWrite = u.cacheWrite ?? 0;
  const total = u.totalTokens ?? input + output + cacheRead + cacheWrite;
  t.input += input;
  t.output += output;
  t.cacheRead += cacheRead;
  t.cacheWrite += cacheWrite;
  t.reasoning += u.reasoning ?? 0;
  t.totalTokens += total;
  t.cost += u.cost?.total ?? 0;
  t.requests += 1;
  if (cacheRead > 0) t.hitRequests += 1;
  return total;
}

export function aggregateUsage(sessionDirs: string | string[], windowDays: number | "all"): Report {
  const startedAt = Date.now();
  const roots = [...new Set((typeof sessionDirs === "string" ? [sessionDirs] : sessionDirs).filter((d) => d !== ""))];
  const files = [...new Set(roots.flatMap((root) => listSessionFiles(root)))];
  const seen = new Set<string>();
  const days = new Map<string, DayBucket>();
  const models = new Map<string, KeyBucket>();
  const providers = new Map<string, KeyBucket>();
  const totals = emptyTotals();

  let cutoff = "";
  if (windowDays !== "all") {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (windowDays - 1));
    cutoff = localDay(from.getTime());
  }

  let entriesCounted = 0;
  let duplicatesSkipped = 0;
  let malformedLines = 0;

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Entries carry no model of their own for compaction/branch summaries and
    // tool-nested usage, so the model in effect at that point in the file is
    // the only available attribution.
    let activeProvider = UNKNOWN_PROVIDER;
    let activeModel = UNKNOWN_MODEL;

    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue;
      }
      if (entry.type === "session") continue;
      if (entry.type === "model_change") {
        activeProvider = entry.provider ?? activeProvider;
        activeModel = entry.modelId ?? activeModel;
        continue;
      }

      let usage: RawUsage | undefined;
      let timestamp: number | undefined;
      let provider: string | undefined;
      let model: string | undefined;

      if (entry.type === "message") {
        const message = entry.message ?? {};
        if (message.role === "assistant") {
          if (message.provider) activeProvider = message.provider;
          if (message.model) activeModel = message.model;
          usage = message.usage;
          timestamp = message.timestamp;
          provider = message.provider;
          model = message.model;
        } else if (message.role === "toolResult" && message.usage) {
          usage = message.usage;
          timestamp = message.timestamp;
        }
      } else if (entry.type === "compaction" || entry.type === "branch_summary") {
        usage = entry.usage;
        provider = entry.provider;
        model = entry.model;
      }
      if (!usage) continue;

      const dedupeKey = `${entry.id ?? ""}|${timestamp ?? entry.timestamp ?? ""}`;
      if (seen.has(dedupeKey)) {
        duplicatesSkipped += 1;
        continue;
      }
      seen.add(dedupeKey);

      const ms = typeof timestamp === "number" && timestamp > 0 ? timestamp : Date.parse(entry.timestamp);
      if (!Number.isFinite(ms)) {
        malformedLines += 1;
        continue;
      }
      const day = localDay(ms);
      if (cutoff && day < cutoff) continue;

      const resolvedProvider = provider || activeProvider;
      const resolvedModel = model || activeModel;
      const modelKey = `${resolvedProvider}/${resolvedModel}`;

      let dayBucket = days.get(day);
      if (!dayBucket) {
        dayBucket = { day, byProvider: new Map(), ...emptyTotals() };
        days.set(day, dayBucket);
      }
      let modelBucket = models.get(modelKey);
      if (!modelBucket) {
        modelBucket = { key: modelKey, ...emptyTotals() };
        models.set(modelKey, modelBucket);
      }
      let providerBucket = providers.get(resolvedProvider);
      if (!providerBucket) {
        providerBucket = { key: resolvedProvider, ...emptyTotals() };
        providers.set(resolvedProvider, providerBucket);
      }

      const total = addUsage(dayBucket, usage);
      addUsage(modelBucket, usage);
      addUsage(providerBucket, usage);
      addUsage(totals, usage);
      dayBucket.byProvider.set(resolvedProvider, (dayBucket.byProvider.get(resolvedProvider) ?? 0) + total);
      entriesCounted += 1;
    }
  }

  const sortedDays = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  return {
    days: sortedDays,
    models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    providers: [...providers.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    totals,
    windowDays,
    firstDay: sortedDays.length > 0 ? sortedDays[0].day : "",
    lastDay: sortedDays.length > 0 ? sortedDays[sortedDays.length - 1].day : "",
    filesScanned: files.length,
    entriesCounted,
    duplicatesSkipped,
    malformedLines,
    scanMs: Date.now() - startedAt,
  };
}
