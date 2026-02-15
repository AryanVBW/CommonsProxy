/**
 * OpenAI-Compatible Provider
 *
 * Generic provider for any OpenAI-compatible API endpoint (Copilot, OpenAI, etc.).
 * Handles full bidirectional conversion between Anthropic format and OpenAI format:
 *   - Tool definitions (Anthropic tools[] → OpenAI tools[])
 *   - Tool calls (Anthropic tool_use blocks ↔ OpenAI tool_calls)
 *   - Tool results (Anthropic tool_result messages → OpenAI tool role messages)
 *   - Thinking/reasoning (Anthropic thinking config → OpenAI reasoning_effort)
 *   - Content blocks (text, image, thinking)
 *   - Streaming with tool call and reasoning support
 *
 * The Copilot API at api.githubcopilot.com uses OpenAI chat/completions format.
 * Reasoning models use `reasoning_effort` + `reasoning_summary` + `include` params
 * instead of Anthropic's `thinking` config.
 */

import { ProviderType } from './index.js';
import { logger } from '../utils/logger.js';
import { COPILOT_REASONING_MODELS } from '../cloudcode/provider-dispatch.js';

// --- Anthropic → OpenAI Request Conversion ---

/**
 * Convert a single Anthropic system prompt to OpenAI system message(s).
 * Anthropic system can be a string or array of content blocks.
 *
 * @param {string|Array} system - Anthropic system prompt
 * @returns {Array<Object>} OpenAI system messages
 */
function convertSystemToMessages(system) {
    if (!system) return [];

    // String system prompt
    if (typeof system === 'string') {
        return [{ role: 'system', content: system }];
    }

    // Array of content blocks (Anthropic supports [{type:'text', text:'...'}])
    if (Array.isArray(system)) {
        const text = system
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n');
        if (text) {
            return [{ role: 'system', content: text }];
        }
    }

    return [];
}

/**
 * Convert Anthropic content blocks to OpenAI message content.
 * Handles text, image, tool_use, and thinking blocks.
 *
 * For user messages: text and image blocks → OpenAI content array or string
 * For assistant messages: text → content string, tool_use → tool_calls array
 *
 * @param {string|Array} content - Anthropic content (string or block array)
 * @param {string} role - Message role ('user', 'assistant', 'tool')
 * @returns {{ content: string|Array|null, tool_calls?: Array }} Converted content
 */
function convertContentBlocks(content, role) {
    // Simple string content
    if (typeof content === 'string') {
        return { content };
    }

    if (!Array.isArray(content)) {
        return { content: '' };
    }

    if (role === 'user') {
        // User messages: convert to OpenAI content array (supports text + images)
        const parts = [];
        for (const block of content) {
            if (block.type === 'text') {
                parts.push({ type: 'text', text: block.text });
            } else if (block.type === 'image') {
                // Anthropic base64 image → OpenAI image_url
                const mediaType = block.source?.media_type || 'image/png';
                const data = block.source?.data || '';
                parts.push({
                    type: 'image_url',
                    image_url: { url: `data:${mediaType};base64,${data}` }
                });
            } else if (block.type === 'tool_result') {
                // tool_result in user message — will be handled separately
                // but extract any text for inline context
                if (typeof block.content === 'string') {
                    parts.push({ type: 'text', text: block.content });
                } else if (Array.isArray(block.content)) {
                    for (const inner of block.content) {
                        if (inner.type === 'text') {
                            parts.push({ type: 'text', text: inner.text });
                        }
                    }
                }
            }
        }
        // If only text parts, simplify to string
        if (parts.length === 1 && parts[0].type === 'text') {
            return { content: parts[0].text };
        }
        return { content: parts.length > 0 ? parts : '' };
    }

    if (role === 'assistant') {
        // Assistant messages: extract text content + tool_calls
        let textContent = '';
        const toolCalls = [];

        for (const block of content) {
            if (block.type === 'text') {
                if (textContent) textContent += '\n';
                textContent += block.text;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    type: 'function',
                    function: {
                        name: block.name,
                        arguments: typeof block.input === 'string'
                            ? block.input
                            : JSON.stringify(block.input || {})
                    }
                });
            }
            // Skip 'thinking' blocks — OpenAI uses reasoning_effort param instead
        }

        const result = { content: textContent || null };
        if (toolCalls.length > 0) {
            result.tool_calls = toolCalls;
        }
        return result;
    }

    // Fallback: join text blocks
    const text = content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
    return { content: text };
}

