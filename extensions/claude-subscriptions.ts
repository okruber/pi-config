import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getModels } from "@earendil-works/pi-ai/compat";
import { loginAnthropic, refreshAnthropicToken, type OAuthCredentials } from "@earendil-works/pi-ai/oauth";

const ACCOUNTS = [
  { provider: "claude-imeto", name: "Claude imeto", env: "PI_CLAUDE_IMETO_EMAIL" },
  { provider: "claude-arrive", name: "Claude Arrive", env: "PI_CLAUDE_ARRIVE_EMAIL" },
] as const;

const DEFAULT_MODEL = "claude-sonnet-5";
const LABELS_ENV = "PI_CLAUDE_SUBSCRIPTION_LABELS";

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

async function login(callbacks: Parameters<Parameters<ExtensionAPI["registerProvider"]>[1]["oauth"]["login"]>[0]): Promise<OAuthCredentials> {
  return loginAnthropic({
    onAuth: callbacks.onAuth,
    onPrompt: callbacks.onPrompt,
    onProgress: callbacks.onProgress,
    onManualCodeInput: callbacks.onManualCodeInput,
  });
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
        login,
        refreshToken: (credentials) => refreshAnthropicToken(credentials.refresh),
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
