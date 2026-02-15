/**
 * Test Format Converters - Unit Tests
 *
 * Tests the format conversion layer between Anthropic and Google formats:
 * - schema-sanitizer: JSON Schema cleaning for Gemini compatibility
 * - signature-cache: Thinking signature caching with TTL/eviction
 * - response-converter: Google → Anthropic response conversion
 * - content-converter: Anthropic content blocks → Google parts
 * - thinking-utils: Thinking block validation, recovery, reordering
 */

async function runTests() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║             FORMAT CONVERTER TEST SUITE                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // Dynamic imports for ESM modules
    const { sanitizeSchema, cleanSchema } = await import('../src/format/schema-sanitizer.js');
    const {
        cacheSignature,
        getCachedSignature,
        cacheThinkingSignature,
        getCachedSignatureFamily,
        clearThinkingSignatureCache
    } = await import('../src/format/signature-cache.js');
    const { convertGoogleToAnthropic } = await import('../src/format/response-converter.js');
    const { convertRole, convertContentToParts } = await import('../src/format/content-converter.js');
    const {
        cleanCacheControl,
        hasGeminiHistory,
        hasUnsignedThinkingBlocks,
        removeTrailingThinkingBlocks,
        restoreThinkingSignatures,
        reorderAssistantContent,
        needsThinkingRecovery,
        closeToolLoopForThinking
    } = await import('../src/format/thinking-utils.js');

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

    function assertIncludes(str, substring, message = '') {
        if (!str || !str.includes(substring)) {
            throw new Error(`${message}\nExpected "${str}" to include "${substring}"`);
        }
    }

    // Helper: generate a string of given length
    function sig(len) {
        return 'A'.repeat(len);
    }

    // ================================================================
    // sanitizeSchema Tests
    // ================================================================
    console.log('\n─── sanitizeSchema Tests ───');

    test('sanitizeSchema: null input returns placeholder object', () => {
        const result = sanitizeSchema(null);
        assertEqual(result.type, 'object');
        assertNotNull(result.properties);
        assertNotNull(result.properties.reason);
    });

    test('sanitizeSchema: undefined input returns placeholder object', () => {
        const result = sanitizeSchema(undefined);
        assertEqual(result.type, 'object');
    });

    test('sanitizeSchema: empty object gets type and placeholder', () => {
        const result = sanitizeSchema({});
        assertEqual(result.type, 'object');
        assertNotNull(result.properties.reason);
    });

    test('sanitizeSchema: preserves allowed fields', () => {
        const result = sanitizeSchema({
            type: 'object',
            description: 'A test schema',
            properties: { name: { type: 'string', description: 'A name' } },
            required: ['name']
        });
        assertEqual(result.type, 'object');
        assertEqual(result.description, 'A test schema');
        assertDeepEqual(result.required, ['name']);
        assertEqual(result.properties.name.type, 'string');
    });

    test('sanitizeSchema: strips unsupported fields', () => {
        const result = sanitizeSchema({
            type: 'object',
            additionalProperties: false,
            $schema: 'http://json-schema.org/draft-07/schema#',
            default: 'foo',
            examples: ['bar'],
            properties: { x: { type: 'string' } }
        });
        assertEqual(result.additionalProperties, undefined);
        assertEqual(result.$schema, undefined);
        assertEqual(result.default, undefined);
        assertEqual(result.examples, undefined);
    });

    test('sanitizeSchema: converts const to enum', () => {
        const result = sanitizeSchema({
            type: 'string',
            const: 'fixed_value'
        });
        assertDeepEqual(result.enum, ['fixed_value']);
        assertEqual(result.const, undefined);
    });

    test('sanitizeSchema: recursively processes properties', () => {
        const result = sanitizeSchema({
            type: 'object',
            properties: {
                nested: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                        value: { type: 'string', default: 'hello' }
                    }
                }
            }
        });
        // additionalProperties should be stripped from nested
        assertEqual(result.properties.nested.additionalProperties, undefined);
        // default should be stripped from nested.properties.value
        assertEqual(result.properties.nested.properties.value.default, undefined);
    });

    test('sanitizeSchema: processes items in array schema', () => {
        const result = sanitizeSchema({
            type: 'array',
            items: { type: 'string', default: 'test' }
        });
        assertEqual(result.items.type, 'string');
        assertEqual(result.items.default, undefined);
    });

    test('sanitizeSchema: handles deeply nested depth limit', () => {
        // Build a schema 55 levels deep
        let schema = { type: 'string' };
        for (let i = 0; i < 55; i++) {
            schema = { type: 'object', properties: { child: schema } };
        }
        // Should not throw, should truncate at depth 50
        const result = sanitizeSchema(schema);
        assertNotNull(result);
    });

    test('sanitizeSchema: object with no properties gets placeholder', () => {
        const result = sanitizeSchema({ type: 'object' });
        assertNotNull(result.properties);
        assertNotNull(result.properties.reason);
    });

    // ================================================================
    // cleanSchema Tests
    // ================================================================
    console.log('\n─── cleanSchema Tests ───');

    test('cleanSchema: null returns null (passthrough)', () => {
        const result = cleanSchema(null);
        assertNull(result);
    });

    test('cleanSchema: converts type to uppercase', () => {
        const result = cleanSchema({ type: 'string' });
        assertEqual(result.type, 'STRING');
    });

    test('cleanSchema: converts object type to uppercase', () => {
        const result = cleanSchema({
            type: 'object',
            properties: { x: { type: 'string' } }
        });
        assertEqual(result.type, 'OBJECT');
        assertEqual(result.properties.x.type, 'STRING');
    });

    test('cleanSchema: converts array type to uppercase', () => {
        const result = cleanSchema({
            type: 'array',
            items: { type: 'number' }
        });
        assertEqual(result.type, 'ARRAY');
        assertEqual(result.items.type, 'NUMBER');
    });

    test('cleanSchema: handles $ref by converting to hint', () => {
        const result = cleanSchema({
            type: 'object',
            properties: {
                child: { $ref: '#/$defs/Foo' }
            }
        });
        assertEqual(result.properties.child.type, 'OBJECT');
        assertIncludes(result.properties.child.description, 'Foo');
    });

    test('cleanSchema: merges allOf schemas', () => {
        const result = cleanSchema({
            allOf: [
                { type: 'object', properties: { a: { type: 'string' } } },
                { properties: { b: { type: 'number' } } }
            ]
        });
        assertEqual(result.type, 'OBJECT');
        assertNotNull(result.properties.a);
        assertNotNull(result.properties.b);
    });

    test('cleanSchema: flattens anyOf with null', () => {
        const result = cleanSchema({
            anyOf: [
                { type: 'string' },
                { type: 'null' }
            ]
        });
        assertEqual(result.type, 'STRING');
    });

    test('cleanSchema: flattens type array with null', () => {
        const result = cleanSchema({
            type: ['string', 'null']
        });
        assertEqual(result.type, 'STRING');
    });

    test('cleanSchema: adds enum hints to description', () => {
        const result = cleanSchema({
            type: 'string',
            enum: ['red', 'green', 'blue']
        });
        assertIncludes(result.description || '', 'Allowed');
    });

    test('cleanSchema: moves constraints to description', () => {
        const result = cleanSchema({
            type: 'string',
            minLength: 5,
            maxLength: 100,
            pattern: '^[a-z]+$'
        });
        const desc = result.description || '';
        assertIncludes(desc, 'minLength');
        assertEqual(result.minLength, undefined);
        assertEqual(result.maxLength, undefined);
        assertEqual(result.pattern, undefined);
    });

    test('cleanSchema: prunes invalid required entries', () => {
        const result = cleanSchema({
            type: 'object',
            properties: { a: { type: 'string' } },
            required: ['a', 'b', 'c']
        });
        // Only 'a' exists in properties
        assertDeepEqual(result.required, ['a']);
    });

    test('cleanSchema: depth limit returns STRING placeholder', () => {
        let schema = { type: 'string' };
        for (let i = 0; i < 55; i++) {
            schema = { type: 'object', properties: { child: schema } };
        }
        const result = cleanSchema(schema);
        assertNotNull(result);
        // Should not throw
    });

    // ================================================================
    // Signature Cache Tests
    // ================================================================
    console.log('\n─── Signature Cache Tests ───');

    // Clear state before tests
    clearThinkingSignatureCache();

    test('cacheSignature: stores and retrieves signature', () => {
        cacheSignature('tool_123', 'sig_abc');
        assertEqual(getCachedSignature('tool_123'), 'sig_abc');
    });

    test('getCachedSignature: returns null for missing key', () => {
        assertNull(getCachedSignature('nonexistent'));
    });

    test('cacheSignature: null id is a no-op', () => {
        cacheSignature(null, 'sig_abc');
        // Should not throw
    });

    test('cacheSignature: empty id is a no-op', () => {
        cacheSignature('', 'sig_abc');
        assertNull(getCachedSignature(''));
    });

    test('cacheThinkingSignature: stores family for valid signature', () => {
        clearThinkingSignatureCache();
        const longSig = sig(60);
        cacheThinkingSignature(longSig, 'claude');
        assertEqual(getCachedSignatureFamily(longSig), 'claude');
    });

    test('cacheThinkingSignature: rejects short signature', () => {
        clearThinkingSignatureCache();
        const shortSig = sig(49);
        cacheThinkingSignature(shortSig, 'gemini');
        assertNull(getCachedSignatureFamily(shortSig));
    });

    test('cacheThinkingSignature: exactly MIN_SIGNATURE_LENGTH is accepted', () => {
        clearThinkingSignatureCache();
        const exactSig = sig(50);
        cacheThinkingSignature(exactSig, 'gemini');
        assertEqual(getCachedSignatureFamily(exactSig), 'gemini');
    });

    test('getCachedSignatureFamily: returns null for null input', () => {
        assertNull(getCachedSignatureFamily(null));
    });

    test('getCachedSignatureFamily: returns null for undefined input', () => {
        assertNull(getCachedSignatureFamily(undefined));
    });

    test('clearThinkingSignatureCache: clears all entries', () => {
        cacheThinkingSignature(sig(60), 'claude');
        clearThinkingSignatureCache();
        assertNull(getCachedSignatureFamily(sig(60)));
    });

    // ================================================================
    // Response Converter Tests
    // ================================================================
    console.log('\n─── Response Converter Tests ───');

    test('convertGoogleToAnthropic: empty response returns default', () => {
        const result = convertGoogleToAnthropic({}, 'claude-sonnet-4-20250514');
        assertEqual(result.role, 'assistant');
        assertTrue(Array.isArray(result.content));
        assertEqual(result.content[0].type, 'text');
        assertEqual(result.content[0].text, '');
    });

    test('convertGoogleToAnthropic: text response', () => {
        const googleResp = {
            candidates: [{
                content: { parts: [{ text: 'Hello world' }] },
                finishReason: 'STOP'
            }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
        };
        const result = convertGoogleToAnthropic(googleResp, 'claude-sonnet-4-20250514');
        assertEqual(result.content[0].type, 'text');
        assertEqual(result.content[0].text, 'Hello world');
        assertEqual(result.stop_reason, 'end_turn');
        assertEqual(result.usage.input_tokens, 10);
        assertEqual(result.usage.output_tokens, 5);
    });

    test('convertGoogleToAnthropic: unwraps nested response', () => {
        const googleResp = {
            response: {
                candidates: [{
                    content: { parts: [{ text: 'Nested' }] },
                    finishReason: 'STOP'
                }]
            }
        };
        const result = convertGoogleToAnthropic(googleResp, 'claude-sonnet-4-20250514');
        assertEqual(result.content[0].text, 'Nested');
    });

    test('convertGoogleToAnthropic: thinking block', () => {
        const longSig = sig(60);
        const googleResp = {
            candidates: [{
                content: {
                    parts: [
                        { text: 'Let me think...', thought: true, thoughtSignature: longSig },
                        { text: 'The answer is 42' }
                    ]
                },
                finishReason: 'STOP'
            }]
        };
        const result = convertGoogleToAnthropic(googleResp, 'claude-sonnet-4-20250514');
        assertEqual(result.content[0].type, 'thinking');
        assertEqual(result.content[0].thinking, 'Let me think...');
        assertEqual(result.content[1].type, 'text');
        assertEqual(result.content[1].text, 'The answer is 42');
    });

    test('convertGoogleToAnthropic: tool_use with finishReason STOP gives tool_use stop_reason', () => {
        const googleResp = {
            candidates: [{
                content: {
                    parts: [{
                        functionCall: {
                            name: 'search',
                            args: { query: 'hello' }
                        }
                    }]
                },
                finishReason: 'STOP'
            }]
        };
        const result = convertGoogleToAnthropic(googleResp, 'claude-sonnet-4-20250514');
        assertEqual(result.stop_reason, 'tool_use');
        assertEqual(result.content[0].type, 'tool_use');
        assertEqual(result.content[0].name, 'search');
        assertDeepEqual(result.content[0].input, { query: 'hello' });
    });

    test('convertGoogleToAnthropic: MAX_TOKENS finish reason', () => {
        const googleResp = {
            candidates: [{
                content: { parts: [{ text: 'truncated' }] },
                finishReason: 'MAX_TOKENS'
            }]
        };
        const result = convertGoogleToAnthropic(googleResp, 'claude-sonnet-4-20250514');
        assertEqual(result.stop_reason, 'max_tokens');
    });

    test('convertGoogleToAnthropic: cachedContentTokenCount subtracted', () => {
        const googleResp = {
            candidates: [{
                content: { parts: [{ text: 'Hi' }] },
                finishReason: 'STOP'
            }],
            usageMetadata: {
                promptTokenCount: 100,
                candidatesTokenCount: 10,
                cachedContentTokenCount: 30
            }
        };
        const result = convertGoogleToAnthropic(googleResp, 'claude-sonnet-4-20250514');
        assertEqual(result.usage.input_tokens, 70);
        assertEqual(result.usage.cache_read_input_tokens, 30);
    });

    test('convertGoogleToAnthropic: functionCall with no args defaults to {}', () => {
        const googleResp = {
            candidates: [{
                content: {
                    parts: [{ functionCall: { name: 'noop' } }]
                },
                finishReason: 'STOP'
            }]
        };
        const result = convertGoogleToAnthropic(googleResp, 'claude-sonnet-4-20250514');
        assertDeepEqual(result.content[0].input, {});
    });

    test('convertGoogleToAnthropic: generates toolu_ id when not provided', () => {
        const googleResp = {
            candidates: [{
                content: {
                    parts: [{ functionCall: { name: 'test', args: {} } }]
                },
                finishReason: 'STOP'
            }]
        };
        const result = convertGoogleToAnthropic(googleResp, 'claude-sonnet-4-20250514');
        assertTrue(result.content[0].id.startsWith('toolu_'));
    });

    test('convertGoogleToAnthropic: uses functionCall.id when provided', () => {
        const googleResp = {
            candidates: [{
                content: {
                    parts: [{ functionCall: { id: 'my_id', name: 'test', args: {} } }]
                },
                finishReason: 'STOP'
            }]
        };
        const result = convertGoogleToAnthropic(googleResp, 'claude-sonnet-4-20250514');
        assertEqual(result.content[0].id, 'my_id');
    });

    test('convertGoogleToAnthropic: model field is set', () => {
        const googleResp = {
            candidates: [{
                content: { parts: [{ text: 'hi' }] },
                finishReason: 'STOP'
            }]
        };
        const result = convertGoogleToAnthropic(googleResp, 'claude-sonnet-4-20250514');
        assertEqual(result.model, 'claude-sonnet-4-20250514');
    });

    // ================================================================
    // Content Converter Tests
    // ================================================================
    console.log('\n─── Content Converter Tests ───');

    test('convertRole: assistant -> model', () => {
        assertEqual(convertRole('assistant'), 'model');
    });

    test('convertRole: user -> user', () => {
        assertEqual(convertRole('user'), 'user');
    });

    test('convertRole: unknown -> user', () => {
        assertEqual(convertRole('system'), 'user');
    });

    test('convertContentToParts: string content', () => {
        const parts = convertContentToParts('Hello', true, false);
        assertEqual(parts.length, 1);
        assertEqual(parts[0].text, 'Hello');
    });

    test('convertContentToParts: non-array non-string content', () => {
        const parts = convertContentToParts(123, true, false);
        assertEqual(parts.length, 1);
        assertEqual(parts[0].text, '123');
    });

    test('convertContentToParts: text block', () => {
        const parts = convertContentToParts([
            { type: 'text', text: 'Hello world' }
        ], true, false);
        assertEqual(parts.length, 1);
        assertEqual(parts[0].text, 'Hello world');
    });

    test('convertContentToParts: empty text blocks are skipped', () => {
        const parts = convertContentToParts([
            { type: 'text', text: '' },
            { type: 'text', text: '   ' },
            { type: 'text', text: 'actual text' }
        ], true, false);
        assertEqual(parts.length, 1);
        assertEqual(parts[0].text, 'actual text');
    });

    test('convertContentToParts: null blocks are skipped', () => {
        const parts = convertContentToParts([null, { type: 'text', text: 'ok' }], true, false);
        assertEqual(parts.length, 1);
    });

    test('convertContentToParts: image with base64 source', () => {
        const parts = convertContentToParts([{
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'abc123' }
        }], true, false);
        assertEqual(parts.length, 1);
        assertEqual(parts[0].inlineData.mimeType, 'image/png');
        assertEqual(parts[0].inlineData.data, 'abc123');
    });

    test('convertContentToParts: image with url source', () => {
        const parts = convertContentToParts([{
            type: 'image',
            source: { type: 'url', url: 'https://example.com/img.png', media_type: 'image/png' }
        }], true, false);
        assertEqual(parts.length, 1);
        assertEqual(parts[0].fileData.fileUri, 'https://example.com/img.png');
    });

    test('convertContentToParts: tool_use for Claude model includes id', () => {
        const parts = convertContentToParts([{
            type: 'tool_use',
            id: 'toolu_123',
            name: 'search',
            input: { q: 'test' }
        }], true, false);
        assertEqual(parts.length, 1);
        assertEqual(parts[0].functionCall.name, 'search');
        assertEqual(parts[0].functionCall.id, 'toolu_123');
    });

    test('convertContentToParts: tool_result for Claude includes id', () => {
        const parts = convertContentToParts([{
            type: 'tool_result',
            tool_use_id: 'toolu_123',
            content: 'Result text'
        }], true, false);
        assertEqual(parts[0].functionResponse.name, 'toolu_123');
        assertEqual(parts[0].functionResponse.id, 'toolu_123');
    });

    test('convertContentToParts: tool_result with array content', () => {
        const parts = convertContentToParts([{
            type: 'tool_result',
            tool_use_id: 'toolu_456',
            content: [
                { type: 'text', text: 'Line 1' },
                { type: 'text', text: 'Line 2' }
            ]
        }], true, false);
        assertIncludes(parts[0].functionResponse.response.result, 'Line 1');
        assertIncludes(parts[0].functionResponse.response.result, 'Line 2');
    });

    test('convertContentToParts: tool_result with images defers inline data', () => {
        const parts = convertContentToParts([{
            type: 'tool_result',
            tool_use_id: 'toolu_789',
            content: [
                { type: 'text', text: 'Result' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } }
            ]
        }], true, false);
        // Function response should come first, then deferred inline data
        assertTrue(parts.length >= 2);
        assertNotNull(parts[0].functionResponse);
        // Last element should be the deferred image
        assertNotNull(parts[parts.length - 1].inlineData);
    });

    test('convertContentToParts: thinking block with valid signature for Claude', () => {
        const longSig = sig(60);
        const parts = convertContentToParts([{
            type: 'thinking',
            thinking: 'Deep thoughts',
            signature: longSig
        }], true, false);
        assertTrue(parts.length >= 1);
        // For Claude, should include the thinking part
        const thinkingPart = parts.find(p => p.thought === true);
        assertNotNull(thinkingPart);
        assertEqual(thinkingPart.text, 'Deep thoughts');
    });

    test('convertContentToParts: thinking block with short signature is dropped', () => {
        const parts = convertContentToParts([{
            type: 'thinking',
            thinking: 'Brief thought',
            signature: sig(10)
        }], true, false);
        // Short signature thinking should be dropped
        assertEqual(parts.length, 0);
    });

    // ================================================================
    // Thinking Utils Tests
    // ================================================================
    console.log('\n─── cleanCacheControl Tests ───');

    test('cleanCacheControl: returns non-array as-is', () => {
        const result = cleanCacheControl('not an array');
        assertEqual(result, 'not an array');
    });

    test('cleanCacheControl: strips cache_control from content blocks', () => {
        const messages = [{
            role: 'user',
            content: [
                { type: 'text', text: 'Hello', cache_control: { type: 'ephemeral' } }
            ]
        }];
        const result = cleanCacheControl(messages);
        assertEqual(result[0].content[0].cache_control, undefined);
        assertEqual(result[0].content[0].text, 'Hello');
    });

    test('cleanCacheControl: leaves string content untouched', () => {
        const messages = [{ role: 'user', content: 'plain string' }];
        const result = cleanCacheControl(messages);
        assertEqual(result[0].content, 'plain string');
    });

    test('cleanCacheControl: handles mixed blocks', () => {
        const messages = [{
            role: 'user',
            content: [
                { type: 'text', text: 'A', cache_control: { type: 'ephemeral' } },
                { type: 'text', text: 'B' }
            ]
        }];
        const result = cleanCacheControl(messages);
        assertEqual(result[0].content[0].cache_control, undefined);
        assertEqual(result[0].content[1].text, 'B');
    });

    console.log('\n─── hasGeminiHistory Tests ───');

    test('hasGeminiHistory: returns false for empty messages', () => {
        assertFalse(hasGeminiHistory([]));
    });

    test('hasGeminiHistory: returns true when tool_use has thoughtSignature', () => {
        const messages = [{
            role: 'assistant',
            content: [{
                type: 'tool_use',
                id: 'toolu_1',
                name: 'search',
                input: {},
                thoughtSignature: sig(60)
            }]
        }];
        assertTrue(hasGeminiHistory(messages));
    });

    test('hasGeminiHistory: returns false without thoughtSignature', () => {
        const messages = [{
            role: 'assistant',
            content: [{
                type: 'tool_use',
                id: 'toolu_1',
                name: 'search',
                input: {}
            }]
        }];
        assertFalse(hasGeminiHistory(messages));
    });

    console.log('\n─── hasUnsignedThinkingBlocks Tests ───');

    test('hasUnsignedThinkingBlocks: false for empty messages', () => {
        assertFalse(hasUnsignedThinkingBlocks([]));
    });

    test('hasUnsignedThinkingBlocks: true for assistant with unsigned thinking', () => {
        const messages = [{
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'hmm' }]
        }];
        assertTrue(hasUnsignedThinkingBlocks(messages));
    });

    test('hasUnsignedThinkingBlocks: false when all thinking is signed', () => {
        const messages = [{
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'hmm', signature: sig(60) }]
        }];
        assertFalse(hasUnsignedThinkingBlocks(messages));
    });

    test('hasUnsignedThinkingBlocks: ignores user messages', () => {
        const messages = [{
            role: 'user',
            content: [{ type: 'thinking', thinking: 'hmm' }]
        }];
        assertFalse(hasUnsignedThinkingBlocks(messages));
    });

    console.log('\n─── removeTrailingThinkingBlocks Tests ───');

    test('removeTrailingThinkingBlocks: non-array returns as-is', () => {
        assertEqual(removeTrailingThinkingBlocks('text'), 'text');
    });

    test('removeTrailingThinkingBlocks: empty array returns empty', () => {
        assertDeepEqual(removeTrailingThinkingBlocks([]), []);
    });

    test('removeTrailingThinkingBlocks: removes trailing unsigned thinking', () => {
        const content = [
            { type: 'text', text: 'Hello' },
            { type: 'thinking', thinking: 'hmm' },
            { type: 'thinking', thinking: 'more thoughts' }
        ];
        const result = removeTrailingThinkingBlocks(content);
        assertEqual(result.length, 1);
        assertEqual(result[0].text, 'Hello');
    });

    test('removeTrailingThinkingBlocks: keeps trailing signed thinking', () => {
        const content = [
            { type: 'text', text: 'Hello' },
            { type: 'thinking', thinking: 'hmm', signature: sig(60) }
        ];
        const result = removeTrailingThinkingBlocks(content);
        assertEqual(result.length, 2);
    });

    console.log('\n─── restoreThinkingSignatures Tests ───');

    test('restoreThinkingSignatures: non-array returns as-is', () => {
        assertEqual(restoreThinkingSignatures('text'), 'text');
    });

    test('restoreThinkingSignatures: keeps signed thinking', () => {
        const content = [
            { type: 'thinking', thinking: 'deep', signature: sig(60) },
            { type: 'text', text: 'Hi' }
        ];
        const result = restoreThinkingSignatures(content);
        assertEqual(result.length, 2);
        assertEqual(result[0].type, 'thinking');
    });

    test('restoreThinkingSignatures: drops unsigned thinking', () => {
        const content = [
            { type: 'thinking', thinking: 'shallow' },
            { type: 'text', text: 'Hi' }
        ];
        const result = restoreThinkingSignatures(content);
        assertEqual(result.length, 1);
        assertEqual(result[0].type, 'text');
    });

    console.log('\n─── reorderAssistantContent Tests ───');

    test('reorderAssistantContent: non-array returns as-is', () => {
        assertEqual(reorderAssistantContent('text'), 'text');
    });

    test('reorderAssistantContent: reorders thinking -> text -> tool_use', () => {
        const content = [
            { type: 'tool_use', id: 't1', name: 'search', input: {} },
            { type: 'text', text: 'Hello' },
            { type: 'thinking', thinking: 'hmm', signature: sig(60) }
        ];
        const result = reorderAssistantContent(content);
        assertEqual(result[0].type, 'thinking');
        assertEqual(result[1].type, 'text');
        assertEqual(result[2].type, 'tool_use');
    });

    test('reorderAssistantContent: drops empty text blocks', () => {
        const content = [
            { type: 'text', text: '' },
            { type: 'text', text: 'Hello' }
        ];
        const result = reorderAssistantContent(content);
        assertEqual(result.length, 1);
        assertEqual(result[0].text, 'Hello');
    });

    console.log('\n─── needsThinkingRecovery Tests ───');

    test('needsThinkingRecovery: false for empty messages', () => {
        assertFalse(needsThinkingRecovery([]));
    });

    test('needsThinkingRecovery: true for tool loop without valid thinking', () => {
        const messages = [
            { role: 'user', content: 'Do something' },
            { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'search', input: {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result' }] },
            { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'search', input: {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'result2' }] }
        ];
        assertTrue(needsThinkingRecovery(messages));
    });

    test('needsThinkingRecovery: false for normal conversation', () => {
        const messages = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }
        ];
        assertFalse(needsThinkingRecovery(messages));
    });

    console.log('\n─── closeToolLoopForThinking Tests ───');

    test('closeToolLoopForThinking: returns unchanged for normal conversation', () => {
        const messages = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] }
        ];
        const result = closeToolLoopForThinking(messages, 'claude');
        assertEqual(result.length, 2);
    });

    test('closeToolLoopForThinking: closes tool loop with synthetic messages', () => {
        const messages = [
            { role: 'user', content: 'Do something' },
            { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'search', input: {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result' }] },
            { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'search', input: {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'result2' }] }
        ];
        const result = closeToolLoopForThinking(messages, 'claude');
        // Should have injected synthetic messages at the end
        assertTrue(result.length > messages.length);
        // Last messages should include the synthetic assistant + user messages
        const lastUser = result[result.length - 1];
        assertEqual(lastUser.role, 'user');
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
