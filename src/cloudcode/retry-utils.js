/**
 * Retry Utilities for Cloud Code Handlers
 *
 * Shared retry logic, rate limit tracking, and error classification
 * used by both message-handler.js and streaming-handler.js.
 */

import {
    DEFAULT_COOLDOWN_MS,
    RATE_LIMIT_DEDUP_WINDOW_MS,
    RATE_LIMIT_STATE_RESET_MS,
    FIRST_RETRY_DELAY_MS,
    BACKOFF_BY_ERROR_TYPE,
    QUOTA_EXHAUSTED_BACKOFF_TIERS_MS,
    MIN_BACKOFF_MS,
    MAX_CONSECUTIVE_FAILURES,
    EXTENDED_COOLDOWN_MS,
    SWITCH_ACCOUNT_DELAY_MS,
    MAX_CAPACITY_RETRIES,
    CAPACITY_BACKOFF_TIERS_MS
} from '../constants.js';
import { isRateLimitError, isAuthError } from '../errors.js';
import { formatDuration, sleep, isNetworkError } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { parseResetTime, parseRateLimitReason } from './rate-limit-parser.js';

// ─── Rate Limit State Tracking ──────────────────────────────────────────────

/**
 * Rate limit deduplication - prevents thundering herd on concurrent rate limits.
 * Tracks rate limit state per account+model including consecutive429 count and timestamps.
 */
const rateLimitStateByAccountModel = new Map(); // `${email}:${model}` -> { consecutive429, lastAt }

/**
 * Get deduplication key for rate limit tracking
 * @param {string} email - Account email
 * @param {string} model - Model ID
 * @returns {string} Dedup key
 */
function getDedupKey(email, model) {
    return `${email}:${model}`;
}

/**
 * Get rate limit backoff with deduplication and exponential backoff
 * @param {string} email - Account email
 * @param {string} model - Model ID
 * @param {number|null} serverRetryAfterMs - Server-provided retry time
 * @returns {{attempt: number, delayMs: number, isDuplicate: boolean}} Backoff info
 */
export function getRateLimitBackoff(email, model, serverRetryAfterMs) {
    const now = Date.now();
    const stateKey = getDedupKey(email, model);
    const previous = rateLimitStateByAccountModel.get(stateKey);

    // Check if within dedup window - return duplicate status
    if (previous && (now - previous.lastAt < RATE_LIMIT_DEDUP_WINDOW_MS)) {
        const baseDelay = serverRetryAfterMs ?? FIRST_RETRY_DELAY_MS;
        const backoffDelay = Math.min(baseDelay * Math.pow(2, previous.consecutive429 - 1), 60000);
        logger.debug(`[CloudCode] Rate limit on ${email}:${model} within dedup window, attempt=${previous.consecutive429}, isDuplicate=true`);
        return { attempt: previous.consecutive429, delayMs: Math.max(baseDelay, backoffDelay), isDuplicate: true };
    }

    // Determine attempt number - reset after RATE_LIMIT_STATE_RESET_MS of inactivity
    const attempt = previous && (now - previous.lastAt < RATE_LIMIT_STATE_RESET_MS)
        ? previous.consecutive429 + 1
        : 1;

    // Update state
    rateLimitStateByAccountModel.set(stateKey, { consecutive429: attempt, lastAt: now });

    // Calculate exponential backoff
    const baseDelay = serverRetryAfterMs ?? FIRST_RETRY_DELAY_MS;
    const backoffDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), 60000);

    logger.debug(`[CloudCode] Rate limit backoff for ${email}:${model}: attempt=${attempt}, delayMs=${Math.max(baseDelay, backoffDelay)}`);
    return { attempt, delayMs: Math.max(baseDelay, backoffDelay), isDuplicate: false };
}

/**
 * Clear rate limit state after successful request
 * @param {string} email - Account email
 * @param {string} model - Model ID
 */
export function clearRateLimitState(email, model) {
    const key = getDedupKey(email, model);
    rateLimitStateByAccountModel.delete(key);
}

// Periodically clean up stale rate limit state (every 60 seconds)
setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_STATE_RESET_MS;
    for (const [key, state] of rateLimitStateByAccountModel.entries()) {
        if (state.lastAt < cutoff) {
            rateLimitStateByAccountModel.delete(key);
        }
    }
}, 60000);

