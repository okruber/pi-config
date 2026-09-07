import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Imeto palette, sampled from the brand header files.
const STOPS = [
	{ pos: 0.0, r: 0x6a, g: 0x30, b: 0x26 }, // burnt_umber
	{ pos: 0.45, r: 0xa5, g: 0x61, b: 0x49 }, // fired_terracotta
	{ pos: 1.0, r: 0xe9, g: 0xe3, b: 0xde }, // stone_greige
];

const WIDGET_KEY = "imeto-splash";
const TICK_MS = 80;
const LEFT_PAD = 3;
const RIGHT_PAD = 2;
const CLOTH_ROWS = 6; // cloth band height in rows (2 half-cell hops per row)

interface Vertex {
	inCloth: boolean;
	sNorm: number;
	shade: number;
	fold: boolean;
}

function fg(r: number, g: number, b: number): string {
	return `\x1b[38;2;${r};${g};${b}m`;
}
const RESET = "\x1b[0m";

function colorAt(pos: number): { r: number; g: number; b: number } {
	for (let i = 1; i < STOPS.length; i++) {
		const a = STOPS[i - 1];
		const b = STOPS[i];
		if (pos <= b.pos) {
			const t = (pos - a.pos) / (b.pos - a.pos || 1);
			return {
				r: Math.round(a.r + (b.r - a.r) * t),
				g: Math.round(a.g + (b.g - a.g) * t),
				b: Math.round(a.b + (b.b - a.b) * t),
			};
		}
	}
	const last = STOPS[STOPS.length - 1];
	return { r: last.r, g: last.g, b: last.b };
}

// Deterministic per-(x,y,frame) hash in [0,1). Used to dissolve the cloth
// edge and shim the fold shading with pixel noise instead of a hard edge.
function hash(x: number, y: number, frame: number): number {
	let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(frame, 83492791);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

const EMPTY: Vertex = { inCloth: false, sNorm: 0, shade: 0, fold: false };

/**
 * A thin strip of cloth pinned near the top, with a free hem at the bottom.
 * Free edge is driven by two long travelling waves plus a short flutter for
 * fabric grain; fold shading alternates ridges and troughs so the strip reads
 * like draped fabric rather than a solid bar.
 */
function vertexRow(params: {
	y: number;
	dy: number;
	dx: number;
	t: number;
}): Vertex[] {
	const { y, dy, dx, t } = params;
	const out: Vertex[] = [];
	for (let x = 0; x < dx; x++) {
		const u = x / (dx - 1);
		const w1 = 0.5 * Math.sin(u * 6.7 + t * 0.9);
		const w2 = 0.25 * Math.cos(u * 9.2 - t * 1.6);
		const wip = 0.12 * Math.sin(u * 21.3 - t * 3.9);
		const top = Math.max(0.05, 0.1 + 0.28 * w1 + 0.18 * w2);
		const bottom = Math.min(1, top + 0.58 + 0.2 * w2 + wip);
		const yNorm = y / (dy - 1);
		const inCloth = yNorm >= top && yNorm <= bottom;
		const sNorm = inCloth ? (yNorm - top) / Math.max(1e-4, bottom - top) : 0;
		// Fold shading: light ridges alternate with shadowed troughs.
		const foldPhase = u * 10.6 - t * 0.4;
		const fold = sNorm > 0.15 && sNorm < 0.9 && Math.cos(foldPhase) > 0.35;
		const shade = inCloth ? (fold ? 1.0 : 1.12 - sNorm * 0.25) : 0;
		out.push({ inCloth, sNorm, shade, fold });
	}
	return out;
}

function frameLines(frame: number, width: number): string[] {
	const t = frame * (TICK_MS / 1000) * 6.0;
	const dx = Math.max(24, width - LEFT_PAD - RIGHT_PAD);
	const dy = CLOTH_ROWS * 2;
	const frameHash = frame;

	// Build the sub-cell grid columns first, then pair y rows into half-blocks.
	const passIn = { y: 0, dy, dx, t };
	const grid: Vertex[][] = [];
	for (let y = 0; y < dy; y++) {
		passIn.y = y;
		grid.push(vertexRow(passIn));
	}

	const lines: string[] = [];
	for (let row = 0; row < CLOTH_ROWS; row++) {
		let line = " ".repeat(LEFT_PAD);
		for (let x = 0; x < dx; x++) {
			const top = grid[row * 2][x] ?? EMPTY;
			const bottom = grid[row * 2 + 1][x] ?? EMPTY;
			const u = x / (dx - 1);
			const c = colorAt(u);
			const shimmer = hash(x, row * 2, frameHash) < 0.04 || hash(x, row * 2 + 1, frameHash) < 0.04;

			if (!top.inCloth && !bottom.inCloth) {
				line += " ";
				continue;
			}
			if (shimmer) {
				line += " ";
				continue;
			}

			const shade = Math.max(top.shade, bottom.shade);
			const glyph = top.inCloth && bottom.inCloth ? "█" : bottom.inCloth ? "▄" : "▀";
			line +=
				fg(Math.round(c.r * shade), Math.round(c.g * shade), Math.round(c.b * shade)) +
				glyph +
				RESET;
		}
		lines.push(line);
	}
	return lines;
}

function goQuiet(): boolean {
	if (process.env.PI_IMETO_SPLASH === "off") return true;
	try {
		const settingsPath = join(homedir(), ".pi/agent/settings.json");
		const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
		if (settings?.imetoSplash?.quiet === true) return true;
	} catch {
		// Missing or unreadable settings just means "not quiet".
	}
	return false;
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let frame = 0;

	function stop(ctx?: ExtensionContext) {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
		ctx?.ui.setWidget(WIDGET_KEY, undefined);
	}

	pi.on("session_start", (event, ctx) => {
		stop(ctx);
		if (event.reason !== "startup") return;
		if (ctx.mode !== "tui") return;
		if (goQuiet()) return;

		const width = Math.min(ctx.ui.terminal?.cols ?? 80, 90);
		ctx.ui.setWidget(WIDGET_KEY, frameLines(frame, width));
		timer = setInterval(() => {
			frame++;
			ctx.ui.setWidget(WIDGET_KEY, frameLines(frame, width));
		}, TICK_MS);
		if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stop(ctx);
	});
}
