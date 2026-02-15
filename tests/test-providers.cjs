/**
 * Test Providers - Unit Tests
 *
 * Tests provider implementations without network calls:
 * - BaseProvider: abstract guard, default methods, credential invalidation
 * - Provider Registry: factory, lookup, enumeration
 * - All providers: parseRateLimitInfo, shouldInvalidateCredentials, getAccessToken
 * - CopilotProvider: buildCopilotHeaders, getQuotas, getAvailableModels
 * - Codex: parseJwtClaims, extractAccountId, JWT validation
 */

async function runTests() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║               PROVIDER TEST SUITE                            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // Dynamic imports
    const { default: BaseProvider } = await import('../src/providers/base-provider.js');
    const { default: GoogleProvider } = await import('../src/providers/google-provider.js');
    const { default: AnthropicProvider } = await import('../src/providers/anthropic-provider.js');
    const { default: OpenAIProvider } = await import('../src/providers/openai-provider.js');
    const { default: OpenRouterProvider } = await import('../src/providers/openrouter-provider.js');
    const { default: GitHubProvider } = await import('../src/providers/github-provider.js');
    const { CopilotProvider, COPILOT_CONFIG } = await import('../src/providers/copilot.js');
    const { default: CodexProvider } = await import('../src/providers/codex-provider.js');
    const {
        parseJwtClaims,
        extractAccountIdFromClaims,
        extractAccountId,
        CODEX_CONFIG
    } = await import('../src/providers/codex-auth.js');
    const {
        getAuthProvider,
        getAllAuthProviders,
        hasAuthProvider,
        getProviderForAccount
    } = await import('../src/providers/index.js');
    const { PROVIDER_CONFIG, PROVIDER_NAMES } = await import('../src/constants.js');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`✓ ${name}`);
            passed++;
        } catch (e) {
            console.log(`✗ ${name}`);
            console.log(`  Error: ${e.message}`);
            failed++;
        }
    }

    async function testAsync(name, fn) {
        try {
            await fn();
            console.log(`✓ ${name}`);
            passed++;
        } catch (e) {
            console.log(`✗ ${name}`);
            console.log(`  Error: ${e.message}`);
            failed++;
        }
    }

    function assertEqual(actual, expected, message = '') {
        if (actual !== expected) {
            throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
        }
    }

    function assertDeepEqual(actual, expected, message = '') {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`${message}\nExpected: ${JSON.stringify(expected, null, 2)}\nActual: ${JSON.stringify(actual, null, 2)}`);
        }
    }

    function assertTrue(value, message = '') {
        if (!value) {
            throw new Error(message || `Expected truthy but got: ${JSON.stringify(value)}`);
        }
    }

    function assertFalse(value, message = '') {
        if (value) {
            throw new Error(message || `Expected falsy but got: ${JSON.stringify(value)}`);
        }
    }

    function assertNull(value, message = '') {
        if (value !== null) {
            throw new Error(`${message}\nExpected null but got: ${JSON.stringify(value)}`);
        }
    }

    function assertNotNull(value, message = '') {
        if (value === null || value === undefined) {
            throw new Error(`${message}\nExpected non-null value but got: ${value}`);
        }
    }

    function assertThrows(fn, expectedMessage = null, message = '') {
        try {
            fn();
            throw new Error(`${message}\nExpected function to throw but it did not`);
        } catch (e) {
            if (e.message.includes('Expected function to throw')) throw e;
            if (expectedMessage && !e.message.includes(expectedMessage)) {
                throw new Error(`${message}\nExpected error containing "${expectedMessage}" but got: "${e.message}"`);
            }
        }
    }

    async function assertThrowsAsync(fn, expectedMessage = null, message = '') {
        try {
            await fn();
            throw new Error(`${message}\nExpected function to throw but it did not`);
        } catch (e) {
            if (e.message.includes('Expected function to throw')) throw e;
            if (expectedMessage && !e.message.includes(expectedMessage)) {
                throw new Error(`${message}\nExpected error containing "${expectedMessage}" but got: "${e.message}"`);
            }
        }
    }

    // Helper: mock response with headers
    function mockResponse(headers = {}) {
        const map = new Map(Object.entries(headers));
        return { headers: { get: (k) => map.get(k) || null } };
    }

    // ================================================================
    // BaseProvider Tests
    // ================================================================
    console.log('\n─── BaseProvider Tests ───');

    test('BaseProvider: cannot instantiate directly', () => {
        assertThrows(() => new BaseProvider('test', 'Test'), 'abstract');
    });

    test('BaseProvider: getSubscriptionTier returns defaults', async () => {
        // Create a concrete subclass to test base methods
        class TestProvider extends BaseProvider {
            constructor() { super('test', 'Test'); }
        }
        const provider = new TestProvider();
        const tier = await provider.getSubscriptionTier({}, 'token');
        assertEqual(tier.tier, 'unknown');
        assertNull(tier.projectId);
    });

    test('BaseProvider: refreshCredentials returns account unchanged', async () => {
        class TestProvider extends BaseProvider {
            constructor() { super('test', 'Test'); }
        }
        const provider = new TestProvider();
        const account = { email: 'test@example.com' };
        const result = await provider.refreshCredentials(account);
        assertEqual(result, account);
    });

    test('BaseProvider: getAvailableModels returns empty array', async () => {
        class TestProvider extends BaseProvider {
            constructor() { super('test', 'Test'); }
        }
        const provider = new TestProvider();
        const models = await provider.getAvailableModels({}, 'token');
        assertDeepEqual(models, []);
    });

    test('BaseProvider: parseRateLimitInfo returns null', () => {
        class TestProvider extends BaseProvider {
            constructor() { super('test', 'Test'); }
        }
        const provider = new TestProvider();
        assertNull(provider.parseRateLimitInfo(mockResponse()));
    });

    test('BaseProvider: shouldInvalidateCredentials for 401', () => {
        class TestProvider extends BaseProvider {
            constructor() { super('test', 'Test'); }
        }
        const provider = new TestProvider();
        assertTrue(provider.shouldInvalidateCredentials({ status: 401 }));
    });

    test('BaseProvider: shouldInvalidateCredentials for 403', () => {
        class TestProvider extends BaseProvider {
            constructor() { super('test', 'Test'); }
        }
        const provider = new TestProvider();
        assertTrue(provider.shouldInvalidateCredentials({ status: 403 }));
    });

    test('BaseProvider: shouldInvalidateCredentials for invalid api message', () => {
        class TestProvider extends BaseProvider {
            constructor() { super('test', 'Test'); }
        }
        const provider = new TestProvider();
        assertTrue(provider.shouldInvalidateCredentials({ message: 'Invalid API key provided' }));
    });

    test('BaseProvider: shouldInvalidateCredentials false for 500', () => {
        class TestProvider extends BaseProvider {
            constructor() { super('test', 'Test'); }
        }
        const provider = new TestProvider();
        assertFalse(provider.shouldInvalidateCredentials({ status: 500, message: 'Server error' }));
    });

    // ================================================================
    // Provider Registry Tests
    // ================================================================
    console.log('\n─── Provider Registry Tests ───');

    test('getAuthProvider: returns provider for all known IDs', () => {
        for (const id of ['google', 'anthropic', 'openai', 'github', 'copilot', 'openrouter', 'codex']) {
            const provider = getAuthProvider(id);
            assertNotNull(provider);
        }
    });

    test('getAllAuthProviders: returns 7 providers', () => {
        const providers = getAllAuthProviders();
        assertEqual(providers.length, 7);
    });

    test('hasAuthProvider: true for known, false for unknown', () => {
        assertTrue(hasAuthProvider('google'));
        assertTrue(hasAuthProvider('copilot'));
        assertFalse(hasAuthProvider('unknown'));
        assertFalse(hasAuthProvider(''));
    });

    test('getProviderForAccount: detects provider from field', () => {
        const result = getProviderForAccount({ provider: 'anthropic' });
        assertNotNull(result);
    });

    test('getProviderForAccount: falls back for oauth source', () => {
        const result = getProviderForAccount({ source: 'oauth' });
        assertNotNull(result);
    });

    test('PROVIDER_CONFIG: has all 7 providers', () => {
        const expected = ['google', 'anthropic', 'openai', 'github', 'copilot', 'openrouter', 'codex'];
        for (const id of expected) {
            assertNotNull(PROVIDER_CONFIG[id], `Missing PROVIDER_CONFIG[${id}]`);
        }
    });

    test('PROVIDER_NAMES: has all 7 providers', () => {
        const expected = ['google', 'anthropic', 'openai', 'github', 'copilot', 'openrouter', 'codex'];
        for (const id of expected) {
            assertNotNull(PROVIDER_NAMES[id], `Missing PROVIDER_NAMES[${id}]`);
        }
    });

    // ================================================================
    // Google Provider Tests
    // ================================================================
    console.log('\n─── Google Provider Tests ───');

    const google = new GoogleProvider();

    test('GoogleProvider: constructor sets id and name', () => {
        assertEqual(google.id, 'google');
        assertEqual(google.name, 'Google Cloud Code');
    });

    await testAsync('GoogleProvider: validateCredentials fails without refreshToken', async () => {
        const result = await google.validateCredentials({});
        assertFalse(result.valid);
        assertTrue(result.error.includes('refresh token'));
    });

    test('GoogleProvider: parseRateLimitInfo with retry-after', () => {
        const result = google.parseRateLimitInfo(mockResponse({ 'retry-after': '30' }));
        assertNotNull(result);
        assertEqual(result.retryAfter, 30);
    });

    test('GoogleProvider: parseRateLimitInfo with x-ratelimit-reset', () => {
        const futureTs = Math.floor(Date.now() / 1000) + 120;
        const result = google.parseRateLimitInfo(mockResponse({ 'x-ratelimit-reset': String(futureTs) }));
        assertNotNull(result);
        assertTrue(result.retryAfter > 0);
    });

    test('GoogleProvider: parseRateLimitInfo with error data quotaResetTime', () => {
        const futureDate = new Date(Date.now() + 60000).toISOString();
        const result = google.parseRateLimitInfo(mockResponse(), {
            error: { details: { quotaResetTime: futureDate } }
        });
        assertNotNull(result);
        assertTrue(result.retryAfter > 0);
    });

    test('GoogleProvider: parseRateLimitInfo returns null with no data', () => {
        assertNull(google.parseRateLimitInfo(mockResponse()));
    });

    test('GoogleProvider: shouldInvalidateCredentials for invalid_grant', () => {
        assertTrue(google.shouldInvalidateCredentials({ message: 'invalid_grant: token expired' }));
    });

    test('GoogleProvider: shouldInvalidateCredentials for token revoked', () => {
        assertTrue(google.shouldInvalidateCredentials({ message: 'Token has been expired or revoked' }));
    });

    test('GoogleProvider: shouldInvalidateCredentials false for generic error', () => {
        assertFalse(google.shouldInvalidateCredentials({ message: 'network timeout', status: 500 }));
    });

    // ================================================================
    // Anthropic Provider Tests
    // ================================================================
    console.log('\n─── Anthropic Provider Tests ───');

    const anthropic = new AnthropicProvider();

    test('AnthropicProvider: constructor sets id', () => {
        assertEqual(anthropic.id, 'anthropic');
    });

    await testAsync('AnthropicProvider: getAccessToken returns apiKey', async () => {
        const token = await anthropic.getAccessToken({ apiKey: 'sk-ant-test' });
        assertEqual(token, 'sk-ant-test');
    });

    await testAsync('AnthropicProvider: getAccessToken throws without apiKey', async () => {
        await assertThrowsAsync(() => anthropic.getAccessToken({}), 'API key');
    });

    await testAsync('AnthropicProvider: validateCredentials fails without apiKey', async () => {
        const result = await anthropic.validateCredentials({});
        assertFalse(result.valid);
    });

    await testAsync('AnthropicProvider: getSubscriptionTier returns usage-based', async () => {
        const tier = await anthropic.getSubscriptionTier({}, 'token');
        assertEqual(tier.tier, 'usage-based');
    });

    test('AnthropicProvider: parseRateLimitInfo with retry-after', () => {
        const result = anthropic.parseRateLimitInfo(mockResponse({ 'retry-after': '10' }));
        assertNotNull(result);
        assertEqual(result.retryAfter, 10);
    });

    test('AnthropicProvider: parseRateLimitInfo with anthropic reset headers', () => {
        const futureDate = new Date(Date.now() + 60000).toISOString();
        const result = anthropic.parseRateLimitInfo(mockResponse({
            'anthropic-ratelimit-requests-reset': futureDate,
            'anthropic-ratelimit-tokens-reset': futureDate
        }));
        assertNotNull(result);
        assertTrue(result.retryAfter > 0);
    });

    test('AnthropicProvider: parseRateLimitInfo with rate_limit_error type', () => {
        const result = anthropic.parseRateLimitInfo(mockResponse(), {
            error: { type: 'rate_limit_error' }
        });
        assertNotNull(result);
        assertEqual(result.retryAfter, 60);
    });

    test('AnthropicProvider: parseRateLimitInfo returns null with no data', () => {
        assertNull(anthropic.parseRateLimitInfo(mockResponse()));
    });

    test('AnthropicProvider: shouldInvalidateCredentials for invalid_api_key', () => {
        assertTrue(anthropic.shouldInvalidateCredentials({ message: 'invalid_api_key' }));
    });

    test('AnthropicProvider: shouldInvalidateCredentials for authentication_error', () => {
        assertTrue(anthropic.shouldInvalidateCredentials({ message: 'authentication_error' }));
    });

    // ================================================================
    // OpenAI Provider Tests
    // ================================================================
    console.log('\n─── OpenAI Provider Tests ───');

    const openai = new OpenAIProvider();

    test('OpenAIProvider: constructor sets id', () => {
        assertEqual(openai.id, 'openai');
    });

    await testAsync('OpenAIProvider: getAccessToken returns apiKey', async () => {
        const token = await openai.getAccessToken({ apiKey: 'sk-test' });
        assertEqual(token, 'sk-test');
    });

    await testAsync('OpenAIProvider: getAccessToken with custom endpoint', async () => {
        const token = await openai.getAccessToken({ apiKey: 'key', customApiEndpoint: 'https://azure.example.com' });
        assertEqual(token, 'key');
    });

    await testAsync('OpenAIProvider: getSubscriptionTier', async () => {
        const tier = await openai.getSubscriptionTier({}, 'token');
        assertEqual(tier.tier, 'usage-based');
    });

    test('OpenAIProvider: parseRateLimitInfo with seconds duration', () => {
        const result = openai.parseRateLimitInfo(mockResponse({
            'x-ratelimit-reset-requests': '1s'
        }));
        assertNotNull(result);
        assertTrue(result.retryAfter >= 0 && result.retryAfter <= 5);
    });

    test('OpenAIProvider: parseRateLimitInfo with milliseconds duration', () => {
        const result = openai.parseRateLimitInfo(mockResponse({
            'x-ratelimit-reset-tokens': '500ms'
        }));
        assertNotNull(result);
        assertTrue(result.retryAfter >= 0 && result.retryAfter <= 5);
    });

    test('OpenAIProvider: parseRateLimitInfo with minutes duration', () => {
        const result = openai.parseRateLimitInfo(mockResponse({
            'x-ratelimit-reset-requests': '2m'
        }));
        assertNotNull(result);
        assertTrue(result.retryAfter >= 100 && result.retryAfter <= 130);
    });

    test('OpenAIProvider: parseRateLimitInfo with rate_limit_exceeded error', () => {
        const result = openai.parseRateLimitInfo(mockResponse(), {
            error: { type: 'rate_limit_exceeded' }
        });
        assertNotNull(result);
        assertEqual(result.retryAfter, 60);
    });

    test('OpenAIProvider: parseRateLimitInfo returns null with no data', () => {
        assertNull(openai.parseRateLimitInfo(mockResponse()));
    });

    test('OpenAIProvider: shouldInvalidateCredentials for invalid_api_key', () => {
        assertTrue(openai.shouldInvalidateCredentials({ message: 'invalid_api_key' }));
    });

    test('OpenAIProvider: shouldInvalidateCredentials for Incorrect API key', () => {
        assertTrue(openai.shouldInvalidateCredentials({ message: 'Incorrect API key provided' }));
    });

    // ================================================================
    // OpenRouter Provider Tests
    // ================================================================
    console.log('\n─── OpenRouter Provider Tests ───');

    const openrouter = new OpenRouterProvider();

    test('OpenRouterProvider: constructor sets id', () => {
        assertEqual(openrouter.id, 'openrouter');
    });

    await testAsync('OpenRouterProvider: getAccessToken returns apiKey', async () => {
        const token = await openrouter.getAccessToken({ apiKey: 'sk-or-test' });
        assertEqual(token, 'sk-or-test');
    });

    test('OpenRouterProvider: parseRateLimitInfo with retry-after', () => {
        const result = openrouter.parseRateLimitInfo(mockResponse({ 'retry-after': '45' }));
        assertNotNull(result);
        assertEqual(result.retryAfter, 45);
    });

    test('OpenRouterProvider: parseRateLimitInfo with ISO reset header', () => {
        const futureDate = new Date(Date.now() + 60000).toISOString();
        const result = openrouter.parseRateLimitInfo(mockResponse({
            'x-ratelimit-reset-requests': futureDate
        }));
        assertNotNull(result);
        assertTrue(result.retryAfter > 0);
    });

    test('OpenRouterProvider: parseRateLimitInfo with 429 error code', () => {
        const result = openrouter.parseRateLimitInfo(mockResponse(), {
            error: { code: 429 }
        });
        assertNotNull(result);
        assertEqual(result.retryAfter, 60);
    });

    test('OpenRouterProvider: parseRateLimitInfo with rate limit message', () => {
        const result = openrouter.parseRateLimitInfo(mockResponse(), {
            error: { message: 'you hit the rate limit' }
        });
        assertNotNull(result);
    });

    test('OpenRouterProvider: shouldInvalidateCredentials for invalid_api_key', () => {
        assertTrue(openrouter.shouldInvalidateCredentials({ message: 'invalid_api_key' }));
    });

    test('OpenRouterProvider: shouldInvalidateCredentials for No auth credentials', () => {
        assertTrue(openrouter.shouldInvalidateCredentials({ message: 'No auth credentials found' }));
    });

    // ================================================================
    // GitHub Provider Tests
    // ================================================================
    console.log('\n─── GitHub Provider Tests ───');

    const github = new GitHubProvider();

    test('GitHubProvider: constructor sets id', () => {
        assertEqual(github.id, 'github');
    });

    await testAsync('GitHubProvider: validateCredentials fails without apiKey', async () => {
        const result = await github.validateCredentials({});
        assertFalse(result.valid);
        assertTrue(result.error.includes('Personal Access Token'));
    });

    await testAsync('GitHubProvider: getAccessToken returns apiKey', async () => {
        const token = await github.getAccessToken({ apiKey: 'ghp_test' });
        assertEqual(token, 'ghp_test');
    });

    test('GitHubProvider: parseRateLimitInfo with x-ratelimit-reset', () => {
        const futureTs = Math.floor(Date.now() / 1000) + 120;
        const result = github.parseRateLimitInfo(mockResponse({
            'x-ratelimit-reset': String(futureTs)
        }));
        assertNotNull(result);
        assertTrue(result.retryAfter > 0);
    });

    test('GitHubProvider: parseRateLimitInfo with retry-after', () => {
        const result = github.parseRateLimitInfo(mockResponse({ 'retry-after': '120' }));
        assertNotNull(result);
        assertEqual(result.retryAfter, 120);
    });

    test('GitHubProvider: parseRateLimitInfo with rate limit error message', () => {
        const result = github.parseRateLimitInfo(mockResponse(), {
            message: 'You have exceeded the rate limit'
        });
        assertNotNull(result);
        assertEqual(result.retryAfter, 3600);
    });

    test('GitHubProvider: shouldInvalidateCredentials for Bad credentials', () => {
        assertTrue(github.shouldInvalidateCredentials({ message: 'Bad credentials' }));
    });

    test('GitHubProvider: shouldInvalidateCredentials for Requires authentication', () => {
        assertTrue(github.shouldInvalidateCredentials({ message: 'Requires authentication' }));
    });

    // ================================================================
    // Copilot Provider Tests
    // ================================================================
    console.log('\n─── Copilot Provider Tests ───');

    const copilot = new CopilotProvider();

    test('CopilotProvider: constructor sets id', () => {
        assertEqual(copilot.id, 'copilot');
    });

    await testAsync('CopilotProvider: validateCredentials fails without apiKey', async () => {
        const result = await copilot.validateCredentials({});
        assertFalse(result.valid);
        assertTrue(result.error.includes('GitHub access token'));
    });

    await testAsync('CopilotProvider: getAccessToken returns apiKey directly', async () => {
        const token = await copilot.getAccessToken({ apiKey: 'ghu_test' });
        assertEqual(token, 'ghu_test');
    });

    await testAsync('CopilotProvider: getQuotas returns hardcoded models', async () => {
        const quotas = await copilot.getQuotas({}, 'token');
        assertNotNull(quotas.models);
        assertNotNull(quotas.models['gpt-4o']);
        assertEqual(quotas.models['gpt-4o'].remainingFraction, 1.0);
    });

    await testAsync('CopilotProvider: getAvailableModels returns 21 models', async () => {
        const models = await copilot.getAvailableModels({}, 'token');
        assertEqual(models.length, 21);
        assertTrue(models.some(m => m.id === 'gpt-4o'));
        assertTrue(models.some(m => m.id === 'claude-sonnet-4'));
        assertTrue(models.some(m => m.id === 'claude-opus-4.6'));
        assertTrue(models.some(m => m.id === 'gpt-5.2'));
        assertTrue(models.some(m => m.id === 'grok-code-fast-1'));
    });

    test('CopilotProvider: buildCopilotHeaders basic', () => {
        const headers = CopilotProvider.buildCopilotHeaders('tok123');
        assertEqual(headers['Authorization'], 'Bearer tok123');
        assertEqual(headers['x-initiator'], 'user');
        assertEqual(headers['Openai-Intent'], 'conversation-edits');
    });

    test('CopilotProvider: buildCopilotHeaders with isAgent', () => {
        const headers = CopilotProvider.buildCopilotHeaders('tok', { isAgent: true });
        assertEqual(headers['x-initiator'], 'agent');
    });

    test('CopilotProvider: buildCopilotHeaders with isVision', () => {
        const headers = CopilotProvider.buildCopilotHeaders('tok', { isVision: true });
        assertEqual(headers['Copilot-Vision-Request'], 'true');
    });

    test('CopilotProvider: parseRateLimitInfo with retry-after', () => {
        const result = copilot.parseRateLimitInfo(mockResponse({ 'retry-after': '60' }));
        assertNotNull(result);
        assertEqual(result.retryAfter, 60);
    });

    test('CopilotProvider: parseRateLimitInfo with x-ratelimit-reset', () => {
        const futureTs = Math.floor(Date.now() / 1000) + 300;
        const result = copilot.parseRateLimitInfo(mockResponse({
            'x-ratelimit-reset': String(futureTs)
        }));
        assertNotNull(result);
        assertTrue(result.retryAfter > 0);
    });

    test('CopilotProvider: shouldInvalidateCredentials for Bad credentials', () => {
        assertTrue(copilot.shouldInvalidateCredentials({ message: 'Bad credentials' }));
    });

    test('CopilotProvider: shouldInvalidateCredentials for Copilot access denied', () => {
        assertTrue(copilot.shouldInvalidateCredentials({ message: 'Copilot access denied' }));
    });

    test('COPILOT_CONFIG: has required fields', () => {
        assertNotNull(COPILOT_CONFIG.clientId);
        assertNotNull(COPILOT_CONFIG.deviceCodeUrl);
        assertNotNull(COPILOT_CONFIG.apiUrl);
    });

    // ================================================================
    // Codex Provider + Auth Tests
    // ================================================================
    console.log('\n─── Codex Provider Tests ───');

    const codex = new CodexProvider();

    test('CodexProvider: constructor sets id', () => {
        assertEqual(codex.id, 'codex');
    });

    await testAsync('CodexProvider: getAccessToken returns apiKey', async () => {
        const token = await codex.getAccessToken({ apiKey: 'codex-token' });
        assertEqual(token, 'codex-token');
    });

    await testAsync('CodexProvider: getAccessToken throws without credentials', async () => {
        await assertThrowsAsync(() => codex.getAccessToken({}));
    });

    await testAsync('CodexProvider: getQuotas returns empty models', async () => {
        const quotas = await codex.getQuotas({}, 'token');
        assertDeepEqual(quotas, { models: {} });
    });

    await testAsync('CodexProvider: getSubscriptionTier returns codex tier', async () => {
        const tier = await codex.getSubscriptionTier({ accountId: 'acct_123' }, 'token');
        assertEqual(tier.tier, 'codex');
        assertEqual(tier.projectId, 'acct_123');
    });

    test('CodexProvider: shouldInvalidateCredentials for Token refresh failed', () => {
        assertTrue(codex.shouldInvalidateCredentials({ message: 'Token refresh failed: 401' }));
    });

    test('CodexProvider: shouldInvalidateCredentials for invalid_grant', () => {
        assertTrue(codex.shouldInvalidateCredentials({ message: 'invalid_grant' }));
    });

    test('CODEX_CONFIG: has required fields', () => {
        assertNotNull(CODEX_CONFIG.clientId);
        assertNotNull(CODEX_CONFIG.issuer);
        assertNotNull(CODEX_CONFIG.apiEndpoint);
    });

    // ================================================================
    // Codex JWT Parsing Tests
    // ================================================================
    console.log('\n─── Codex JWT Parsing Tests ───');

    test('parseJwtClaims: valid JWT returns claims', () => {
        // Build a valid JWT: header.payload.signature
        const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ sub: 'user_123', email: 'test@example.com' })).toString('base64url');
        const token = `${header}.${payload}.fakesignature`;
        const claims = parseJwtClaims(token);
        assertNotNull(claims);
        assertEqual(claims.sub, 'user_123');
        assertEqual(claims.email, 'test@example.com');
    });

    test('parseJwtClaims: returns undefined for 2-part string', () => {
        const result = parseJwtClaims('part1.part2');
        assertEqual(result, undefined);
    });

    test('parseJwtClaims: returns undefined for empty string', () => {
        const result = parseJwtClaims('');
        assertEqual(result, undefined);
    });

    test('parseJwtClaims: returns undefined for invalid base64', () => {
        const result = parseJwtClaims('header.!!!invalid!!!.signature');
        assertEqual(result, undefined);
    });

    test('extractAccountIdFromClaims: chatgpt_account_id', () => {
        assertEqual(extractAccountIdFromClaims({ chatgpt_account_id: 'acct_123' }), 'acct_123');
    });

    test('extractAccountIdFromClaims: nested auth claim', () => {
        const claims = {
            'https://api.openai.com/auth': { chatgpt_account_id: 'acct_456' }
        };
        assertEqual(extractAccountIdFromClaims(claims), 'acct_456');
    });

    test('extractAccountIdFromClaims: organizations fallback', () => {
        const claims = { organizations: [{ id: 'org_789' }] };
        assertEqual(extractAccountIdFromClaims(claims), 'org_789');
    });

    test('extractAccountIdFromClaims: priority order (direct > nested > org)', () => {
        const claims = {
            chatgpt_account_id: 'acct_direct',
            'https://api.openai.com/auth': { chatgpt_account_id: 'acct_nested' },
            organizations: [{ id: 'org_fallback' }]
        };
        assertEqual(extractAccountIdFromClaims(claims), 'acct_direct');
    });

    test('extractAccountIdFromClaims: empty claims returns undefined', () => {
        assertEqual(extractAccountIdFromClaims({}), undefined);
    });

    test('extractAccountId: extracts from id_token', () => {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ chatgpt_account_id: 'acct_from_id' })).toString('base64url');
        const idToken = `${header}.${payload}.sig`;
        const result = extractAccountId({ id_token: idToken });
        assertEqual(result, 'acct_from_id');
    });

    test('extractAccountId: extracts from access_token if no id_token', () => {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ chatgpt_account_id: 'acct_from_access' })).toString('base64url');
        const accessToken = `${header}.${payload}.sig`;
        const result = extractAccountId({ access_token: accessToken });
        assertEqual(result, 'acct_from_access');
    });

    test('extractAccountId: returns undefined for empty tokens', () => {
        assertEqual(extractAccountId({}), undefined);
    });

    test('extractAccountId: prefers id_token over access_token', () => {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
        const idPayload = Buffer.from(JSON.stringify({ chatgpt_account_id: 'from_id' })).toString('base64url');
        const accessPayload = Buffer.from(JSON.stringify({ chatgpt_account_id: 'from_access' })).toString('base64url');
        const result = extractAccountId({
            id_token: `${header}.${idPayload}.sig`,
            access_token: `${header}.${accessPayload}.sig`
        });
        assertEqual(result, 'from_id');
    });

    // ================================================================
    // Summary
    // ================================================================
    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`Tests completed: ${passed} passed, ${failed} failed`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
