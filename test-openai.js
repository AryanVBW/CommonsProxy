
const FETCH_OPTS = {
    headers: { 'Content-Type': 'application/json' }
};

async function testOpenAI() {
    console.log('Testing OpenAI Compatibility...');
    const BASE_URL = 'http://localhost:8080/openai/v1';

    // 1. Test Models
    try {
        console.log('\n--- Testing /models ---');
        const res = await fetch(`${BASE_URL}/models`, FETCH_OPTS);
        const data = await res.json();
        if (data.object === 'list' && Array.isArray(data.data)) {
            console.log('✅ Models list success. Found:', data.data.length, 'models.');
        } else {
            console.log('❌ Models list failed:', data);
        }
    } catch (e) { console.error(e); }

    // 2. Test Non-Streaming Chat
    try {
        console.log('\n--- Testing Chat (Non-Streaming) ---');
        const res = await fetch(`${BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: FETCH_OPTS.headers,
            body: JSON.stringify({
                model: 'gemini-2.0-flash-exp', // Fast model
                messages: [{ role: 'user', content: 'Say "Hello OpenAI" and nothing else.' }]
            })
        });
        
        if (res.ok) {
            const data = await res.json();
            console.log('Response:', JSON.stringify(data, null, 2));
            if (data.choices?.[0]?.message?.content?.includes('Hello')) {
                console.log('✅ Chat success.');
            } else {
                console.log('⚠️ Chat response unexpected content.');
            }
        } else {
            const txt = await res.text();
            console.log('❌ Chat failed:', res.status, txt);
        }
    } catch (e) { 
        console.error('Chat error:', e); 
    }
}

// Ensure server is running before running this test separately
testOpenAI();
