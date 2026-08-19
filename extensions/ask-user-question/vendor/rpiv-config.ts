/**
 * Vendored subset of `@juicesharp/rpiv-config` (MIT, https://github.com/juicesharp/rpiv-mono).
 *
 * Only the four symbols this extension uses are copied, verbatim apart from the
 * dropped TypeBox schema export. Vendoring keeps the fork dependency-free so it
 * can live in the pi-config repo with no node_modules.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

function defaultConfigDir(): string {
	return join(homedir(), ".config");
}

function readEnvVar(key: string, fallback?: string): string | undefined {
	return process.env[key]?.trim() || fallback;
}

function resolveConfigDir(): string {
	const xdg = readEnvVar("XDG_CONFIG_HOME");
	if (!xdg) return defaultConfigDir();
	const expanded = expandTilde(xdg);
	return isAbsolute(expanded) ? expanded : defaultConfigDir();
}

function legacyConfigPath(name: string, file = "config.json"): string {
	return join(defaultConfigDir(), name, file);
}

export function configPath(name: string, file = "config.json"): string {
	return join(resolveConfigDir(), name, file);
}

export function loadJsonConfig<T>(path: string): T {
	if (!existsSync(path)) return {} as T;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
		return parsed as T;
	} catch (err) {
		console.warn(`rpiv-config: invalid JSON at ${path}, using default ({}) — ${(err as Error).message}`);
		return {} as T;
	}
}

export function loadJsonConfigWithLegacyFallback<T>(name: string, file = "config.json"): T {
	const xdgPath = configPath(name, file);
	if (existsSync(xdgPath)) return loadJsonConfig<T>(xdgPath);
	return loadJsonConfig<T>(legacyConfigPath(name, file));
}

export interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
	description?: string;
}

export function validateGuidanceFields(fields: unknown): GuidanceFields {
	if (!fields || typeof fields !== "object") return {};
	const g = fields as Record<string, unknown>;
	const result: GuidanceFields = {};
	if (typeof g.promptSnippet === "string" && g.promptSnippet.length > 0) {
		result.promptSnippet = g.promptSnippet;
	}
	if (
		Array.isArray(g.promptGuidelines) &&
		g.promptGuidelines.length > 0 &&
		g.promptGuidelines.every((s) => typeof s === "string" && s.length > 0)
	) {
		result.promptGuidelines = g.promptGuidelines;
	}
	if (typeof g.description === "string" && g.description.length > 0) {
		result.description = g.description;
	}
	return result;
}
