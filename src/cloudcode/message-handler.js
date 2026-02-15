/**
 * Message Handler for Cloud Code
 *
 * Handles non-streaming message requests with multi-account support,
 * retry logic, and endpoint failover.
 */

import {
    CLOUDCODE_ENDPOINT_FALLBACKS,
    MAX_RETRIES,
    MAX_TOTAL_RETRY_TIME_MS,
    UPSTREAM_REQUEST_TIMEOUT_MS,
    isThinkingModel
} from '../constants.js';
import { convertGoogleToAnthropic } from '../format/index.js';
import { isRateLimitError, MaxRetriesError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { buildCloudCodeRequest, buildHeaders } from './request-builder.js';
import { parseThinkingSSEResponse } from './sse-parser.js';
import { getFallbackModel } from '../fallback-config.js';
import {
    clearRateLimitState,
    handleHttpError,
    classifyRetryError,
    selectAccountForAttempt
} from './retry-utils.js';
import { isNonGoogleProvider, dispatchMessageToProvider } from './provider-dispatch.js';

/**
 * Send a non-streaming request to Cloud Code with multi-account support
 * Uses SSE endpoint for thinking models (non-streaming doesn't return thinking blocks)
 *
 * @param {Object} anthropicRequest - The Anthropic-format request
 * @param {Object} anthropicRequest.model - Model name to use
 * @param {Array} anthropicRequest.messages - Array of message objects
 * @param {number} [anthropicRequest.max_tokens] - Maximum tokens to generate
 * @param {Object} [anthropicRequest.thinking] - Thinking configuration
 * @param {import('../account-manager/index.js').default} accountManager - The account manager instance
 * @param {boolean} [fallbackEnabled=false] - Whether model fallback is enabled
 * @returns {Promise<Object>} Anthropic-format response object
 * @throws {Error} If max retries exceeded or no accounts available
 */
export async function sendMessage(anthropicRequest, accountManager, fallbackEnabled = false) {
    const model = anthropicRequest.model;
    const isThinking = isThinkingModel(model);

    // Retry loop with account failover
    const maxAttempts = Math.max(MAX_RETRIES, accountManager.getAccountCount() + 1);
    const retryStartTime = Date.now();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Wall-clock safety: abort if total retry time exceeds cap
        if (Date.now() - retryStartTime > MAX_TOTAL_RETRY_TIME_MS) {
            throw new MaxRetriesError(`Total retry time exceeded ${MAX_TOTAL_RETRY_TIME_MS}ms`, attempt);
        }

        // Select account (handles rate-limit waits, fallback detection)
        const selection = await selectAccountForAttempt({
            model, accountManager, attempt, maxAttempts, fallbackEnabled
        });

        if (selection.exhaustedAction === 'fallback') {
            const fallbackRequest = { ...anthropicRequest, model: selection.fallbackModel };
            return await sendMessage(fallbackRequest, accountManager, false);
        }

        if (selection.decrementAttempt) {
            attempt--;
            continue;
        }

        const { account } = selection;
        if (!account) continue;

        try {
            // Get token and project for this account
            const token = await accountManager.getTokenForAccount(account);

            // --- Provider-aware dispatch ---
            // Non-Google providers (Copilot, OpenAI, etc.) use their own API endpoints
            if (isNonGoogleProvider(account)) {
                try {
                    const result = await dispatchMessageToProvider(anthropicRequest, account, token, accountManager);
                    clearRateLimitState(account.email, model);
                    accountManager.notifySuccess(account, model);
                    return result;
                } catch (providerError) {
                    logger.warn(`[CloudCode] Provider dispatch failed for ${account.provider}:`, providerError.message);
                    throw providerError;
                }
            }

            // --- Google Cloud Code path (default) ---
            const project = await accountManager.getProjectForAccount(account, token);
            const payload = buildCloudCodeRequest(anthropicRequest, project, account.email);

            logger.debug(`[CloudCode] Sending request for model: ${model}`);

            // Try each endpoint with index-based loop for capacity retry support
            let lastError = null;
            const retryState = { capacityRetryCount: 0 };
            let endpointIndex = 0;

            while (endpointIndex < CLOUDCODE_ENDPOINT_FALLBACKS.length) {
                const endpoint = CLOUDCODE_ENDPOINT_FALLBACKS[endpointIndex];
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_REQUEST_TIMEOUT_MS);

                try {
                    const url = isThinking
                        ? `${endpoint}/v1internal:streamGenerateContent?alt=sse`
                        : `${endpoint}/v1internal:generateContent`;

                    let response;
                    try {
                        response = await fetch(url, {
                            method: 'POST',
                            headers: buildHeaders(token, model, isThinking ? 'text/event-stream' : 'application/json'),
                            body: JSON.stringify(payload),
                            signal: controller.signal
                        });
                    } catch (fetchError) {
                        clearTimeout(timeoutId);
                        throw fetchError;
                    }

                    if (!response.ok) {
                        const errorText = await response.text();
                        logger.warn(`[CloudCode] Error at ${endpoint}: ${response.status} - ${errorText}`);

                        const result = await handleHttpError({
                            response, errorText, endpoint, account, model,
                            accountManager, retryState
                        });

                        switch (result.action) {
                            case 'retryEndpoint':
                                continue;
                            case 'nextEndpoint':
                                if (result.error) lastError = result.error;
                                endpointIndex++;
                                continue;
                            case 'throw':
                                throw result.error;
                        }
                    }

                    // For thinking models, parse SSE and accumulate all parts
                    if (isThinking) {
                        const result = await parseThinkingSSEResponse(response, anthropicRequest.model);
                        clearTimeout(timeoutId);
                        clearRateLimitState(account.email, model);
                        accountManager.notifySuccess(account, model);
                        return result;
                    }

                    // Non-thinking models use regular JSON
                    const data = await response.json();
                    clearTimeout(timeoutId);
                    logger.debug('[CloudCode] Response received');
                    clearRateLimitState(account.email, model);
                    accountManager.notifySuccess(account, model);
                    return convertGoogleToAnthropic(data, anthropicRequest.model);

                } catch (endpointError) {
                    clearTimeout(timeoutId);
                    if (isRateLimitError(endpointError)) {
                        throw endpointError; // Re-throw to trigger account switch
                    }
                    logger.warn(`[CloudCode] Error at ${endpoint}:`, endpointError.message);
                    lastError = endpointError;
                    endpointIndex++;
                }
            }

            // If all endpoints failed for this account
            if (lastError) {
                if (lastError.is429) {
                    logger.warn(`[CloudCode] All endpoints rate-limited for ${account.email}`);
                    accountManager.markRateLimited(account.email, lastError.resetMs, model);
                    throw new Error(`Rate limited: ${lastError.errorText}`);
                }
                throw lastError;
            }

        } catch (error) {
            const action = await classifyRetryError(error, account, model, accountManager);
            if (action === 'continue') continue;
            throw error;
        }
    }

    // All retries exhausted - try fallback model if enabled
    if (fallbackEnabled) {
        const fallbackModel = getFallbackModel(model);
        if (fallbackModel) {
            logger.warn(`[CloudCode] All retries exhausted for ${model}. Attempting fallback to ${fallbackModel}`);
            const fallbackRequest = { ...anthropicRequest, model: fallbackModel };
            return await sendMessage(fallbackRequest, accountManager, false);
        }
    }

    throw new MaxRetriesError('Max retries exceeded', maxAttempts);
}
