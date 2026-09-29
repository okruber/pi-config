import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Jev through OpenRouter with a dedicated key.
 *
 * The `openrouter` login in auth.json belongs to an organization workspace whose
 * guardrails block TypeSafe models, so Jev cannot run on it. This extension
 * repoints provider `typesafe` at OpenRouter and reads the key from the macOS
 * keychain, while classification itself stays pi's built-in `typesafe-system-one`
 * implementation. Add the key with:
 *
 *   security add-generic-password -s openrouter-jev -a pi -w <key>
 *
 * Reach it from a codemode script with:
 *
 *   models.getModelOfType("classifier", "typesafe", "~typesafe/jev-latest")
 */

const ENDPOINT = "https://openrouter.ai/api/v1";
const KEYCHAIN_SERVICE = "openrouter-jev";
const COST = { input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 };

export default function (pi: ExtensionAPI) {
  pi.registerProvider("typesafe", {
    name: "TypeSafe Jev (OpenRouter)",
    baseUrl: ENDPOINT,
    apiKey: `!security find-generic-password -s ${KEYCHAIN_SERVICE} -a pi -w`,
    models: [
      {
        type: "classifier",
        id: "~typesafe/jev-latest",
        name: "TypeSafe: Jev Latest (OpenRouter)",
        api: "typesafe-system-one",
        baseUrl: ENDPOINT,
        input: ["text"],
        cost: COST,
        contextWindow: 32000
      },
      {
        type: "classifier",
        id: "typesafe/jev-1.13",
        name: "TypeSafe: Jev 1.13 (OpenRouter)",
        api: "typesafe-system-one",
        baseUrl: ENDPOINT,
        input: ["text"],
        cost: COST,
        contextWindow: 32000
      }
    ]
  });
}
