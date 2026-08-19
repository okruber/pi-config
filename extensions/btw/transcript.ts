export type TranscriptRole = "user" | "assistant" | "tool";

export type TranscriptEntry = {
	role: TranscriptRole;
	text: string;
	streaming: boolean;
};

export type TranscriptState = {
	entries: TranscriptEntry[];
};

export type TranscriptEventLike = {
	type: string;
	role?: string;
	text?: string;
	toolName?: string;
};

export function emptyTranscript(): TranscriptState {
	return { entries: [] };
}

export function appendUserEntry(state: TranscriptState, text: string): TranscriptState {
	return { entries: [...state.entries, { role: "user", text, streaming: false }] };
}

function replaceLast(state: TranscriptState, update: Partial<TranscriptEntry>): TranscriptState {
	if (state.entries.length === 0) {
		return state;
	}
	const entries = state.entries.slice();
	entries[entries.length - 1] = { ...entries[entries.length - 1], ...update };
	return { entries };
}

export function applyTranscriptEvent(state: TranscriptState, event: TranscriptEventLike): TranscriptState {
	switch (event.type) {
		case "message_start":
			return { entries: [...state.entries, { role: "assistant", text: "", streaming: true }] };
		case "message_update":
			return replaceLast(state, { text: event.text ?? "" });
		case "message_end":
			return replaceLast(state, { streaming: false });
		case "tool_execution_start":
			return { entries: [...state.entries, { role: "tool", text: event.toolName ?? "tool", streaming: true }] };
		case "tool_execution_end":
			return replaceLast(state, { streaming: false });
		default:
			return state;
	}
}
