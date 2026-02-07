/**
 * Add Account Modal Component
 * Registers itself to window.Components for Alpine.js to consume
 * Supports multi-provider account addition (Google OAuth, API keys, PAT, Device Auth)
 */
window.Components = window.Components || {};

window.Components.addAccountModal = () => ({
    // Provider selection
    providers: [],
    selectedProvider: 'google',
    
    // Form fields
    email: '',
    apiKey: '',
    customEndpoint: '',
    
    // OAuth state (Google)
    manualMode: false,
    authUrl: '',
    authState: '',
    callbackInput: '',
    submitting: false,

    // Copilot Device Auth state
    copilotFlowId: null,
    copilotUserCode: '',
    copilotVerificationUri: '',
    copilotPolling: false,
    copilotPollTimer: null,

    // Codex Device Auth state
    codexFlowId: null,
    codexUserCode: '',
    codexVerificationUri: '',
    codexPolling: false,
    codexPollTimer: null,

    async init() {
        // Fetch available providers on modal init
        await this.loadProviders();
    },

    async loadProviders() {
        try {
            const store = Alpine.store('global');
            const { response, newPassword } = await window.utils.request(
                '/api/providers',
                {},
                store.webuiPassword
            );
            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok' && Array.isArray(data.providers)) {
                this.providers = data.providers.map(p => ({
                    id: p.id,
                    name: p.name,
                    authType: p.authType,
                    color: p.config?.color || '#4285f4'
                }));
            }
        } catch (e) {
            console.error('Failed to load providers:', e);
            // Fallback to default providers if API fails
            this.providers = [
                { id: 'google', name: 'Google Cloud Code', authType: 'oauth', color: '#4285f4' },
                { id: 'anthropic', name: 'Anthropic', authType: 'api-key', color: '#d97706' },
                { id: 'openai', name: 'OpenAI', authType: 'api-key', color: '#10b981' },
                { id: 'github', name: 'GitHub Models', authType: 'api-key', color: '#6366f1' },
                { id: 'copilot', name: 'GitHub Copilot', authType: 'device-auth', color: '#f97316' },
                { id: 'openrouter', name: 'OpenRouter', authType: 'api-key', color: '#6d28d9' },
                { id: 'codex', name: 'ChatGPT Plus/Pro (Codex)', authType: 'device-auth', color: '#10b981' }
            ];
        }
    },

    get currentProvider() {
        return this.providers.find(p => p.id === this.selectedProvider) || this.providers[0];
    },

    get isOAuthProvider() {
        return this.currentProvider?.authType === 'oauth';
    },

    get requiresApiKey() {
        return this.currentProvider?.authType === 'api-key' || this.currentProvider?.authType === 'pat';
    },

    get isDeviceAuthProvider() {
        return this.currentProvider?.authType === 'device-auth';
    },

    get apiKeyLabel() {
        if (this.currentProvider?.authType === 'pat') {
            return 'Personal Access Token';
        }
        return 'API Key';
    },

    get apiKeyPlaceholder() {
        const provider = this.currentProvider;
        if (!provider) return 'Enter your API key';
        
        if (provider.id === 'anthropic') {
            return 'sk-ant-api03-...';
        } else if (provider.id === 'openai') {
            return 'sk-...';
        } else if (provider.id === 'github') {
            return 'github_pat_...';
        } else if (provider.id === 'openrouter') {
            return 'sk-or-v1-...';
        }
        return 'Enter your API key or token';
    },

    get isCopilotProvider() {
        return this.currentProvider?.id === 'copilot';
    },

    get isCodexProvider() {
        return this.currentProvider?.id === 'codex';
    },

    onProviderChange() {
        // Reset form fields when provider changes
        this.email = '';
        this.apiKey = '';
        this.customEndpoint = '';
        this.authUrl = '';
        this.callbackInput = '';
        this.manualMode = false;
        // Stop any active Copilot polling
        this.stopCopilotPolling();
        this.copilotFlowId = null;
        this.copilotUserCode = '';
        this.copilotVerificationUri = '';
        // Stop any active Codex polling
        this.stopCodexPolling();
        this.codexFlowId = null;
        this.codexUserCode = '';
        this.codexVerificationUri = '';
    },

    // ==================== OAuth Methods (Google) ====================

    async addAccountWeb() {
        const store = Alpine.store('global');
        const password = store.webuiPassword;

        try {
            store.showOAuthProgress();
            const { response, newPassword } = await window.utils.request('/api/auth/url', {}, password);
            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                window.open(data.url, 'google_oauth', 'width=600,height=700,scrollbars=yes');
            } else {
                store.showToast(data.error || store.t('authUrlFailed'), 'error');
                store.hideOAuthProgress();
            }
        } catch (e) {
            store.showToast(store.t('authUrlFailed') + ': ' + e.message, 'error');
            store.hideOAuthProgress();
        }
    },

    async initManualAuth(event) {
        if (!event.target.open || this.authUrl) return;
        
        try {
            const password = Alpine.store('global').webuiPassword;
            const {
                response,
                newPassword
            } = await window.utils.request('/api/auth/url', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;
            const data = await response.json();
            if (data.status === 'ok') {
                this.authUrl = data.url;
                this.authState = data.state;
            }
        } catch (e) {
            Alpine.store('global').showToast(e.message, 'error');
        }
    },

    async copyLink() {
        if (!this.authUrl) return;
        await navigator.clipboard.writeText(this.authUrl);
        Alpine.store('global').showToast(Alpine.store('global').t('linkCopied'), 'success');
    },

    async completeManualAuth() {
        if (!this.callbackInput || !this.authState) return;
        this.submitting = true;
        try {
            const store = Alpine.store('global');
            const {
                response,
                newPassword
            } = await window.utils.request('/api/auth/complete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    callbackInput: this.callbackInput,
                    state: this.authState
                })
            }, store.webuiPassword);
            if (newPassword) store.webuiPassword = newPassword;
            const data = await response.json();
            if (data.status === 'ok') {
                store.showToast(store.t('accountAddedSuccess'), 'success');
                Alpine.store('data').fetchData();
                document.getElementById('add_account_modal').close();
                this.resetState();
            } else {
                store.showToast(data.error || store.t('authFailed'), 'error');
            }
        } catch (e) {
            Alpine.store('global').showToast(e.message, 'error');
        } finally {
            this.submitting = false;
        }
    },

    // ==================== Copilot Device Auth Methods ====================

    async startCopilotDeviceAuth() {
        const store = Alpine.store('global');
        this.submitting = true;

        try {
            const { response, newPassword } = await window.utils.request(
                '/api/copilot/device-auth',
                { method: 'POST', headers: { 'Content-Type': 'application/json' } },
                store.webuiPassword
            );
            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                this.copilotFlowId = data.flowId;
                this.copilotUserCode = data.userCode;
                this.copilotVerificationUri = data.verificationUri;

                // Open GitHub verification page
                window.open(data.verificationUri, '_blank', 'width=600,height=700,scrollbars=yes');

                store.showToast('Enter the code shown below on GitHub to authorize', 'info');

                // Start polling for token
                this.startCopilotPolling(data.interval || 5);
            } else {
                store.showToast(data.error || 'Failed to start device auth', 'error');
            }
        } catch (e) {
            store.showToast('Device auth failed: ' + e.message, 'error');
        } finally {
            this.submitting = false;
        }
    },

    startCopilotPolling(interval) {
        this.copilotPolling = true;
        const poll = async () => {
            if (!this.copilotPolling || !this.copilotFlowId) return;

            try {
                const store = Alpine.store('global');
                const { response, newPassword } = await window.utils.request(
                    '/api/copilot/poll-token',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ flowId: this.copilotFlowId })
                    },
                    store.webuiPassword
                );
                if (newPassword) store.webuiPassword = newPassword;

                const data = await response.json();

                if (data.completed) {
                    // Success!
                    this.stopCopilotPolling();
                    store.showToast(`Copilot account ${data.email} added successfully!`, 'success');
                    Alpine.store('data').fetchData();
                    document.getElementById('add_account_modal').close();
                    this.resetState();
                    return;
                }

                if (data.status === 'error') {
                    this.stopCopilotPolling();
                    store.showToast(data.error || 'Device auth failed', 'error');
                    return;
                }

                // Update interval if server says to slow down
                if (data.interval) {
                    interval = data.interval;
                }

                // Continue polling
                this.copilotPollTimer = setTimeout(poll, interval * 1000);
            } catch (e) {
                this.stopCopilotPolling();
                Alpine.store('global').showToast('Polling error: ' + e.message, 'error');
            }
        };

        this.copilotPollTimer = setTimeout(poll, interval * 1000);
    },

    stopCopilotPolling() {
        this.copilotPolling = false;
        if (this.copilotPollTimer) {
            clearTimeout(this.copilotPollTimer);
            this.copilotPollTimer = null;
        }
    },

    async copyCopilotCode() {
        if (!this.copilotUserCode) return;
        await navigator.clipboard.writeText(this.copilotUserCode);
        Alpine.store('global').showToast('Code copied to clipboard', 'success');
    },

    // ==================== Codex Device Auth Methods ====================

    async startCodexDeviceAuth() {
        const store = Alpine.store('global');
        this.submitting = true;

        try {
            const { response, newPassword } = await window.utils.request(
                '/api/codex/device-auth',
                { method: 'POST', headers: { 'Content-Type': 'application/json' } },
                store.webuiPassword
            );
            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                this.codexFlowId = data.flowId;
                this.codexUserCode = data.userCode;
                this.codexVerificationUri = data.verificationUri;

                // Open OpenAI verification page
                window.open(data.verificationUri, '_blank', 'width=600,height=700,scrollbars=yes');

                store.showToast('Enter the code shown below on OpenAI to authorize', 'info');

                // Start polling for token
                this.startCodexPolling(data.interval || 5);
            } else {
                store.showToast(data.error || 'Failed to start Codex device auth', 'error');
            }
        } catch (e) {
            store.showToast('Codex device auth failed: ' + e.message, 'error');
        } finally {
            this.submitting = false;
        }
    },

    startCodexPolling(interval) {
        this.codexPolling = true;
        const poll = async () => {
            if (!this.codexPolling || !this.codexFlowId) return;

            try {
                const store = Alpine.store('global');
                const { response, newPassword } = await window.utils.request(
                    '/api/codex/poll-token',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ flowId: this.codexFlowId })
                    },
                    store.webuiPassword
                );
                if (newPassword) store.webuiPassword = newPassword;

                const data = await response.json();

                if (data.completed) {
                    this.stopCodexPolling();
                    store.showToast(`Codex account ${data.email || ''} added successfully!`, 'success');
                    Alpine.store('data').fetchData();
                    document.getElementById('add_account_modal').close();
                    this.resetState();
                    return;
                }

                if (data.status === 'error') {
                    this.stopCodexPolling();
                    store.showToast(data.error || 'Codex device auth failed', 'error');
                    return;
                }

                if (data.interval) {
                    interval = data.interval;
                }

                this.codexPollTimer = setTimeout(poll, interval * 1000);
            } catch (e) {
                this.stopCodexPolling();
                Alpine.store('global').showToast('Polling error: ' + e.message, 'error');
            }
        };

        this.codexPollTimer = setTimeout(poll, interval * 1000);
    },

    stopCodexPolling() {
        this.codexPolling = false;
        if (this.codexPollTimer) {
            clearTimeout(this.codexPollTimer);
            this.codexPollTimer = null;
        }
    },

    async copyCodexCode() {
        if (!this.codexUserCode) return;
        await navigator.clipboard.writeText(this.codexUserCode);
        Alpine.store('global').showToast('Code copied to clipboard', 'success');
    },

    // ==================== API Key Methods (Anthropic, OpenAI, GitHub) ==

    async addAccountWithProvider() {
        return await window.ErrorHandler.withLoading(async () => {
            const store = Alpine.store('global');

            // Validate inputs
            if (!this.email || !this.email.includes('@')) {
                throw new Error(store.t('invalidEmail') || 'Invalid email address');
            }
            if (!this.apiKey) {
                throw new Error(store.t('apiKeyRequired') || `${this.apiKeyLabel} is required`);
            }

            // Validate credentials before adding
            store.showToast(store.t('validatingCredentials') || 'Validating credentials...', 'info');
            const validationResult = await this.validateCredentials();
            if (!validationResult.valid) {
                throw new Error(validationResult.error || 'Credential validation failed');
            }

            // Add account
            const payload = {
                provider: this.selectedProvider,
                email: this.email,
                apiKey: this.apiKey
            };

            if (this.customEndpoint && this.customEndpoint.trim()) {
                payload.customApiEndpoint = this.customEndpoint.trim();
            }

            const { response, newPassword } = await window.utils.request(
                '/api/accounts/add',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                },
                store.webuiPassword
            );
            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                store.showToast(store.t('accountAdded', { email: this.email }), 'success');
                Alpine.store('data').fetchData();
                document.getElementById('add_account_modal').close();
                this.resetState();
            } else {
                throw new Error(data.error || store.t('addAccountFailed'));
            }
        }, this, 'submitting', { errorMessage: 'Failed to add account' });
    },

    async validateCredentials() {
        const store = Alpine.store('global');
        
        try {
            const { response, newPassword } = await window.utils.request(
                `/api/providers/${this.selectedProvider}/validate`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiKey: this.apiKey,
                        customApiEndpoint: this.customEndpoint || undefined
                    })
                },
                store.webuiPassword
            );
            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            return data; // { valid: boolean, error?: string }
        } catch (e) {
            return { valid: false, error: e.message };
        }
    },

    /**
     * Reset all state to initial values
     */
    resetState() {
        this.selectedProvider = 'google';
        this.email = '';
        this.apiKey = '';
        this.customEndpoint = '';
        this.manualMode = false;
        this.authUrl = '';
        this.authState = '';
        this.callbackInput = '';
        this.submitting = false;
        // Stop Copilot polling
        this.stopCopilotPolling();
        this.copilotFlowId = null;
        this.copilotUserCode = '';
        this.copilotVerificationUri = '';
        // Stop Codex polling
        this.stopCodexPolling();
        this.codexFlowId = null;
        this.codexUserCode = '';
        this.codexVerificationUri = '';
        // Close any open details elements
        const details = document.querySelectorAll('#add_account_modal details[open]');
        details.forEach(d => d.removeAttribute('open'));
    }
});