/**
 * Convert Anthropic-format messages to OpenAI-format messages.
 * Handles the full message flow including tool_result messages.
 *
 * Anthropic tool flow:
 *   1. assistant message with tool_use content blocks
 *   2. user message with tool_result content blocks
 *
 * OpenAI tool flow:
 *   1. assistant message with tool_calls array
 *   2. tool role messages (one per tool call)
 *
 * @param {Array} anthropicMessages - Anthropic-format messages
 * @returns {Array} OpenAI-format messages
 */
function convertMessages(anthropicMessages) {
    const messages = [];

    for (const msg of anthropicMessages) {
        // Check if this is a user message that contains tool_result blocks
        if (msg.role === 'user' && Array.isArray(msg.content)) {
            const toolResults = msg.content.filter(b => b.type === 'tool_result');
            const nonToolContent = msg.content.filter(b => b.type !== 'tool_result');

            // Emit tool response messages first
            for (const result of toolResults) {
                let resultContent = '';
                if (typeof result.content === 'string') {
                    resultContent = result.content;
                } else if (Array.isArray(result.content)) {
                    resultContent = result.content
                        .filter(b => b.type === 'text')
                        .map(b => b.text)
                        .join('\n');
                }

                messages.push({
                    role: 'tool',
                    tool_call_id: result.tool_use_id,
                    content: resultContent || ''
                });
            }

            // If there's non-tool content, emit as a user message
            if (nonToolContent.length > 0) {
                const { content } = convertContentBlocks(nonToolContent, 'user');
                if (content && content !== '') {
                    messages.push({ role: 'user', content });
                }
            }
            continue;
        }

        // Regular message conversion
        const { content, tool_calls } = convertContentBlocks(msg.content, msg.role);
        const openaiMsg = { role: msg.role, content };

        if (tool_calls && tool_calls.length > 0) {
            openaiMsg.tool_calls = tool_calls;
        }

        messages.push(openaiMsg);
    }

    return messages;
}

/**
 * Convert Anthropic tool definitions to OpenAI function-calling tools.
 *
 * Anthropic format:
 *   { name, description, input_schema: { type: 'object', properties, required } }
 *
 * OpenAI format:
 *   { type: 'function', function: { name, description, parameters } }
 *
 * @param {Array} tools - Anthropic tool definitions
 * @returns {Array} OpenAI tool definitions
 */
function convertTools(tools) {
    if (!tools || tools.length === 0) return undefined;

    return tools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.input_schema || { type: 'object', properties: {} }
        }
    }));
}

/**
 * Map Anthropic thinking config / budget to OpenAI reasoning_effort.
 *
 * Anthropic uses:
 *   thinking: { type: 'enabled', budget_tokens: N }
 *
 * OpenAI/Copilot uses:
 *   reasoning_effort: 'low' | 'medium' | 'high'
 *   reasoning_summary: 'auto'
 *   include: ['reasoning.encrypted_content']
 *
 * @param {Object} request - Anthropic request with optional thinking config
 * @returns {Object} Reasoning params for OpenAI request, or empty object
 */
function convertThinkingToReasoning(request) {
    const model = request.model;
    const thinking = request.thinking;
    const isCopilotReasoning = request._copilotReasoning;
    const isReasoningModel = COPILOT_REASONING_MODELS.has(model);

    // If not a reasoning model or no thinking config, skip
    if (!isReasoningModel && !isCopilotReasoning) {
        return {};
    }

    // Default effort for reasoning models
    let effort = 'medium';

    if (thinking) {
        if (thinking.type === 'enabled' && thinking.budget_tokens) {
            // Map budget tokens to effort level
            // Rough mapping: <4k=low, 4k-16k=medium, >16k=high
            if (thinking.budget_tokens < 4000) {
                effort = 'low';
            } else if (thinking.budget_tokens >= 16000) {
                effort = 'high';
            } else {
                effort = 'medium';
            }
        } else if (thinking.type === 'disabled') {
            return {};
        }
    }

    return {
        reasoning_effort: effort,
        reasoning_summary: 'auto',
        include: ['reasoning.encrypted_content']
    };
}

