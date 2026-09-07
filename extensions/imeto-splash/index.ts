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
const TICK_MS = 600;
const LEFT_PAD = 2;
const RIGHT_PAD = 2;
const CLOTH_ROWS = 4; // band height in braille rows
const BOX_WIDTH = 62;
const TITLE = "Welcome";

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

// Per-(x,y,frame) hash in [0,1), used to gently dissolve isolated sub-pixels
// at the cloth edge so the silhouette isn't hard-clipped.
function hash(x: number, y: number, frame: number): number {
	let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(frame, 83492791);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

// BRAILLE_BITS[xDot][yDot] is the bit that lights that dot.
const BRAILLE_BITS = [
	[0x1, 0x2, 0x4, 0x40], // x0, y0..y3
	[0x8, 0x10, 0x20, 0x80], // x1, y0..y3
];

interface Bulge {
	inCloth: boolean;
	shade: number;
}

/**
 * One frame of cloth rendered as braille sub-cells: every cell is a 2x4 dot
 * grid; we evaluate the cloth at each dot and pack into a single glyph.
 */
function renderCloth(widthCells: number, t: number, frame: number): string[] {
	const sx = widthCells * 2;
	const sy = CLOTH_ROWS * 4;

	const top = (u: number): number =>
		0.12 + 0.22 * Math.sin(u * 6.1 + t) + 0.12 * Math.cos(u * 9.4 - t * 1.3);
	const bottom = (u: number, tp: number): number => {
		const long = 0.42 * Math.sin(u * 6.1 + t + 0.6);
		const mid = 0.22 * Math.cos(u * 9.4 - t * 1.3 + 1.2);
		const fl = 0.08 * Math.sin(u * 24 - t * 3.1);
		const thickness = 0.5 + 0.25 * Math.cos(u * 5.4 - t * 0.7);
		return Math.min(1, tp + thickness * (0.6 + 0.4 * long + 0.4 * mid) + fl * 0.3);
	};

	const grid: Bulge[][] = [];
	for (let y = 0; y < sy; y++) {
		const rowCells: Bulge[] = [];
		for (let x = 0; x < sx; x++) {
			const u = x / (sx - 1);
			const tp = top(u);
			const bt = bottom(u, tp);
			const yNorm = y / (sy - 1);
			const inCloth = yNorm >= tp && yNorm <= bt;
			let shade = 0;
			if (inCloth) {
				const foldPhase = u * 11 - t * 0.4;
				const fold = Math.cos(foldPhase) > 0.3 ? 0 : 0.12;
				shade = 1.25 - 0.45 * (yNorm - tp) / Math.max(1e-4, bt - tp) - fold;
				if (hash(x, y, frame) < 0.03) {
					rowCells.push({ inCloth: false, shade });
					continue;
				}
			}
			rowCells.push({ inCloth, shade });
		}
		grid.push(rowCells);
	}

	const lines: string[] = [];
	for (let row = 0; row < CLOTH_ROWS; row++) {
		let line = " ".repeat(LEFT_PAD);
		for (let xCell = 0; xCell < widthCells; xCell++) {
			let bits = 0;
			for (let xDot = 0; xDot < 2; xDot++) {
				for (let yDot = 0; yDot < 4; yDot++) {
					const ySub = row * 4 + yDot;
					const xSub = xCell * 2 + xDot;
					if (grid[ySub]?.[xSub]?.inCloth) bits |= BRAILLE_BITS[xDot][yDot];
				}
			}
			if (bits === 0) {
				line += " ";
				continue;
			}
			const u = xCell / (widthCells - 1);
			const c = colorAt(u);
			let shadeSum = 0;
			let n = 0;
			for (let xDot = 0; xDot < 2; xDot++) {
				for (let yDot = 0; yDot < 4; yDot++) {
					const ySub = row * 4 + yDot;
					const xSub = xCell * 2 + xDot;
					const b = grid[ySub]?.[xSub];
					if (b?.inCloth) {
						shadeSum += b.shade;
						n++;
					}
				}
			}
			const shade = n > 0 ? shadeSum / n : 0.9;
			line += fg(Math.round(c.r * shade), Math.round(c.g * shade), Math.round(c.b * shade));
			line += String.fromCharCode(0x2800 + bits);
			line += RESET;
		}
		lines.push(line);
	}
	return lines;
}

/**
 * Wrap the cloth in a bordered box with a title, like omp's welcome box.
 * Border is a dim grey; title sits on the top edge.
 */
function renderBox(widthCells: number, frame: number): string[] {
	const inner = renderCloth(widthCells, frame * 0.15, frame);
	const top = `╭─ ${fg(0x85, 0x85, 0x85) + TITLE + RESET} ${"─".repeat(Math.max(0, BOX_WIDTH - 4 - TITLE.length))}╮`;
	const bottom = "╰" + "─".repeat(BOX_WIDTH) + "╯";
	const padTo = (line: string): string => {
		const vis = line.replace(/\x1b\[[0-9;]*m/g, "");
		const pad = Math.max(0, BOX_WIDTH - vis.length);
		return " ".repeat(pad) + line;
	};
	const body = inner.map(
		(l) =>
			"│" +
			padTo(l) +
			"│",
	);
	return [top, ...body, bottom];
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

		const cols = ctx.ui.terminal?.cols ?? 80;
		const widthCells = Math.min(Math.max(30, cols - LEFT_PAD - RIGHT_PAD - 2), BOX_WIDTH - 2);
		ctx.ui.setWidget(WIDGET_KEY, renderBox(widthCells, frame));
		timer = setInterval(() => {
			frame++;
			ctx.ui.setWidget(WIDGET_KEY, renderBox(widthCells, frame));
		}, TICK_MS);
		if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stop(ctx);
	});
}
