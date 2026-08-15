import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const CHARS_PER_TOKEN = 4;
const RENDER_INTERVAL_MS = 500;

let currentCtx: ExtensionContext | undefined;
let currentTui: { requestRender(): void } | undefined;
let streaming = false;
let streamStartMs = 0;
let streamChars = 0;
let renderTimer: ReturnType<typeof setInterval> | undefined;

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." &&
			!relativeToHome.startsWith(`..${sep}`) &&
			!isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

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
function getBarFg(theme: Theme): string {
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

function addUsage(
	totals: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number },
	usage: Usage,
): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
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
}

function renderFooter(
	width: number,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
	barFg: string,
): string[] {
	const ctx = currentCtx;
	if (!ctx) return [];

	// Cumulative usage across all session entries (input/output/cache/cost), matching pi's footer.
	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let latestCacheHitRate: number | undefined;
	for (const entry of ctx.sessionManager.getEntries() as SessionEntry[]) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const u = entry.message.usage;
			addUsage(totals, u);
			const latestPromptTokens = u.input + u.cacheRead + u.cacheWrite;
			latestCacheHitRate =
				latestPromptTokens > 0 ? (u.cacheRead / latestPromptTokens) * 100 : undefined;
		} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
			addUsage(totals, entry.message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}

	// Line 1: pwd with git branch and session name, plain dim text.
	const home = process.env.HOME || process.env.USERPROFILE;
	let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), home);
	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;
	const sessionName = ctx.sessionManager.getSessionName();
	if (sessionName) pwd = `${pwd} • ${sessionName}`;

	// Stats line: left stats, right-aligned model plus live tok/s counter.
	const statsParts: string[] = [];
	if (totals.input) statsParts.push(`↑${formatTokens(totals.input)}`);
	if (totals.output) statsParts.push(`↓${formatTokens(totals.output)}`);
	if (totals.cacheRead) statsParts.push(`R${formatTokens(totals.cacheRead)}`);
	if (totals.cacheWrite) statsParts.push(`W${formatTokens(totals.cacheWrite)}`);
	if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && latestCacheHitRate !== undefined) {
		statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
	}
	if (totals.cost) statsParts.push(`$${totals.cost.toFixed(3)}`);
	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercentValue = contextUsage?.percent ?? 0;
	const contextPercent = contextUsage?.percent !== null ? `${contextPercentValue.toFixed(1)}%` : "?";
	statsParts.push(`${contextPercent}/${formatTokens(contextWindow)}`);

	let left = truncateToWidth(statsParts.join(" "), width, "...");
	const leftW = visibleWidth(left);

	let rightSide = ctx.model?.id || "no-model";
	if (ctx.model?.reasoning) {
		const level = ctx.thinkingLevel || "off";
		rightSide = level === "off" ? `${rightSide} • thinking off` : `${rightSide} • ${level}`;
	}
	if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
		rightSide = `(${ctx.model.provider}) ${rightSide}`;
	}
	if (streaming) {
		rightSide += ` · ${formatRate(currentRate())} tok/s`;
	}
	const rightW = visibleWidth(rightSide);

	const minPadding = 2;
	let line: string;
	if (leftW + minPadding + rightW <= width) {
		line = left + " ".repeat(width - leftW - rightW) + rightSide;
	} else {
		const availableForRight = width - leftW - minPadding;
		if (availableForRight > 0) {
			const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
			line =
				left +
				" ".repeat(Math.max(0, width - leftW - visibleWidth(truncatedRight))) +
				truncatedRight;
		} else {
			line = left;
		}
	}

	// Negative-space bar: inverse video swaps the teal foreground into the background,
	// so letters render in the terminal's default background color.
	const bar = `\x1b[7m${barFg}${line}\x1b[27m`;

	const lines = [truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")), bar];

	const extensionStatuses = footerData.getExtensionStatuses();
	if (extensionStatuses.size > 0) {
		const statusLine = Array.from(extensionStatuses.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => sanitizeStatusText(text))
			.join(" ");
		lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
	}
	return lines;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		stopStreaming();
		ctx.ui.setFooter((tui, _theme, footerData) => {
			currentTui = tui;
			let barFg: string | undefined;
			return {
				invalidate() {
					barFg = undefined;
				},
				dispose() {
					stopStreaming();
				},
				render(width: number): string[] {
					if (!currentCtx) return [];
					const theme = currentCtx.ui.theme;
					if (!barFg) barFg = getBarFg(theme);
					return renderFooter(width, theme, footerData, barFg);
				},
			};
		});
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stopStreaming();
		currentCtx = undefined;
		ctx.ui.setFooter(undefined);
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
