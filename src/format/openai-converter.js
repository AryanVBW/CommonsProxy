/**
 * OpenAI Converter Module
 * Converts between OpenAI Chat Completion API format and Anthropic Messages API format
 */

import { logger } from '../utils/logger.js';

/**
 * Convert OpenAI request to Anthropic format
 * @param {Object} openAIRequest - The OpenAI-formatted request
 * @returns {Object} existing Anthropic-formatted request ready for sendMessage
 */
export function convertOpenAIToAnthropic(openAIRequest) {
    const messages = [];
    let system = undefined;

    // 1. Process messages
    for (const msg of (openAIRequest.messages || [])) {
        if (msg.role === 'system') {
            // Anthropic supports top-level system parameter
            // Only take the first system message or concatenate if multiple? 
            // Standard practice: concatenated system prompt or just first. 
            // We'll concatenate if multiple, or set if first.
            if (system) {
                system += '\n' + msg.content;
            } else {
                system = msg.content;
            }
        } else if (msg.role === 'user' || msg.role === 'assistant') {
            // Direct mapping
            messages.push({
                role: msg.role,
                content: msg.content
            });
        } else if (msg.role === 'tool') {
            // OpenAI "tool" role -> Anthropic "user" role with tool_result content block
            // Anthropic expects tool results in user messages
            messages.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: msg.tool_call_id,
                        content: msg.content,
                        is_error: false // OpenAI doesn't explicitly flag errors in message struct usually
                    }
                ]
            });
        }
    }

    // 2. Process tools
    let tools = undefined;
    if (openAIRequest.tools && openAIRequest.tools.length > 0) {
        tools = openAIRequest.tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters
        }));
    }

    // 3. Construct Anthropic request
    const anthropicRequest = {
        model: openAIRequest.model, // Pass through model name (client handles mapping if needed)
        messages: messages,
        max_tokens: openAIRequest.max_tokens || openAIRequest.max_completion_tokens || 4096,
        system: system,
        tools: tools,
        stream: openAIRequest.stream || false,
        temperature: openAIRequest.temperature,
        top_p: openAIRequest.top_p
    };

    // Remove undefined keys
    Object.keys(anthropicRequest).forEach(key => 
        anthropicRequest[key] === undefined && delete anthropicRequest[key]
    );

    return anthropicRequest;
}

/**
 * Convert Anthropic response to OpenAI Chat Completion format
 * @param {Object} anthropicResponse - The Anthropic-formatted response
 * @param {Object} originalOpenAIRequest - Original request for echoing parameters
 * @returns {Object} OpenAI-formatted response
 */
export function convertAnthropicToOpenAI(anthropicResponse, originalOpenAIRequest) {
    const timestamp = Math.floor(Date.now() / 1000);
    const model = anthropicResponse.model || originalOpenAIRequest.model;
    
    // Extract content and tool calls from Anthropic response
    let content = null;
    let toolCalls = undefined;
    
    for (const block of anthropicResponse.content || []) {
        if (block.type === 'text') {
            content = (content || '') + block.text;
        } else if (block.type === 'tool_use') {
            if (!toolCalls) toolCalls = [];
            toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input)
                }
            });
        }
    }

    // Map finish reason
    let finishReason = 'stop';
    if (anthropicResponse.stop_reason === 'tool_use') finishReason = 'tool_calls';
    else if (anthropicResponse.stop_reason === 'max_tokens') finishReason = 'length';
    
    return {
        id: 'chatcmpl-' + (anthropicResponse.id || Math.random().toString(36).substr(2, 9)),
        object: 'chat.completion',
        created: timestamp,
        model: model,
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: content,
                    tool_calls: toolCalls
                },
                finish_reason: finishReason
            }
        ],
        usage: {
            prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
            completion_tokens: anthropicResponse.usage?.output_tokens || 0,
            total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0)
        }
    };
}

/**
 * Convert Anthropic SSE event to OpenAI SSE event format
 * @param {Object} anthropicEvent - The Anthropic SSE event
 * @param {string} id - Stable ID for the stream
 * @param {string} model - Model name
 * @returns {Object|null} OpenAI SSE data object or null if should be skipped
 */
export function convertAnthropicStreamToOpenAI(anthropicEvent, id, model) {
    const base = {
        id: id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
            {
                index: 0,
                delta: {},
                finish_reason: null
            }
        ]
    };

    switch (anthropicEvent.type) {
        case 'message_start':
            // Initial message start, role assignment
            base.choices[0].delta = { role: 'assistant' };
            return base;

        case 'content_block_start':
            // Start of a block (text or tool_use)
            if (anthropicEvent.content_block.type === 'tool_use') {
                base.choices[0].delta = {
                    tool_calls: [{
                        index: 0, // Simplified: assuming 1 active tool call at a time for stream?
                                  // Anthropic can output multiple, but usually sequential. 
                                  // OpenAI streams index. We'll stick to index 0 for now or track indices if needed.
                        id: anthropicEvent.content_block.id,
                        type: 'function',
                        function: {
                            name: anthropicEvent.content_block.name,
                            arguments: ''
                        }
                    }]
                };
                return base;
            } else if (anthropicEvent.content_block.type === 'text') {
                // Usually text content comes in deltas, but if start has text?
                if (anthropicEvent.content_block.text) {
                    base.choices[0].delta = { content: anthropicEvent.content_block.text };
                    return base;
                }
            }
            return null;

        case 'content_block_delta':
            if (anthropicEvent.delta.type === 'text_delta') {
                base.choices[0].delta = { content: anthropicEvent.delta.text };
                return base;
            } else if (anthropicEvent.delta.type === 'input_json_delta') {
                base.choices[0].delta = {
                    tool_calls: [{
                        index: 0,
                        function: {
                            arguments: anthropicEvent.delta.partial_json
                        }
                    }]
                };
                return base;
            }
            return null;

        case 'message_delta':
            // Stop reason usually comes here
            if (anthropicEvent.delta.stop_reason) {
                 let finishReason = 'stop';
                 if (anthropicEvent.delta.stop_reason === 'tool_use') finishReason = 'tool_calls';
                 else if (anthropicEvent.delta.stop_reason === 'max_tokens') finishReason = 'length';
                 
                 base.choices[0].delta = {}; // Empty delta on finish
                 base.choices[0].finish_reason = finishReason;
                 return base;
            }
            return null;

        case 'message_stop':
            // Stream end
            return null; // 'DONE' handled by server loop logic usually

        case 'ping':
            return null;

        default:
            return null;
    }
}
