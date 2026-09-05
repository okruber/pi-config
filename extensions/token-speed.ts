import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TOKEN_CACHE_STATUS_KEY, TOKEN_RATE_STATUS_KEY } from "./imeto-tool-ui.ts";
const CHARS_PER_TOKEN = 4;
const RENDER_INTERVAL_MS = 500;
// pi-cache-optimizer debounces its disk write by 2s, so a later re-render is
// what actually picks up the finished turn.
const STATS_SETTLE_MS = 2500;

// pi-cache-optimizer v7 stores per-process shards here (atomic tmp+rename
// writes) and deletes the legacy aggregate pi-cache-optimizer-stats.json on
// startup, so the powerline aggregates the shards itself.
const SHARDS_DIR = join(
	process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
	"pi-cache-optimizer-stats.d",
	"shards",
);

const STATUS_BRIDGE = Symbol.for("omp.footer.statuses.v1");
const CACHE_STATUS_KEY = "pi-cache-stats";
export type CacheCounters = {
	day: string;
	totalRequests: number;
	hitRequests: number;
	cachedInputTokens: number;
	totalInputTokens: number;
};
type PersistedStats = {
	sessions?: Record<string, Record<string, CacheCounters>>;
	totalsByModel?: Record<string, CacheCounters>;
};

let sessionHash: string | undefined;
let statsCache: { signature: string; data: PersistedStats } | undefined;

let currentCtx: ExtensionContext | undefined;
let streaming = false;
let streamStartMs = 0;
let streamChars = 0;
let renderTimer: ReturnType<typeof setInterval> | undefined;

function formatRate(rate: number): string {
	return rate >= 10 ? String(Math.round(rate)) : rate.toFixed(1);
}

export function tokenRateStatusLabel(isStreaming: boolean, rate: number): string {
	return `${isStreaming ? formatRate(rate) : "0"} tok/s`;
}

function readCacheStatus(): string | undefined {
	const bridge = (globalThis as Record<symbol, unknown>)[STATUS_BRIDGE] as
		| { getStatuses?: () => ReadonlyMap<string, string> }
		| undefined;
	return bridge?.getStatuses?.().get(CACHE_STATUS_KEY);
}

function localDay(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

// Counters from a previous day are stale: the optimizer resets them on rollover.
export function usableCounters(counters: CacheCounters | undefined, today: string): CacheCounters | undefined {
	if (!counters || counters.day !== today || counters.totalInputTokens <= 0) return undefined;
	return counters;
}

export function hitPercent(counters: CacheCounters): string {
	return `${((counters.cachedInputTokens / counters.totalInputTokens) * 100).toFixed(1)}%`;
}

export function cacheStatusLabel(
	session: CacheCounters | undefined,
	total: CacheCounters | undefined,
	warned: boolean,
): string | undefined {
	if (!session && !total) return undefined;
	const parts: string[] = [];
	if (session) parts.push(`cache ${hitPercent(session)}`);
	if (total) parts.push(`day ${hitPercent(total)}`);
	return `${parts.join(" · ")}${warned ? " ⚠" : ""}`;
}

function addCounters(a: CacheCounters | undefined, b: CacheCounters): CacheCounters {
	if (!a) return b;
	return {
		day: a.day,
		totalRequests: a.totalRequests + b.totalRequests,
		hitRequests: a.hitRequests + b.hitRequests,
		cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
		totalInputTokens: a.totalInputTokens + b.totalInputTokens,
	};
}

// Mirrors the optimizer's own shard aggregation for display purposes. Unlike
// refreshShardAggregate it does not track modelEpoch resets, so a just-rolled
// epoch may briefly double-count until its old shard entry ages out at midnight.
export function readStats(today: string): PersistedStats {
	let names: string[];
	try {
		names = readdirSync(SHARDS_DIR).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name));
		names.sort();
	} catch {
		return {};
	}
	let signature = "";
	for (const name of names) {
		try {
			signature += `${name}:${statSync(join(SHARDS_DIR, name)).mtimeMs};`;
		} catch {
			signature += `${name}:gone;`;
		}
	}
	if (statsCache?.signature === signature) return statsCache.data;

	const sessions: NonNullable<PersistedStats["sessions"]> = {};
	const totalsByModel: NonNullable<PersistedStats["totalsByModel"]> = {};
	for (const name of names) {
		let shard: any;
		try {
			shard = JSON.parse(readFileSync(join(SHARDS_DIR, name), "utf8"));
		} catch {
			continue;
		}
		if (shard?.version !== 7 || shard?.kind !== "pi-cache-optimizer-shard") continue;
		const models = shard.models ?? {};
		for (const [modelKey, entry] of Object.entries<any>(models)) {
			const s = entry?.stats;
			if (!s || s.day !== today) continue;
			const counters: CacheCounters = {
				day: s.day,
				totalRequests: s.totalRequests ?? 0,
				hitRequests: s.hitRequests ?? 0,
				cachedInputTokens: s.cachedInputTokens ?? 0,
				totalInputTokens: s.totalInputTokens ?? 0,
			};
			if (typeof shard.sessionHash === "string") {
				const slot = (sessions[shard.sessionHash] ??= {});
				slot[modelKey] = addCounters(slot[modelKey], counters);
			}
			totalsByModel[modelKey] = addCounters(totalsByModel[modelKey], counters);
		}
	}
	const data = { sessions, totalsByModel };
	statsCache = { signature, data };
	return data;
}

