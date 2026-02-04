/**
 * Constants for CommonsProxy - Cloud Code API integration
 * Based on: https://github.com/NoeFabris/opencode-cloudcode-auth
 * Enhanced with multi-provider support inspired by opencode
 */

import { homedir, platform, arch } from 'os';
import { join } from 'path';
import { config } from './config.js';

/**
 * Get the Cloud Code IDE database path based on the current platform.
 * - macOS: ~/Library/Application Support/Windsurf/... (or Cursor, etc.)
 * - Windows: ~/AppData/Roaming/Windsurf/...
 * - Linux/other: ~/.config/Windsurf/...
 * @returns {string} Full path to the IDE state database
 */
function getCloudCodeDbPath() {
    const home = homedir();
    switch (platform()) {
        case 'darwin':
            return join(home, 'Library/Application Support/Windsurf/User/globalStorage/state.vscdb');
        case 'win32':
            return join(home, 'AppData/Roaming/Windsurf/User/globalStorage/state.vscdb');
        default: // linux, freebsd, etc.
            return join(home, '.config/Windsurf/User/globalStorage/state.vscdb');
    }
}

/**
 * Generate platform-specific User-Agent string.
 * @returns {string} User-Agent in format "commons-proxy/version os/arch"
 */
function getPlatformUserAgent() {
    const os = platform();
    const architecture = arch();
    return `commons-proxy/1.0.0 ${os}/${architecture}`;
}

// Cloud Code API endpoints (in fallback order)
const CLOUDCODE_ENDPOINT_DAILY = 'https://daily-cloudcode-pa.googleapis.com';
const CLOUDCODE_ENDPOINT_PROD = 'https://cloudcode-pa.googleapis.com';

// Endpoint fallback order (daily → prod)
export const CLOUDCODE_ENDPOINT_FALLBACKS = [
    CLOUDCODE_ENDPOINT_DAILY,
    CLOUDCODE_ENDPOINT_PROD
];

// Legacy alias for backward compatibility
export const ANTIGRAVITY_ENDPOINT_FALLBACKS = CLOUDCODE_ENDPOINT_FALLBACKS;

// Required headers for Cloud Code API requests
export const CLOUDCODE_HEADERS = {
    'User-Agent': getPlatformUserAgent(),
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI'
    })
};

// Endpoint order for loadCodeAssist (prod first)
// loadCodeAssist works better on prod for fresh/unprovisioned accounts
export const LOAD_CODE_ASSIST_ENDPOINTS = [
    CLOUDCODE_ENDPOINT_PROD,
    CLOUDCODE_ENDPOINT_DAILY
];

// Endpoint order for onboardUser (same as generateContent fallbacks)
export const ONBOARD_USER_ENDPOINTS = CLOUDCODE_ENDPOINT_FALLBACKS;

// Headers for loadCodeAssist API
export const LOAD_CODE_ASSIST_HEADERS = CLOUDCODE_HEADERS;

// Legacy alias
export const ANTIGRAVITY_HEADERS = CLOUDCODE_HEADERS;

// Default project ID if none can be discovered
export const DEFAULT_PROJECT_ID = 'rising-fact-p41fc';

// Configurable constants - values from config.json take precedence
export const TOKEN_REFRESH_INTERVAL_MS = config?.tokenCacheTtlMs || (5 * 60 * 1000); // From config or 5 minutes
export const REQUEST_BODY_LIMIT = config?.requestBodyLimit || '50mb';
export const CLOUDCODE_AUTH_PORT = 9092;
export const ANTIGRAVITY_AUTH_PORT = CLOUDCODE_AUTH_PORT; // Legacy alias
export const DEFAULT_PORT = config?.port || 8080;

// Multi-account configuration
export const ACCOUNT_CONFIG_PATH = config?.accountConfigPath || join(
    homedir(),
    '.config/commons-proxy/accounts.json'
);

// Usage history persistence path
export const USAGE_HISTORY_PATH = join(
    homedir(),
    '.config/commons-proxy/usage-history.json'
);

