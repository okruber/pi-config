import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { detectCapabilities, getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import http from "node:http";
import { Type } from "typebox";

const VAULT_NAME = "Oek Vault";
const PORT = 51888;
const HOST = "127.0.0.1";

let server: http.Server | undefined;

function obsidianUrl(fileRelPath: string): string {
	return `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(fileRelPath)}`;
}

function openInObsidian(fileRelPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile("open", [obsidianUrl(fileRelPath)], (err) => (err ? reject(err) : resolve()));
	});
}

function forceHyperlinks(): void {
	const caps = getCapabilities() ?? detectCapabilities();
	if (caps.hyperlinks) return;
	setCapabilities({ ...caps, hyperlinks: true });
}

function startServer(): void {
	if (server) return;
	const s = http.createServer((req, res) => {
		try {
			const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
			if (url.pathname === "/o") {
				const file = url.searchParams.get("file");
				if (file) void openInObsidian(file);
				res.statusCode = 204;
				res.end();
				return;
			}
			res.statusCode = 404;
			res.end();
		} catch {
			res.statusCode = 400;
			res.end();
		}
	});
	s.on("error", () => {
		// Another pi instance already owns the port; it serves all clicks.
		server = undefined;
	});
	s.listen(PORT, HOST, () => {
		server = s;
	});
	server = s;
}

export default function (pi: ExtensionAPI) {
	forceHyperlinks();
	startServer();

	pi.on("session_start", async (_event, _ctx) => {
		forceHyperlinks();
		startServer();
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
			await openInObsidian(params.file);
			return {
				content: [{ type: "text", text: `Opened in Obsidian: ${params.file}` }],
				details: {},
			};
		},
	});
}
