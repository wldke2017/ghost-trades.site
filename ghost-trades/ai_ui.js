// ===================================
// AI STRATEGY UI CONTROLLER
// ===================================

const AI_API_ENDPOINT = '/api/ai/generate';

// UI Elements
let aiPromptInput, aiGenerateBtn, aiCodeEditor, aiRunBtn, aiStopBtn, aiLogContainer, aiStatusIndicator;

document.addEventListener('DOMContentLoaded', () => {
    initializeAIUI();
});

function initializeAIUI() {
    aiPromptInput = document.getElementById('ai-prompt-input');
    aiGenerateBtn = document.getElementById('ai-generate-btn');
    aiCodeEditor = document.getElementById('ai-code-editor');
    aiRunBtn = document.getElementById('ai-run-btn');
    aiStopBtn = document.getElementById('ai-stop-btn');
    aiLogContainer = document.getElementById('ai-log-container');
    aiStatusIndicator = document.getElementById('ai-status-indicator');

    if (!aiGenerateBtn) return; // UI might not be loaded yet

    // Event Listeners
    aiGenerateBtn.addEventListener('click', handleGenerateStrategy);
    aiRunBtn.addEventListener('click', handleRunStrategy);
    aiStopBtn.addEventListener('click', handleStopStrategy);

    // Initial State
    updateAIStatus('IDLE');
}

async function handleGenerateStrategy() {
    const prompt = aiPromptInput.value.trim();
    if (!prompt) {
        showToast('Please enter a strategy description.', 'error');
        return;
    }

    updateAIStatus('GENERATING');
    aiGenerateBtn.disabled = true;
    aiGenerateBtn.textContent = 'Generating...';

    try {
        // Get token from storage similar to auth.js/app.js
        const token = localStorage.getItem('authToken');

        const response = await fetch('/api/ai/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ prompt })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Generation failed');
        }

        aiCodeEditor.value = data.code;
        showToast('Strategy generated successfully!', 'success');
        updateAIStatus('READY');

        // Auto-compile to check for errors immediately
        if (window.aiStrategyRunner) {
            window.aiStrategyRunner.compile(data.code);
        }

    } catch (error) {
        console.error('AI Generation Error:', error);
        showToast(error.message, 'error');
        updateAIStatus('ERROR');
        // Add log entry
        if (window.aiStrategyRunner) window.aiStrategyRunner.log(error.message, 'error');
    } finally {
        aiGenerateBtn.disabled = false;
        aiGenerateBtn.textContent = 'Generate Code';
    }
}

function handleRunStrategy() {
    const code = aiCodeEditor.value.trim();
    if (!code) {
        showToast('No code to run.', 'error');
        return;
    }

    if (!window.aiStrategyRunner) {
        showToast('AI Engine not initialized.', 'error');
        return;
    }

    const compiled = window.aiStrategyRunner.compile(code);
    if (compiled) {
        const started = window.aiStrategyRunner.start();
        if (started) {
            updateAIStatus('RUNNING');
            updateAIButtons(true);
        }
    } else {
        showToast('Compilation Failed. Check logs.', 'error');
    }
}

function handleStopStrategy() {
    if (window.aiStrategyRunner) {
        window.aiStrategyRunner.stop();
        updateAIStatus('STOPPED');
        updateAIButtons(false);
    }
}

function updateAIStatus(status) {
    if (!aiStatusIndicator) return;

    // Status can be IDLE, GENERATING, READY, RUNNING, STOPPED, ERROR
    let text = status;
    let color = '#888';

    switch (status) {
        case 'IDLE': color = '#888'; break;
        case 'GENERATING': color = '#f39c12'; break; // Orange
        case 'READY': color = '#3498db'; break; // Blue
        case 'RUNNING': color = '#2ecc71'; break; // Green
        case 'STOPPED': color = '#e74c3c'; break; // Red
        case 'ERROR': color = '#c0392b'; break; // Dark Red
    }

    aiStatusIndicator.textContent = text;
    aiStatusIndicator.style.color = color;
    aiStatusIndicator.style.borderColor = color;
}

function updateAIButtons(isRunning) {
    aiRunBtn.style.display = isRunning ? 'none' : 'inline-block';
    aiStopBtn.style.display = isRunning ? 'inline-block' : 'none';
}

// Global hooks for Engine
window.updateAILogs = function (logEntry) {
    if (!aiLogContainer) return;

    const div = document.createElement('div');
    div.className = `log-entry log-${logEntry.type}`;
    div.textContent = `[${logEntry.time}] ${logEntry.message}`;

    aiLogContainer.insertBefore(div, aiLogContainer.firstChild);

    // Keep max 50 logs in UI
    if (aiLogContainer.children.length > 50) {
        aiLogContainer.removeChild(aiLogContainer.lastChild);
    }
};

// Global hook for Trade Execution (Interfaces with trading.js)
window.executeAIStratTrade = function (type, stake, symbol) {
    // Validate inputs
    if (!type || !stake || !symbol) {
        console.error('Invalid trade parameters', { type, stake, symbol });
        return;
    }

    // Default parameters for AI trades
    const duration = 1;
    const duration_unit = 't';

    const purchaseRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": type, // 'CALL' or 'PUT'
            "currency": "USD",
            "duration": duration,
            "duration_unit": duration_unit,
            "symbol": symbol,
        },
        "passthrough": {
            "purpose": "ai_strategy_trade",
            "timestamp": Date.now()
        }
    };

    if (typeof sendAPIRequest === 'function') {
        // Log intent
        if (window.aiStrategyRunner) {
            window.aiStrategyRunner.log(`Placing trade: ${type} ${symbol} $${stake} (${duration}${duration_unit})`, 'info');
        }

        sendAPIRequest(purchaseRequest).catch(error => {
            console.error('AI Trade Error:', error);
            if (window.aiStrategyRunner) {
                window.aiStrategyRunner.log(`Trade API Error: ${error.message || error}`, 'error');
            }
        });
    } else {
        console.error('sendAPIRequest not found! Cannot execute trade.');
        if (window.aiStrategyRunner) {
            window.aiStrategyRunner.log('System Error: sendAPIRequest function missing', 'error');
        }
    }
};
