import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "token-speed";
const CHARS_PER_TOKEN = 4;
const RENDER_INTERVAL_MS = 500;
// pi-cache-optimizer debounces its disk write by 2s, so a later re-render is
// what actually picks up the finished turn.
const STATS_SETTLE_MS = 2500;

const STATS_FILE = join(
	process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
	"pi-cache-optimizer-stats.json",
);

// Powerline left wedge (U+E0B2), supplied by Symbols Nerd Font as a fallback glyph.
const CHEVRON = "\uE0B2";

// omp-chatbox.ts republishes ctx.ui.setStatus() values here; its empty footer
// would otherwise swallow them.
const STATUS_BRIDGE = Symbol.for("omp.footer.statuses.v1");
const CACHE_STATUS_KEY = "pi-cache-stats";

type Color = { fg: string; bg?: string };
type Segment = { label: string; color: Color };
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
let statsCache: { mtimeMs: number; data: PersistedStats } | undefined;

let currentCtx: ExtensionContext | undefined;
let currentTui: { requestRender(): void } | undefined;
let streaming = false;
let streamStartMs = 0;
let streamChars = 0;
let renderTimer: ReturnType<typeof setInterval> | undefined;

function formatRate(rate: number): string {
	return rate >= 10 ? String(Math.round(rate)) : rate.toFixed(1);
}

export function rateLabel(isStreaming: boolean, rate: number): string {
	return ` ${isStreaming ? formatRate(rate) : "0"} tok/s `;
}

// Named color from the theme's vars, tried in order so palettes that don't use
// Catppuccin's names still land on something sensible; accent is the last
// resort. Themes that resolve to a hex value also yield a background form,
// which the powerline separator needs to sit on the preceding segment.
export function themeColor(theme: Theme, ...varNames: string[]): Color {
	try {
		if (theme.sourcePath) {
			const parsed = JSON.parse(readFileSync(theme.sourcePath, "utf8")) as {
				vars?: Record<string, string>;
			};
			for (const varName of varNames) {
				const hex = parsed.vars?.[varName];
				if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
					const r = parseInt(hex.slice(1, 3), 16);
					const g = parseInt(hex.slice(3, 5), 16);
					const b = parseInt(hex.slice(5, 7), 16);
					return { fg: `\x1b[38;2;${r};${g};${b}m`, bg: `\x1b[48;2;${r};${g};${b}m` };
				}
			}
		}
	} catch {
		// fall through to accent
	}
	return { fg: theme.getFgAnsi("accent") };
}

function readCacheStatus(): string | undefined {
	const bridge = (globalThis as Record<symbol, unknown>)[STATUS_BRIDGE] as
		| { getStatuses?: () => ReadonlyMap<string, string> }
		| undefined;
	return bridge?.getStatuses?.().get(CACHE_STATUS_KEY);
}