/**
 * Convert Anthropic tool_choice to OpenAI tool_choice format.
 *
 * Anthropic: { type: 'auto' | 'any' | 'tool', name?: string }
 * OpenAI: 'auto' | 'none' | 'required' | { type: 'function', function: { name } }
 *
 * @param {Object} toolChoice - Anthropic tool_choice
 * @returns {string|Object|undefined} OpenAI tool_choice
 */
function convertToolChoice(toolChoice) {
    if (!toolChoice) return undefined;

    if (typeof toolChoice === 'string') {
        // Sometimes sent as plain string
        if (toolChoice === 'any') return 'required';
        if (toolChoice === 'none') return 'none';
        return 'auto';
    }

    switch (toolChoice.type) {
        case 'auto': return 'auto';
        case 'any': return 'required';
        case 'tool':
            return {
                type: 'function',
                function: { name: toolChoice.name }
            };
        default: return 'auto';
    }
}

/**
 * Convert Anthropic-format request to OpenAI Chat Completions format.
 *
 * Handles:
 *   - System prompt (string or content blocks)
 *   - Messages with text, image, tool_use, tool_result content
 *   - Tool definitions
 *   - Tool choice
 *   - Thinking/reasoning → reasoning_effort
 *   - max_tokens → max_completion_tokens for modern models
 *   - Strips Anthropic-specific fields (thinking, metadata, _copilotReasoning)
 *
 * @param {Object} request - Anthropic-format request
 * @returns {Object} OpenAI Chat Completions request body
 */
function convertAnthropicToOpenAI(request) {
    // Build messages: system + converted conversation
    const systemMessages = convertSystemToMessages(request.system);
    const conversationMessages = convertMessages(request.messages || []);
    const messages = [...systemMessages, ...conversationMessages];

    // Build base request
    const openaiRequest = {
        model: request.model,
        messages,
        stream: false
    };

    // Tools
    const tools = convertTools(request.tools);
    if (tools) {
        openaiRequest.tools = tools;
        const toolChoice = convertToolChoice(request.tool_choice);
        if (toolChoice) {
            openaiRequest.tool_choice = toolChoice;
        }
    }

    // Max tokens — use max_completion_tokens for modern models
    if (request.max_tokens) {
        openaiRequest.max_completion_tokens = request.max_tokens;
    }

    // Temperature (only include if explicitly set — reasoning models often ignore it)
    if (request.temperature !== undefined && request.temperature !== null) {
        openaiRequest.temperature = request.temperature;
    }

    // Top-p
    if (request.top_p !== undefined) {
        openaiRequest.top_p = request.top_p;
    }

    // Reasoning params (from Anthropic thinking config)
    const reasoningParams = convertThinkingToReasoning(request);
    Object.assign(openaiRequest, reasoningParams);

    // Store: false to avoid server-side storage (matches opencode behavior)
    openaiRequest.store = false;

    return openaiRequest;
}

// --- OpenAI → Anthropic Response Conversion ---

/**
 * Map OpenAI finish_reason to Anthropic stop_reason.
 *
 * @param {string} finishReason - OpenAI finish reason
 * @returns {string} Anthropic stop reason
 */
function mapStopReason(finishReason) {
    switch (finishReason) {
        case 'stop': return 'end_turn';
        case 'length': return 'max_tokens';
        case 'tool_calls': return 'tool_use';
        case 'content_filter': return 'end_turn';
        default: return finishReason || 'end_turn';
    }
}

/**
 * Convert OpenAI Chat Completion response to Anthropic message format.
 *
 * Handles:
 *   - Text content → Anthropic text blocks
 *   - tool_calls → Anthropic tool_use blocks
 *   - Reasoning content → Anthropic thinking blocks
 *   - Usage mapping
 *   - stop_reason mapping
 *
 * @param {Object} response - OpenAI Chat Completion response
 * @param {string} originalModel - Original model name from the Anthropic request
 * @returns {Object} Anthropic-format message response
 */