// Cloud Code IDE database path (for legacy single-account token extraction)
// Uses platform-specific path detection
export const CLOUDCODE_DB_PATH = getCloudCodeDbPath();
export const ANTIGRAVITY_DB_PATH = CLOUDCODE_DB_PATH; // Legacy alias

export const DEFAULT_COOLDOWN_MS = config?.defaultCooldownMs || (10 * 1000); // From config or 10 seconds
export const MAX_RETRIES = config?.maxRetries || 5; // From config or 5
export const MAX_EMPTY_RESPONSE_RETRIES = 2; // Max retries for empty API responses (from upstream)
export const MAX_ACCOUNTS = config?.maxAccounts || 10; // From config or 10

// Rate limit wait thresholds
export const MAX_WAIT_BEFORE_ERROR_MS = config?.maxWaitBeforeErrorMs || 120000; // From config or 2 minutes

// Retry deduplication - prevents thundering herd on concurrent rate limits
export const RATE_LIMIT_DEDUP_WINDOW_MS = config?.rateLimitDedupWindowMs || 2000; // 2 seconds
export const RATE_LIMIT_STATE_RESET_MS = config?.rateLimitStateResetMs || 120000; // 2 minutes - reset consecutive429 after inactivity
export const FIRST_RETRY_DELAY_MS = config?.firstRetryDelayMs || 1000; // Quick 1s retry on first 429
export const SWITCH_ACCOUNT_DELAY_MS = config?.switchAccountDelayMs || 5000; // Delay before switching accounts

// Consecutive failure tracking - extended cooldown after repeated failures
export const MAX_CONSECUTIVE_FAILURES = config?.maxConsecutiveFailures || 3;
export const EXTENDED_COOLDOWN_MS = config?.extendedCooldownMs || 60000; // 1 minute

// Capacity exhaustion - progressive backoff tiers for model capacity issues
export const CAPACITY_BACKOFF_TIERS_MS = config?.capacityBackoffTiersMs || [5000, 10000, 20000, 30000, 60000];
export const MAX_CAPACITY_RETRIES = config?.maxCapacityRetries || 5;

// Smart backoff by error type
export const BACKOFF_BY_ERROR_TYPE = {
    RATE_LIMIT_EXCEEDED: 30000,      // 30 seconds
    MODEL_CAPACITY_EXHAUSTED: 15000, // 15 seconds
    SERVER_ERROR: 20000,             // 20 seconds
    UNKNOWN: 60000                   // 1 minute
};

// Progressive backoff tiers for QUOTA_EXHAUSTED (60s, 5m, 30m, 2h)
export const QUOTA_EXHAUSTED_BACKOFF_TIERS_MS = [60000, 300000, 1800000, 7200000];

// Minimum backoff floor to prevent "Available in 0s" loops (matches opencode-cloudcode-auth)
export const MIN_BACKOFF_MS = 2000;

// Thinking model constants
export const MIN_SIGNATURE_LENGTH = 50; // Minimum valid thinking signature length

// Account selection strategies
export const SELECTION_STRATEGIES = ['sticky', 'round-robin', 'hybrid'];
export const DEFAULT_SELECTION_STRATEGY = 'hybrid';

// Strategy display labels
export const STRATEGY_LABELS = {
    'sticky': 'Sticky (Cache Optimized)',
    'round-robin': 'Round Robin (Load Balanced)',
    'hybrid': 'Hybrid (Smart Distribution)'
};

// Gemini-specific limits
export const GEMINI_MAX_OUTPUT_TOKENS = 16384;

// Gemini signature handling
// Sentinel value to skip thought signature validation when Claude Code strips the field
// See: https://ai.google.dev/gemini-api/docs/thought-signatures
export const GEMINI_SKIP_SIGNATURE = 'skip_thought_signature_validator';

// Cache TTL for Gemini thoughtSignatures (2 hours)
export const GEMINI_SIGNATURE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Get the model family from model name (dynamic detection, no hardcoded list).
 * @param {string} modelName - The model name from the request
 * @returns {'claude' | 'gemini' | 'unknown'} The model family
 */
export function getModelFamily(modelName) {
    const lower = (modelName || '').toLowerCase();
    if (lower.includes('claude')) return 'claude';
    if (lower.includes('gemini')) return 'gemini';
    return 'unknown';
}

