/**
 * Streaming Handler for Cloud Code
 *
 * Handles streaming message requests with multi-account support,
 * retry logic, and endpoint failover.
 */

import {
    CLOUDCODE_ENDPOINT_FALLBACKS,
    MAX_RETRIES,
    MAX_EMPTY_RESPONSE_RETRIES,
    MAX_TOTAL_RETRY_TIME_MS,
    UPSTREAM_REQUEST_TIMEOUT_MS
} from '../constants.js';
import { isRateLimitError, isEmptyResponseError, MaxRetriesError } from '../errors.js';
import { sleep } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { parseResetTime } from './rate-limit-parser.js';
import { buildCloudCodeRequest, buildHeaders } from './request-builder.js';
import { streamSSEResponse } from './sse-streamer.js';
import { getFallbackModel } from '../fallback-config.js';
import crypto from 'crypto';
import {
    clearRateLimitState,
    isPermanentAuthFailure,
    handleHttpError,
    classifyRetryError,
    selectAccountForAttempt
} from './retry-utils.js';
import { isNonGoogleProvider, dispatchStreamToProvider } from './provider-dispatch.js';

/**
 * Send a streaming request to Cloud Code with multi-account support
 * Streams events in real-time as they arrive from the server
 *
 * @param {Object} anthropicRequest - The Anthropic-format request
 * @param {string} anthropicRequest.model - Model name to use
 * @param {Array} anthropicRequest.messages - Array of message objects
 * @param {number} [anthropicRequest.max_tokens] - Maximum tokens to generate
 * @param {Object} [anthropicRequest.thinking] - Thinking configuration
 * @param {import('../account-manager/index.js').default} accountManager - The account manager instance
 * @param {boolean} [fallbackEnabled=false] - Whether model fallback is enabled
 * @yields {Object} Anthropic-format SSE events (message_start, content_block_start, content_block_delta, etc.)
 * @throws {Error} If max retries exceeded or no accounts available
 */
