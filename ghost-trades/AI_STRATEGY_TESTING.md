# AI Strategy Testing Guide

## Setup Instructions

1. **Start the server:**
   ```bash
   npm start
   ```
   Server will run at `http://localhost:3000`

2. **Access Ghost Trades:**
   - Navigate to: `http://localhost:3000/ghost-trades`
   - Login with your Deriv account (OAuth or API token)

3. **Navigate to AI Strategy:**
   - Click on "AI Strategy" in the navigation menu
   - Wait for markets to load (you'll see checkboxes populated)

## How It Works

The AI Strategy system:
1. Takes your plain English description
2. Converts it to JavaScript code using Gemini API
3. Runs the code on every market tick
4. Executes trades based on your strategy

## Data Available to Your Strategy

Your generated code receives a `data` object with:
- `data.symbol` - Current market (e.g., 'R_100')
- `data.tick` - Current price
- `data.digits` - Array of last 1000 digits
- `data.lastDigit` - Most recent digit (0-9)

## Available Trading Functions

Use these in your strategy description:
- **CALL / PUT** - Rise/Fall predictions
- **DIGITOVER / DIGITUNDER** - Digit above/below a barrier
- **DIGITMATCH / DIGITDIFF** - Digit matches/differs from barrier
- **DIGITEVEN / DIGITODD** - Even/Odd digit predictions

---

## Test Prompts (Simple → Advanced)

### 1. Basic Even/Odd Strategy
**Prompt:**
```
Buy Even if the last digit is odd, stake 0.35
```

**Expected behavior:** Places DIGITEVEN trades whenever the last digit is 1, 3, 5, 7, or 9

---

### 2. Digit Match Strategy
**Prompt:**
```
Buy Match 5 if last 3 digits are all below 5, stake 1.0
```

**Expected behavior:** Checks if last 3 digits are 0-4, then places DIGITMATCH on barrier 5

---

### 3. Sequence Detection
**Prompt:**
```
Buy Call if last digit is 7 and previous digit was 8, stake 2.0
```

**Expected behavior:** Detects 8→7 sequence and places CALL trade

---

### 4. Percentage-Based Strategy
**Prompt:**
```
Buy Over 5 if more than 60% of last 20 digits are above 5, stake 0.5
```

**Expected behavior:** Analyzes last 20 digits, counts those >5, and trades if >60%

---

### 5. Multi-Condition Strategy
**Prompt:**
```
Buy Odd if last digit is even AND previous 2 digits were also even, stake 1.5
```

**Expected behavior:** Checks for 3 consecutive even digits, then bets on odd

---

### 6. Volatility-Based Entry
**Prompt:**
```
Buy Call if last 5 digits alternate between high and low (above and below 5), stake 1.0
```

**Expected behavior:** Detects alternating pattern and places rise trade

---

### 7. Simple Reversal Strategy
**Prompt:**
```
Buy Put if last 3 digits are all 9, stake 2.0
```

**Expected behavior:** Detects "999" pattern and bets on fall

---

### 8. Conservative Entry
**Prompt:**
```
Buy Under 3 only if last 10 digits average is above 6, stake 0.35
```

**Expected behavior:** Calculates average of last 10 digits, trades if mean > 6

---

## Testing Checklist

- [ ] Server is running at port 3000
- [ ] Ghost Trades app loads successfully
- [ ] Logged in with Deriv account
- [ ] Market checkboxes are populated
- [ ] AI Strategy navigation works
- [ ] Can enter a prompt
- [ ] "Generate Code" button works
- [ ] Generated code appears in editor
- [ ] Can select markets (checkboxes)
- [ ] "Run" button starts execution
- [ ] Logs show activity
- [ ] Trades are placed on Deriv
- [ ] "Stop" button stops execution
- [ ] Martingale multiplier works after losses
- [ ] Manual stake input is respected

---

## Troubleshooting

### No code generated
- Check console for API errors
- Ensure `GEMINI_API_KEY` is set in `.env`
- Check server logs for errors

### Markets not loading
- Ensure WebSocket connection to Deriv is active
- Check browser console for connection errors
- Verify you're logged in

### Trades not executing
- Ensure markets are selected (checkboxes checked)
- Check you have sufficient balance
- Verify stake amount is >= 0.35 USD
- Check Deriv API permissions (need "Trade" scope)

### Code compilation errors
- AI might generate invalid syntax
- Try rephrasing your prompt
- Check logs for specific error messages

---

## Environment Variables Required

```env
# .env file
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
```

Get your Gemini API key from: https://makersuite.google.com/app/apikey

---

## Advanced Tips

1. **Be specific** - "Buy Call if last digit is 7" works better than "Trade when appropriate"
2. **Mention stake** - Always include desired stake amount
3. **Use simple logic** - Complex strategies may fail to compile
4. **Test with small stakes** - Start with 0.35 USD to verify behavior
5. **Watch the logs** - Live logs show what's happening
6. **Use Martingale wisely** - Set conservative multipliers (2.0-2.5)

---

## API Mock Mode

If no `GEMINI_API_KEY` is provided, the API returns a mock strategy:
```javascript
// Buys CALL on even digits
if (data.lastDigit % 2 === 0) {
    signal('CALL', 1.0);
    log('Mock Buy Call (Even digit)');
}
```

This is useful for testing the execution engine without API costs.