// ─── Error Classification ───────────────────────────────────────────────────

/**
 * Detect permanent authentication failures that require re-authentication.
 * @param {string} errorText - Error message from API
 * @returns {boolean} True if permanent auth failure
 */
export function isPermanentAuthFailure(errorText) {
    const lower = (errorText || '').toLowerCase();
    return lower.includes('invalid_grant') ||
        lower.includes('token revoked') ||
        lower.includes('token has been expired or revoked') ||
        lower.includes('token_revoked') ||
        lower.includes('invalid_client') ||
        lower.includes('credentials are invalid');
}

/**
 * Detect if 429 error is due to model capacity (not user quota).
 * Capacity issues should retry on same account with shorter delay.
 * @param {string} errorText - Error message from API
 * @returns {boolean} True if capacity exhausted (not quota)
 */
export function isModelCapacityExhausted(errorText) {
    const lower = (errorText || '').toLowerCase();
    return lower.includes('model_capacity_exhausted') ||
        lower.includes('capacity_exhausted') ||
        lower.includes('model is currently overloaded') ||
        lower.includes('service temporarily unavailable');
}

/**
 * Calculate smart backoff based on error type
 * @param {string} errorText - Error message
 * @param {number|null} serverResetMs - Reset time from server
 * @param {number} consecutiveFailures - Number of consecutive failures
 * @returns {number} Backoff time in milliseconds
 */
export function calculateSmartBackoff(errorText, serverResetMs, consecutiveFailures = 0) {
    // If server provides a reset time, use it (with minimum floor to prevent loops)
    if (serverResetMs && serverResetMs > 0) {
        return Math.max(serverResetMs, MIN_BACKOFF_MS);
    }

    const reason = parseRateLimitReason(errorText);

    switch (reason) {
        case 'QUOTA_EXHAUSTED':
            // Progressive backoff: [60s, 5m, 30m, 2h]
            const tierIndex = Math.min(consecutiveFailures, QUOTA_EXHAUSTED_BACKOFF_TIERS_MS.length - 1);
            return QUOTA_EXHAUSTED_BACKOFF_TIERS_MS[tierIndex];
        case 'RATE_LIMIT_EXCEEDED':
            return BACKOFF_BY_ERROR_TYPE.RATE_LIMIT_EXCEEDED;
        case 'MODEL_CAPACITY_EXHAUSTED':
            return BACKOFF_BY_ERROR_TYPE.MODEL_CAPACITY_EXHAUSTED;
        case 'SERVER_ERROR':
            return BACKOFF_BY_ERROR_TYPE.SERVER_ERROR;
        default:
            return BACKOFF_BY_ERROR_TYPE.UNKNOWN;
    }
}

// ─── HTTP Response Error Handling ───────────────────────────────────────────

/**
 * Handle a non-OK HTTP response within the endpoint loop.
 * Processes 401, 429, 503 capacity, and other error status codes.
 *
 * @param {Object} params
 * @param {Response} params.response - The fetch Response object
 * @param {string} params.errorText - The response body text
 * @param {string} params.endpoint - Current endpoint URL
 * @param {Object} params.account - Current account object
 * @param {string} params.model - Model ID
 * @param {Object} params.accountManager - AccountManager instance
 * @param {Object} params.retryState - Mutable state: { capacityRetryCount }
 * @param {string} params.logPrefix - Log prefix ("" or "Stream ")
 * @returns {{action: string, waitMs?: number, error?: Error}}
 *   action: 'retryEndpoint' | 'nextEndpoint' | 'switchAccount' | 'throw'
 */
