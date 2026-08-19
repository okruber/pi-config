import { describe, expect, it } from "vitest";
import { applyTranscriptEvent, emptyTranscript, type TranscriptEventLike } from "./transcript.js";

function apply(events: TranscriptEventLike[]) {
	return events.reduce(applyTranscriptEvent, emptyTranscript());
}

describe("applyTranscriptEvent", () => {
	it("appends an assistant entry on message_start", () => {
		const state = apply([{ type: "message_start", role: "assistant" }]);
		expect(state.entries).toEqual([{ role: "assistant", text: "", streaming: true }]);
	});

	it("accumulates streamed text into the open assistant entry", () => {
		const state = apply([
			{ type: "message_start", role: "assistant" },
			{ type: "message_update", role: "assistant", text: "Hel" },
			{ type: "message_update", role: "assistant", text: "Hello" },
		]);
		expect(state.entries).toEqual([{ role: "assistant", text: "Hello", streaming: true }]);
	});

	it("closes the entry on message_end", () => {
		const state = apply([
			{ type: "message_start", role: "assistant" },
			{ type: "message_update", role: "assistant", text: "Hello" },
			{ type: "message_end", role: "assistant" },
		]);
		expect(state.entries).toEqual([{ role: "assistant", text: "Hello", streaming: false }]);
	});

	it("records tool activity as its own entry", () => {
		const state = apply([{ type: "tool_execution_start", toolName: "bash" }]);
		expect(state.entries).toEqual([{ role: "tool", text: "bash", streaming: true }]);
	});

	it("closes the tool entry on tool_execution_end", () => {
		const state = apply([
			{ type: "tool_execution_start", toolName: "bash" },
			{ type: "tool_execution_end", toolName: "bash" },
		]);
		expect(state.entries).toEqual([{ role: "tool", text: "bash", streaming: false }]);
	});

	it("ignores unrelated events", () => {
		const state = apply([{ type: "turn_start" }, { type: "turn_end" }]);
		expect(state.entries).toEqual([]);
	});

	it("does not mutate the previous state", () => {
		const first = apply([{ type: "message_start", role: "assistant" }]);
		const second = applyTranscriptEvent(first, { type: "message_update", role: "assistant", text: "Hi" });
		expect(first.entries[0].text).toBe("");
		expect(second.entries[0].text).toBe("Hi");
	});
});