function currentRate(): number {
	const elapsedSec = (Date.now() - streamStartMs) / 1000;
	if (elapsedSec <= 0) return 0;
	return streamChars / CHARS_PER_TOKEN / elapsedSec;
}

function publishStatuses(ctx: ExtensionContext): void {
	const model = ctx.model;
	const modelKey = model ? `${model.provider}/${model.id}` : undefined;
	let cache: string | undefined;
	if (modelKey) {
		const today = localDay();
		const stats = readStats(today);
		const session = usableCounters(
			sessionHash ? stats.sessions?.[sessionHash]?.[modelKey] : undefined,
			today,
		);
		const total = usableCounters(stats.totalsByModel?.[modelKey], today);
		cache = cacheStatusLabel(session, total, readCacheStatus()?.includes("⚠") ?? false);
	}
	ctx.ui.setStatus(TOKEN_CACHE_STATUS_KEY, cache);
	ctx.ui.setStatus(TOKEN_RATE_STATUS_KEY, tokenRateStatusLabel(streaming, currentRate()));
}

function publishCurrentStatuses(): void {
	if (currentCtx) publishStatuses(currentCtx);
}

function startStreaming(): void {
	if (streaming) return;
	streaming = true;
	streamStartMs = Date.now();
	streamChars = 0;
	renderTimer = setInterval(publishCurrentStatuses, RENDER_INTERVAL_MS);
	renderTimer.unref?.();
	publishCurrentStatuses();
}

function stopStreaming(): void {
	streaming = false;
	if (renderTimer !== undefined) {
		clearInterval(renderTimer);
		renderTimer = undefined;
	}
	publishCurrentStatuses();
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		currentCtx = undefined;
		sessionHash = undefined;
		stopStreaming();
		if (ctx.mode !== "tui") return;
		currentCtx = ctx;
		const sessionId = ctx.sessionManager.getSessionId();
		sessionHash = sessionId
			? createHash("sha256").update(sessionId).digest("hex").slice(0, 16)
			: undefined;
		publishStatuses(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		const clearStatuses = currentCtx !== undefined;
		currentCtx = undefined;
		sessionHash = undefined;
		stopStreaming();
		if (!clearStatuses) return;
		ctx.ui.setStatus(TOKEN_CACHE_STATUS_KEY, undefined);
		ctx.ui.setStatus(TOKEN_RATE_STATUS_KEY, undefined);
	});

	pi.on("model_select", (_event, ctx) => {
		if (ctx.mode !== "tui" || !currentCtx) return;
		currentCtx = ctx;
		publishStatuses(ctx);
	});

	pi.on("message_start", (event) => {
		if (currentCtx && event.message.role === "assistant") startStreaming();
	});

	pi.on("message_update", (event) => {
		if (!currentCtx) return;
		const ev = event.assistantMessageEvent;
		if (ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "toolcall_delta") {
			if (!streaming) startStreaming();
			streamChars += ev.delta.length;
			publishCurrentStatuses();
		}
	});

	pi.on("message_end", () => {
		if (!currentCtx) return;
		stopStreaming();
		setTimeout(publishCurrentStatuses, STATS_SETTLE_MS).unref?.();
	});

	pi.on("agent_end", () => {
		if (currentCtx) stopStreaming();
	});
}
