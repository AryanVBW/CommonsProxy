/**
 * OpenAI Codex OAuth Provider
 *
 * Enables ChatGPT Plus/Pro users to authenticate via OAuth (browser or device flow).
 * Inspired by opencode's codex.ts plugin implementation.
 *
 * Supports two auth methods:
 * 1. Browser OAuth (PKCE flow with local callback server)
 * 2. Headless device auth (for SSH/remote environments)
 *
 * Credits: Authentication flow based on opencode (https://github.com/nichochar/opencode)
 */

import crypto from 'crypto';
import http from 'http';
import { logger } from '../utils/logger.js';

// OpenAI Codex OAuth configuration (from opencode's codex.ts)
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_ISSUER = 'https://auth.openai.com';
const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const CODEX_OAUTH_PORT = 1455;
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000;

/**
 * Escape HTML special characters to prevent XSS in OAuth callback pages
 * @param {string} str - Untrusted string to escape
 * @returns {string} HTML-safe string
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const bytes = crypto.randomBytes(43);
    const verifier = Array.from(bytes).map(b => chars[b % chars.length]).join('');

    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

    return { verifier, challenge };
}

/**
 * Generate random state parameter
 */
function generateState() {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Parse JWT claims from an ID token or access token
 * @param {string} token - JWT token
 * @returns {Object|undefined} Parsed claims
 */
export function parseJwtClaims(token) {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    try {
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    } catch {
        return undefined;
    }
}

/**
 * Extract ChatGPT account ID from JWT claims
 * @param {Object} claims - JWT claims
 * @returns {string|undefined} Account ID
 */
export function extractAccountIdFromClaims(claims) {
    return (
        claims.chatgpt_account_id ||
        claims['https://api.openai.com/auth']?.chatgpt_account_id ||
        claims.organizations?.[0]?.id
    );
}

/**
 * Extract account ID from token response
 * @param {Object} tokens - Token response with id_token and access_token
 * @returns {string|undefined} Account ID
 */
export function extractAccountId(tokens) {
    if (tokens.id_token) {
        const claims = parseJwtClaims(tokens.id_token);
        const accountId = claims && extractAccountIdFromClaims(claims);
        if (accountId) return accountId;
    }
    if (tokens.access_token) {
        const claims = parseJwtClaims(tokens.access_token);
        return claims ? extractAccountIdFromClaims(claims) : undefined;
    }
    return undefined;
}

/**
 * Build the OAuth authorization URL
 * @param {string} redirectUri - Redirect URI for callback
 * @param {Object} pkce - PKCE codes { verifier, challenge }
 * @param {string} state - State parameter
 * @returns {string} Authorization URL
 */
function buildAuthorizeUrl(redirectUri, pkce, state) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CODEX_CLIENT_ID,
        redirect_uri: redirectUri,
        scope: 'openid profile email offline_access',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        state,
        originator: 'commons-proxy'
    });
    return `${CODEX_ISSUER}/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code
 * @param {string} redirectUri - Redirect URI used in authorization
 * @param {Object} pkce - PKCE codes { verifier }
 * @returns {Promise<Object>} Token response
 */
async function exchangeCodeForTokens(code, redirectUri, pkce) {
    const response = await fetch(`${CODEX_ISSUER}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: CODEX_CLIENT_ID,
            code_verifier: pkce.verifier
        }).toString()
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${text}`);
    }

    return response.json();
}

/**
 * Refresh an access token using a refresh token
 * @param {string} refreshToken - OAuth refresh token
 * @returns {Promise<Object>} Token response
 */
export async function refreshCodexAccessToken(refreshToken) {
    const response = await fetch(`${CODEX_ISSUER}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: CODEX_CLIENT_ID
        }).toString()
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${text}`);
    }

    return response.json();
}

// ============================================================================
// Browser OAuth Flow (PKCE with local callback server)
// ============================================================================

const HTML_SUCCESS = `<!doctype html>
<html>
  <head><title>CommonsProxy - Authorization Successful</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #131010; color: #f1ecec; }
      .container { text-align: center; padding: 2rem; }
      h1 { color: #28a745; margin-bottom: 1rem; }
      p { color: #b7b1b1; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to CommonsProxy.</p>
    </div>
    <script>setTimeout(() => window.close(), 2000)</script>
  </body>
</html>`;

const HTML_ERROR = (error) => `<!doctype html>
<html>
  <head><title>CommonsProxy - Authorization Failed</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #131010; color: #f1ecec; }
      .container { text-align: center; padding: 2rem; }
      h1 { color: #dc3545; margin-bottom: 1rem; }
      p { color: #b7b1b1; }
      .error { color: #ff917b; font-family: monospace; margin-top: 1rem; padding: 1rem; background: #3c140d; border-radius: 0.5rem; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${escapeHtml(error)}</div>
    </div>
  </body>
</html>`;

/**
 * Start browser OAuth flow for OpenAI Codex
 * Returns authorization URL and a promise that resolves with tokens
 *
 * @returns {Promise<{url: string, promise: Promise<Object>, abort: Function}>}
 */
export async function startCodexBrowserAuth() {
    const pkce = generatePKCE();
    const state = generateState();
    const port = CODEX_OAUTH_PORT;
    const redirectUri = `http://localhost:${port}/auth/callback`;
    const authUrl = buildAuthorizeUrl(redirectUri, pkce, state);

    let server = null;
    let pendingResolve = null;
    let pendingReject = null;
    let timeoutId = null;

    const promise = new Promise((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;

        server = http.createServer(async (req, res) => {
            const url = new URL(req.url, `http://localhost:${port}`);

            if (url.pathname === '/auth/callback') {
                const code = url.searchParams.get('code');
                const returnedState = url.searchParams.get('state');
                const error = url.searchParams.get('error');
                const errorDescription = url.searchParams.get('error_description');

                if (error) {
                    const errorMsg = errorDescription || error;
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(HTML_ERROR(errorMsg));
                    reject(new Error(errorMsg));
                    cleanup();
                    return;
                }

                if (!code) {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(HTML_ERROR('Missing authorization code'));
                    reject(new Error('Missing authorization code'));
                    cleanup();
                    return;
                }

                if (returnedState !== state) {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(HTML_ERROR('Invalid state - potential CSRF attack'));
                    reject(new Error('State mismatch'));
                    cleanup();
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(HTML_SUCCESS);

                try {
                    const tokens = await exchangeCodeForTokens(code, redirectUri, pkce);
                    const accountId = extractAccountId(tokens);
                    resolve({
                        accessToken: tokens.access_token,
                        refreshToken: tokens.refresh_token,
                        idToken: tokens.id_token,
                        expiresIn: tokens.expires_in,
                        accountId
                    });
                } catch (err) {
                    reject(err);
                }
                cleanup();
                return;
            }

            res.writeHead(404);
            res.end('Not found');
        });

        server.listen(port, () => {
            logger.info(`[CodexAuth] OAuth callback server listening on port ${port}`);
        });

        server.on('error', (err) => {
            reject(new Error(`Failed to start OAuth server on port ${port}: ${err.message}`));
        });

        // 5 minute timeout
        timeoutId = setTimeout(() => {
            reject(new Error('OAuth callback timeout'));
            cleanup();
        }, 5 * 60 * 1000);
    });

    const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (server) {
            server.close();
            server = null;
        }
    };

    const abort = () => {
        if (pendingReject) {
            pendingReject(new Error('OAuth flow aborted'));
        }
        cleanup();
    };

    return { url: authUrl, promise, abort };
}

// ============================================================================
// Headless Device Auth Flow
// ============================================================================

/**
 * Initiate headless device authorization for OpenAI Codex
 * Returns device code info for user to complete in browser
 *
 * @returns {Promise<Object>} { deviceAuthId, userCode, interval }
 */
export async function initiateCodexDeviceAuth() {
    const response = await fetch(`${CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'commons-proxy/2.0.0'
        },
        body: JSON.stringify({ client_id: CODEX_CLIENT_ID })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to initiate device authorization: ${response.status} ${text}`);
    }

    const data = await response.json();
    return {
        deviceAuthId: data.device_auth_id,
        userCode: data.user_code,
        interval: Math.max(parseInt(data.interval) || 5, 1),
        verificationUri: `${CODEX_ISSUER}/codex/device`
    };
}

/**
 * Poll for device auth token completion
 * Single poll attempt - caller should retry
 *
 * @param {string} deviceAuthId - Device auth ID from initiateCodexDeviceAuth
 * @param {string} userCode - User code from initiateCodexDeviceAuth
 * @returns {Promise<Object>} { completed, tokens?, pending? }
 */
export async function pollCodexDeviceAuth(deviceAuthId, userCode) {
    const response = await fetch(`${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'commons-proxy/2.0.0'
        },
        body: JSON.stringify({
            device_auth_id: deviceAuthId,
            user_code: userCode
        })
    });

    if (response.ok) {
        const data = await response.json();

        // Exchange the authorization code for tokens
        const tokenResponse = await fetch(`${CODEX_ISSUER}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: data.authorization_code,
                redirect_uri: `${CODEX_ISSUER}/deviceauth/callback`,
                client_id: CODEX_CLIENT_ID,
                code_verifier: data.code_verifier
            }).toString()
        });

        if (!tokenResponse.ok) {
            throw new Error(`Token exchange failed: ${tokenResponse.status}`);
        }

        const tokens = await tokenResponse.json();
        const accountId = extractAccountId(tokens);

        return {
            completed: true,
            tokens: {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                idToken: tokens.id_token,
                expiresIn: tokens.expires_in,
                accountId
            }
        };
    }

    // 403/404 means still pending
    if (response.status === 403 || response.status === 404) {
        return { completed: false, pending: true };
    }

    // Other errors
    return { completed: false, error: `Unexpected response: ${response.status}` };
}

// Export configuration
export const CODEX_CONFIG = {
    clientId: CODEX_CLIENT_ID,
    issuer: CODEX_ISSUER,
    apiEndpoint: CODEX_API_ENDPOINT,
    oauthPort: CODEX_OAUTH_PORT
};

export default {
    startCodexBrowserAuth,
    initiateCodexDeviceAuth,
    pollCodexDeviceAuth,
    refreshCodexAccessToken,
    extractAccountId,
    parseJwtClaims,
    CODEX_CONFIG
};