export async function* sendMessageStream(anthropicRequest, accountManager, fallbackEnabled = false) {
    const model = anthropicRequest.model;

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
            model, accountManager, attempt, maxAttempts, fallbackEnabled,
            logPrefix: 'Stream '
        });

        if (selection.exhaustedAction === 'fallback') {
            const fallbackRequest = { ...anthropicRequest, model: selection.fallbackModel };
            yield* sendMessageStream(fallbackRequest, accountManager, false);
            return;
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
                    yield* dispatchStreamToProvider(anthropicRequest, account, token, accountManager);
                    clearRateLimitState(account.email, model);
                    accountManager.notifySuccess(account, model);
                    return;
                } catch (providerError) {
                    logger.warn(`[CloudCode] Provider dispatch failed for ${account.provider}:`, providerError.message);
                    throw providerError;
                }
            }

            // --- Google Cloud Code path (default) ---
            const project = await accountManager.getProjectForAccount(account, token);
            const payload = buildCloudCodeRequest(anthropicRequest, project, account.email);

            logger.debug(`[CloudCode] Starting stream for model: ${model}`);

            // Try each endpoint with index-based loop for capacity retry support
            let lastError = null;
            const retryState = { capacityRetryCount: 0 };
            let endpointIndex = 0;

            while (endpointIndex < CLOUDCODE_ENDPOINT_FALLBACKS.length) {
                const endpoint = CLOUDCODE_ENDPOINT_FALLBACKS[endpointIndex];
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_REQUEST_TIMEOUT_MS);

                try {
                    const url = `${endpoint}/v1internal:streamGenerateContent?alt=sse`;

                    let response;
                    try {
                        response = await fetch(url, {
                            method: 'POST',
                            headers: buildHeaders(token, model, 'text/event-stream'),
                            body: JSON.stringify(payload),
                            signal: controller.signal
                        });
                    } catch (fetchError) {
                        clearTimeout(timeoutId);
                        throw fetchError;
                    }

                    if (!response.ok) {
                        const errorText = await response.text();
                        logger.warn(`[CloudCode] Stream error at ${endpoint}: ${response.status} - ${errorText}`);

                        const result = await handleHttpError({
                            response, errorText, endpoint, account, model,
                            accountManager, retryState, logPrefix: 'Stream '
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

                    // Stream the response with retry logic for empty responses
                    let currentResponse = response;

                    for (let emptyRetries = 0; emptyRetries <= MAX_EMPTY_RESPONSE_RETRIES; emptyRetries++) {
                        try {
                            yield* streamSSEResponse(currentResponse, anthropicRequest.model);
                            clearTimeout(timeoutId);
                            logger.debug('[CloudCode] Stream completed');
                            clearRateLimitState(account.email, model);
                            accountManager.notifySuccess(account, model);
                            return;
                        } catch (streamError) {
                            // Only retry on EmptyResponseError
                            if (!isEmptyResponseError(streamError)) {
                                throw streamError;
                            }

                            // Check if we have retries left
                            if (emptyRetries >= MAX_EMPTY_RESPONSE_RETRIES) {
                                logger.error(`[CloudCode] Empty response after ${MAX_EMPTY_RESPONSE_RETRIES} retries`);
                                yield* emitEmptyResponseFallback(anthropicRequest.model);
                                return;
                            }

                            // Exponential backoff: 500ms, 1000ms, 2000ms
                            const backoffMs = 500 * Math.pow(2, emptyRetries);
                            logger.warn(`[CloudCode] Empty response, retry ${emptyRetries + 1}/${MAX_EMPTY_RESPONSE_RETRIES} after ${backoffMs}ms...`);
                            await sleep(backoffMs);

                            // Refetch the response
                            currentResponse = await fetch(url, {
                                method: 'POST',
                                headers: buildHeaders(token, model, 'text/event-stream'),
                                body: JSON.stringify(payload)
                            });

                            // Handle specific error codes on retry
                            if (!currentResponse.ok) {
                                const retryErrorText = await currentResponse.text();

                                if (currentResponse.status === 429) {
                                    const resetMs = parseResetTime(currentResponse, retryErrorText);
                                    accountManager.markRateLimited(account.email, resetMs, model);
                                    throw new Error(`429 RESOURCE_EXHAUSTED during retry: ${retryErrorText}`);
                                }

                                if (currentResponse.status === 401) {
                                    if (isPermanentAuthFailure(retryErrorText)) {
                                        logger.error(`[CloudCode] Permanent auth failure during retry for ${account.email}`);
                                        accountManager.markInvalid(account.email, 'Token revoked - re-authentication required');
                                        throw new Error(`AUTH_INVALID_PERMANENT: ${retryErrorText}`);
                                    }
                                    accountManager.clearTokenCache(account.email);
                                    accountManager.clearProjectCache(account.email);
                                    throw new Error(`401 AUTH_INVALID during retry: ${retryErrorText}`);
                                }

                                // For 5xx errors, continue retrying
                                if (currentResponse.status >= 500) {
                                    logger.warn(`[CloudCode] Retry got ${currentResponse.status}, will retry...`);
                                    await sleep(1000);
                                    currentResponse = await fetch(url, {
                                        method: 'POST',
                                        headers: buildHeaders(token, model, 'text/event-stream'),
                                        body: JSON.stringify(payload)
                                    });
                                    if (currentResponse.ok) {
                                        continue;
                                    }
                                }

                                throw new Error(`Empty response retry failed: ${currentResponse.status} - ${retryErrorText}`);
                            }
                        }
                    }

                } catch (endpointError) {
                    clearTimeout(timeoutId);
                    if (isRateLimitError(endpointError)) {
                        throw endpointError; // Re-throw to trigger account switch
                    }
                    if (isEmptyResponseError(endpointError)) {
                        throw endpointError;
                    }
                    logger.warn(`[CloudCode] Stream error at ${endpoint}:`, endpointError.message);
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
            const action = await classifyRetryError(error, account, model, accountManager, ' stream');
            if (action === 'continue') continue;
            throw error;
        }
    }

    // All retries exhausted - try fallback model if enabled
    if (fallbackEnabled) {
        const fallbackModel = getFallbackModel(model);
        if (fallbackModel) {
            logger.warn(`[CloudCode] All retries exhausted for ${model}. Attempting fallback to ${fallbackModel} (streaming)`);
            const fallbackRequest = { ...anthropicRequest, model: fallbackModel };
            yield* sendMessageStream(fallbackRequest, accountManager, false);
            return;
        }
    }

    throw new MaxRetriesError('Max retries exceeded', maxAttempts);
}

/**
 * Emit a fallback message when all retry attempts fail with empty response
 * @param {string} model - The model name
 * @yields {Object} Anthropic-format SSE events for empty response fallback
 */
function* emitEmptyResponseFallback(model) {
    const messageId = `msg_${crypto.randomBytes(16).toString('hex')}`;

    yield {
        type: 'message_start',
        message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 }
        }
    };

    yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
    };

    yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '[No response after retries - please try again]' }
    };

    yield { type: 'content_block_stop', index: 0 };

    yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 0 }
    };

    yield { type: 'message_stop' };
}
