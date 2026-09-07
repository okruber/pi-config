import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Image, getCapabilities } from "@earendil-works/pi-tui";

function fg(c: { r: number; g: number; b: number }): string {
	return `\x1b[38;2;${c.r};${c.g};${c.b}m`;
}
const RESET = "\x1b[0m";

const WIDGET_KEY = "imeto-splash";
const TICK_MS = 350;
const TITLE = "Welcome";

// Clamp to a value range for the braille fallback.
function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

// Hash for edge shimmer in the braille fallback.
function hash(x: number, y: number, frame: number): number {
	let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(frame, 83492791);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

// Imeto palette, sampled from the header files.
const STOPS = [
	{ pos: 0.0, r: 0x6a, g: 0x30, b: 0x26 }, // burnt_umber
	{ pos: 0.45, r: 0xa5, g: 0x61, b: 0x49 }, // fired_terracotta
	{ pos: 0.8, r: 0xe9, g: 0xe3, b: 0xde }, // stone_greige
	{ pos: 1.0, r: 0xfb, g: 0xf9, b: 0xf7 }, // bone_white highlight
];

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

// ------------------------------------------------------------
// PNG path (true bitmap): 8-bit RGB wrapped in a minimal PNG so we can hand
// pi's Image component real pixels and anti-aliased curves.
// ------------------------------------------------------------

function crc32(buf: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i];
		for (let j = 0; j < 8; j++) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const len = new Uint8Array(4);
	new DataView(len.buffer).setUint32(0, data.length, false);
	const t = new TextEncoder().encode(type);
	const out = new Uint8Array(4 + 4 + data.length + 4);
	out.set(len, 0);
	out.set(t, 4);
	out.set(data, 8);
	const crc = new Uint8Array(4);
	new DataView(crc.buffer).setUint32(0, crc32(new Uint8Array(out.subarray(4, 8 + data.length))), false);
	out.set(crc, 8 + data.length);
	return out;
}

/**
 * Minimal PNG wrapper: 8-bit RGB source, no interlace. The per-frame cloth
 * is a few hundred pixels wide so this stays cheap.
 */
const pngSig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
	const ihdr = new Uint8Array(13);
	new DataView(ihdr.buffer).setUint32(0, width, false);
	new DataView(ihdr.buffer).setUint32(4, height, false);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // RGB
	ihdr[10] = 0; // compression (deflate)
	ihdr[11] = 0; // filter method (standard)
	ihdr[12] = 0; // interlace (none)

	const stride = width * 3 + 1;
	const raw = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		raw[y * stride] = 0; // filter none
		raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * stride + 1);
	}

	const idat = pngChunk("IDAT", deflateSync(raw));
	const out = new Uint8Array(
		pngSig.length + pngChunk("IHDR", ihdr).length + idat.length + pngChunk("IEND", new Uint8Array(0)).length,
	);
	let off = 0;
	out.set(pngSig, off);
	off += pngSig.length;
	const ihdrChunk = pngChunk("IHDR", ihdr);
	out.set(ihdrChunk, off);
	off += ihdrChunk.length;
	out.set(idat, off);
	off += idat.length;
	out.set(pngChunk("IEND", new Uint8Array(0)), off);
	return out;
}

function deflateSync(data: Uint8Array): Uint8Array {
	// Node's zlib.deflateSync signature accepts (Buffer|Uint8Array); wrap in
	// Buffer to keep types happy.
	const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	// zlib is built in; importing keeps the extension self-contained.
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const zlib = require("node:zlib") as typeof import("node:zlib");
	return zlib.deflateSync(buf, { level: 6 }) as unknown as Uint8Array;
}

// ------------------------------------------------------------
// Frame renderer: evaluates the cloth at pixel resolution either to RGBA
// (PNG) or sub-cell braille. Cloth is a thin strip pinned near the top,
// hem driven by two long waves plus flutter, fold shading via cosine bands.
// ------------------------------------------------------------

interface ClothVertex {
	inCloth: boolean;
	shade: number;
}

interface RenderResult {
	// PNG path
	png?: Uint8Array;
	widthCells: number;
	rows: number;
}

const CLOTH_ROWS = 4;

