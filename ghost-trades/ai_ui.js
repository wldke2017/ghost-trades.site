// ===================================
// AI STRATEGY UI CONTROLLER
// ===================================

const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const isWrongPort = window.location.port === '5500' || window.location.port === '5501';
const AI_API_ENDPOINT = (isLocalDev && isWrongPort)
    ? 'http://localhost:3000/api/ai/generate'
    : '/api/ai/generate';

// UI Elements
let aiPromptInput, aiGenerateBtn, aiCodeEditor, aiRunBtn, aiStopBtn, aiLogContainer, aiStatusIndicator;
let aiMarketCheckboxes, aiSelectAllBtn, aiClearMarketsBtn; // New Elements

document.addEventListener('DOMContentLoaded', () => {
    initializeAIUI();
});

function initializeAIUI() {
    // Get all DOM elements
    aiPromptInput = document.getElementById('ai-prompt-input');
    aiGenerateBtn = document.getElementById('ai-generate-btn');
    aiCodeEditor = document.getElementById('ai-code-editor');
    aiRunBtn = document.getElementById('ai-run-btn');
    aiStopBtn = document.getElementById('ai-stop-btn');
    aiLogContainer = document.getElementById('ai-log-container');
    aiStatusIndicator = document.getElementById('ai-status-indicator');

    // Market Selector Elements
    aiMarketCheckboxes = document.getElementById('ai-market-checkboxes');
    aiSelectAllBtn = document.getElementById('ai-select-all-markets');
    aiClearMarketsBtn = document.getElementById('ai-clear-markets');

    // Log initialization status
    console.log('🤖 AI Strategy UI Initialization:', {
        promptInput: !!aiPromptInput,
        generateBtn: !!aiGenerateBtn,
        codeEditor: !!aiCodeEditor,
        runBtn: !!aiRunBtn,
        stopBtn: !!aiStopBtn,
        logContainer: !!aiLogContainer,
        statusIndicator: !!aiStatusIndicator,
        marketCheckboxes: !!aiMarketCheckboxes,
        selectAllBtn: !!aiSelectAllBtn,
        clearMarketsBtn: !!aiClearMarketsBtn
    });

    // Add Event Listeners (with null checks)
    if (aiGenerateBtn) {
        aiGenerateBtn.addEventListener('click', handleGenerateStrategy);
    } else {
        console.warn('⚠️ AI Generate Button not found - AI Strategy UI may not be fully loaded');
    }

    if (aiRunBtn) {
        aiRunBtn.addEventListener('click', handleRunStrategy);
    }

    if (aiStopBtn) {
        aiStopBtn.addEventListener('click', handleStopStrategy);
    }

    if (aiSelectAllBtn) {
        aiSelectAllBtn.addEventListener('click', () => toggleAllMarkets(true));
    }

    if (aiClearMarketsBtn) {
        aiClearMarketsBtn.addEventListener('click', () => toggleAllMarkets(false));
    }

    // Set Initial State
    updateAIStatus('IDLE');

    // RACE CONDITION FIX: If markets already loaded in app.js, populate them now
    if (window.activeSymbols && window.activeSymbols.length > 0) {
        console.log('🔄 AI UI: Active symbols already available, populating market selector...');
        if (typeof window.updateAIMarketSelector === 'function') {
            window.updateAIMarketSelector(window.activeSymbols);
        }
    } else {
        console.log('⏳ AI UI: Waiting for active symbols to load...');
    }

    console.log('✅ AI Strategy UI Initialized Successfully');
}

