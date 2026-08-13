import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { getModels } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const ACCOUNTS = [
  { provider: "claude-imeto", name: "Claude imeto", env: "PI_CLAUDE_IMETO_EMAIL" },
  { provider: "claude-arrive", name: "Claude Arrive", env: "PI_CLAUDE_ARRIVE_EMAIL" },
] as const;

const DEFAULT_MODEL = "claude-sonnet-5";
const LABELS_ENV = "PI_CLAUDE_SUBSCRIPTION_LABELS";

const CLIENT_ID = atob("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CALLBACK_HOST = process.env.PI_OAUTH_CALLBACK_HOST || "127.0.0.1";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const verifier = base64Url(random);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // not a URL
  }
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return { code: params.get("code") ?? undefined, state: params.get("state") ?? undefined };
  }
  return { code: value };
}

interface CallbackServer {
  server: Server;
  waitForCode(): Promise<{ code: string; state: string } | null>;
  cancelWait(): void;
}

function page(title: string, detail?: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:3rem"><h1>${title}</h1>${detail ? `<p>${detail}</p>` : ""}</body>`;
}

async function startCallbackServer(expectedState: string): Promise<CallbackServer | null> {
  return new Promise((resolve) => {
    let settle: ((value: { code: string; state: string } | null) => void) | undefined;
    let settled = false;
    const waitForCodePromise = new Promise<{ code: string; state: string } | null>((resolveWait) => {
      settle = (value) => {
        if (settled) return;
        settled = true;
        resolveWait(value);
      };
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url || "", "http://localhost");
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Callback route not found."));
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error || !code || !state || state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Claude authentication did not complete.", error ?? "Missing or mismatched code/state."));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Claude authentication completed.", "You can close this window."));
      settle?.({ code, state });
    });

    server.on("error", () => resolve(null));
    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
      resolve({ server, waitForCode: () => waitForCodePromise, cancelWait: () => settle?.(null) });
    });
  });
}