/**
 * Check if a model supports thinking/reasoning output.
 * @param {string} modelName - The model name from the request
 * @returns {boolean} True if the model supports thinking blocks
 */
export function isThinkingModel(modelName) {
    const lower = (modelName || '').toLowerCase();
    // Claude thinking models have "thinking" in the name
    if (lower.includes('claude') && lower.includes('thinking')) return true;
    // Gemini thinking models: explicit "thinking" in name, OR gemini version 3+
    if (lower.includes('gemini')) {
        if (lower.includes('thinking')) return true;
        // Check for gemini-3 or higher (e.g., gemini-3, gemini-3.5, gemini-4, etc.)
        const versionMatch = lower.match(/gemini-(\d+)/);
        if (versionMatch && parseInt(versionMatch[1], 10) >= 3) return true;
    }
    return false;
}

// Google OAuth configuration (from opencode-cloudcode-auth)
// OAuth callback port - configurable via environment variable for Windows compatibility (issue #176)
// Windows may reserve ports in range 49152-65535 for Hyper-V/WSL2/Docker, causing EACCES errors
const OAUTH_CALLBACK_PORT = parseInt(process.env.OAUTH_CALLBACK_PORT || '51121', 10);
const OAUTH_CALLBACK_FALLBACK_PORTS = [51122, 51123, 51124, 51125, 51126];

