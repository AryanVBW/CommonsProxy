/**
 * Provider-Aware Request Dispatch
 *
 * Routes requests to the correct API endpoint based on the account's provider.
 * Google accounts use the Cloud Code API (default path in streaming-handler/message-handler).
 * Non-Google accounts (Copilot, OpenAI, Anthropic, etc.) are dispatched here
 * using the OpenAI-compatible infrastructure.
 */

import { createOpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { CopilotProvider, COPILOT_CONFIG } from '../providers/copilot.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// --- Copilot Model Name Mapping ---

/**
 * Authoritative set of Copilot model IDs from models.dev/api.json.
 * Updated 2026-02-15 from https://models.dev/api.json → "github-copilot" → "models".
 *
 * These are the EXACT model IDs the Copilot API accepts at api.githubcopilot.com.
 * Any model name not in this set after translation will still be passed through
 * (the API may add new models), but a warning will be logged.
 *
 * @type {Set<string>}
 */
const KNOWN_COPILOT_MODELS = new Set([
    // --- Claude (Anthropic) ---
    'claude-sonnet-4',
    'claude-sonnet-4.5',
    'claude-haiku-4.5',
    'claude-opus-41',           // NOTE: no dot — "41" not "4.1"
    'claude-opus-4.5',
    'claude-opus-4.6',
    // --- GPT (OpenAI) ---
    'gpt-4o',
    'gpt-4.1',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5.1',
    'gpt-5.1-codex',
    'gpt-5.1-codex-mini',
    'gpt-5.1-codex-max',
    'gpt-5.2',
    'gpt-5.2-codex',
    'gpt-5.3-codex',
    // --- Gemini (Google) ---
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
    // --- Grok (xAI) ---
    'grok-code-fast-1'
]);

/**
 * Explicit overrides for model names that don't follow regex rules.
 * Maps incoming model ID (lowercased) → exact Copilot model ID.
 *
 * We use a Map so lookup is O(1) and the entries are self-documenting.
 * @type {Map<string, string>}
 */
const COPILOT_MODEL_OVERRIDES = new Map([
    // --- Claude opus 4.1 → "opus-41" (concatenated, no dot) ---
    ['claude-opus-4-1', 'claude-opus-41'],
    ['claude-opus-4-1-thinking', 'claude-opus-41'],
    ['claude-opus-4.1', 'claude-opus-41'],
    ['claude-opus-4.1-thinking', 'claude-opus-41'],

    // --- Legacy / deprecated Anthropic model names → best current equivalent ---
    ['claude-3-5-sonnet', 'claude-sonnet-4'],
    ['claude-3.5-sonnet', 'claude-sonnet-4'],
    ['claude-3-5-sonnet-latest', 'claude-sonnet-4'],
    ['claude-3-7-sonnet', 'claude-sonnet-4'],
    ['claude-3.7-sonnet', 'claude-sonnet-4'],
    ['claude-3-7-sonnet-latest', 'claude-sonnet-4'],
    ['claude-3-5-haiku', 'claude-haiku-4.5'],
    ['claude-3.5-haiku', 'claude-haiku-4.5'],
    ['claude-3-opus', 'claude-opus-41'],
    ['claude-3.0-opus', 'claude-opus-41'],

    // --- GPT legacy names ---
    ['gpt-4o-mini', 'gpt-4o'],
    ['gpt-4', 'gpt-4o'],
    ['gpt-4-turbo', 'gpt-4o'],

    // --- o-series → GPT-5 mini (retired per GitHub docs, 2025-10-23) ---
    ['o1', 'gpt-5-mini'],
    ['o1-mini', 'gpt-5-mini'],
    ['o1-preview', 'gpt-5-mini'],
    ['o3', 'gpt-5-mini'],
    ['o3-mini', 'gpt-5-mini'],
    ['o3-pro', 'gpt-5.1'],
    ['o4-mini', 'gpt-5-mini']
]);

/**
 * Copilot models that support reasoning (reasoning: true from models.dev).
 * When the incoming request has Anthropic `thinking` config, we convert it
 * to OpenAI `reasoning_effort` for these models.
 *
 * @type {Set<string>}
 */
export const COPILOT_REASONING_MODELS = new Set([
    'claude-sonnet-4', 'claude-sonnet-4.5',
    'claude-haiku-4.5',
    'claude-opus-41', 'claude-opus-4.5', 'claude-opus-4.6',
    'gpt-5', 'gpt-5-mini',
    'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-mini', 'gpt-5.1-codex-max',
    'gpt-5.2', 'gpt-5.2-codex',
    'gpt-5.3-codex',
    'gemini-3-flash-preview', 'gemini-3-pro-preview',
    'grok-code-fast-1'
]);

/**
 * Translate an Anthropic/generic model name to a Copilot-compatible model ID.
 *
 * The Copilot API at api.githubcopilot.com uses specific model IDs that differ
 * from Anthropic's naming conventions. Claude Code sends Anthropic-style names
 * like "claude-opus-4-6-thinking" which must be translated to "claude-opus-4.6".
 *
 * Translation pipeline (applied in order):
 *   1. Exact match against known set (already valid) → return as-is
 *   2. Explicit override lookup (handles special cases like opus-41)
 *   3. Strip date suffixes (e.g. -20250514)
 *   4. Strip "-latest" and "-0" suffixes
 *   5. Strip "-thinking" suffix (Copilot uses reasoning_effort param instead)
 *   6. Re-check explicit overrides after stripping
 *   7. Convert Claude version hyphens to dots: "claude-sonnet-4-5" → "claude-sonnet-4.5"
 *   8. Convert GPT version hyphens to dots: "gpt-5-1" → "gpt-5.1"
 *   9. Validate against known set; pass through unknown with warning
 *
 * @param {string} model - Incoming model name (e.g. from Claude Code or Anthropic API)
 * @returns {{ model: string, isThinking: boolean }} Copilot model ID and whether -thinking was stripped
 */
export function translateModelForCopilot(model) {
    if (!model) return { model, isThinking: false };

    // Track whether the original name had -thinking suffix
    let isThinking = false;

    // 1. Already a known Copilot model? Return as-is.
    if (KNOWN_COPILOT_MODELS.has(model)) {
        return { model, isThinking };
    }

    // 2. Explicit override (before any stripping)
    const lowerModel = model.toLowerCase();
    if (COPILOT_MODEL_OVERRIDES.has(lowerModel)) {
        const mapped = COPILOT_MODEL_OVERRIDES.get(lowerModel);
        isThinking = /-thinking$/i.test(model);
        logger.debug(`[ProviderDispatch] Model override: ${model} → ${mapped}`);
        return { model: mapped, isThinking };
    }

    let translated = model;

    // 3. Strip date suffixes (e.g. -20250514, -20250601, -20260101)
    translated = translated.replace(/-\d{8}$/, '');

    // 4. Strip "-latest" and trailing "-0" suffixes
    translated = translated.replace(/-latest$/, '');
    translated = translated.replace(/-0$/, '');

    // 5. Strip "-thinking" suffix — record that it was present
    if (/-thinking$/i.test(translated)) {
        isThinking = true;
        translated = translated.replace(/-thinking$/i, '');
    }

    // 6. Re-check overrides after stripping
    //    e.g. "claude-opus-4-1-20250514" → stripped to "claude-opus-4-1" → override to "claude-opus-41"
    const lowerTranslated = translated.toLowerCase();
    if (COPILOT_MODEL_OVERRIDES.has(lowerTranslated)) {
        const mapped = COPILOT_MODEL_OVERRIDES.get(lowerTranslated);
        logger.debug(`[ProviderDispatch] Model override (post-strip): ${model} → ${mapped}`);
        return { model: mapped, isThinking };
    }

    // 7. Convert Claude version hyphens to dots:
    //    "claude-sonnet-4-5" → "claude-sonnet-4.5"
    //    "claude-opus-4-6"  → "claude-opus-4.6"
    //    "claude-haiku-4-5" → "claude-haiku-4.5"
    translated = translated.replace(
        /^(claude-(?:sonnet|opus|haiku)-)(\d+)-(\d+)$/,
        '$1$2.$3'
    );

    // 8. Convert GPT version hyphens to dots (for compound versions):
    //    "gpt-5-1" → "gpt-5.1"  but NOT "gpt-5-mini" or "gpt-5-codex"
    //    Match: gpt-X-Y where Y is a digit
    translated = translated.replace(
        /^(gpt-)(\d+)-(\d+)$/,
        '$1$2.$3'
    );
    // Also handle "gpt-5-1-codex" → "gpt-5.1-codex", "gpt-5-2-codex" → "gpt-5.2-codex"
    translated = translated.replace(
        /^(gpt-)(\d+)-(\d+)(-codex(?:-\w+)?)$/,
        '$1$2.$3$4'
    );

    // 9. Already a known model after translation?
    if (KNOWN_COPILOT_MODELS.has(translated)) {
        if (translated !== model) {
            logger.info(`[ProviderDispatch] Model translated: ${model} → ${translated}`);
        }
        return { model: translated, isThinking };
    }

    // 10. Unknown model — pass through but warn
    if (translated !== model) {
        logger.warn(`[ProviderDispatch] Model translated: ${model} → ${translated} (not in known Copilot set, passing through)`);
    } else {
        logger.warn(`[ProviderDispatch] Unknown model passed through unchanged: ${model}`);
    }
    return { model: translated, isThinking };
}

// --- Provider API Configuration ---

/**
 * Build provider-specific API configuration for non-Google providers
 *
 * @param {Object} account - Account object with provider field
 * @param {string} token - Access token for the account
 * @returns {{ baseUrl: string, headers: Object }|null} API config or null if unknown provider
 */
function getProviderApiConfig(account, token) {
    const providerId = account.provider || 'google';

    switch (providerId) {
        case 'copilot':
            return {
                baseUrl: COPILOT_CONFIG.apiUrl,
                headers: CopilotProvider.buildCopilotHeaders(token)
            };

        case 'openai':
            return {
                baseUrl: 'https://api.openai.com/v1',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            };

        case 'anthropic':
            return {
                baseUrl: 'https://api.anthropic.com/v1',
                headers: {
                    'x-api-key': token,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                }
            };

        case 'openrouter':
            return {
                baseUrl: 'https://openrouter.ai/api/v1',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            };

        case 'github':
            return {
                baseUrl: 'https://models.inference.ai.azure.com',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            };

        default:
            return null;
    }
}

/**
 * Check if an account's provider requires non-Google dispatch
 *
 * @param {Object} account - Account object
 * @returns {boolean} True if this account should NOT use the Cloud Code API
 */
export function isNonGoogleProvider(account) {
    const providerId = account.provider || 'google';
    return providerId !== 'google';
}

// --- Streaming Dispatch ---

/**
 * Send a streaming request through a non-Google provider's API
 * Converts Anthropic-format request to OpenAI format, streams the response,
 * and converts back to Anthropic-format SSE events.
 *
 * @param {Object} anthropicRequest - The Anthropic-format request
 * @param {Object} account - Account object with provider field
 * @param {string} token - Access token
 * @param {import('../account-manager/index.js').default} accountManager - Account manager
 * @yields {Object} Anthropic-format SSE events
 * @throws {Error} If the provider is unknown or the request fails
 */
export async function* dispatchStreamToProvider(anthropicRequest, account, token, accountManager) {
    const providerId = account.provider || 'google';
    const apiConfig = getProviderApiConfig(account, token);

    if (!apiConfig) {
        throw new Error(`No API configuration for provider: ${providerId}`);
    }

    // Translate model name for provider (e.g. Copilot uses different IDs)
    const originalModel = anthropicRequest.model;
    if (providerId === 'copilot') {
        const { model: copilotModel, isThinking } = translateModelForCopilot(anthropicRequest.model);
        anthropicRequest = { ...anthropicRequest, model: copilotModel };
        // Attach metadata so the format converter knows this is a reasoning model
        // and whether the original request had -thinking suffix
        if (isThinking || anthropicRequest.thinking) {
            anthropicRequest._copilotReasoning = true;
        }
    }
    if (anthropicRequest.model !== originalModel) {
        logger.info(`[ProviderDispatch] Model mapped: ${originalModel} → ${anthropicRequest.model} for ${providerId}`);
    }

    logger.info(`[ProviderDispatch] Routing stream request to ${providerId} (${apiConfig.baseUrl}), model: ${anthropicRequest.model}`);

    const provider = createOpenAICompatibleProvider({
        id: providerId,
        name: providerId,
        baseUrl: apiConfig.baseUrl,
        headers: apiConfig.headers
    });

    try {
        // The openai-compatible provider's sendMessageStream already handles
        // Anthropic->OpenAI conversion and OpenAI SSE->Anthropic SSE conversion
        yield* provider.sendMessageStream(anthropicRequest, { apiKey: null }, {});
    } catch (error) {
        logger.error(`[ProviderDispatch] Stream error for ${providerId}:`, error.message);
        throw error;
    }
}

// --- Non-Streaming Dispatch ---

/**
 * Send a non-streaming request through a non-Google provider's API
 * Converts Anthropic-format request to OpenAI format, sends it,
 * and converts the response back to Anthropic format.
 *
 * @param {Object} anthropicRequest - The Anthropic-format request
 * @param {Object} account - Account object with provider field
 * @param {string} token - Access token
 * @param {import('../account-manager/index.js').default} accountManager - Account manager
 * @returns {Promise<Object>} Anthropic-format response
 * @throws {Error} If the provider is unknown or the request fails
 */
export async function dispatchMessageToProvider(anthropicRequest, account, token, accountManager) {
    const providerId = account.provider || 'google';
    const apiConfig = getProviderApiConfig(account, token);

    if (!apiConfig) {
        throw new Error(`No API configuration for provider: ${providerId}`);
    }

    // Translate model name for provider (e.g. Copilot uses different IDs)
    const originalModel = anthropicRequest.model;
    if (providerId === 'copilot') {
        const { model: copilotModel, isThinking } = translateModelForCopilot(anthropicRequest.model);
        anthropicRequest = { ...anthropicRequest, model: copilotModel };
        if (isThinking || anthropicRequest.thinking) {
            anthropicRequest._copilotReasoning = true;
        }
    }
    if (anthropicRequest.model !== originalModel) {
        logger.info(`[ProviderDispatch] Model mapped: ${originalModel} → ${anthropicRequest.model} for ${providerId}`);
    }

    logger.info(`[ProviderDispatch] Routing message request to ${providerId} (${apiConfig.baseUrl}), model: ${anthropicRequest.model}`);

    const provider = createOpenAICompatibleProvider({
        id: providerId,
        name: providerId,
        baseUrl: apiConfig.baseUrl,
        headers: apiConfig.headers
    });

    try {
        // The openai-compatible provider's sendMessage already handles
        // Anthropic->OpenAI conversion and OpenAI->Anthropic response conversion
        return await provider.sendMessage(anthropicRequest, { apiKey: null }, {});
    } catch (error) {
        logger.error(`[ProviderDispatch] Message error for ${providerId}:`, error.message);
        throw error;
    }
}

export default {
    isNonGoogleProvider,
    translateModelForCopilot,
    dispatchStreamToProvider,
    dispatchMessageToProvider
};
