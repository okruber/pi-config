import { Container, Input, Key, Text, matchesKey, type Focusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import type { TranscriptState } from "./transcript.js";

export const FOCUS_SHORTCUTS = [Key.alt("/"), Key.ctrlAlt("w")] as const;

export function matchesFocusShortcut(data: string): boolean {
	return FOCUS_SHORTCUTS.some((shortcut) => matchesKey(data, shortcut));
}

export class BtwOverlay extends Container implements Focusable {
	focused = true;
	private readonly input: Input;

	constructor(
		tui: TUI,
		private readonly theme: { fg: (name: string, text: string) => string; bold: (text: string) => string },
		keybindings: KeybindingsManager,
		private readonly getTranscript: () => TranscriptState,
		private readonly getStatus: () => string | null,
		private readonly onSubmit: (value: string) => void,
		private readonly onDismiss: () => void,
		private readonly onToggleFocus: () => void,
	) {
		super();
		this.input = new Input(tui, keybindings);
		this.input.onSubmit = (value) => {
			if (value.trim()) {
				this.onSubmit(value.trim());
				this.input.setText("");
			}
		};
		this.rebuild();
	}

	handleInput(data: string): boolean {
		if (matchesFocusShortcut(data)) {
			this.onToggleFocus();
			return true;
		}
		if (matchesKey(data, Key.escape())) {
			this.onDismiss();
			return true;
		}
		return this.input.handleInput(data);
	}

	setDraft(value: string): void {
		this.input.setText(value);
	}

	getDraft(): string {
		return this.input.getText();
	}

	refresh(): void {
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		this.addChild(new Text(this.theme.bold("btw · side thread")));

		for (const entry of this.getTranscript().entries) {
			const prefix = entry.role === "user" ? "› " : entry.role === "tool" ? "⚙ " : "";
			const body = entry.role === "tool" ? this.theme.fg("dim", `${prefix}${entry.text}`) : `${prefix}${entry.text}`;
			this.addChild(new Text(body));
		}

		const status = this.getStatus();
		if (status) {
			this.addChild(new Text(this.theme.fg("dim", status)));
		}

		this.addChild(this.input);
		this.addChild(new Text(this.theme.fg("dim", "alt+/ focus main · esc dismiss")));
	}
}
