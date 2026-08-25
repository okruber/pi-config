import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

// Served from this machine, so delegating to them cannot bill any account.
const LOCAL_PROVIDERS = new Set(["llama", "ornith", "dspark", "lmstudio"]);

export interface ModelInfo {
	provider: string;
	id: string;
	fullId: string;
}

// The resolution below mirrors pi-subagents resolveBaseModelCandidate. A looser
// matcher here would let a spelling it accepts past a check this one fails.
function normalizeModelSegment(segment: string): string {
	return segment
		.toLowerCase()
		.replace(/[._]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function isPlausibleDateStamp(year: string, month: string, day: string): boolean {
	const yyyy = Number(year);
	const mm = Number(month);
	const dd = Number(day);
	return yyyy >= 1900 && yyyy <= 2099 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

function stripTrailingDateStamp(segment: string): string {
	const dashed = /^(.*)-(\d{4})-(\d{2})-(\d{2})$/.exec(segment);
	if (dashed && isPlausibleDateStamp(dashed[2]!, dashed[3]!, dashed[4]!)) return dashed[1]!;
	const compact = /^(.*)-(\d{4})(\d{2})(\d{2})$/.exec(segment);
	if (compact && isPlausibleDateStamp(compact[2]!, compact[3]!, compact[4]!)) return compact[1]!;
	return segment;
}

export function splitThinkingSuffix(model: string): string {
	const colonIdx = model.lastIndexOf(":");
	if (colonIdx === -1) return model;
	const suffix = model.substring(colonIdx + 1);
	return THINKING_LEVELS.some((level) => level === suffix) ? model.substring(0, colonIdx) : model;
}

function isRegisteredProvider(provider: string, available: ModelInfo[]): boolean {
	const normalized = normalizeModelSegment(provider);
	return available.some((entry) => normalizeModelSegment(entry.provider) === normalized);
}

function splitQualifiedModelQuery(
	baseModel: string,
	available: ModelInfo[],
): { queryProvider?: string; queryIdRaw: string } {
	const slashIdx = baseModel.indexOf("/");
	if (slashIdx !== -1) {
		const providerPart = baseModel.slice(0, slashIdx);
		if (isRegisteredProvider(providerPart, available)) {
			return { queryProvider: normalizeModelSegment(providerPart), queryIdRaw: baseModel.slice(slashIdx + 1) };
		}
		return { queryIdRaw: baseModel };
	}
	for (const separator of [":", "."]) {
		const separatorIdx = baseModel.indexOf(separator);
		if (separatorIdx <= 0) continue;
		const providerPart = baseModel.slice(0, separatorIdx);
		if (!isRegisteredProvider(providerPart, available)) continue;
		return { queryProvider: normalizeModelSegment(providerPart), queryIdRaw: baseModel.slice(separatorIdx + 1) };
	}
	return { queryIdRaw: baseModel };
}

export function resolveRequestedModel(
	requested: string,
	available: ModelInfo[],
	preferredProvider?: string,
): ModelInfo | undefined {
	const baseModel = splitThinkingSuffix(requested);

	const exact = available.find((entry) => entry.fullId === baseModel);
	if (exact) return exact;

	const { queryProvider, queryIdRaw } = splitQualifiedModelQuery(baseModel, available);

	if (queryProvider === undefined) {
		const exactIdMatches = available.filter((entry) => entry.id === baseModel);
		const preferredExact = preferredProvider
			? exactIdMatches.find((entry) => entry.provider === preferredProvider)
			: undefined;
		if (preferredExact) return preferredExact;
		if (exactIdMatches.length === 1) return exactIdMatches[0];
	}

	const queryId = normalizeModelSegment(queryIdRaw);
	const queryIdNoDate = stripTrailingDateStamp(queryId);
	const candidates = available.filter((entry) => {
		const entryId = normalizeModelSegment(entry.id);
		if (entryId !== queryId && stripTrailingDateStamp(entryId) !== queryIdNoDate) return false;
		if (queryProvider !== undefined && normalizeModelSegment(entry.provider) !== queryProvider) return false;
		return true;
	});
	if (candidates.length === 0) return undefined;
	if (preferredProvider) {
		const preferredNorm = normalizeModelSegment(preferredProvider);
		const preferred = candidates.find((entry) => normalizeModelSegment(entry.provider) === preferredNorm);
		if (preferred) return preferred;
	}
	return candidates.length === 1 ? candidates[0] : undefined;
}

/** Every `model` value in the tool input, including per-task and per-step overrides. */
export function collectModelRequests(input: unknown): string[] {
	const found: string[] = [];
	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const entry of node) walk(entry);
			return;
		}
		if (!node || typeof node !== "object") return;
		for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
			if (key === "model" && typeof value === "string" && value.trim()) found.push(value.trim());
			else walk(value);
		}
	};
	walk(input);
	return found;
}

export interface LockVerdict {
	allowed: boolean;
	reason?: string;
}

export function checkProviderLock(
	input: unknown,
	available: ModelInfo[],
	parentProvider: string | undefined,
): LockVerdict {
	if (!parentProvider) return { allowed: true };
	const requests = collectModelRequests(input);
	if (requests.length === 0) return { allowed: true };

	for (const requested of requests) {
		const resolved = resolveRequestedModel(requested, available, parentProvider);
		if (!resolved) continue;
		if (resolved.provider === parentProvider) continue;
		if (LOCAL_PROVIDERS.has(resolved.provider)) continue;
		const via = resolved.fullId === requested ? "" : ` resolves to '${resolved.fullId}', which`;
		return {
			allowed: false,
			reason:
				`Subagent model '${requested}'${via} is on provider '${resolved.provider}', ` +
				`but this session runs on '${parentProvider}'. Billing accounts are per provider, so a ` +
				`subagent must stay on '${parentProvider}' or on a local provider ` +
				`(${[...LOCAL_PROVIDERS].sort().join(", ")}). Nothing was billed. ` +
				`Re-dispatch with a model on '${parentProvider}', or omit 'model' to inherit this session's model.`,
		};
	}
	return { allowed: true };
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "subagent") return;
		const available = ctx.modelRegistry.getAvailable().map((model) => ({
			provider: model.provider,
			id: model.id,
			fullId: `${model.provider}/${model.id}`,
		}));
		const verdict = checkProviderLock(event.input, available, ctx.model?.provider);
		if (!verdict.allowed) return { block: true, reason: verdict.reason };
	});
}