function convertOpenAIToAnthropic(response, originalModel) {
    const choice = response.choices?.[0];
    const message = choice?.message || {};
    const content = [];

    // Add thinking/reasoning block if present
    // Some OpenAI models return reasoning in a separate field
    if (message.reasoning_content) {
        content.push({
            type: 'thinking',
            thinking: message.reasoning_content
        });
    }

    // Add text content
    if (message.content) {
        content.push({
            type: 'text',
            text: message.content
        });
    }

    // Add tool_use blocks from tool_calls
    if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
            if (toolCall.type === 'function') {
                let parsedInput = {};
                try {
                    parsedInput = JSON.parse(toolCall.function.arguments || '{}');
                } catch (e) {
                    logger.debug(`[OpenAI] Failed to parse tool call arguments: ${e.message}`);
                    parsedInput = { _raw: toolCall.function.arguments };
                }

                content.push({
                    type: 'tool_use',
                    id: toolCall.id,
                    name: toolCall.function.name,
                    input: parsedInput
                });
            }
        }
    }

    // Ensure at least one content block
    if (content.length === 0) {
        content.push({ type: 'text', text: '' });
    }

    return {
        id: response.id || `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content,
        model: originalModel,
        stop_reason: mapStopReason(choice?.finish_reason),
        usage: {
            input_tokens: response.usage?.prompt_tokens || 0,
            output_tokens: response.usage?.completion_tokens || 0
        }
    };
}

// --- Provider Factory ---

/**
 * Create an OpenAI-compatible provider instance
 *
 * @param {Object} config - Provider configuration
 * @param {string} config.id - Unique provider ID
 * @param {string} config.name - Display name
 * @param {string} config.baseUrl - API base URL
 * @param {string} [config.apiKey] - API key (optional)
 * @param {Object} [config.headers] - Additional headers
 * @returns {Object} Provider instance with sendMessage, sendMessageStream, listModels
 */
export function createOpenAICompatibleProvider(config) {
    const { id, name, baseUrl, apiKey, headers = {} } = config;

    return {
        id,
        name,
        type: ProviderType.OPENAI,
        enabled: true,

        config: {
            baseUrl,
            apiKey,
            headers
        },

        /**
         * Send a non-streaming message
         *
         * @param {Object} request - Anthropic-format request
         * @param {Object} credentials - { apiKey }
         * @param {Object} options - Additional options
         * @returns {Promise<Object>} Anthropic-format response
         */
        async sendMessage(request, credentials = {}, options = {}) {
            const key = credentials.apiKey || apiKey;
            const openaiRequest = convertAnthropicToOpenAI(request);

            const requestHeaders = {
                'Content-Type': 'application/json',
                'User-Agent': 'commons-proxy/2.0.0',
                ...headers
            };
            if (key) {
                requestHeaders['Authorization'] = `Bearer ${key}`;
            }

            logger.debug(`[OpenAI] POST ${baseUrl}/chat/completions model=${openaiRequest.model}`);

            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(openaiRequest)
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`API error: ${response.status} ${text}`);
            }

            const data = await response.json();
            return convertOpenAIToAnthropic(data, request.model);
        },

        /**
         * Send a streaming message.
         * Converts Anthropic request to OpenAI format, streams the response,
         * and yields Anthropic-format SSE events.
         *
         * Handles:
         *   - Text content deltas
         *   - Tool call streaming (function name + argument deltas)
         *   - Reasoning/thinking content (if present in delta)
         *   - Proper content block indexing for multiple blocks
         *
         * @param {Object} request - Anthropic-format request
         * @param {Object} credentials - { apiKey }
         * @param {Object} options - Additional options
         * @yields {Object} Anthropic-format SSE events
         */
        async *sendMessageStream(request, credentials = {}, options = {}) {
            const key = credentials.apiKey || apiKey;
            const openaiRequest = convertAnthropicToOpenAI(request);
            openaiRequest.stream = true;
            // Request usage info in streaming (needed for final message_delta)
            openaiRequest.stream_options = { include_usage: true };

            const requestHeaders = {
                'Content-Type': 'application/json',
                'User-Agent': 'commons-proxy/2.0.0',
                ...headers
            };
            if (key) {
                requestHeaders['Authorization'] = `Bearer ${key}`;
            }

            logger.debug(`[OpenAI] POST ${baseUrl}/chat/completions (stream) model=${openaiRequest.model}`);

            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(openaiRequest)
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`API error: ${response.status} ${text}`);
            }

            // Parse SSE stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const messageId = `msg_${Date.now()}`;
            let started = false;

            // Content block tracking
            // We use indices to map Anthropic content blocks:
            //   index 0: thinking block (if reasoning content is present)
            //   index N: text block
            //   index N+1...: tool_use blocks
            let currentBlockIndex = 0;
            let thinkingBlockStarted = false;
            let textBlockStarted = false;
            let textBlockIndex = -1;

            // Tool call tracking — one tool_use block per OpenAI tool call
            // toolCallIndexMap: openai_tool_index → anthropic_block_index
            const toolCallIndexMap = new Map();
            // toolCallAccumulators: openai_tool_index → { id, name, arguments }
            const toolCallAccumulators = new Map();

            // Track usage from final chunk
            let finalUsage = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const chunk = JSON.parse(data);

                        // Capture usage from stream (some APIs send it in a final chunk with empty choices)
                        if (chunk.usage) {
                            finalUsage = chunk.usage;
                        }

                        const choice = chunk.choices?.[0];
                        if (!choice) continue;

                        const delta = choice.delta || {};
                        const finishReason = choice.finish_reason;

                        // --- Emit message_start on first chunk ---
                        if (!started) {
                            started = true;
                            yield {
                                type: 'message_start',
                                message: {
                                    id: messageId,
                                    type: 'message',
                                    role: 'assistant',
                                    content: [],
                                    model: request.model,
                                    stop_reason: null,
                                    usage: { input_tokens: 0, output_tokens: 0 }
                                }
                            };
                        }

                        // --- Reasoning/thinking content ---
                        if (delta.reasoning_content) {
                            if (!thinkingBlockStarted) {
                                thinkingBlockStarted = true;
                                yield {
                                    type: 'content_block_start',
                                    index: currentBlockIndex,
                                    content_block: { type: 'thinking', thinking: '' }
                                };
                            }
                            yield {
                                type: 'content_block_delta',
                                index: currentBlockIndex,
                                delta: { type: 'thinking_delta', thinking: delta.reasoning_content }
                            };
                        }

                        // --- Text content ---
                        if (delta.content) {
                            // Close thinking block if needed and start text block
                            if (thinkingBlockStarted && !textBlockStarted) {
                                yield { type: 'content_block_stop', index: currentBlockIndex };
                                currentBlockIndex++;
                            }

                            if (!textBlockStarted) {
                                textBlockStarted = true;
                                textBlockIndex = currentBlockIndex;
                                yield {
                                    type: 'content_block_start',
                                    index: textBlockIndex,
                                    content_block: { type: 'text', text: '' }
                                };
                            }
                            yield {
                                type: 'content_block_delta',
                                index: textBlockIndex,
                                delta: { type: 'text_delta', text: delta.content }
                            };
                        }

                        // --- Tool calls ---
                        if (delta.tool_calls) {
                            // Close thinking block if open and text not started
                            if (thinkingBlockStarted && !textBlockStarted) {
                                yield { type: 'content_block_stop', index: currentBlockIndex };
                                currentBlockIndex++;
                                thinkingBlockStarted = false; // Prevent double-close
                            }
                            // Close text block if open
                            if (textBlockStarted && !toolCallIndexMap.size) {
                                yield { type: 'content_block_stop', index: textBlockIndex };
                                currentBlockIndex = textBlockIndex + 1;
                            }

                            for (const tc of delta.tool_calls) {
                                const tcIndex = tc.index ?? 0;

                                if (!toolCallIndexMap.has(tcIndex)) {
                                    // New tool call — start a tool_use content block
                                    const blockIdx = currentBlockIndex + toolCallIndexMap.size;
                                    toolCallIndexMap.set(tcIndex, blockIdx);
                                    toolCallAccumulators.set(tcIndex, {
                                        id: tc.id || `toolu_${Date.now()}_${tcIndex}`,
                                        name: tc.function?.name || '',
                                        arguments: ''
                                    });

                                    yield {
                                        type: 'content_block_start',
                                        index: blockIdx,
                                        content_block: {
                                            type: 'tool_use',
                                            id: toolCallAccumulators.get(tcIndex).id,
                                            name: tc.function?.name || '',
                                            input: {}
                                        }
                                    };
                                }

                                const accum = toolCallAccumulators.get(tcIndex);
                                const blockIdx = toolCallIndexMap.get(tcIndex);

                                // Accumulate function name (sometimes streamed in parts)
                                if (tc.function?.name) {
                                    accum.name = tc.function.name;
                                }

                                // Stream argument deltas
                                if (tc.function?.arguments) {
                                    accum.arguments += tc.function.arguments;
                                    yield {
                                        type: 'content_block_delta',
                                        index: blockIdx,
                                        delta: {
                                            type: 'input_json_delta',
                                            partial_json: tc.function.arguments
                                        }
                                    };
                                }
                            }
                        }

                        // --- Finish ---
                        if (finishReason) {
                            // Close any open thinking block
                            if (thinkingBlockStarted && !textBlockStarted && toolCallIndexMap.size === 0) {
                                yield { type: 'content_block_stop', index: currentBlockIndex };
                                currentBlockIndex++;
                            }

                            // Close text block if still open
                            if (textBlockStarted && toolCallIndexMap.size === 0) {
                                yield { type: 'content_block_stop', index: textBlockIndex };
                            }

                            // Close all tool_use blocks
                            for (const [, blockIdx] of toolCallIndexMap) {
                                yield { type: 'content_block_stop', index: blockIdx };
                            }

                            // If nothing was started, emit an empty text block
                            if (!textBlockStarted && !thinkingBlockStarted && toolCallIndexMap.size === 0) {
                                yield {
                                    type: 'content_block_start',
                                    index: 0,
                                    content_block: { type: 'text', text: '' }
                                };
                                yield { type: 'content_block_stop', index: 0 };
                            }

                            const usage = finalUsage || chunk.usage || {};
                            yield {
                                type: 'message_delta',
                                delta: { stop_reason: mapStopReason(finishReason) },
                                usage: { output_tokens: usage.completion_tokens || 0 }
                            };
                            yield { type: 'message_stop' };
                        }
                    } catch (e) {
                        logger.debug(`[OpenAI] Failed to parse stream chunk: ${e.message}`);
                    }
                }
            }

            // Safety: if stream ended without a finish_reason, close gracefully
            if (started && !buffer.includes('[DONE]')) {
                // Check if we have unclosed blocks
                const needsCleanup = textBlockStarted || thinkingBlockStarted || toolCallIndexMap.size > 0;
                if (needsCleanup) {
                    if (thinkingBlockStarted && !textBlockStarted && toolCallIndexMap.size === 0) {
                        yield { type: 'content_block_stop', index: currentBlockIndex };
                    }
                    if (textBlockStarted && toolCallIndexMap.size === 0) {
                        yield { type: 'content_block_stop', index: textBlockIndex };
                    }
                    for (const [, blockIdx] of toolCallIndexMap) {
                        yield { type: 'content_block_stop', index: blockIdx };
                    }
                    yield {
                        type: 'message_delta',
                        delta: { stop_reason: 'end_turn' },
                        usage: { output_tokens: finalUsage?.completion_tokens || 0 }
                    };
                    yield { type: 'message_stop' };
                }
            }
        },

        /**
         * List available models from the API
         *
         * @param {Object} credentials - { apiKey }
         * @returns {Promise<Array>} Array of model info objects
         */
        async listModels(credentials = {}) {
            const key = credentials.apiKey || apiKey;

            try {
                const requestHeaders = {
                    'User-Agent': 'commons-proxy/2.0.0',
                    ...headers
                };
                if (key) {
                    requestHeaders['Authorization'] = `Bearer ${key}`;
                }

                const response = await fetch(`${baseUrl}/models`, {
                    headers: requestHeaders
                });

                if (!response.ok) {
                    return [];
                }

                const data = await response.json();
                return (data.data || []).map(m => ({
                    id: m.id,
                    name: m.id,
                    family: 'openai'
                }));
            } catch (error) {
                logger.warn(`[OpenAI] Failed to list models: ${error.message}`);
                return [];
            }
        },

        getModelFamilies() {
            return ['openai'];
        },

        supportsModel(modelId) {
            return true; // Accept any model
        }
    };
}

export default createOpenAICompatibleProvider;
