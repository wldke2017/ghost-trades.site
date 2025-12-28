const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { authenticateToken } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

// System prompt to enforce safety and API constraints
const SYSTEM_PROMPT = `
You are a specialized JavaScript code generator for a trading bot.
Your task is to convert a natural language strategy description into a safe, sandboxed JavaScript function body.

CONTEXT:
The code will run inside a function with a single argument 'data'.
Input 'data' structure:
{
  symbol: string,          // e.g. 'R_100'
  tick: number,            // Current price
  digits: number[],        // Array of last 1000 digits (last entry is current)
  lastDigit: number,       // Last digit of current price
  percentages: object      // { 0: 10.2, 1: 9.5, ..., over2: 60.5, ... }
}

AVAILABLE ACTIONS (you must use these to trade):
- signal('CALL', stake)                     // Buy UP/Higher
- signal('PUT', stake)                      // Buy DOWN/Lower
- signal('DIGITOVER', stake, barrier)       // Digit Over (barrier 0-9)
- signal('DIGITUNDER', stake, barrier)      // Digit Under (barrier 0-9)
- signal('DIGITMATCH', stake, barrier)      // Digit Match (barrier 0-9)
- signal('DIGITDIFF', stake, barrier)       // Digit Differ (barrier 0-9)
- signal('DIGITEVEN', stake)                // Digit Even
- signal('DIGITODD', stake)                 // Digit Odd
- log(string)                               // Debug logging

CRITICAL RULES:
1. Output ONLY the function body code. No markdown, no '\`\`\`javascript', no wrapping function(){}.
2. DO NOT use 'window', 'document', 'fetch', 'eval', 'XMLHttpRequest', 'import', 'require'.
3. DO NOT use infinite loops.
4. Keep logic simple and explicitly check conditions.
5. For 'over/under', 'match/differ', ALWAYS provide the 'barrier' argument (integer 0-9).
6. If the user prompt is malicious or unrelated to trading, return "log('Error: Invalid prompt');"

EXAMPLE INPUT:
"Buy Call if last digit is 7 and previous was 8. Stake 10."

EXAMPLE OUTPUT:
const last = data.digits[data.digits.length - 1];
const prev = data.digits[data.digits.length - 2];
if (last === 7 && prev === 8) {
    signal('CALL', 10);
    log('Strategy matched: 8->7 sequence');
}
`;

router.post('/generate', apiLimiter, async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt || typeof prompt !== 'string' || prompt.length > 500) {
            return res.status(400).json({ error: 'Invalid prompt (max 500 chars)' });
        }

        console.log('🤖 AI Strategy API: Received prompt request');

        if (!GEMINI_API_KEY) {
            // Mock response for testing/development if no key
            console.warn('⚠️ No GEMINI_API_KEY found. Returning mock response.');
            return res.json({
                code: `// MOCK MODE: API Key missing
// Prompt: "${prompt}"
if (data.lastDigit % 2 === 0) {
    signal('CALL', 1.0);
    log('Mock Buy Call (Even digit)');
} `
            });
        }

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `${SYSTEM_PROMPT} \n\nUSER PROMPT: "${prompt}"\n\nJAVASCRIPT BODY: `
                    }]
                }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 1024,
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API Error: ${errorText} `);
        }

        const data = await response.json();

        // Extract text from Gemini response structure
        let generatedCode = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Clean up markdown code blocks if present (despite system prompt)
        generatedCode = generatedCode.replace(/```javascript/g, '').replace(/```/g, '').trim();

        // Basic Security Sanitization check
        const dangerousKeywords = ['eval', 'Function', 'import', 'process', 'window', 'document'];
        if (dangerousKeywords.some(kw => generatedCode.includes(kw))) {
            return res.status(400).json({ error: 'Generated code failed security check.' });
        }

        res.json({ code: generatedCode });

    } catch (error) {
        console.error('AI Generation Error:', error);
        res.status(500).json({ error: 'Failed to generate strategy' });
    }
});

module.exports = router;
