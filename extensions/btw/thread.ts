export const BTW_TURN_ENTRY = "btw-turn";
export const BTW_RESET_ENTRY = "btw-reset";

export type BtwTurnKind = "question" | "handoff";

export type BtwTurn = {
	question: string;
	answer: string;
	kind: BtwTurnKind;
	timestamp: number;
};

export type SessionEntryLike = {
	type?: string;
	customType?: string;
	data?: unknown;
};

function toTurn(data: unknown): BtwTurn | null {
	if (!data || typeof data !== "object") {
		return null;
	}
	const record = data as Record<string, unknown>;
	if (typeof record.question !== "string" || typeof record.answer !== "string") {
		return null;
	}
	return {
		question: record.question,
		answer: record.answer,
		kind: record.kind === "handoff" ? "handoff" : "question",
		timestamp: typeof record.timestamp === "number" ? record.timestamp : 0,
	};
}

export function rehydrateThread(entries: SessionEntryLike[]): BtwTurn[] {
	let thread: BtwTurn[] = [];

	for (const entry of entries) {
		if (entry?.type !== "custom") {
			continue;
		}
		if (entry.customType === BTW_RESET_ENTRY) {
			thread = [];
			continue;
		}
		if (entry.customType !== BTW_TURN_ENTRY) {
			continue;
		}
		const turn = toTurn(entry.data);
		if (turn) {
			thread.push(turn);
		}
	}

	return thread;
}
