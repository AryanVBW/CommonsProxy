/**
 * Health Page Component
 * Standalone health monitoring page with matrix, summary, and issues
 */
window.Components = window.Components || {};

window.Components.healthPage = () => ({
    matrix: [],
    loading: false,
    issues: [],
    summary: {
        healthy: 0,
        warning: 0,
        critical: 0,
        disabled: 0
    },
    activeFilter: null, // 'healthy', 'warning', 'critical', 'disabled'
    pollInterval: null,

    // Models to display in the matrix - now from constants
    commonModels: window.AppConstants?.MODELS?.HEALTH_MONITOR_MODELS || [
        'claude-opus-4-5-thinking',
        'claude-sonnet-4-5-thinking',
        'gemini-3-flash',
        'gemini-3-pro-high'
    ],

    init() {
        this.loadMatrix();

        // Refresh when health tab is active
        this.$watch('$store.global.activeTab', (val) => {
            if (val === 'health') {
                this.loadMatrix();
                this.startPolling();
            } else {
                this.stopPolling();
            }
        });

        // Start polling if initially on health page
        if (Alpine.store('global').activeTab === 'health') {
            this.startPolling();
        }
    },

    startPolling() {
        this.stopPolling();
        this.pollInterval = setInterval(() => {
            if (!document.hidden) this.loadMatrix(true);
        }, 30000); // 30s poll
    },

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    },

    async loadMatrix(silent = false) {
        if (!silent) this.loading = true;
        try {
            const globalStore = Alpine.store('global');

            // Try to get models from data store for dynamic selection
            const dataStore = Alpine.store('data');
            let models = this.commonModels;

            if (dataStore?.models?.length > 0) {
                // Could implement smarter model selection here
            }

            const query = models.join(',');
            const { response, newPassword } = await window.utils.request(
                `/api/health/matrix?models=${encodeURIComponent(query)}`,
                {},
                globalStore.webuiPassword
            );
            if (newPassword) globalStore.webuiPassword = newPassword;

            if (response.ok) {
                const data = await response.json();
                const apiMatrix = data.matrix || {};
                const accounts = apiMatrix.accounts || [];

                // Transform API response to frontend format
                this.matrix = accounts.map(acc => ({
                    account: acc.email,
                    models: this.commonModels.map(modelId => ({
                        modelId,
                        ...(acc.models?.[modelId] || {
                            healthScore: 100,
                            successCount: 0,
                            failCount: 0,
                            disabled: false
                        })
                    }))
                }));

                // Calculate summary stats
                this.calculateSummary();
            }

            // Load issues separately
            await this.loadIssues(silent);
        } catch (error) {
            console.error('Failed to load health matrix:', error);
        } finally {
            if (!silent) this.loading = false;
        }
    },

    calculateSummary() {
        let healthy = 0, warning = 0, critical = 0, disabled = 0;

        for (const row of this.matrix) {
            for (const cell of row.models) {
                if (cell.disabled) {
                    disabled++;
                } else if (cell.healthScore >= 90) {
                    healthy++;
                } else if (cell.healthScore >= 70) {
                    warning++;
                } else {
                    critical++;
                }
            }
        }

        this.summary = { healthy, warning, critical, disabled };
    },

    async loadIssues(silent = false) {
        try {
            const globalStore = Alpine.store('global');
            const { response, newPassword } = await window.utils.request(
                '/api/issues',
                {},
                globalStore.webuiPassword
            );
            if (newPassword) globalStore.webuiPassword = newPassword;

            if (response.ok) {
                const data = await response.json();
                this.issues = (data.issues || []).filter(i => i.status === 'active');
            }
        } catch (error) {
            // Issues endpoint may not exist yet, ignore silently
            this.issues = [];
        }
    },

    getHealthClass(cell) {
        // Base classes for colors
        let classes = '';
        let type = '';

        if (cell.disabled) {
            type = 'disabled';
            classes = 'bg-red-500/20 text-red-500 border-red-500/30';
        } else if (cell.healthScore >= 90) {
            type = 'healthy';
            classes = 'bg-neon-green/10 text-neon-green border-neon-green/20';
        } else if (cell.healthScore >= 70) {
            type = 'warning';
            classes = 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
        } else {
            type = 'critical';
            classes = 'bg-red-500/10 text-red-400 border-red-500/20';
        }

        // Apply dimming if a filter is active and this cell doesn't match
        if (this.activeFilter && this.activeFilter !== type) {
            return classes + ' opacity-20 grayscale blur-[1px] transition-all duration-300';
        }

        return classes + ' transition-all duration-300 transform hover:scale-105 hover:z-10 shadow-lg shadow-black/20';
    },

    setFilter(filter) {
        // Toggle off if clicking same filter
        if (this.activeFilter === filter) {
            this.activeFilter = null;
        } else {
            this.activeFilter = filter;
        }
    },

    formatScore(score) {
        return score === undefined || score === null ? '-' : Math.round(score) + '%';
    },

    // Navigate to account details with health tab open
    viewAccountHealth(email) {
        const store = Alpine.store('global');
        store.activeTab = 'accounts';

        // Dispatch event to open specific account's health tab
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('open-account-details', {
                detail: { email, tab: 'health' }
            }));
        }, 50);
    },

    async resolveIssue(issueId) {
        try {
            const globalStore = Alpine.store('global');
            const { response, newPassword } = await window.utils.request(
                `/api/issues/${encodeURIComponent(issueId)}/resolve`,
                { method: 'POST' },
                globalStore.webuiPassword
            );
            if (newPassword) globalStore.webuiPassword = newPassword;

            if (response.ok) {
                // Remove from local list
                this.issues = this.issues.filter(i => i.id !== issueId);
                globalStore.showToast(globalStore.t('issueResolved') || 'Issue resolved', 'success');
            } else {
                throw new Error('Failed to resolve issue');
            }
        } catch (error) {
            console.error('Failed to resolve issue:', error);
            Alpine.store('global').showToast('Failed to resolve issue', 'error');
        }
    }
});