export async function handleHttpError({ response, errorText, endpoint, account, model, accountManager, retryState, logPrefix = '' }) {
    const status = response.status;

    // ── 401 Auth ─────────────────────────────────────────────────────────
    if (status === 401) {
        if (isPermanentAuthFailure(errorText)) {
            logger.error(`[CloudCode] Permanent auth failure for ${account.email}: ${errorText.substring(0, 100)}`);
            accountManager.markInvalid(account.email, 'Token revoked - re-authentication required');
            return { action: 'throw', error: new Error(`AUTH_INVALID_PERMANENT: ${errorText}`) };
        }

        logger.warn(`[CloudCode] ${logPrefix}Transient auth error, refreshing token...`);
        accountManager.clearTokenCache(account.email);
        accountManager.clearProjectCache(account.email);
        return { action: 'nextEndpoint' };
    }

    // ── 429 Rate Limit ───────────────────────────────────────────────────
    if (status === 429) {
        const resetMs = parseResetTime(response, errorText);
        const consecutiveFailures = accountManager.getConsecutiveFailures?.(account.email) || 0;

        // Capacity issue (not quota) — retry same endpoint with progressive backoff
        if (isModelCapacityExhausted(errorText)) {
            if (retryState.capacityRetryCount < MAX_CAPACITY_RETRIES) {
                const tierIndex = Math.min(retryState.capacityRetryCount, CAPACITY_BACKOFF_TIERS_MS.length - 1);
                const waitMs = resetMs || CAPACITY_BACKOFF_TIERS_MS[tierIndex];
                retryState.capacityRetryCount++;
                accountManager.incrementConsecutiveFailures(account.email);
                logger.info(`[CloudCode] ${logPrefix}Model capacity exhausted, retry ${retryState.capacityRetryCount}/${MAX_CAPACITY_RETRIES} after ${formatDuration(waitMs)}...`);
                await sleep(waitMs);
                return { action: 'retryEndpoint' };
            }
            logger.warn(`[CloudCode] ${logPrefix}Max capacity retries (${MAX_CAPACITY_RETRIES}) exceeded, switching account`);
        }

        // Exponential backoff + dedup
        const backoff = getRateLimitBackoff(account.email, model, resetMs);

        // Very short rate limits (< 1 second) — always wait and retry
        if (resetMs !== null && resetMs < 1000) {
            logger.info(`[CloudCode] ${logPrefix}Short rate limit on ${account.email} (${resetMs}ms), waiting and retrying...`);
            await sleep(resetMs);
            return { action: 'retryEndpoint' };
        }

        // Within dedup window — switch account
        if (backoff.isDuplicate) {
            const smartBackoffMs = calculateSmartBackoff(errorText, resetMs, consecutiveFailures);
            logger.info(`[CloudCode] ${logPrefix}Skipping retry due to recent rate limit on ${account.email} (attempt ${backoff.attempt}), switching account...`);
            accountManager.markRateLimited(account.email, smartBackoffMs, model);
            return { action: 'throw', error: new Error(`RATE_LIMITED_DEDUP: ${errorText}`) };
        }

        const smartBackoffMs = calculateSmartBackoff(errorText, resetMs, consecutiveFailures);

        // First 429 + short backoff → quick retry
        if (backoff.attempt === 1 && smartBackoffMs <= DEFAULT_COOLDOWN_MS) {
            const waitMs = backoff.delayMs;
            accountManager.markRateLimited(account.email, waitMs, model);
            logger.info(`[CloudCode] ${logPrefix}First rate limit on ${account.email}, quick retry after ${formatDuration(waitMs)}...`);
            await sleep(waitMs);
            return { action: 'retryEndpoint' };
        }

        // Long-term quota exhaustion → switch account
        if (smartBackoffMs > DEFAULT_COOLDOWN_MS) {
            logger.info(`[CloudCode] ${logPrefix}Quota exhausted for ${account.email} (${formatDuration(smartBackoffMs)}), switching account after ${formatDuration(SWITCH_ACCOUNT_DELAY_MS)} delay...`);
            await sleep(SWITCH_ACCOUNT_DELAY_MS);
            accountManager.markRateLimited(account.email, smartBackoffMs, model);
            return { action: 'throw', error: new Error(`QUOTA_EXHAUSTED: ${errorText}`) };
        }

        // Short-term but not first attempt → exponential backoff
        const waitMs = backoff.delayMs;
        accountManager.markRateLimited(account.email, waitMs, model);
        logger.info(`[CloudCode] ${logPrefix}Rate limit on ${account.email} (attempt ${backoff.attempt}), waiting ${formatDuration(waitMs)}...`);
        await sleep(waitMs);
        return { action: 'retryEndpoint' };
    }

    // ── 503 Capacity ─────────────────────────────────────────────────────
    if (status === 503 && isModelCapacityExhausted(errorText)) {
        if (retryState.capacityRetryCount < MAX_CAPACITY_RETRIES) {
            const tierIndex = Math.min(retryState.capacityRetryCount, CAPACITY_BACKOFF_TIERS_MS.length - 1);
            const waitMs = CAPACITY_BACKOFF_TIERS_MS[tierIndex];
            retryState.capacityRetryCount++;
            accountManager.incrementConsecutiveFailures(account.email);
            logger.info(`[CloudCode] ${logPrefix}503 Model capacity exhausted, retry ${retryState.capacityRetryCount}/${MAX_CAPACITY_RETRIES} after ${formatDuration(waitMs)}...`);
            await sleep(waitMs);
            return { action: 'retryEndpoint' };
        }
        logger.warn(`[CloudCode] ${logPrefix}Max capacity retries (${MAX_CAPACITY_RETRIES}) exceeded on 503, switching account`);
        accountManager.markRateLimited(account.email, BACKOFF_BY_ERROR_TYPE.MODEL_CAPACITY_EXHAUSTED, model);
        return { action: 'throw', error: new Error(`CAPACITY_EXHAUSTED: ${errorText}`) };
    }

    // ── Other 4xx/5xx ────────────────────────────────────────────────────
    if (status >= 400) {
        if (status === 403 || status === 404) {
            logger.warn(`[CloudCode] ${logPrefix}${status} at ${endpoint}...`);
        } else if (status >= 500) {
            logger.warn(`[CloudCode] ${logPrefix}${status} error, waiting 1s before retry...`);
            await sleep(1000);
        }
        return { action: 'nextEndpoint', error: new Error(`API error ${status}: ${errorText}`) };
    }

    // Shouldn't reach here for !response.ok, but be safe
    return { action: 'nextEndpoint', error: new Error(`API error ${status}: ${errorText}`) };
}

