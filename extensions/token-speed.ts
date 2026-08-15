import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "token-speed";
const CHARS_PER_TOKEN = 4;
const RENDER_INTERVAL_MS = 500;

// Powerline left wedge (U+E0B2), supplied by Symbols Nerd Font as a fallback glyph.
const CHEVRON = "\uE0B2";

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

// Teal from the theme's vars; accent is the fallback for themes without a teal var.
function getSegmentFg(theme: Theme): string {
	try {
		if (theme.sourcePath) {
			const parsed = JSON.parse(readFileSync(theme.sourcePath, "utf8")) as {
				vars?: Record<string, string>;
			};
			const teal = parsed.vars?.teal;
			if (teal && /^#[0-9a-fA-F]{6}$/.test(teal)) return hexToFgAnsi(teal);
		}
	} catch {
		// fall through to accent
	}
	return theme.getFgAnsi("accent");
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

function renderSegment(width: number, fg: string): string[] {
	if (!streaming || width < 4) return [];

	const label = ` ${formatRate(currentRate())} tok/s `;
	const segmentWidth = visibleWidth(label) + 1;
	if (segmentWidth > width) return [];

	// Chevron is teal on the default background; the label inverts teal into the
	// background so its letters render in the terminal's own background color.
	const chevron = `${fg}${CHEVRON}\x1b[39m`;
	const segment = `\x1b[7m${fg}${label}\x1b[27m\x1b[39m`;
	return [" ".repeat(width - segmentWidth) + chevron + segment];
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		stopStreaming();
		ctx.ui.setWidget(
			WIDGET_KEY,
			(tui) => {
				currentTui = tui;
				let fg: string | undefined;
				return {
					invalidate() {
						fg = undefined;
					},
					dispose() {
						stopStreaming();
					},
					render(width: number): string[] {
						if (!currentCtx) return [];
						if (!fg) fg = getSegmentFg(currentCtx.ui.theme);
						return renderSegment(width, fg);
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

	pi.on("message_end", () => stopStreaming());
	pi.on("agent_end", () => stopStreaming());
}