function renderClothFrame(widthCells: number, t: number, frame: number): RenderResult {
	const sx = widthCells * 2;
	const sy = CLOTH_ROWS * 4;

	const top = (u: number): number =>
		clamp(0.1 + 0.2 * Math.sin(u * 5.8 + t) + 0.1 * Math.cos(u * 9.4 - t * 0.8), 0, 0.3);
	const bottom = (u: number, tp: number): number => {
		const long = 0.42 * Math.sin(u * 5.8 + t + 0.6);
		const mid = 0.24 * Math.cos(u * 9.4 - t * 0.8 + 1.2);
		const fl = 0.07 * Math.sin(u * 23 - t * 2.8);
		const thickness = 0.55 + 0.25 * Math.cos(u * 4.8 - t * 0.6);
		return Math.min(1, tp + thickness * (0.6 + 0.4 * long + 0.4 * mid) + fl * 0.3);
	};

	const grid: boolean[][] = [];
	const shades: number[][] = [];
	for (let y = 0; y < sy; y++) {
		grid.push(new Array(sx).fill(false));
		shades.push(new Array(sx).fill(0));
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
				if (hash(x, y, frame) > 0.97) {
					grid[y][x] = false;
					shades[y][x] = 0;
				} else {
					grid[y][x] = true;
					shades[y][x] = shade;
				}
			}
		}
	}

	// RGB pixels, one cell column == 2 sub-pixel columns for finer edge detail.
	const rgb = new Uint8Array(sx * sy * 3);
	const avg = { r: 0, g: 0, b: 0 };
	for (let y = 0; y < sy; y++) {
		for (let x = 0; x < sx; x++) {
			const inCloth = grid[y][x];
			const u = x / (sx - 1);
			const c = colorAt(u);
			if (inCloth) {
				const shade = shades[y][x];
				rgb[(y * sx + x) * 3] = Math.round(c.r * shade);
				rgb[(y * sx + x) * 3 + 1] = Math.round(c.g * shade);
				rgb[(y * sx + x) * 3 + 2] = Math.round(c.b * shade);
			}
		}
	}
	void avg;
	return { png: makePng(rgb, sx, sy), widthCells, rows: CLOTH_ROWS };
}

// ------------------------------------------------------------
// Braille fallback: renderClothFrame always returns png for Ghostty; if the
// terminal can't do images we rebuild with dot sub-cells instead.
// ------------------------------------------------------------

interface BrailleRender {
	lines: string[];
	widthCells: number;
}

const BRAILLE_BITS = [
	[0x1, 0x2, 0x4, 0x40],
	[0x8, 0x10, 0x20, 0x80],
];

function renderClothBraille(widthCells: number, t: number, frame: number): BrailleRender {
	const sx = widthCells * 2;
	const sy = CLOTH_ROWS * 4;

	const top = (u: number): number =>
		clamp(0.1 + 0.2 * Math.sin(u * 5.8 + t) + 0.1 * Math.cos(u * 9.4 - t * 0.8), 0, 0.3);
	const bottom = (u: number, tp: number): number => {
		const long = 0.42 * Math.sin(u * 5.8 + t + 0.6);
		const mid = 0.24 * Math.cos(u * 9.4 - t * 0.8 + 1.2);
		const fl = 0.07 * Math.sin(u * 23 - t * 2.8);
		const thickness = 0.55 + 0.25 * Math.cos(u * 4.8 - t * 0.6);
		return Math.min(1, tp + thickness * (0.6 + 0.4 * long + 0.4 * mid) + fl * 0.3);
	};

	const grid: ClothVertex[][] = [];
	for (let y = 0; y < sy; y++) {
		const rowCells: ClothVertex[] = [];
		for (let x = 0; x < sx; x++) {
			const u = x / (sx - 1);
			const tp = top(u);
			const bt = bottom(u, tp);
			const yNorm = y / (sy - 1);
			const inCloth = yNorm >= tp && yNorm <= bt;
			let shade = 0;
			if (inCloth) {
				const foldPhase = u * 10.6 - t * 0.35;
				const fold = Math.cos(foldPhase) > 0.25 ? 0 : 0.1;
				const sNorm = (yNorm - tp) / Math.max(1e-4, bt - tp);
				shade = 1.2 - 0.35 * sNorm - fold;
				if (hash(x, y, frame) > 0.97) {
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
		let line = "";
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
			line += fg({
				r: Math.round(c.r * shade),
				g: Math.round(c.g * shade),
				b: Math.round(c.b * shade),
			});
			line += String.fromCharCode(0x2800 + bits);
			line += RESET;
		}
		lines.push(line);
	}
	return { lines, widthCells };
}

// ------------------------------------------------------------
// Widget component: either an Image (Kitty/Ghostty/…) or braille text.
// ------------------------------------------------------------

function frameWidget(
	tui: { theme: any },
	cols: number,
	frame: number,
): Image | { render(width: number): string[] } {
	const widthCells = Math.min(Math.max(24, cols - 2), 80);
	let okImage = false;
	try {
		getCapabilities();
		okImage = true;
	} catch {
		okImage = false;
	}

	if (okImage) {
		const { png } = renderClothFrame(widthCells, frame * 0.012, frame);
		const imageTheme = {
			fallbackColor: (str: string) => str,
		};
		return new Image(Buffer.from(png.buffer).toString("base64"), "image/png", imageTheme as any, {
			maxWidthCells: widthCells,
		});
	}
	const { lines } = renderClothBraille(widthCells, frame * 0.012, frame);
	return { render: () => lines };
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
		const render = (): void =>
			ctx.ui.setWidget(
				WIDGET_KEY,
				(tui: { theme: any }, theme: any) =>
					frameWidget({ theme }, cols, frame) as any,
			);
		render();
		timer = setInterval(() => {
			frame++;
			render();
		}, TICK_MS);
		if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stop(ctx);
	});
}
