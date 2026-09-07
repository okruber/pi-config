import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Per-cell gradient colors for this frame.
interface CellColor {
	r: number;
	g: number;
	b: number;
}
interface RenderFrame {
	grid: boolean[][]; // [y][x] sub-cell occupancy
	shades: number[][]; // [y][x] fold shading in (0..1]
	avgColor: CellColor[]; // averaged per cell, widthCells long
	widthCells: number;
	rows: number;
}

interface Vertex {
	inCloth: boolean;
	shade: number;
}

const WIDGET_KEY = "imeto-splash";
const TICK_MS = 500;
const LEFT_PAD = 1;
const RIGHT_PAD = 1;
const CLOTH_ROWS = 5;
const BOX_WIDTH = 64;
const TITLE = "Welcome";

// Imeto palette: a three-stop diagonal ramp across the cloth.
const STOPS: CellColor[] = [
	{ r: 0x6a, g: 0x30, b: 0x26 }, // burnt_umber
	{ r: 0xa5, g: 0x61, b: 0x49 }, // fired_terracotta
	{ r: 0xfb, g: 0xf9, b: 0xf7 }, // bone_white highlight
];

const RESET = "\x1b[0m";
const BOX_FG = "\x1b[38;2;99;99;99m";

function fg(c: CellColor): string {
	return `\x1b[38;2;${c.r};${c.g};${c.b}m`;
}

