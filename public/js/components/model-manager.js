/**
 * Model Manager Component
 * Handles model configuration editing in Settings page
 * Registers itself to window.Components for Alpine.js to consume
 */
window.Components = window.Components || {};

window.Components.modelManager = () => ({
    editingModelId: null,

    init() {
        // Component initialization if needed
    },

    /**
     * Check if a specific model is currently being edited
     * @param {string} modelId - The model ID to check
     * @returns {boolean} True if the model is being edited
     */
    isEditing(modelId) {
        return this.editingModelId === modelId;
    },

    /**
     * Start editing a model's mapping
     * @param {string} modelId - The model ID to edit
     */
    startEditing(modelId) {
        this.editingModelId = modelId;
    },

    /**
     * Stop editing (cancel or after save)
     */
    stopEditing() {
        this.editingModelId = null;
    },

    /**
     * Update model configuration (delegates to shared utility)
     * @param {string} modelId - The model ID to update
     * @param {object} configUpdates - Configuration updates (pinned, hidden, mapping)
     */
    async updateModelConfig(modelId, configUpdates) {
        return window.ModelConfigUtils.updateModelConfig(modelId, configUpdates);
    }
});