// Global function to populate markets (Called from app.js when activeSymbols are ready)
window.updateAIMarketSelector = function (activeSymbols) {
    console.log('🔄 AI UI: updateAIMarketSelector called', { 
        hasContainer: !!aiMarketCheckboxes, 
        symbolCount: activeSymbols ? activeSymbols.length : 0 
    });

    if (!aiMarketCheckboxes) {
        console.error('❌ AI UI: Market checkboxes container not found - retrying initialization...');
        // Retry getting the element
        aiMarketCheckboxes = document.getElementById('ai-market-checkboxes');
        if (!aiMarketCheckboxes) {
            console.error('❌ AI UI: Still cannot find market checkboxes container');
            return;
        }
    }

    console.log(`✅ AI UI: Received ${activeSymbols ? activeSymbols.length : 0} symbols for selector.`);
    console.log('🔍 AI UI: Sample symbol structure:', activeSymbols[0]);

    aiMarketCheckboxes.innerHTML = ''; // Clear existing

    if (!activeSymbols || activeSymbols.length === 0) {
        aiMarketCheckboxes.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem; padding: 5px;">No active symbols loaded.</span>';
        console.warn('⚠️ AI UI: No active symbols available');
        return;
    }

    // Filter for synthetic indices FIRST, then sort
    const syntheticSymbols = activeSymbols.filter(symbol => {
        // Check if it's a synthetic index
        const isSynthetic = symbol.market === 'synthetic_index' || 
                           symbol.submarket === 'random_index' ||
                           symbol.submarket === 'random_daily' ||
                           symbol.market_display_name?.includes('Synthetics');
        
        if (isSynthetic) {
            console.log(`✅ Including ${symbol.symbol} (${symbol.display_name || symbol.symbol})`);
        }
        return isSynthetic;
    });

    console.log(`🔍 AI UI: Filtered ${syntheticSymbols.length} synthetic symbols from ${activeSymbols.length} total`);

    // Sort: Crash/Boom first, then Volatility
    const sortedSymbols = syntheticSymbols.sort((a, b) => {
        const aName = a.display_name || a.symbol;
        const bName = b.display_name || b.symbol;
        
        if (aName.includes('Crash') || aName.includes('Boom')) return -1;
        if (bName.includes('Crash') || bName.includes('Boom')) return 1;
        return aName.localeCompare(bName);
    });

    let count = 0;
    sortedSymbols.forEach(symbol => {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '5px';
        wrapper.style.fontSize = '0.75rem';
        wrapper.style.color = '#cbd5e1';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = symbol.symbol;
        checkbox.id = `ai-chk-${symbol.symbol}`;
        checkbox.checked = false; // Default unchecked

        const label = document.createElement('label');
        label.htmlFor = `ai-chk-${symbol.symbol}`;
        label.textContent = symbol.display_name || symbol.symbol;
        label.style.cursor = 'pointer';

        wrapper.appendChild(checkbox);
        wrapper.appendChild(label);
        aiMarketCheckboxes.appendChild(wrapper);
        count++;
    });

    console.log(`✅ AI UI: Successfully populated ${count} market checkboxes.`);

    if (count === 0) {
        // Show all symbols as fallback if no synthetic found
        console.warn('⚠️ AI UI: No synthetic markets found, showing all symbols');
        activeSymbols.forEach(symbol => {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '5px';
            wrapper.style.fontSize = '0.75rem';
            wrapper.style.color = '#cbd5e1';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = symbol.symbol;
            checkbox.id = `ai-chk-${symbol.symbol}`;

            const label = document.createElement('label');
            label.htmlFor = `ai-chk-${symbol.symbol}`;
            label.textContent = symbol.display_name || symbol.symbol;
            label.style.cursor = 'pointer';

            wrapper.appendChild(checkbox);
            wrapper.appendChild(label);
            aiMarketCheckboxes.appendChild(wrapper);
        });
        console.log(`✅ AI UI: Showing all ${activeSymbols.length} symbols as fallback`);
    }
};

function toggleAllMarkets(check) {
    if (!aiMarketCheckboxes) return;
    const checkboxes = aiMarketCheckboxes.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = check);
}