// ─── Outer Catch Error Classification ───────────────────────────────────────

/**
 * Classify and handle errors caught in the outer try-catch of the retry loop.
 * Returns 'continue' if the loop should try the next account, or 'throw' if the error is fatal.
 *
 * @param {Error} error - The caught error
 * @param {Object} account - Current account object
 * @param {string} model - Model ID
 * @param {Object} accountManager - AccountManager instance
 * @param {string} logPrefix - Log prefix ("" or " stream")
 * @returns {Promise<'continue'|'throw'>} Action to take
 */
export async function classifyRetryError(error, account, model, accountManager, logPrefix = '') {
    if (isRateLimitError(error)) {
        accountManager.notifyRateLimit(account, model);
        logger.info(`[CloudCode] Account ${account.email} rate-limited, trying next...`);
        return 'continue';
    }

    if (isAuthError(error)) {
        logger.warn(`[CloudCode] Account ${account.email} has invalid credentials, trying next...`);
        return 'continue';
    }

    // 5xx errors
    if (error.message.includes('API error 5') || error.message.includes('500') || error.message.includes('503')) {
        accountManager.notifyFailure(account, model);
        const currentFailures = accountManager.getConsecutiveFailures(account.email);
        if (currentFailures + 1 >= MAX_CONSECUTIVE_FAILURES) {
            logger.warn(`[CloudCode] Account ${account.email} has ${currentFailures + 1} consecutive failures, applying extended cooldown (${formatDuration(EXTENDED_COOLDOWN_MS)})`);
            accountManager.markRateLimited(account.email, EXTENDED_COOLDOWN_MS, model);
        } else {
            accountManager.incrementConsecutiveFailures(account.email);
            logger.warn(`[CloudCode] Account ${account.email} failed with 5xx${logPrefix} error (${currentFailures + 1}/${MAX_CONSECUTIVE_FAILURES}), trying next...`);
        }
        return 'continue';
    }

    if (isNetworkError(error)) {
        accountManager.notifyFailure(account, model);
        const currentFailures = accountManager.getConsecutiveFailures(account.email);
        if (currentFailures + 1 >= MAX_CONSECUTIVE_FAILURES) {
            logger.warn(`[CloudCode] Account ${account.email} has ${currentFailures + 1} consecutive network failures, applying extended cooldown (${formatDuration(EXTENDED_COOLDOWN_MS)})`);
            accountManager.markRateLimited(account.email, EXTENDED_COOLDOWN_MS, model);
        } else {
            accountManager.incrementConsecutiveFailures(account.email);
            logger.warn(`[CloudCode] Network error for ${account.email}${logPrefix} (${currentFailures + 1}/${MAX_CONSECUTIVE_FAILURES}), trying next account... (${error.message})`);
        }
        await sleep(1000);
        return 'continue';
    }

    return 'throw';
}