function colorAt(pos: number): CellColor {
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

// Per-(x,y,frame) hash to dissolve stray pixels at the cloth edge.
function hash(x: number, y: number, frame: number): number {
	let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(frame, 83492791);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

const BRAILLE_BITS = [
	[0x1, 0x2, 0x4, 0x40],
	[0x8, 0x10, 0x20, 0x80],
];

/**
 * Cloth evaluation at sub-pixel resolution. Returns the occupancy grid plus
 * the per-cell average color, so an empty cell can show a faint tint that
 * makes the edge dissolve instead of snapping off, and so the box border can
 * pick up the overall tone.
 */
function renderCloth(widthCells: number, t: number, frame: number): RenderFrame {
	const sx = widthCells * 2;
	const sy = CLOTH_ROWS * 4;

	const top = (u: number): number =>
		0.1 + 0.2 * Math.sin(u * 5.7 + t) + 0.1 * Math.cos(u * 9.6 - t * 0.9);
	const bottom = (u: number, tp: number): number => {
		const long = 0.42 * Math.sin(u * 5.7 + t + 0.6);
		const mid = 0.24 * Math.cos(u * 9.6 - t * 0.9 + 1.3);
		const fl = 0.07 * Math.sin(u * 23 - t * 2.8);
		const thickness = 0.55 + 0.25 * Math.cos(u * 4.8 - t * 0.6);
		return Math.min(1, tp + thickness * (0.6 + 0.4 * long + 0.4 * mid) + fl * 0.3);
	};

	const grid: boolean[][] = [];
	const shades: number[][] = [];
	const avgColor: CellColor[] = [];

	for (let y = 0; y < sy; y++) {
		grid.push(new Array(sx).fill(false));
		shades.push(new Array(sx).fill(0));
	}
	for (let xCell = 0; xCell < widthCells; xCell++) {
		avgColor.push({ r: 0, g: 0, b: 0 });
	}

	for (let x = 0; x < sx; x++) {
		const u = x / (sx - 1);
		const tp = top(u);
		const bt = bottom(u, tp);
		for (let y = 0; y < sy; y++) {
			const yNorm = y / (sy - 1);
			const inCloth = yNorm >= tp && yNorm <= bt;
			let shade = 0;
			if (inCloth) {
				const foldPhase = u * 10.6 - t * 0.35;
				const fold = Math.cos(foldPhase) > 0.25 ? 0 : 0.1;
				const sNorm = (yNorm - tp) / Math.max(1e-4, bt - tp);
				shade = 1.2 - 0.35 * sNorm - fold;
				if (hash(x, y, frame) > 0.96) {
					grid[y][x] = false;
					shades[y][x] = 0;
				} else {
					grid[y][x] = true;
					shades[y][x] = shade;
				}
			}
		}
	}

	// Average lit sub-pixels into one color per cell, so the box border and
	// empty-edge blend have something to blend with.
	const colorCount: number[] = new Array(widthCells).fill(0);
	for (let x = 0; x < sx; x++) {
		const xCell = Math.floor(x / 2);
		const u = x / (sx - 1);
		const c = colorAt(u);
		for (let y = 0; y < sy; y++) {
			if (grid[y][x]) {
				const shade = shades[y][x];
				avgColor[xCell] = {
					r: avgColor[xCell].r + Math.min(255, c.r * shade),
					g: avgColor[xCell].g + Math.min(255, c.g * shade),
					b: avgColor[xCell].b + Math.min(255, c.b * shade),
				};
				colorCount[xCell] += 1;
			}
		}
	}
	for (let xCell = 0; xCell < widthCells; xCell++) {
		if (colorCount[xCell] > 0) {
			avgColor[xCell] = {
				r: Math.round(avgColor[xCell].r / colorCount[xCell]),
				g: Math.round(avgColor[xCell].g / colorCount[xCell]),
				b: Math.round(avgColor[xCell].b / colorCount[xCell]),
			};
		}
	}

	return { grid, shades, avgColor, widthCells, rows: CLOTH_ROWS };
}

/**
 * Border box render: top edge has the title in dim grey; cloth cells render
 * with their own glyph + fg. Empty sub-cells adjacent to cloth also get a
 * very faint tint at ~6% brightness so the edge blurs instead of end.
 */
function renderBox(widthCells: number, frame: number): string[] {
	const fr = renderCloth(widthCells, frame, frame);
	const inner: string[] = [];
	const colorIndex: number[] = []; // visible index → color fallback

	for (let row = 0; row < fr.rows; row++) {
		let line = "";
		for (let xCell = 0; xCell < fr.widthCells; xCell++) {
			let bits = 0;
			for (let xDot = 0; xDot < 2; xDot++) {
				for (let yDot = 0; yDot < 4; yDot++) {
					const ySub = row * 4 + yDot;
					const xSub = xCell * 2 + xDot;
					if (fr.grid[ySub]?.[xSub]) bits |= BRAILLE_BITS[xDot][yDot];
				}
			}
			if (bits === 0) {
				// Faint ambient tint so the cloth edge dissolves into the padding.
				const c = fr.avgColor[xCell];
				line += fg({
					r: Math.round(c.r * 0.08),
					g: Math.round(c.g * 0.08),
					b: Math.round(c.b * 0.08),
				}) + "·" + RESET;
				colorIndex[xCell] = xCell;
				continue;
			}
			const c = fr.avgColor[xCell];
			line += fg(c) + String.fromCharCode(0x2800 + bits) + RESET;
			colorIndex[xCell] = xCell;
		}
		inner.push(line);
	}

	const interior = Math.max(0, BOX_WIDTH - 4 - (TITLE.length + 2));
	const header = `╭─ ${BOX_FG}${TITLE}${RESET} ${BOX_FG}${"─".repeat(interior)}${RESET}╮`;
	const footer = `╰${"─".repeat(BOX_WIDTH)}╯`;

	const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
	const body = inner.map((line) => {
		const vis = stripAnsi(line).length;
		const pad = Math.max(0, BOX_WIDTH - 2 - vis);
		return `│${" ".repeat(LEFT_PAD)}${line}${" ".repeat(pad)}│`;
	});

	return [header, ...body, footer];
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
		const widthCells = Math.min(Math.max(24, cols - LEFT_PAD - RIGHT_PAD - 2), BOX_WIDTH - 2);
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