async function postToken(body: Record<string, string>, signal?: AbortSignal): Promise<OAuthCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Claude token request failed. status=${response.status}; url=${TOKEN_URL}; body=${text}`);
  }
  const data = JSON.parse(text) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    refresh: data.refresh_token,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const { verifier, challenge } = await generatePKCE();
  const server = await startCallbackServer(verifier);
  const authParams = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
  });

  callbacks.onAuth({
    url: `${AUTHORIZE_URL}?${authParams.toString()}`,
    instructions: "Complete login in your browser. If the browser runs on another machine, paste the final redirect URL here.",
  });

  try {
    const manual = callbacks
      .onPrompt({
        message: "Complete login in your browser, or paste the authorization code / redirect URL here:",
        placeholder: REDIRECT_URI,
        allowEmpty: true,
      })
      .then((value) => {
        server?.cancelWait();
        return value;
      });

    let code: string | undefined;
    let state: string | undefined;

    const fromServer = server ? await Promise.race([server.waitForCode(), manual.then(() => null)]) : null;
    if (fromServer?.code) {
      code = fromServer.code;
      state = fromServer.state;
    } else {
      const parsed = parseAuthorizationInput(await manual);
      if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
      code = parsed.code;
      state = parsed.state ?? verifier;
    }

    if (!code) throw new Error("Missing authorization code");
    callbacks.onProgress?.("Exchanging authorization code for tokens...");
    return postToken(
      {
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        state: state ?? verifier,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      },
      callbacks.signal,
    );
  } finally {
    server?.server.close();
  }
}

async function refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
  const refreshed = await postToken(
    { grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: credentials.refresh },
    signal,
  );
  return { ...refreshed, refresh: refreshed.refresh || credentials.refresh };
}

function readConfiguredLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  const configPath = join(getAgentDir(), "claude-subscriptions.json");

  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      if (parsed && typeof parsed === "object") {
        for (const [provider, label] of Object.entries(parsed)) {
          if (typeof label === "string" && label.trim()) labels[provider] = label.trim();
        }
      }
    } catch {
      // Ignore config parse errors; /login and model aliases should still work.
    }
  }

  for (const account of ACCOUNTS) {
    const fromEnv = process.env[account.env]?.trim();
    if (fromEnv) labels[account.provider] = fromEnv;
  }

  return labels;
}

function publishLabelsForFooter() {
  const existing = process.env[LABELS_ENV]
    ? (() => {
        try {
          const parsed = JSON.parse(process.env[LABELS_ENV] ?? "{}");
          return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
        } catch {
          return {};
        }
      })()
    : {};

  process.env[LABELS_ENV] = JSON.stringify({ ...existing, ...readConfiguredLabels() });
}

function cloneAnthropicModels(): ProviderModelConfig[] {
  return getModels("anthropic").map((model) => ({
    id: model.id,
    name: model.name,
    api: model.api,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    headers: model.headers,
    compat: model.compat,
  }));
}

export default function (pi: ExtensionAPI) {
  publishLabelsForFooter();
  const models = cloneAnthropicModels();

  for (const account of ACCOUNTS) {
    pi.registerProvider(account.provider, {
      name: account.name,
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      models,
      oauth: {
        name: `${account.name} (Claude Pro/Max)`,
        isSubscription: true,
        login,
        refreshToken,
        getApiKey: (credentials) => credentials.access,
      },
    });

    pi.registerCommand(account.provider, {
      description: `Switch to ${account.name} using the current Claude model (or ${DEFAULT_MODEL})`,
      handler: async (args, ctx) => {
        const requested = args.trim();
        const current = ctx.model?.provider.startsWith("claude-") || ctx.model?.provider === "anthropic" ? ctx.model.id : undefined;
        const modelId = requested || current || DEFAULT_MODEL;
        const model = ctx.modelRegistry.find(account.provider, modelId);
        if (!model) {
          ctx.ui.notify(`No model ${account.provider}/${modelId}`, "error");
          return;
        }
        const ok = await pi.setModel(model);
        ctx.ui.notify(ok ? `Switched to ${account.provider}/${model.id}` : `Login required: /login ${account.provider}`, ok ? "info" : "warning");
      },
    });
  }

  pi.registerCommand("claude-sub", {
    description: "Switch Claude subscription account: /claude-sub imeto|arrive [model]",
    getArgumentCompletions: (prefix) => {
      const options = ["imeto", "arrive", "claude-imeto", "claude-arrive"];
      return options.filter((value) => value.startsWith(prefix)).map((value) => ({ value }));
    },
    handler: async (args, ctx) => {
      const [rawAccount, maybeModel] = args.trim().split(/\s+/, 2);
      const suffix = rawAccount?.replace(/^claude-/, "");
      const account = ACCOUNTS.find((candidate) => candidate.provider === rawAccount || candidate.provider === `claude-${suffix}`);
      if (!account) {
        ctx.ui.notify("Usage: /claude-sub imeto|arrive [model]", "warning");
        return;
      }
      const modelId = maybeModel || (ctx.model?.provider.startsWith("claude-") || ctx.model?.provider === "anthropic" ? ctx.model.id : undefined) || DEFAULT_MODEL;
      const model = ctx.modelRegistry.find(account.provider, modelId);
      if (!model) {
        ctx.ui.notify(`No model ${account.provider}/${modelId}`, "error");
        return;
      }
      const ok = await pi.setModel(model);
      ctx.ui.notify(ok ? `Switched to ${account.provider}/${model.id}` : `Login required: /login ${account.provider}`, ok ? "info" : "warning");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    publishLabelsForFooter();
    const labels = readConfiguredLabels();
    const activeLabel = ctx.model?.provider ? labels[ctx.model.provider] : undefined;
    if (activeLabel) ctx.ui.setStatus("claude-sub", `sub: ${activeLabel}`);
  });

  pi.on("model_select", (event, ctx) => {
    publishLabelsForFooter();
    const labels = readConfiguredLabels();
    const label = labels[event.model.provider];
    ctx.ui.setStatus("claude-sub", label ? `sub: ${label}` : undefined);
  });
}
