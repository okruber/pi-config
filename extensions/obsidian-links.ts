import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { detectCapabilities, getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { Type } from "typebox";

const VAULT_NAME = "Oek Vault";

function obsidianUrl(fileRelPath: string): string {
	return `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(fileRelPath)}`;
}

function forceHyperlinks(): void {
	const caps = getCapabilities() ?? detectCapabilities();
	if (caps.hyperlinks) return;
	setCapabilities({ ...caps, hyperlinks: true });
}

export default function (pi: ExtensionAPI) {
	forceHyperlinks();

	pi.on("session_start", async (_event, _ctx) => {
		forceHyperlinks();
	});

	pi.registerTool({
		name: "open_in_obsidian",
		label: "Open in Obsidian",
		description:
			"Open a note in the Obsidian editor. Pass the vault-relative path (e.g. 'Tasks/foo.md'). Use as a fallback when clicking a link in the terminal does not open Obsidian.",
		parameters: Type.Object({
			file: Type.String({ description: "Vault-relative path to the note, e.g. 'Inbox/idea.md'" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const url = obsidianUrl(params.file);
			await new Promise<void>((resolve, reject) => {
				execFile("open", [url], (err) => (err ? reject(err) : resolve()));
			});
			return {
				content: [{ type: "text", text: `Opened in Obsidian: ${params.file}` }],
				details: {},
			};
		},
	});
}