// ─── Account Selection ──────────────────────────────────────────────────────

/**
 * Select an account for the current retry attempt, handling rate-limit waits and fallback.
 *
 * @param {Object} params
 * @param {string} params.model - Model ID
 * @param {Object} params.accountManager - AccountManager instance
 * @param {number} params.attempt - Current attempt number
 * @param {number} params.maxAttempts - Max attempts
 * @param {boolean} params.fallbackEnabled - Whether model fallback is enabled
 * @param {string} params.logPrefix - Log prefix
 * @returns {Promise<{account: Object|null, decrementAttempt: boolean, exhaustedAction: 'fallback'|'throw'|null, fallbackModel: string|null}>}
 */
export async function selectAccountForAttempt({ model, accountManager, attempt, maxAttempts, fallbackEnabled, logPrefix = '' }) {
    // Clear any expired rate limits before picking
    accountManager.clearExpiredLimits();

    // Get available accounts for this model
    const availableAccounts = accountManager.getAvailableAccounts(model);

    // If no accounts available, check if we should wait or throw error
    if (availableAccounts.length === 0) {
        if (accountManager.isAllRateLimited(model)) {
            const minWaitMs = accountManager.getMinWaitTimeMs(model);
            const resetTime = new Date(Date.now() + minWaitMs).toISOString();

            // If wait time is too long (> 2 minutes), try fallback or throw
            const { MAX_WAIT_BEFORE_ERROR_MS } = await import('../constants.js');
            if (minWaitMs > MAX_WAIT_BEFORE_ERROR_MS) {
                if (fallbackEnabled) {
                    const { getFallbackModel } = await import('../fallback-config.js');
                    const fallbackModel = getFallbackModel(model);
                    if (fallbackModel) {
                        logger.warn(`[CloudCode] ${logPrefix}All accounts exhausted for ${model} (${formatDuration(minWaitMs)} wait). Attempting fallback to ${fallbackModel}`);
                        return { account: null, decrementAttempt: false, exhaustedAction: 'fallback', fallbackModel };
                    }
                }
                throw new Error(
                    `RESOURCE_EXHAUSTED: Rate limited on ${model}. Quota will reset after ${formatDuration(minWaitMs)}. Next available: ${resetTime}`
                );
            }

            // Wait for shortest reset time
            const accountCount = accountManager.getAccountCount();
            logger.warn(`[CloudCode] ${logPrefix}All ${accountCount} account(s) rate-limited. Waiting ${formatDuration(minWaitMs)}...`);
            await sleep(minWaitMs + 500);
            accountManager.clearExpiredLimits();

            return { account: null, decrementAttempt: true, exhaustedAction: null, fallbackModel: null };
        }

        throw new Error('No accounts available');
    }

    // Select account using configured strategy
    const { account, waitMs } = accountManager.selectAccount(model);

    // If strategy returns a wait time without an account, sleep and retry
    if (!account && waitMs > 0) {
        logger.info(`[CloudCode] ${logPrefix}Waiting ${formatDuration(waitMs)} for account...`);
        await sleep(waitMs + 500);
        return { account: null, decrementAttempt: true, exhaustedAction: null, fallbackModel: null };
    }

    // If strategy returns an account with throttle wait (fallback mode), apply delay
    if (account && waitMs > 0) {
        logger.debug(`[CloudCode] ${logPrefix}Throttling request (${waitMs}ms) - fallback mode active`);
        await sleep(waitMs);
    }

    if (!account) {
        logger.warn(`[CloudCode] ${logPrefix}Strategy returned no account for ${model} (attempt ${attempt + 1}/${maxAttempts})`);
    }

    return { account, decrementAttempt: false, exhaustedAction: null, fallbackModel: null };
}
