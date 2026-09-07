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
const BONE_WHITE = { r: 0xfb, g: 0xf9, b: 0xf7 };

const WIDGET_KEY = "imeto-splash";
const TICK_MS = 200;
const WIDTH = 46;
const LEFT_PAD = 2;

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

// Deterministic per-(x,y,frame) hash in [0,1), used to make the edge
// pixels sparkle instead of a hard silhouette.
function hash(x: number, y: number, frame: number): number {
	let h = x * 73856093 ^ (y * 19349663 ^ frame * 83492791);
	h = (h ^ (h >>> 13)) * 1274126177;
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

const RAMP = ["█", "▓", "▒", "░"];

/**
 * A thin strip of cloth: the top edge is pinned and sways gently, the
 * bottom hem rides a travelling wave that bulges in and out like a sail.
 * Brightness ramps left-to-right through the imeto gradient, and a per-cell
 * hash occasionally knocks a pixel down the ramp so the edge shimmers.
 */
function clothRow(row: number, t: number, frame: number): string {
	let line = " ".repeat(LEFT_PAD);
	const topEdge = (x: number): number => 1 + Math.round(0.6 * Math.sin(x * 0.35 + t));
	const thickness = (x: number): number =>
		Math.max(2, 2 + Math.round(1.8 * Math.sin(x * 0.5 - t * 1.3)));

	for (let x = 0; x < WIDTH; x++) {
		const yTop = topEdge(x);
		const yBot = yTop + thickness(x);
		if (row < yTop || row >= yBot) {
			line += " ";
			continue;
		}
		const pos = x / (WIDTH - 1);
		const c = colorAt(pos);
		let depth = row - yTop; // 0 = cloth face, higher = inner fold shadow
		// Inner fold gets slightly darker.
		const shade = Math.max(0.6, 1 - depth * 0.12);
		const isEdge = depth === 0 || Math.abs(hash(x, row, frame) - 0.5) < 0.12;
		const rampIdx = isEdge ? (depth === 0 ? 0 : Math.min(3, depth)) : Math.min(2, depth);
		line += fg(
			Math.round(c.r * shade),
			Math.round(c.g * shade),
			Math.round(c.b * shade),
		) + RAMP[rampIdx] + RESET;
	}
	return line;
}

function renderLogo(frame: number): string[] {
	const t = frame * 0.55;
	const rows: string[] = [];
	// Cloth occupies at most ~7 rows; reserve them all so the widget height is stable.
	for (let y = 0; y < 7; y++) rows.push(clothRow(y, t, frame));
	rows.push("");
	rows.push(
		" ".repeat(LEFT_PAD) +
			" ".repeat(Math.floor(WIDTH / 2 - 3)) +
			fg(BONE_WHITE.r, BONE_WHITE.g, BONE_WHITE.b) +
			"imeto" +
			RESET,
	);
	return rows;
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

		ctx.ui.setWidget(WIDGET_KEY, renderLogo(frame));
		timer = setInterval(() => {
			frame++;
			ctx.ui.setWidget(WIDGET_KEY, renderLogo(frame));
		}, TICK_MS);
		// Keep the render interval separate from pi's own keepalive process.
		if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stop(ctx);
	});
}
