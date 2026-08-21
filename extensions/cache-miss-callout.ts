// Transcript callouts for significant prompt-cache misses, in this repo's
// theme colors. Replaces pi's built-in notice (Settings > "Cache miss
// notices"), which renders in the warning token and is too quiet on light
// themes. Turn that setting off; this extension re-derives the same misses
// from pi's exported cache-stats helpers and appends a UI-only entry, so the
// callout never reaches LLM context and survives resume/compaction rebuilds.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const CUSTOM_TYPE = "cache-miss-callout";
const MIN_TOKENS = 20_000;
const MIN_COST = 0.1;

async function resolveCacheStats(): Promise<
	typeof import("@earendil-works/pi-coding-agent/dist/core/cache-stats.js")
> {
	const require = createRequire(import.meta.url);
	let path: string;
	try {
		path = require.resolve("@earendil-works/pi-coding-agent/dist/core/cache-stats.js");
	} catch {
		path = "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/cache-stats.js";
	}
	return import(pathToFileURL(path).href);
}

function formatTokens(value: number): string {
	const millions = value / 1_000_000;
	if (millions >= 10) return `${millions.toFixed(1)}M`;
	if (millions >= 0.01) return `${millions.toFixed(2)}M`;
	return `${(millions * 1000).toFixed(0)}K`;
}

export default async function (pi: ExtensionAPI) {
	const { CACHE_TTL_MS, detectCacheMiss } = await resolveCacheStats();
	pi.registerEntryRenderer(CUSTOM_TYPE, (entry, _options, theme) => {
		const text = (entry.data as { text?: string } | undefined)?.text;
		if (!text) return undefined;
		return new Text(theme.fg("error", theme.bold(text)), 1, 0);
	});

	pi.on("message_end", async (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant" || !message.usage) return;
		const miss = detectCacheMiss(
			ctx.sessionManager.getEntries(),
			message,
			ctx.modelRegistry,
		);
		if (!miss) return;
		if (miss.missedTokens < MIN_TOKENS && miss.missedCost < MIN_COST) return;

		const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";
		let label = "Cache miss";
		if (miss.modelChanged) {
			label = "Cache miss after model switch";
		} else if (miss.idleMs >= CACHE_TTL_MS) {
			label = `Cache miss after ${Math.round(miss.idleMs / 60_000)}m idle`;
		}
		pi.appendEntry(CUSTOM_TYPE, {
			text: `${label}: ${formatTokens(miss.missedTokens)} tokens re-billed${cost}`,
		});
	});
}
