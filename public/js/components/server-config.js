/**
 * Server Config Component
 * Registers itself to window.Components for Alpine.js to consume
 */
window.Components = window.Components || {};

window.Components.serverConfig = () => ({
    serverConfig: {},
    healthConfig: {}, // Health Management Config
    loading: false,
    advancedExpanded: false,
    debounceTimers: {}, // Store debounce timers for each config field

    init() {
        // Initial fetch if this is the active sub-tab
        if (this.activeTab === 'server') {
            this.fetchServerConfig();
        }
        if (this.activeTab === 'health') {
            this.fetchHealthConfig();
        }

        // Watch local activeTab (from parent settings scope, skip initial trigger)
        this.$watch('activeTab', (tab, oldTab) => {
            if (tab === 'server' && oldTab !== undefined) {
                this.fetchServerConfig();
            }
            if (tab === 'health' && oldTab !== undefined) {
                this.fetchHealthConfig();
            }
        });
    },

    async fetchServerConfig() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/config', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error('Failed to fetch config');
            const data = await response.json();
            this.serverConfig = data.config || {};
        } catch (e) {
            console.error('Failed to fetch server config:', e);
        }
    },

    async fetchHealthConfig() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/health/config', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error('Failed to fetch health config');
            const data = await response.json();
            this.healthConfig = data.config || {};
        } catch (e) {
            console.error('Failed to fetch health config:', e);
        }
    },

    /**
     * Get recovery hours from autoRecoveryMs for UI display
     * Backend stores milliseconds, UI displays hours
     */
    getRecoveryHours() {
        const ms = this.healthConfig.autoRecoveryMs;
        if (!ms) return 24; // Default 24 hours
        return Math.round(ms / (60 * 60 * 1000));
    },

    async updateHealthConfig(updates, optimistic = true) {
        const store = Alpine.store('global');
        const password = store.webuiPassword;

        // Check if we should debounce this update (for numeric ranges)
        // Use backend field names: consecutiveFailureThreshold, autoRecoveryMs, warningThreshold, criticalThreshold
        const numericFields = ['consecutiveFailureThreshold', 'autoRecoveryMs', 'warningThreshold', 'criticalThreshold', 'eventMaxCount', 'eventRetentionDays'];
        const firstField = Object.keys(updates)[0];

        if (numericFields.includes(firstField)) {
            // Clear existing debounce timer for health config
            if (this.debounceTimers['health_config']) {
                clearTimeout(this.debounceTimers['health_config']);
            }

            // Optimistic update for UI responsiveness
            if (optimistic) {
                this.healthConfig = { ...this.healthConfig, ...updates };
            }

            this.debounceTimers['health_config'] = setTimeout(async () => {
                await this.executeHealthConfigUpdate(updates, store, password);
            }, window.AppConstants.INTERVALS.CONFIG_DEBOUNCE || 500);
            return;
        }

        // Immediate update for toggles
        if (optimistic) {
            this.healthConfig = { ...this.healthConfig, ...updates };
        }
        await this.executeHealthConfigUpdate(updates, store, password);
    },

    async executeHealthConfigUpdate(updates, store, password) {
        try {
            const { response, newPassword } = await window.utils.request('/api/health/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            }, password);

            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                // Only show toast for explicit toggles, not sliders to avoid spam
                const isToggle = typeof Object.values(updates)[0] === 'boolean';
                if (isToggle) {
                    store.showToast('Health configuration updated', 'success');
                }
                this.healthConfig = data.config;
            } else {
                throw new Error(data.error || 'Update failed');
            }
        } catch (e) {
            store.showToast('Failed to update health config: ' + e.message, 'error');
            this.fetchHealthConfig(); // Rollback to server state
        }
    },

    // Password management
    passwordDialog: {
        show: false,
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
    },

    showPasswordDialog() {
        this.passwordDialog = {
            show: true,
            oldPassword: '',
            newPassword: '',
            confirmPassword: ''
        };
    },

    hidePasswordDialog() {
        this.passwordDialog = {
            show: false,
            oldPassword: '',
            newPassword: '',
            confirmPassword: ''
        };
    },

    async changePassword() {
        const store = Alpine.store('global');
        const { oldPassword, newPassword, confirmPassword } = this.passwordDialog;

        if (newPassword !== confirmPassword) {
            store.showToast(store.t('passwordsNotMatch'), 'error');
            return;
        }
        if (newPassword.length < 6) {
            store.showToast(store.t('passwordTooShort'), 'error');
            return;
        }

        try {
            const { response } = await window.utils.request('/api/config/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPassword, newPassword })
            }, store.webuiPassword);

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || store.t('failedToChangePassword'));
            }

            // Update stored password
            store.webuiPassword = newPassword;
            store.showToast(store.t('passwordChangedSuccess'), 'success');
            this.hidePasswordDialog();
        } catch (e) {
            store.showToast(store.t('failedToChangePassword') + ': ' + e.message, 'error');
        }
    },

    // Toggle Debug Mode with instant save
    async toggleDebug(enabled) {
        const store = Alpine.store('global');

        // Optimistic update
        const previousValue = this.serverConfig.debug;
        this.serverConfig.debug = enabled;

        try {
            const { response, newPassword } = await window.utils.request('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ debug: enabled })
            }, store.webuiPassword);

            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                const status = enabled ? store.t('enabledStatus') : store.t('disabledStatus');
                store.showToast(store.t('debugModeToggled', { status }), 'success');
                await this.fetchServerConfig(); // Confirm server state
            } else {
                throw new Error(data.error || store.t('failedToUpdateDebugMode'));
            }
        } catch (e) {
            // Rollback on error
            this.serverConfig.debug = previousValue;
            store.showToast(store.t('failedToUpdateDebugMode') + ': ' + e.message, 'error');
        }
    },

    // Toggle Token Cache with instant save
    async toggleTokenCache(enabled) {
        const store = Alpine.store('global');

        // Optimistic update
        const previousValue = this.serverConfig.persistTokenCache;
        this.serverConfig.persistTokenCache = enabled;

        try {
            const { response, newPassword } = await window.utils.request('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ persistTokenCache: enabled })
            }, store.webuiPassword);

            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                const status = enabled ? store.t('enabledStatus') : store.t('disabledStatus');
                store.showToast(store.t('tokenCacheToggled', { status }), 'success');
                await this.fetchServerConfig(); // Confirm server state
            } else {
                throw new Error(data.error || store.t('failedToUpdateTokenCache'));
            }
        } catch (e) {
            // Rollback on error
            this.serverConfig.persistTokenCache = previousValue;
            store.showToast(store.t('failedToUpdateTokenCache') + ': ' + e.message, 'error');
        }
    },

    // Generic debounced save method for numeric configs with validation
    async saveConfigField(fieldName, value, displayName, validator = null) {
        const store = Alpine.store('global');

        // Validate input if validator provided
        if (validator) {
            const validation = window.Validators.validate(value, validator, true);
            if (!validation.isValid) {
                // Rollback to previous value
                this.serverConfig[fieldName] = this.serverConfig[fieldName];
                return;
            }
            value = validation.value;
        } else {
            value = parseInt(value);
        }

        // Clear existing timer for this field
        if (this.debounceTimers[fieldName]) {
            clearTimeout(this.debounceTimers[fieldName]);
        }

        // Optimistic update
        const previousValue = this.serverConfig[fieldName];
        this.serverConfig[fieldName] = value;

        // Set new timer
        this.debounceTimers[fieldName] = setTimeout(async () => {
            try {
                const payload = {};
                payload[fieldName] = value;

                const { response, newPassword } = await window.utils.request('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, store.webuiPassword);

                if (newPassword) store.webuiPassword = newPassword;

                const data = await response.json();
                if (data.status === 'ok') {
                    store.showToast(store.t('fieldUpdated', { displayName, value }), 'success');
                    await this.fetchServerConfig(); // Confirm server state
                } else {
                    throw new Error(data.error || store.t('failedToUpdateField', { displayName }));
                }
            } catch (e) {
                // Rollback on error
                this.serverConfig[fieldName] = previousValue;
                store.showToast(store.t('failedToUpdateField', { displayName }) + ': ' + e.message, 'error');
            }
        }, window.AppConstants.INTERVALS.CONFIG_DEBOUNCE);
    },

    // Individual toggle methods for each Advanced Tuning field with validation
    toggleMaxRetries(value) {
        const { MAX_RETRIES_MIN, MAX_RETRIES_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('maxRetries', value, 'Max Retries',
            (v) => window.Validators.validateRange(v, MAX_RETRIES_MIN, MAX_RETRIES_MAX, 'Max Retries'));
    },

    toggleRetryBaseMs(value) {
        const { RETRY_BASE_MS_MIN, RETRY_BASE_MS_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('retryBaseMs', value, 'Retry Base Delay',
            (v) => window.Validators.validateRange(v, RETRY_BASE_MS_MIN, RETRY_BASE_MS_MAX, 'Retry Base Delay'));
    },

    toggleRetryMaxMs(value) {
        const { RETRY_MAX_MS_MIN, RETRY_MAX_MS_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('retryMaxMs', value, 'Retry Max Delay',
            (v) => window.Validators.validateRange(v, RETRY_MAX_MS_MIN, RETRY_MAX_MS_MAX, 'Retry Max Delay'));
    },

    toggleDefaultCooldownMs(value) {
        const { DEFAULT_COOLDOWN_MIN, DEFAULT_COOLDOWN_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('defaultCooldownMs', value, 'Default Cooldown',
            (v) => window.Validators.validateTimeout(v, DEFAULT_COOLDOWN_MIN, DEFAULT_COOLDOWN_MAX));
    },

    toggleMaxWaitBeforeErrorMs(value) {
        const { MAX_WAIT_MIN, MAX_WAIT_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('maxWaitBeforeErrorMs', value, 'Max Wait Threshold',
            (v) => window.Validators.validateTimeout(v, MAX_WAIT_MIN, MAX_WAIT_MAX));
    },

    // Health Management Setters with Validation
    // Field names match backend: consecutiveFailureThreshold, autoRecoveryMs, warningThreshold, criticalThreshold

    setFailureThreshold(value) {
        const { HEALTH_THRESHOLD_MIN, HEALTH_THRESHOLD_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, HEALTH_THRESHOLD_MIN, HEALTH_THRESHOLD_MAX, 'Failure Threshold');
        if (validation.isValid) this.updateHealthConfig({ consecutiveFailureThreshold: validation.value });
    },

    setRecoveryHours(value) {
        const { RECOVERY_HOURS_MIN, RECOVERY_HOURS_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, RECOVERY_HOURS_MIN, RECOVERY_HOURS_MAX, 'Recovery Hours');
        // Convert hours to milliseconds for backend
        if (validation.isValid) this.updateHealthConfig({ autoRecoveryMs: validation.value * 60 * 60 * 1000 });
    },

    setWarnThreshold(value) {
        const { HEALTH_SCORE_MIN, HEALTH_SCORE_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, HEALTH_SCORE_MIN, HEALTH_SCORE_MAX, 'Warning Threshold');
        if (validation.isValid) this.updateHealthConfig({ warningThreshold: validation.value });
    },

    setCriticalThreshold(value) {
        const { HEALTH_SCORE_MIN, HEALTH_SCORE_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, HEALTH_SCORE_MIN, HEALTH_SCORE_MAX, 'Critical Threshold');
        if (validation.isValid) this.updateHealthConfig({ criticalThreshold: validation.value });
    },

    setMaxEvents(value) {
        const { MAX_EVENTS_MIN, MAX_EVENTS_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, MAX_EVENTS_MIN, MAX_EVENTS_MAX, 'Max Events');
        if (validation.isValid) this.updateHealthConfig({ eventMaxCount: validation.value });
    },

    setRetentionDays(value) {
        const { RETENTION_DAYS_MIN, RETENTION_DAYS_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, RETENTION_DAYS_MIN, RETENTION_DAYS_MAX, 'Retention Days');
        if (validation.isValid) this.updateHealthConfig({ eventRetentionDays: validation.value });
    },

    setQuotaPollInterval(value) {
        const { QUOTA_POLL_INTERVAL_MIN, QUOTA_POLL_INTERVAL_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, QUOTA_POLL_INTERVAL_MIN, QUOTA_POLL_INTERVAL_MAX, 'Poll Interval');
        if (validation.isValid) this.updateHealthConfig({ quotaPollIntervalMs: validation.value * 60 * 1000 });
    },

    setStaleIssueInterval(value) {
        const { STALE_ISSUE_MIN, STALE_ISSUE_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, STALE_ISSUE_MIN, STALE_ISSUE_MAX, 'Stale Issue Interval');
        if (validation.isValid) this.updateHealthConfig({ staleIssueMs: validation.value * 60 * 1000 });
    },

    // Quota Protection Settings
    setQuotaThreshold(value) {
        // value is percentage (5-50), convert to fraction (0.05-0.5)
        const pct = parseInt(value, 10);
        if (pct >= 5 && pct <= 50) {
            this.updateHealthConfig({ quotaThreshold: pct / 100 });
        }
    },

    // Main branch: Account Management Setters
    toggleMaxAccounts(value) {
        const { MAX_ACCOUNTS_MIN, MAX_ACCOUNTS_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('maxAccounts', value, 'Max Accounts',
            (v) => window.Validators.validateRange(v, MAX_ACCOUNTS_MIN, MAX_ACCOUNTS_MAX, 'Max Accounts'));
    },

    toggleRateLimitDedupWindowMs(value) {
        const { RATE_LIMIT_DEDUP_MIN, RATE_LIMIT_DEDUP_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('rateLimitDedupWindowMs', value, 'Rate Limit Dedup Window',
            (v) => window.Validators.validateTimeout(v, RATE_LIMIT_DEDUP_MIN, RATE_LIMIT_DEDUP_MAX));
    },

    toggleMaxConsecutiveFailures(value) {
        const { MAX_CONSECUTIVE_FAILURES_MIN, MAX_CONSECUTIVE_FAILURES_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('maxConsecutiveFailures', value, 'Max Consecutive Failures',
            (v) => window.Validators.validateRange(v, MAX_CONSECUTIVE_FAILURES_MIN, MAX_CONSECUTIVE_FAILURES_MAX, 'Max Consecutive Failures'));
    },

    toggleExtendedCooldownMs(value) {
        const { EXTENDED_COOLDOWN_MIN, EXTENDED_COOLDOWN_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('extendedCooldownMs', value, 'Extended Cooldown',
            (v) => window.Validators.validateTimeout(v, EXTENDED_COOLDOWN_MIN, EXTENDED_COOLDOWN_MAX));
    },

    toggleCapacityRetryDelayMs(value) {
        const { CAPACITY_RETRY_DELAY_MIN, CAPACITY_RETRY_DELAY_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('capacityRetryDelayMs', value, 'Capacity Retry Delay',
            (v) => window.Validators.validateTimeout(v, CAPACITY_RETRY_DELAY_MIN, CAPACITY_RETRY_DELAY_MAX));
    },

    toggleMaxCapacityRetries(value) {
        const { MAX_CAPACITY_RETRIES_MIN, MAX_CAPACITY_RETRIES_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('maxCapacityRetries', value, 'Max Capacity Retries',
            (v) => window.Validators.validateRange(v, MAX_CAPACITY_RETRIES_MIN, MAX_CAPACITY_RETRIES_MAX, 'Max Capacity Retries'));
    },

    // Toggle Account Selection Strategy
    async toggleStrategy(strategy) {
        const store = Alpine.store('global');
        const validStrategies = ['sticky', 'round-robin', 'hybrid'];

        if (!validStrategies.includes(strategy)) {
            store.showToast(store.t('invalidStrategy'), 'error');
            return;
        }

        // Optimistic update
        const previousValue = this.serverConfig.accountSelection?.strategy || 'hybrid';
        if (!this.serverConfig.accountSelection) {
            this.serverConfig.accountSelection = {};
        }
        this.serverConfig.accountSelection.strategy = strategy;

        try {
            const { response, newPassword } = await window.utils.request('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountSelection: { strategy } })
            }, store.webuiPassword);

            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                const strategyLabel = this.getStrategyLabel(strategy);
                store.showToast(store.t('strategyUpdated', { strategy: strategyLabel }), 'success');
                await this.fetchServerConfig(); // Confirm server state
            } else {
                throw new Error(data.error || store.t('failedToUpdateStrategy'));
            }
        } catch (e) {
            // Rollback on error
            if (!this.serverConfig.accountSelection) {
                this.serverConfig.accountSelection = {};
            }
            this.serverConfig.accountSelection.strategy = previousValue;
            store.showToast(store.t('failedToUpdateStrategy') + ': ' + e.message, 'error');
        }
    },

    // Get display label for a strategy
    getStrategyLabel(strategy) {
        const store = Alpine.store('global');
        const labels = {
            'sticky': store.t('strategyStickyLabel'),
            'round-robin': store.t('strategyRoundRobinLabel'),
            'hybrid': store.t('strategyHybridLabel')
        };
        return labels[strategy] || strategy;
    },

    // Get description for current strategy
    currentStrategyDescription() {
        const store = Alpine.store('global');
        const strategy = this.serverConfig.accountSelection?.strategy || 'hybrid';
        const descriptions = {
            'sticky': store.t('strategyStickyDesc'),
            'round-robin': store.t('strategyRoundRobinDesc'),
            'hybrid': store.t('strategyHybridDesc')
        };
        return descriptions[strategy] || '';
    }
});