function getSelectedAIMarkets() {
    if (!aiMarketCheckboxes) return [];
    const checkboxes = aiMarketCheckboxes.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

async function handleGenerateStrategy() {
    const prompt = aiPromptInput.value.trim();
    if (!prompt) {
        showToast('Please enter a strategy description.', 'error');
        return;
    }

    console.log('🤖 AI: Generating strategy for prompt:', prompt.substring(0, 100) + '...');
    updateAIStatus('GENERATING');
    aiGenerateBtn.disabled = true;
    aiGenerateBtn.textContent = 'Generating...';

    try {
        // Get token from storage similar to auth.js/app.js
        const token = localStorage.getItem('deriv_token');
        
        console.log('🔗 AI: Sending request to:', AI_API_ENDPOINT);

        const response = await fetch(AI_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ prompt })
        });

        console.log('📡 AI: Response status:', response.status, response.statusText);

        // Handle non-JSON responses (like 404 HTML from static hosts)
        const contentType = response.headers.get("content-type");
        let data;
        if (contentType && contentType.indexOf("application/json") !== -1) {
            data = await response.json();
            console.log('✅ AI: Received JSON response');
        } else {
            const text = await response.text();
            console.error('❌ AI: Non-JSON response received:', text.substring(0, 500)); // Log first 500 chars
            throw new Error(`Backend Error (${response.status}): The server returned an invalid response. Ensure the Backend API is running and reachable at ${AI_API_ENDPOINT}`);
        }

        if (!response.ok) {
            throw new Error(data.error || `Generation failed with status ${response.status}`);
        }

        if (!data.code) {
            throw new Error('AI response missing code field');
        }

        aiCodeEditor.value = data.code;
        console.log('✅ AI: Strategy code generated successfully');
        showToast('Strategy generated successfully!', 'success');
        updateAIStatus('READY');

        // Auto-compile to check for errors immediately
        if (window.aiStrategyRunner) {
            const compiled = window.aiStrategyRunner.compile(data.code);
            if (compiled) {
                console.log('✅ AI: Strategy compiled successfully');
            } else {
                console.warn('⚠️ AI: Strategy compilation had issues - check logs');
            }
        }

    } catch (error) {
        console.error('❌ AI Generation Error:', error);
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

    // Get Selected Markets
    const selectedMarkets = getSelectedAIMarkets();
    if (selectedMarkets.length === 0) {
        showToast('Please select at least one market to trade.', 'error');
        return;
    }

    const compiled = window.aiStrategyRunner.compile(code);
    if (compiled) {
        // Reset Martingale State
        const stakeInput = document.getElementById('ai-stake-input');
        const baseStake = parseFloat(stakeInput?.value) || 0.35;
        window.aiTradingState.currentStake = baseStake;
        window.aiTradingState.consecutiveLosses = 0;
        window.aiTradingState.totalProfit = 0;

        window.aiStrategyRunner.log(`Starting strategy on ${selectedMarkets.length} market(s). Base Stake: $${baseStake}`, 'info');

        // Start runner with selected markets
        const started = window.aiStrategyRunner.start(selectedMarkets);
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
window.executeAIStratTrade = function (type, stake, symbol, barrier = null) {
    // Validate inputs
    if (!type || !symbol) {
        console.error('Invalid trade parameters', { type, symbol });
        return;
    }

    // --- MANUAL STAKE & MARTINGALE LOGIC ---
    // Ignore the 'stake' from the AI prompt strategy and use manual configuration
    const stakeInput = document.getElementById('ai-stake-input');
    const martingaleInput = document.getElementById('ai-martingale-input');

    let actualStake = 0.35; // Fallback default

    if (stakeInput && martingaleInput) {
        const baseStake = parseFloat(stakeInput.value) || 0.35;
        // Use the tracked current stake from state
        actualStake = window.aiTradingState.currentStake || baseStake;

        // Ensure strictly no less than base stake (safety)
        if (actualStake < baseStake) actualStake = baseStake;
    } else {
        actualStake = parseFloat(stake) || 0.35; // Fallback to prompt stake if inputs missing
    }

    // Round to 2 decimals
    actualStake = Math.round(actualStake * 100) / 100;
    // ---------------------------------------

    // Default parameters for AI trades
    const duration = 1;
    const duration_unit = 't';

    const purchaseRequest = {
        "buy": 1,
        "price": actualStake,
        "parameters": {
            "amount": actualStake,
            "basis": "stake",
            "contract_type": type, // 'CALL', 'PUT', 'DIGITOVER', etc.
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

    // Add barrier if present (for Digit strategies)
    if (barrier !== null && barrier !== undefined) {
        purchaseRequest.parameters.barrier = String(barrier);
    }

    if (typeof sendAPIRequest === 'function') {
        // Log intent
        if (window.aiStrategyRunner) {
            let logMsg = `Placing trade: ${type} ${symbol} $${actualStake} (${duration}${duration_unit})`;
            if (barrier !== null) logMsg += ` [Barrier: ${barrier}]`;
            window.aiStrategyRunner.log(logMsg, 'info');
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

// --- MARTINGALE STATE MANAGEMENT ---
window.aiTradingState = {
    currentStake: 0.35,
    consecutiveLosses: 0,
    totalProfit: 0
};

// Called by app.js when a contract finishes
window.handleAIStrategyResult = function (contract) {
    const profit = parseFloat(contract.profit);
    const stakeInput = document.getElementById('ai-stake-input');
    const martingaleInput = document.getElementById('ai-martingale-input');

    if (!stakeInput || !martingaleInput) return;

    const baseStake = parseFloat(stakeInput.value) || 0.35;
    const martingaleMultiplier = parseFloat(martingaleInput.value) || 2.1;

    window.aiTradingState.totalProfit += profit;

    // Log result to AI console
    if (window.aiStrategyRunner) {
        const resultType = profit > 0 ? 'success' : 'error'; // Green or Red log
        // window.aiStrategyRunner.log(`Trade Result: ${profit > 0 ? 'WIN' : 'LOSS'} (Profit: $${profit.toFixed(2)})`, resultType);
        // The main app likely logs this too, but having it in AI logs is good.
    }

    if (profit > 0) {
        // WIN: Reset stake
        window.aiTradingState.currentStake = baseStake;
        window.aiTradingState.consecutiveLosses = 0;
        if (window.aiStrategyRunner) {
            window.aiStrategyRunner.log(`WIN: +$${profit.toFixed(2)}. Stake reset to $${baseStake}`, 'success');
        }
    } else {
        // LOSS: Martingale
        window.aiTradingState.consecutiveLosses++;
        let nextStake = window.aiTradingState.currentStake * martingaleMultiplier;
        nextStake = Math.round(nextStake * 100) / 100; // Round to 2 decimals
        window.aiTradingState.currentStake = nextStake;

        if (window.aiStrategyRunner) {
            window.aiStrategyRunner.log(`LOSS: $${profit.toFixed(2)}. Martingale x${martingaleMultiplier} -> Next Stake: $${nextStake}`, 'warning');
        }
    }
};

// Reset state when strategy starts
const originalStart = window.AIStrategyRunner ? window.AIStrategyRunner.prototype.start : null;
// Actually better to hook via event listener or just reset in handleRunStrategy
const originalHandleRun = handleRunStrategy;
handleRunStrategy = function () {
    // Reset state on start
    const stakeInput = document.getElementById('ai-stake-input');
    const baseStake = parseFloat(stakeInput?.value) || 0.35;
    window.aiTradingState.currentStake = baseStake;
    window.aiTradingState.consecutiveLosses = 0;
    window.aiTradingState.totalProfit = 0;

    if (window.aiStrategyRunner) window.aiStrategyRunner.log(`Starting with Base Stake: $${baseStake}`, 'info');

    originalHandleRun();
};
