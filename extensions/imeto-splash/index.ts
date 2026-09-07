import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Imeto palette.
const STOPS = [
	{ pos: 0.0, r: 0x6a, g: 0x30, b: 0x26 }, // burnt_umber
	{ pos: 0.45, r: 0xa5, g: 0x61, b: 0x49 }, // fired_terracotta
	{ pos: 1.0, r: 0xe9, g: 0xe3, b: 0xde }, // stone_greige
];

const WIDGET_KEY = "imeto-splash";
const TICK_MS = 160;
const LEFT_PAD = 2;
const RIGHT_PAD = 2;
const CLOTH_ROWS = 4; // braille rows (4 sub-rows of dots each)

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

// Per-(sx,sy,frame) hash in [0,1), used to gently dissolve isolated sub-pixels
// at the cloth edge so the silhouette isn't hard-clipped.
function hash(x: number, y: number, frame: number): number {
	let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(frame, 83492791);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

interface Bulge {
	inCloth: boolean;
	shade: number;
}

/**
 * Braille sub-cell position for (xDot, yDot): which bit of the braille glyph
 * corresponds to that dot. Braille is a 2x4 dot grid per cell, encoded as
 * U+2800 + bitmask.
 */
const BRAILLE_BITS = [
	[0x1, 0x2, 0x4, 0x40], // y0..y3, x0
	[0x8, 0x10, 0x20, 0x80], // y0..y3, x1
];

/**
 * One frame of cloth at sub-cell resolution. For every (x,y) sub-pixel we
 * answer "is this inside the cloth" and "what shade", then we pack four y
 * rows and two x columns into a single braille glyph.
 */
function renderCloth(widthCells: number, t: number, frame: number): string[] {
	const sx = widthCells * 2;
	const sy = CLOTH_ROWS * 4;

	const wave = {
		// Pinned-ish top edge that drifts very slightly.
		top(u: number): number {
			return 0.12 + 0.22 * Math.sin(u * 6.1 + t) + 0.12 * Math.cos(u * 9.4 - t * 1.3);
		},
		// Free hem rider: long wave + moderate wave + flutter.
		bottom(u: number, top: number): number {
			const long = 0.42 * Math.sin(u * 6.1 + t + 0.6);
			const mid = 0.22 * Math.cos(u * 9.4 - t * 1.3 + 1.2);
			const fl = 0.08 * Math.sin(u * 24 - t * 3.1);
			const thickness = 0.5 + 0.25 * Math.cos(u * 5.4 - t * 0.7);
			return Math.min(1, top + thickness * (0.6 + 0.4 * (long + mid)) + fl * 0.3);
		},
	};

	const grid: Bulge[][] = [];
	for (let y = 0; y < sy; y++) {
		const rowCells: Bulge[] = [];
		for (let x = 0; x < sx; x++) {
			const u = x / (sx - 1);
			const top = wave.top(u);
			const bottom = wave.bottom(u, top);
			const yNorm = y / (sy - 1);
			const inCloth = yNorm >= top && yNorm <= bottom;
			let shade = 0;
			if (inCloth) {
				// Ridges and troughs with a cosine band so the surface reads like
				// draped fabric rather than an even gradient.
				const foldPhase = u * 11 - t * 0.4;
				const fold = Math.cos(foldPhase) > 0.3 ? 0 : 0.12;
				shade = 1.2 - 0.45 * (yNorm - top) / Math.max(1e-4, bottom - top) - fold;
				// Edge dissolve: rare sub-pixel removal so the hem flutters.
				if (hash(x, y, frame) < 0.03) rowCells.push({ inCloth: false, shade });
				else rowCells.push({ inCloth, shade });
			} else {
				rowCells.push({ inCloth: false, shade });
			}
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
			// Average shade across the lit sub-pixels in this cell.
			let shadeSum = 0;
			let n = 0;
			for (let xDot = 0; xDot < 2; xDot++) {
				for (let yDot = 0; yDot < 4; yDot++) {
					const ySub = row * 4 + yDot;
					const xSub = xCell * 2 + xDot;
					const b = grid[ySub]?.[xSub];
					if (b && b.inCloth) {
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

		const cols = Math.max(30, (ctx.ui.terminal?.cols ?? 80) - LEFT_PAD - RIGHT_PAD);
		const widthCells = Math.min(cols, 56);
		ctx.ui.setWidget(WIDGET_KEY, renderCloth(widthCells, frame * 0.45, frame));
		timer = setInterval(() => {
			frame++;
			ctx.ui.setWidget(WIDGET_KEY, renderCloth(widthCells, frame * 0.45, frame));
		}, TICK_MS);
		if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stop(ctx);
	});
}
