import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "token-speed";
const CHARS_PER_TOKEN = 4;
const RENDER_INTERVAL_MS = 500;
const STATUS_SETTLE_MS = 250;

// Powerline left wedge (U+E0B2), supplied by Symbols Nerd Font as a fallback glyph.
const CHEVRON = "\uE0B2";

// omp-chatbox.ts republishes ctx.ui.setStatus() values here; its empty footer
// would otherwise swallow them.
const STATUS_BRIDGE = Symbol.for("omp.footer.statuses.v1");
const CACHE_STATUS_KEY = "pi-cache-stats";

type Segment = { label: string; fg: string };

let currentCtx: ExtensionContext | undefined;
let currentTui: { requestRender(): void } | undefined;
let streaming = false;
let streamStartMs = 0;
let streamChars = 0;
let renderTimer: ReturnType<typeof setInterval> | undefined;

function formatRate(rate: number): string {
	return rate >= 10 ? String(Math.round(rate)) : rate.toFixed(1);
}

function hexToFgAnsi(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}

// Named color from the theme's vars; accent is the fallback for themes without it.
function getSegmentFg(theme: Theme, varName: string): string {
	try {
		if (theme.sourcePath) {
			const parsed = JSON.parse(readFileSync(theme.sourcePath, "utf8")) as {
				vars?: Record<string, string>;
			};
			const value = parsed.vars?.[varName];
			if (value && /^#[0-9a-fA-F]{6}$/.test(value)) return hexToFgAnsi(value);
		}
	} catch {
		// fall through to accent
	}
	return theme.getFgAnsi("accent");
}

export function cacheLabel(status: string | undefined): string | undefined {
	if (!status?.trim()) return undefined;
	const percents = [...status.matchAll(/(\d+(?:\.\d+)?)%/g)];
	const rate = percents.at(-1)?.[1];
	if (!rate) return undefined;
	return ` ${rate}% cache${status.includes("⚠️") ? " ⚠️" : ""} `;
}

function readCacheStatus(): string | undefined {
	const bridge = (globalThis as Record<symbol, unknown>)[STATUS_BRIDGE] as
		| { getStatuses?: () => ReadonlyMap<string, string> }
		| undefined;
	return bridge?.getStatuses?.().get(CACHE_STATUS_KEY);
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

	// Chevron takes the segment color on the default background; the label
	// inverts it so its letters render in the terminal's own background color.
	const body = fitted
		.map(({ label, fg }) => `${fg}${CHEVRON}\x1b[39m\x1b[7m${fg}${label}\x1b[27m\x1b[39m`)
		.join("");
	return [" ".repeat(width - rowWidth()) + body];
}

function renderRow(width: number, teal: string, peach: string): string[] {
	if (width < 4) return [];

	const segments: Segment[] = [];
	const cache = cacheLabel(readCacheStatus());
	if (cache) segments.push({ label: cache, fg: peach });
	if (streaming) segments.push({ label: ` ${formatRate(currentRate())} tok/s `, fg: teal });

	return buildSegments(width, segments);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		stopStreaming();
		ctx.ui.setWidget(
			WIDGET_KEY,
			(tui) => {
				currentTui = tui;
				let teal: string | undefined;
				let peach: string | undefined;
				return {
					invalidate() {
						teal = undefined;
						peach = undefined;
					},
					dispose() {
						stopStreaming();
					},
					render(width: number): string[] {
						if (!currentCtx) return [];
						const theme = currentCtx.ui.theme;
						if (!teal) teal = getSegmentFg(theme, "teal");
						if (!peach) peach = getSegmentFg(theme, "peach");
						return renderRow(width, teal, peach);
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
		// pi-cache-optimizer writes its status asynchronously after this event,
		// so one extra render picks up the new numbers instead of the stale ones.
		setTimeout(() => currentTui?.requestRender(), STATUS_SETTLE_MS).unref?.();
	});

	pi.on("agent_end", () => stopStreaming());
}
