/**
 * Add Account Modal Component
 * Registers itself to window.Components for Alpine.js to consume
 * Supports multi-provider account addition (Google OAuth, API keys, PAT)
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
                { id: 'github', name: 'GitHub Models', authType: 'pat', color: '#6366f1' }
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
        }
        return 'Enter your API key or token';
    },

    onProviderChange() {
        // Reset form fields when provider changes
        this.email = '';
        this.apiKey = '';
        this.customEndpoint = '';
        this.authUrl = '';
        this.callbackInput = '';
        this.manualMode = false;
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

    // ==================== API Key Methods (Anthropic, OpenAI, GitHub) ====================

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
        // Close any open details elements
        const details = document.querySelectorAll('#add_account_modal details[open]');
        details.forEach(d => d.removeAttribute('open'));
    }
});
