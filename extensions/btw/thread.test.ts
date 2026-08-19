import { describe, expect, it } from "vitest";
import { BTW_RESET_ENTRY, BTW_TURN_ENTRY, rehydrateThread, type BtwTurn, type SessionEntryLike } from "./thread.js";

function turnEntry(turn: Partial<BtwTurn>): SessionEntryLike {
	return {
		type: "custom",
		customType: BTW_TURN_ENTRY,
		data: { question: "q", answer: "a", kind: "question", timestamp: 1, ...turn },
	};
}

describe("rehydrateThread", () => {
	it("returns turns in session order", () => {
		const thread = rehydrateThread([turnEntry({ question: "one" }), turnEntry({ question: "two" })]);
		expect(thread.map((t) => t.question)).toEqual(["one", "two"]);
	});

	it("ignores entries belonging to other extensions", () => {
		const thread = rehydrateThread([
			{ type: "custom", customType: "todo-state", data: { question: "nope" } },
			turnEntry({ question: "one" }),
		]);
		expect(thread.map((t) => t.question)).toEqual(["one"]);
	});

	it("drops everything before a reset marker", () => {
		const thread = rehydrateThread([
			turnEntry({ question: "old" }),
			{ type: "custom", customType: BTW_RESET_ENTRY, data: {} },
			turnEntry({ question: "new" }),
		]);
		expect(thread.map((t) => t.question)).toEqual(["new"]);
	});

	it("returns an empty thread when the last entry is a reset", () => {
		const thread = rehydrateThread([turnEntry({ question: "old" }), { type: "custom", customType: BTW_RESET_ENTRY, data: {} }]);
		expect(thread).toEqual([]);
	});

	it("skips malformed turn payloads instead of throwing", () => {
		const thread = rehydrateThread([
			{ type: "custom", customType: BTW_TURN_ENTRY, data: null },
			{ type: "custom", customType: BTW_TURN_ENTRY, data: { question: 42 } },
			turnEntry({ question: "one" }),
		]);
		expect(thread.map((t) => t.question)).toEqual(["one"]);
	});

	it("preserves the handoff kind", () => {
		const thread = rehydrateThread([turnEntry({ kind: "handoff" })]);
		expect(thread[0].kind).toBe("handoff");
	});
});