export const OAUTH_CONFIG = {
    clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
    clientSecret: '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',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v1/userinfo',
    callbackPort: OAUTH_CALLBACK_PORT,
    callbackFallbackPorts: OAUTH_CALLBACK_FALLBACK_PORTS,
    scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/cclog',
        'https://www.googleapis.com/auth/experimentsandconfigs'
    ]
};
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CONFIG.callbackPort}/oauth-callback`;

// Minimal system instruction for Cloud Code API
// Only includes the essential identity portion to reduce token usage and improve response quality
// Reference: GitHub issue #76, CLIProxyAPI, gcli2api
export const CLOUDCODE_SYSTEM_INSTRUCTION = `You are a powerful agentic AI coding assistant. You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**`;
export const ANTIGRAVITY_SYSTEM_INSTRUCTION = CLOUDCODE_SYSTEM_INSTRUCTION; // Legacy alias

// Model fallback mapping - maps primary model to fallback when quota exhausted
export const MODEL_FALLBACK_MAP = {
    'gemini-3-pro-high': 'claude-opus-4-5-thinking',
    'gemini-3-pro-low': 'claude-sonnet-4-5',
    'gemini-3-flash': 'claude-sonnet-4-5-thinking',
    'claude-opus-4-5-thinking': 'gemini-3-pro-high',
    'claude-sonnet-4-5-thinking': 'gemini-3-flash',
    'claude-sonnet-4-5': 'gemini-3-flash'
};

// Default test models for each family (used by test suite)
export const TEST_MODELS = {
    claude: 'claude-sonnet-4-5-thinking',
    gemini: 'gemini-3-flash'
};

// Default Claude CLI presets (used by WebUI settings)
export const DEFAULT_PRESETS = [
    {
        name: 'Claude Thinking',
        config: {
            ANTHROPIC_AUTH_TOKEN: 'test',
            ANTHROPIC_BASE_URL: 'http://localhost:8080',
            ANTHROPIC_MODEL: 'claude-opus-4-5-thinking',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-5-thinking',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5-thinking',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-5',
            CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-4-5-thinking',
            ENABLE_EXPERIMENTAL_MCP_CLI: 'true'
        }
    },
    {
        name: 'Gemini 1M',
        config: {
            ANTHROPIC_AUTH_TOKEN: 'test',
            ANTHROPIC_BASE_URL: 'http://localhost:8080',
            ANTHROPIC_MODEL: 'gemini-3-pro-high[1m]',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'gemini-3-pro-high[1m]',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'gemini-3-flash[1m]',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gemini-3-flash[1m]',
            CLAUDE_CODE_SUBAGENT_MODEL: 'gemini-3-flash[1m]',
            ENABLE_EXPERIMENTAL_MCP_CLI: 'true'
        }
    }
];

// Provider configuration
export const PROVIDER_CONFIG = {
    google: {
        id: 'google',
        name: 'Google Cloud Code',
        authType: 'oauth',
        apiEndpoint: CLOUDCODE_ENDPOINT_DAILY,
        color: '#4285f4', // Google Blue
        icon: 'google',
        requiresProjectId: true
    },
    anthropic: {
        id: 'anthropic',
        name: 'Anthropic',
        authType: 'api-key',
        apiEndpoint: 'https://api.anthropic.com',
        color: '#d97706', // Orange
        icon: 'anthropic',
        requiresProjectId: false
    },
    openai: {
        id: 'openai',
        name: 'OpenAI',
        authType: 'api-key',
        apiEndpoint: 'https://api.openai.com',
        color: '#10b981', // Green
        icon: 'openai',
        requiresProjectId: false
    },
    github: {
        id: 'github',
        name: 'GitHub Models',
        authType: 'pat', // Personal Access Token
        apiEndpoint: 'https://models.inference.ai.azure.com',
        modelsEndpoint: 'https://api.github.com/models',
        color: '#6366f1', // Indigo
        icon: 'github',
        requiresProjectId: false
    }
};

// Provider display names
export const PROVIDER_NAMES = {
    google: 'Google Cloud Code',
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    github: 'GitHub Models'
};

// Provider colors for UI visualization
export const PROVIDER_COLORS = {
    google: '#4285f4',
    anthropic: '#d97706',
    openai: '#10b981',
    github: '#6366f1'
};

export default {
    // New exports
    CLOUDCODE_ENDPOINT_FALLBACKS,
    CLOUDCODE_HEADERS,
    CLOUDCODE_AUTH_PORT,
    CLOUDCODE_DB_PATH,
    CLOUDCODE_SYSTEM_INSTRUCTION,
    // Legacy aliases for backward compatibility
    ANTIGRAVITY_ENDPOINT_FALLBACKS,
    ANTIGRAVITY_HEADERS,
    ANTIGRAVITY_AUTH_PORT,
    ANTIGRAVITY_DB_PATH,
    ANTIGRAVITY_SYSTEM_INSTRUCTION,
    // Common exports
    LOAD_CODE_ASSIST_ENDPOINTS,
    ONBOARD_USER_ENDPOINTS,
    LOAD_CODE_ASSIST_HEADERS,
    DEFAULT_PROJECT_ID,
    TOKEN_REFRESH_INTERVAL_MS,
    REQUEST_BODY_LIMIT,
    DEFAULT_PORT,
    ACCOUNT_CONFIG_PATH,
    DEFAULT_COOLDOWN_MS,
    MAX_RETRIES,
    MAX_EMPTY_RESPONSE_RETRIES,
    MAX_ACCOUNTS,
    MAX_WAIT_BEFORE_ERROR_MS,
    RATE_LIMIT_DEDUP_WINDOW_MS,
    RATE_LIMIT_STATE_RESET_MS,
    FIRST_RETRY_DELAY_MS,
    SWITCH_ACCOUNT_DELAY_MS,
    MAX_CONSECUTIVE_FAILURES,
    EXTENDED_COOLDOWN_MS,
    CAPACITY_BACKOFF_TIERS_MS,
    MAX_CAPACITY_RETRIES,
    BACKOFF_BY_ERROR_TYPE,
    QUOTA_EXHAUSTED_BACKOFF_TIERS_MS,
    MIN_BACKOFF_MS,
    MIN_SIGNATURE_LENGTH,
    GEMINI_MAX_OUTPUT_TOKENS,
    GEMINI_SKIP_SIGNATURE,
    GEMINI_SIGNATURE_CACHE_TTL_MS,
    getModelFamily,
    isThinkingModel,
    OAUTH_CONFIG,
    OAUTH_REDIRECT_URI,
    STRATEGY_LABELS,
    MODEL_FALLBACK_MAP,
    TEST_MODELS,
    DEFAULT_PRESETS,
    PROVIDER_CONFIG,
    PROVIDER_NAMES,
    PROVIDER_COLORS
};