// Same shape as pi-cache-optimizer's own formatTokenCount, so the powerline and
// /cache-optimizer stats never disagree.
export function formatTokens(value: number): string {
	const millions = Math.max(0, Math.round(value)) / 1_000_000;
	if (millions === 0) return "0M";
	if (millions < 0.001) return `${millions.toFixed(4)}M`;
	if (millions < 0.01) return `${millions.toFixed(3)}M`;
	if (millions >= 10) return `${millions.toFixed(1)}M`;
	return `${millions.toFixed(2)}M`;
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

export function sessionLabel(counters: CacheCounters, warned: boolean): string {
	const tokens = `${formatTokens(counters.cachedInputTokens)}/${formatTokens(counters.totalInputTokens)}`;
	return ` ${counters.hitRequests}/${counters.totalRequests} · ${tokens} · ${hitPercent(counters)}${warned ? " ⚠️" : ""} `;
}

export function dayLabel(counters: CacheCounters): string {
	return ` ${hitPercent(counters)} day `;
}

function readStats(): PersistedStats | undefined {
	try {
		const mtimeMs = statSync(STATS_FILE).mtimeMs;
		if (statsCache?.mtimeMs !== mtimeMs) {
			statsCache = { mtimeMs, data: JSON.parse(readFileSync(STATS_FILE, "utf8")) as PersistedStats };
		}
		return statsCache.data;
	} catch {
		return undefined;
	}
}

function currentRate(): number {
	const elapsedSec = (Date.now() - streamStartMs) / 1000;
	if (elapsedSec <= 0) return 0;
	return streamChars / CHARS_PER_TOKEN / elapsedSec;
}

function startStreaming(): void {
	if (streaming) return;
	streaming = true;
	streamStartMs = Date.now();
	streamChars = 0;
	renderTimer = setInterval(() => currentTui?.requestRender(), RENDER_INTERVAL_MS);
}

function stopStreaming(): void {
	streaming = false;
	if (renderTimer !== undefined) {
		clearInterval(renderTimer);
		renderTimer = undefined;
	}
	currentTui?.requestRender();
}

export function buildSegments(width: number, segments: Segment[]): string[] {
	const fitted = [...segments];
	const rowWidth = () => fitted.reduce((sum, seg) => sum + visibleWidth(seg.label) + 1, 0);
	// Rightmost segment wins the space: drop from the left until the row fits.
	while (fitted.length > 0 && rowWidth() > width) fitted.shift();
	if (fitted.length === 0) return [];

	const body = fitted
		.map(({ label, color }, index) => {
			// The separator carries the previous segment's color as its background so
			// the two blocks meet edge to edge. The leftmost one sits on the terminal
			// background, and a theme without a hex value degrades to that too.
			const behind = index > 0 ? fitted[index - 1].color.bg : undefined;
			const chevron = behind
				? `${behind}${color.fg}${CHEVRON}\x1b[39m\x1b[49m`
				: `${color.fg}${CHEVRON}\x1b[39m`;
			// Inverting the label paints the block in the segment color and draws the
			// letters in the terminal's own background color.
			return `${chevron}\x1b[7m${color.fg}${label}\x1b[27m\x1b[39m`;
		})
		.join("");
	return [" ".repeat(width - rowWidth()) + body];
}

function renderRow(width: number, colors: Record<"teal" | "peach" | "yellow", Color>): string[] {
	if (width < 4) return [];

	const segments: Segment[] = [];
	const model = currentCtx?.model;
	const modelKey = model ? `${model.provider}/${model.id}` : undefined;

	if (modelKey) {
		const stats = readStats();
		const today = localDay();
		const session = usableCounters(
			sessionHash ? stats?.sessions?.[sessionHash]?.[modelKey] : undefined,
			today,
		);
		const total = usableCounters(stats?.totalsByModel?.[modelKey], today);
		if (session) {
			const warned = readCacheStatus()?.includes("⚠️") ?? false;
			segments.push({ label: sessionLabel(session, warned), color: colors.peach });
		}
		if (total) segments.push({ label: dayLabel(total), color: colors.yellow });
	}

	segments.push({ label: rateLabel(streaming, currentRate()), color: colors.teal });

	return buildSegments(width, segments);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		const sessionId = ctx.sessionManager.getSessionId();
		sessionHash = sessionId
			? createHash("sha256").update(sessionId).digest("hex").slice(0, 16)
			: undefined;
		stopStreaming();
		ctx.ui.setWidget(
			WIDGET_KEY,
			(tui) => {
				currentTui = tui;
				let colors: Record<"teal" | "peach" | "yellow", Color> | undefined;
				return {
					invalidate() {
						colors = undefined;
					},
					dispose() {
						stopStreaming();
					},
					render(width: number): string[] {
						if (!currentCtx) return [];
						const theme = currentCtx.ui.theme;
						if (!colors) {
							colors = {
								teal: themeColor(theme, "teal", "cyan"),
								peach: themeColor(theme, "peach", "red"),
								yellow: themeColor(theme, "yellow", "olive"),
							};
						}
						return renderRow(width, colors);
					},
				};
			},
			{ placement: "belowEditor" },
		);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stopStreaming();
		currentCtx = undefined;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") startStreaming();
	});

	pi.on("message_update", (event) => {
		const ev = event.assistantMessageEvent;
		if (ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "toolcall_delta") {
			if (!streaming) startStreaming();
			streamChars += ev.delta.length;
		}
	});

	pi.on("message_end", () => {
		stopStreaming();
		setTimeout(() => currentTui?.requestRender(), STATS_SETTLE_MS).unref?.();
	});

	pi.on("agent_end", () => stopStreaming());
}
