// ===================================
// GHOST AI BOT FUNCTIONS
// ===================================

// CRITICAL: Global contract tracking variables (must be accessible from app.js)
// These are used for contract lifecycle management and duplicate prevention
if (typeof window.activeContracts === 'undefined') {
    window.activeContracts = {}; // { contractId: { symbol, strategy: 'S1' or 'S2', stake, startTime } }
}
if (typeof window.activeS1Symbols === 'undefined') {
    window.activeS1Symbols = new Set(); // Track symbols with active S1 trades to prevent duplicates
}
// CRITICAL: Track processed contracts to prevent duplicate history entries
if (typeof window.processedContracts === 'undefined') {
    window.processedContracts = new Set(); // Track contract IDs that have been added to history
}

function addBotLog(message, type = 'info') {
    const logEntry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `<span>[${timestamp}]</span> ${message}`;
    logEntry.className = `log-${type}`;
    botLogContainer.appendChild(logEntry);
    botLogContainer.scrollTop = botLogContainer.scrollHeight;
}

function addBotTradeHistory(contract, profit) {
    const row = botHistoryTableBody.insertRow(0);
    const profitClass = profit >= 0 ? 'price-up' : 'price-down';

    // Get the last digit from the contract price
    const lastDigit = contract.entry_tick_display_value ? parseInt(contract.entry_tick_display_value.slice(-1)) : '?';

    row.insertCell(0).textContent = new Date().toLocaleTimeString();
    row.insertCell(1).innerHTML = `${contract.symbol} - ${contract.barrier <= 4 ? 'Over' : 'Under'} ${contract.barrier}<br><small>Price: ${contract.entry_tick_display_value} (Last digit: ${lastDigit})</small>`;
    row.cells[1].style.fontWeight = 'bold';
    row.insertCell(2).innerHTML = `<span class="${profitClass}">${profit.toFixed(2)}</span>`;
}

function updateProfitLossDisplay() {
    const displayElement = document.getElementById('botProfitLossDisplay');
    if (!displayElement) return;

    const totalPL = botState.totalPL;
    const plString = totalPL.toFixed(2);

    displayElement.textContent = `${totalPL >= 0 ? '+' : ''}$${plString}`;

    displayElement.classList.remove('pl-win', 'pl-loss');
    if (totalPL > 0) {
        displayElement.classList.add('pl-win');
    } else if (totalPL < 0) {
        displayElement.classList.add('pl-loss');
    }
}

/**
 * Cleanup stale contracts that have been active for too long (> 60 seconds)
 * This prevents the bot from getting stuck due to missed contract updates
 */
function cleanupStaleContracts() {
    const now = Date.now();
    const maxAge = 60000; // 60 seconds

    for (const [contractId, info] of Object.entries(activeContracts)) {
        const age = now - info.startTime;
        if (age > maxAge) {
            console.warn(`🧹 Cleaning up stale contract ${contractId} (${age}ms old) for ${info.symbol}`);

            if (info.strategy === 'S1') {
                activeS1Symbols.delete(info.symbol);
            }

            delete activeContracts[contractId];
            clearPendingStake(info.symbol, 'ghost_ai');

            addBotLog(`⚠️ Cleaned up stale contract for ${info.symbol} (was active for ${(age / 1000).toFixed(1)}s)`, 'warning');
        }
    }
}

async function startGhostAiBot() {
    if (isBotRunning) return;
    isBotRunning = true;
    botState.runId = `bot-${Date.now()}`;

    // Increment runs count only when starting a new run
    // Use typeof to check if undefined/null, not falsy check (0 is falsy!)
    if (typeof botState.runsCount === 'undefined' || botState.runsCount === null) {
        botState.runsCount = 0;
    }
    botState.runsCount++;

    // Start bot timer
    botStartTime = Date.now();
    startBotTimer();

    // Clear logs but KEEP trade history (users need to see past trades)
    botLogContainer.innerHTML = '';

    // Clear any stale contracts and locks from previous session
    window.activeContracts = {}; // Reset global contract tracking
    window.activeS1Symbols.clear(); // Reset global S1 symbol tracking
    window.processedContracts.clear(); // Reset processed contracts tracking
    expectedStakes = {}; // Clear expected stakes
    clearAllPendingStakes();

    // Add session start marker in logs
    addBotLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');
    addBotLog(`🔄 New Bot Session Started`, 'info');
    addBotLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');

    // Update button states (if updateGhostAIButtonStates function exists)
    if (typeof updateGhostAIButtonStates === 'function') {
        updateGhostAIButtonStates(true);
    }

    // Load parameters from UI (following XML "Starts" procedure structure)
    const initialStake = parseFloat(botInitialStake.value);
    const targetProfit = parseFloat(botTargetProfit.value);
    const payoutPercentage = parseFloat(botPayoutPercentage.value);
    const stopLoss = parseFloat(botStopLoss.value);
    const maxMartingaleSteps = parseInt(botMaxMartingale.value);

    // Load new configuration parameters
    const analysisDigits = parseInt(document.getElementById('botAnalysisDigits')?.value || 15);
    const s1UseDigitCheck = document.getElementById('botS1UseDigitCheck')?.checked ?? true;
    const s1CheckDigits = parseInt(document.getElementById('botS1CheckDigits')?.value || 4);
    const s1MaxDigit = parseInt(document.getElementById('botS1MaxDigit')?.value || 3);
    const s1UsePercentage = document.getElementById('botS1UsePercentage')?.checked ?? true;
    const s1Prediction = parseInt(document.getElementById('botS1Prediction')?.value || 2);
    const s1Percentage = parseFloat(document.getElementById('botS1Percentage')?.value || 70);
    const s1PercentageOperator = document.getElementById('botS1PercentageOperator')?.value || '>=';
    const s1MaxLosses = parseInt(document.getElementById('botS1MaxLosses')?.value || 1);
    const s2UseDigitCheck = document.getElementById('botS2UseDigitCheck')?.checked ?? true;
    const s2CheckDigits = parseInt(document.getElementById('botS2CheckDigits')?.value || 6);
    const s2MaxDigit = parseInt(document.getElementById('botS2MaxDigit')?.value || 4);
    const s1ContractType = document.getElementById('botS1ContractType')?.value || 'OVER';
    const s1DigitOperator = document.getElementById('botS1DigitOperator')?.value || '<=';
    const s2UsePercentage = document.getElementById('botS2UsePercentage')?.checked ?? true;
    const s2Prediction = parseInt(document.getElementById('botS2Prediction')?.value || 5);
    const s2ContractType = document.getElementById('botS2ContractType')?.value || 'UNDER';
    const s2DigitOperator = document.getElementById('botS2DigitOperator')?.value || '<=';
    const s2Percentage = parseFloat(document.getElementById('botS2Percentage')?.value || 45);
    const s2PercentageOperator = document.getElementById('botS2PercentageOperator')?.value || '>=';

    // Initialize bot state following XML structure
    botState.initialStake = initialStake;
    botState.targetProfit = targetProfit;
    botState.payoutPercentage = payoutPercentage;
    botState.stopLoss = stopLoss;
    botState.maxMartingaleSteps = maxMartingaleSteps;
    botState.analysisDigits = analysisDigits;
    botState.s1UseDigitCheck = s1UseDigitCheck;
    botState.s1CheckDigits = s1CheckDigits;
    botState.s1MaxDigit = s1MaxDigit;
    botState.s1UsePercentage = s1UsePercentage;
    botState.s1Prediction = s1Prediction;
    botState.s1Percentage = s1Percentage;
    botState.s1PercentageOperator = s1PercentageOperator;
    botState.s1ContractType = s1ContractType;
    botState.s1DigitOperator = s1DigitOperator;
    botState.s1MaxLosses = s1MaxLosses;
    botState.s1ConsecutiveLosses = 0; // Track consecutive S1 losses
    botState.s1Blocked = false; // Flag to block S1 after max losses
    botState.s2UseDigitCheck = s2UseDigitCheck;
    botState.s2CheckDigits = s2CheckDigits;
    botState.s2MaxDigit = s2MaxDigit;
    botState.s2UsePercentage = s2UsePercentage;
    botState.s2Prediction = s2Prediction;
    botState.s2ContractType = s2ContractType;
    botState.s2DigitOperator = s2DigitOperator;
    botState.s2Percentage = s2Percentage;
    botState.s2PercentageOperator = s2PercentageOperator;
    botState.currentStake = botState.initialStake;
    botState.totalProfit = 0.0;
    botState.totalLoss = 0.0;
    botState.totalPL = 0.0; // Cumulative P/L
    botState.accumulatedStakesLost = 0.0; // Reset accumulated stake losses
    botState.activeStrategy = 'S1';
    botState.isTrading = false;
    botState.martingaleStepCount = 0;
    botState.activeSymbol = null;
    botState.recoverySymbol = null;
    botState.winCount = 0;
    botState.lossCount = 0;
    botState.winPercentage = 0;
    botState.s1LossSymbol = null;
    botState.totalStake = 0.0;
    botState.totalPayout = 0.0;
    botState.activeS2Count = 0; // Initialize S2 counter
    // Don't reset runsCount - it should persist across runs
    // botState.runsCount is incremented at the start of the function

    updateProfitLossDisplay();
    updateBotStats();

    addBotLog(`🤖 Rammy Auto Strategy Started`);
    addBotLog(`📊 Analyzing last ${analysisDigits} digits + percentages + full distribution across ${Object.keys(marketTickHistory).length} markets`);

    // CRITICAL: Check if we have subscribed markets
    if (Object.keys(marketTickHistory).length === 0) {
        addBotLog(`⚠️ WARNING: No markets subscribed! Please visit the Speedbot section first to subscribe to markets.`, 'warning');
        showToast('No markets subscribed! Visit Speedbot section first.', 'warning');
        return; // Don't proceed without markets
    }

    addBotLog(`💰 Initial Stake: $${botState.initialStake.toFixed(2)} | Target: $${botState.targetProfit.toFixed(2)} | Stop Loss: $${botState.stopLoss.toFixed(2)}`);

    // Build S1 condition string
    let s1Conditions = [];
    if (s1UseDigitCheck) s1Conditions.push(`Last ${s1CheckDigits} ${s1DigitOperator} ${s1MaxDigit}`);
    if (s1UsePercentage) s1Conditions.push(`Over ${s1Prediction}% ${s1PercentageOperator} ${s1Percentage}%`);
    s1Conditions.push(`Most digit >4 & Least digit <4`);
    addBotLog(`📈 S1: ${s1Conditions.join(' & ')} → ${s1ContractType} ${s1Prediction} | Max Losses: ${s1MaxLosses}`);

    // Build S2 condition string
    let s2Conditions = [];
    if (s2UseDigitCheck) s2Conditions.push(`Last ${s2CheckDigits} ${s2DigitOperator} ${s2MaxDigit}`);
    if (s2UsePercentage) s2Conditions.push(`Over ${s2Prediction}% ${s2PercentageOperator} ${s2Percentage}%`);
    s2Conditions.push(`Most digit >4 & Least digit <4`);
    addBotLog(`📉 S2: ${s2Conditions.join(' & ')} → ${s2ContractType} ${s2Prediction}`);

    addBotLog(`⏳ Waiting for valid entry conditions...`);

    // Initialize technical indicators
    updateTechnicalIndicators();

    // Debug: Log current market data
    console.log('Bot started - Current market data:', marketTickHistory);
    console.log('Bot state:', botState);

    // Start periodic cleanup of stale contracts (every 30 seconds)
    if (botLoopInterval) {
        clearInterval(botLoopInterval);
    }
    botLoopInterval = setInterval(() => {
        if (isBotRunning) {
            cleanupStaleContracts();
        }
    }, 30000);
}

async function stopGhostAiBot() {
    if (!isBotRunning) return;
    isBotRunning = false;

    // Stop bot timer
    stopBotTimer();

    // Also clear the toggle interval if running
    if (botLoopInterval) {
        clearInterval(botLoopInterval);
        botLoopInterval = null;
    }

    // Clear all trade locks when stopping
    clearAllPendingStakes();

    // Update button states (if updateGhostAIButtonStates function exists)
    if (typeof updateGhostAIButtonStates === 'function') {
        updateGhostAIButtonStates(false);
    }

    // DON'T clear trade history when bot stops - only clear via the clear button
    // Trade history should persist until manually cleared by user

    addBotLog("🛑 Bot stopped by user.", 'warning');
    botState.runId = null;
    updateProfitLossDisplay();
}

/**
 * Helper function to compare values using operator
 * @param {number} actual - The actual value
 * @param {string} operator - The comparison operator (>, >=, =, <=, <)
 * @param {number} expected - The expected value
 * @returns {boolean} - True if comparison passes
 */
function compareWithOperator(actual, operator, expected) {
    switch (operator) {
        case '>':
            return actual > expected;
        case '>=':
            return actual >= expected;
        case '=':
            return actual === expected;
        case '<=':
            return actual <= expected;
        case '<':
            return actual < expected;
        default:
            console.warn(`Unknown operator: ${operator}, defaulting to >=`);
            return actual >= expected;
    }
}

/**
 * Calculate percentage of each digit (0-9) in the last N ticks
 */
function calculateDigitPercentages(symbol) {
    const allDigits = marketTickHistory[symbol] || [];
    if (allDigits.length === 0) return null;

    // Use configured analysis digits count
    const analysisCount = botState.analysisDigits || 15;
    const digits = allDigits.slice(-analysisCount);
    const percentages = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    const total = digits.length;

    // Count occurrences of each digit
    digits.forEach(digit => {
        percentages[digit]++;
    });

    // Convert to percentages
    for (let i = 0; i <= 9; i++) {
        percentages[i] = (percentages[i] / total) * 100;
    }

    // Calculate dynamic percentages based on prediction barriers
    for (let barrier = 0; barrier <= 9; barrier++) {
        let overSum = 0;
        for (let d = barrier + 1; d <= 9; d++) {
            overSum += percentages[d];
        }
        percentages[`over${barrier}`] = overSum;
    }

    return percentages;
}

/**
 * Calculate digit distribution from full tick history (last 100 digits)
 * @param {string} symbol - The symbol to calculate distribution for
 * @returns {object} Distribution analysis with most and least appearing digits
 */
function calculateFullDigitDistribution(symbol) {
    const digits = marketFullTickDigits[symbol] || [];
    if (digits.length === 0) return null;

    const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };

    // Count occurrences
    digits.forEach(digit => {
        counts[digit]++;
    });

    // Find most and least appearing digits
    let mostAppearingDigit = 0;
    let leastAppearingDigit = 0;
    let maxCount = counts[0];
    let minCount = counts[0];

    for (let i = 1; i <= 9; i++) {
        if (counts[i] > maxCount) {
            maxCount = counts[i];
            mostAppearingDigit = i;
        }
        if (counts[i] < minCount) {
            minCount = counts[i];
            leastAppearingDigit = i;
        }
    }

    return {
        counts,
        mostAppearingDigit,
        leastAppearingDigit,
        totalTicks: digits.length
    };
}

/**
 * Update and display win percentage
 */
function updateWinPercentage() {
    const totalTrades = botState.winCount + botState.lossCount;
    if (totalTrades > 0) {
        botState.winPercentage = (botState.winCount / totalTrades) * 100;

        // Update the UI displays
        const winRateDisplay = document.getElementById('botWinRateDisplay');
        const tradesCountDisplay = document.getElementById('botTradesCountDisplay');

        if (winRateDisplay) {
            winRateDisplay.textContent = `${botState.winPercentage.toFixed(1)}%`;
        }

        if (tradesCountDisplay) {
            tradesCountDisplay.textContent = `${botState.winCount}W/${botState.lossCount}L`;
        }

        addBotLog(`📊 Win/Loss: ${botState.winCount}W/${botState.lossCount}L | Win Rate: ${botState.winPercentage.toFixed(1)}%`, 'info');
    }

    updateBotStats();
}

/**
 * Update and display bot statistics
 */
function updateBotStats() {
    const totalStakeDisplay = document.getElementById('botTotalStakeDisplay');
    const totalPayoutDisplay = document.getElementById('botTotalPayoutDisplay');
    const runsCountDisplay = document.getElementById('botRunsCountDisplay');

    if (totalStakeDisplay) {
        totalStakeDisplay.textContent = `$${botState.totalStake.toFixed(2)}`;
    }

    if (totalPayoutDisplay) {
        totalPayoutDisplay.textContent = `$${botState.totalPayout.toFixed(2)}`;
    }

    if (runsCountDisplay) {
        runsCountDisplay.textContent = `${botState.runsCount}`;
    }
}


// Performance optimization: Track last scan time and trade placement to avoid excessive scanning
let lastScanTime = 0;
const SCAN_COOLDOWN = 100; // Base cooldown between scans
let lastTradeTime = 0;
const TRADE_COOLDOWN = 100; // No scans for 5 seconds after a trade is placed
let isScanning = false; // Atomic scan lock to prevent simultaneous scans

// Access global contract tracking (declared at top of file)
const activeContracts = window.activeContracts;
const activeS1Symbols = window.activeS1Symbols;

// expectedStakes is now managed globally in utils.js

// Bot timer variables
let botStartTime = null;
let botTimerInterval = null;

// Trade timing diagnostics - Track ticks after trade placement to detect delays
let postTradeTickMonitoring = {}; // { symbol: { ticksToCapture: 2, capturedTicks: [], tradeTime: timestamp, last6Digits: [] } }

// Live Contract Monitor - Track every tick for active contracts
let liveContractMonitor = {}; // { contractId: { symbol, entryTick, ticks: [], startTime, elapsedMs, barrier, contractType } }

function updateLiveContractMonitor(contractId, symbol, currentPrice) {
    const lastDigit = parseInt(currentPrice.toString().slice(-1));
    const now = Date.now();

    if (liveContractMonitor[contractId]) {
        const contract = liveContractMonitor[contractId];

        // STOP recording after 5 ticks
        if (contract.postEntryCount >= 5) {
            return;
        }

        contract.ticks.push({ digit: lastDigit, time: new Date().toLocaleTimeString(), price: currentPrice, type: 'post' });
        contract.postEntryCount++;
        contract.elapsedMs = now - contract.startTime;

        // Update the UI
        const container = document.getElementById('live-contracts-container');
        if (container) {
            // Rebuild the display
            const contractEntries = Object.entries(liveContractMonitor);
            if (contractEntries.length === 0) {
                container.innerHTML = '<div class="log-info">No active contracts</div>';
            } else {
                const legend = `
                    <div style="font-size: 10px; color: #888; margin-bottom: 8px; border-bottom: 1px solid #444; padding-bottom: 4px;">
                        <span>Key: <span style="color: #888;">History</span> → <span style="color: #00ff7f; font-weight: bold;">ENTRY</span> → <span style="color: #fff;">Result (5 Ticks)</span></span>
                    </div>
                `;

                const entriesHtml = contractEntries.map(([id, data]) => {
                    const ticksDisplay = data.ticks.map((t, i) => {
                        let color = '#fff';
                        let weight = 'normal';
                        let border = '';

                        if (t.type === 'pre') {
                            color = '#888';
                        } else if (t.type === 'entry') {
                            color = '#00ff7f';
                            weight = 'bold';
                            border = 'border-bottom: 2px solid #00ff7f;';
                        } else if (t.type === 'post') {
                            color = '#fff';
                        }

                        return `<span style="color: ${color}; font-weight: ${weight}; ${border} padding: 0 2px;">${t.digit}</span>`;
                    }).join('<span style="color: #444; font-size: 0.8em;">→</span>');

                    const elapsed = ((data.elapsedMs || 0) / 1000).toFixed(1);
                    const statusText = data.postEntryCount >= 5 ? '✅ Complete' : '⏳ Monitoring...';

                    return `
                        <div class="log-info" style="border-left: 3px solid #ff6b6b; padding-left: 10px; margin: 8px 0; background: rgba(255,107,107,0.05);">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <strong>${data.symbol}</strong>
                                <span style="font-size: 0.85em; background: #333; padding: 2px 6px; rounded: 4px;">${data.contractType} ${data.barrier}</span>
                            </div>
                            <div style="font-size: 1.1em; font-family: 'Courier New', monospace; letter-spacing: 1px; overflow-x: auto; white-space: nowrap;">
                                ${ticksDisplay}
                            </div>
                            <div style="font-size: 0.8em; color: #888; margin-top: 4px; display: flex; justify-content: space-between;">
                                <span>${statusText}</span>
                                <span>${data.postEntryCount}/5 Ticks</span>
                            </div>
                        </div>
                    `;
                }).join('');

                container.innerHTML = legend + entriesHtml;
            }
        }
    }
}

function addLiveContract(contractId, symbol, entryTick, barrier, contractType) {
    // 1. Get last 6 ticks from history as pre-entry context
    const history = marketTickHistory[symbol] || [];
    const preTicks = history.slice(-6).map(d => ({ digit: d, price: 'history', type: 'pre' }));

    liveContractMonitor[contractId] = {
        symbol: symbol,
        entryTick: entryTick,
        ticks: [
            ...preTicks,
            { digit: entryTick, time: new Date().toLocaleTimeString(), price: 'Entry', type: 'entry' }
        ],
        startTime: Date.now(),
        elapsedMs: 0,
        barrier: barrier,
        contractType: contractType,
        postEntryCount: 0 // Initialize counter
    };

    // Force initial update
    updateLiveContractMonitor(contractId, symbol, entryTick);

    addBotLog(`🔴 Live Monitor: Tracking ${symbol} (${contractType} ${barrier})`, 'info');
}

function removeLiveContract(contractId) {
    if (liveContractMonitor[contractId]) {
        const contract = liveContractMonitor[contractId];
        // Don't remove immediately if we want to mimic a log, 
        // BUT the UI space is limited. 
        // User asked to "act like tick history", but usually these disappear when the trade closes.
        // Let's keep the standard behavior of removing it from the *Live* section when it closes,
        // because the result goes to the Trade History table.
        // The "Stop" refers to stopping the *recording* of ticks (which we handled directly in updateLiveContractMonitor).

        addBotLog(`⚪ Live Monitor: Finished ${contract.symbol}`, 'info');
        delete liveContractMonitor[contractId];

        // Update UI
        const container = document.getElementById('live-contracts-container');
        container.innerHTML = '<div class="log-info">No active contracts</div>';
    }
}

function handleBotTick(tick) {
    if (!isBotRunning) {
        return;
    }

    const symbol = tick.symbol;
    const price = tick.quote.toString();
    const lastDigit = parseInt(price.slice(-1));

    // Reduce logging frequency (only 5% of ticks)
    if (Math.random() < 0.05) {
        console.log(`Bot tick received: ${symbol} = ${price} (digit: ${lastDigit})`);
    }

    // 1. Update Global Tick History for this symbol
    if (marketTickHistory[symbol]) {
        marketTickHistory[symbol].push(lastDigit);
        if (marketTickHistory[symbol].length > 20) {
            marketTickHistory[symbol].shift();
        }

        // 2. Calculate and store digit percentages (only if we have enough data)
        if (marketTickHistory[symbol].length >= 20) {
            marketDigitPercentages[symbol] = calculateDigitPercentages(symbol);

            // Reduce logging frequency
            if (Math.random() < 0.02) {
                const last7Digits = marketTickHistory[symbol].slice(-7).join(', ');
                console.log(`📊 ${symbol} Last 7: [${last7Digits}] | OVER 2%: ${marketDigitPercentages[symbol].over2?.toFixed(1)}%, OVER 4%: ${marketDigitPercentages[symbol].over4?.toFixed(1)}%`);
            }
        }
    }

    // 3. Update technical indicators (throttled - only once per second)
    const now = Date.now();
    if (now - lastScanTime > 1000) {
        updateTechnicalIndicators();
    }

    // 3b. Monitor post-trade ticks for timing diagnostics
    if (postTradeTickMonitoring[symbol]) {
        const monitor = postTradeTickMonitoring[symbol];
        if (monitor.capturedTicks.length < monitor.ticksToCapture) {
            monitor.capturedTicks.push(lastDigit);

            // When we've captured enough ticks, log the diagnostic info
            if (monitor.capturedTicks.length === monitor.ticksToCapture) {
                const delayMs = Date.now() - monitor.tradeTime;
                addBotLog(`📊 TIMING DIAGNOSTIC for ${symbol}:`, 'info');
                addBotLog(`   ├─ Last 6 digits when conditions met: [${monitor.last6Digits.join(', ')}]`, 'info');
                addBotLog(`   ├─ Next 2 ticks after trade placed: [${monitor.capturedTicks.join(', ')}]`, 'info');
                addBotLog(`   └─ Time to capture 2 ticks: ${delayMs}ms`, 'info');

                // Clean up
                delete postTradeTickMonitoring[symbol];
            }
        }
    }

    // 3c. Update live contract monitor for ALL active contracts on this symbol
    Object.keys(window.activeContracts).forEach(contractId => {
        const contractInfo = window.activeContracts[contractId];
        if (contractInfo.symbol === symbol && liveContractMonitor[contractId]) {
            updateLiveContractMonitor(contractId, symbol, price);
        }
    });

    // 4. Scan and place trades with atomic lock and dual cooldown to prevent simultaneous scanning
    // NOTE: We can now have multiple active trades simultaneously
    if (!isScanning && now - lastScanTime > SCAN_COOLDOWN && now - lastTradeTime > TRADE_COOLDOWN) {
        isScanning = true; // Set atomic lock
        lastScanTime = now;
        scanAndPlaceMultipleTrades();
        isScanning = false; // Release atomic lock
    }
}

/**
 * CORE LOGIC: Scans all markets (or the recovery market) and places a trade.
 * Implements Rammy Auto Strategy with percentage analysis and third condition.
 */
function scanAndPlaceMultipleTrades() {
    const symbolsToScan = Object.keys(marketTickHistory).filter(isAllowedBotMarket);
    let validS1Markets = [];
    let validS2Markets = [];

    // ALWAYS scan for both S1 and S2 conditions simultaneously
    for (const symbol of symbolsToScan) {
        const lastDigits = marketTickHistory[symbol] || [];
        const percentages = marketDigitPercentages[symbol];

        // Skip if not enough data
        if (lastDigits.length < 20 || !percentages) continue;

        // Check S1 conditions (only if not blocked)
        // Skip if this symbol already has an active S1 trade or if S1 is blocked
        if (!activeS1Symbols.has(symbol) && !botState.s1Blocked) {
            const checkCount = botState.s1CheckDigits || 4;
            const maxDigit = botState.s1MaxDigit || 3;
            const prediction = botState.s1Prediction || 2;
            const minPercentage = botState.s1Percentage || 70;
            const useDigitCheck = botState.s1UseDigitCheck ?? true;
            const usePercentage = botState.s1UsePercentage ?? true;

            // Check conditions based on toggles
            let digitCheckPassed = true;
            let percentageCheckPassed = true;

            const lastN = lastDigits.slice(-checkCount);

            // Only check digit condition if enabled
            if (useDigitCheck) {
                digitCheckPassed = lastN.every(d => compareWithOperator(d, botState.s1DigitOperator, botState.s1MaxDigit));
            }

            // Only check percentage condition if enabled
            if (usePercentage) {
                const overPercentage = percentages[`over${prediction}`] || 0;
                const operator = botState.s1PercentageOperator || '>=';
                percentageCheckPassed = compareWithOperator(overPercentage, operator, minPercentage);
            }

            // Both conditions must pass (or be disabled)
            if (digitCheckPassed && percentageCheckPassed) {
                const fullDistribution = calculateFullDigitDistribution(symbol);
                if (fullDistribution) {
                    const thirdCondition = fullDistribution.mostAppearingDigit > 4 && fullDistribution.leastAppearingDigit < 4;

                    if (thirdCondition) {
                        const overPercentage = percentages[`over${prediction}`] || 0;
                        validS1Markets.push({
                            symbol,
                            mode: 'S1',
                            lastN,
                            overPercentage,
                            mostDigit: fullDistribution.mostAppearingDigit,
                            leastDigit: fullDistribution.leastAppearingDigit,
                            prediction: prediction,
                            contractType: botState.s1ContractType,
                            stake: botState.initialStake
                        });
                    }
                }
            }
        }

        // Check S2 conditions (only if in recovery mode)
        if (botState.martingaleStepCount > 0) {
            const checkCount = botState.s2CheckDigits || 6;
            const maxDigit = botState.s2MaxDigit || 4;
            const prediction = botState.s2Prediction || 5;
            const minPercentage = botState.s2Percentage || 45;
            const contractType = botState.s2ContractType || 'UNDER';
            const useDigitCheck = botState.s2UseDigitCheck ?? true;
            const usePercentage = botState.s2UsePercentage ?? true;

            // Check conditions based on toggles
            let digitCheckPassed = true;
            let percentageCheckPassed = true;

            const lastN = lastDigits.slice(-checkCount);

            // Only check digit condition if enabled
            if (useDigitCheck) {
                digitCheckPassed = lastN.every(d => compareWithOperator(d, botState.s2DigitOperator, botState.s2MaxDigit));
            }

            // Only check percentage condition if enabled
            if (usePercentage) {
                const overPercentage = percentages[`over${prediction}`] || 0;
                const operator = botState.s2PercentageOperator || '>=';
                percentageCheckPassed = compareWithOperator(overPercentage, operator, minPercentage);
            }

            // Both conditions must pass (or be disabled)
            if (digitCheckPassed && percentageCheckPassed) {
                const fullDistribution = calculateFullDigitDistribution(symbol);
                if (fullDistribution) {
                    const thirdCondition = fullDistribution.mostAppearingDigit > 4 && fullDistribution.leastAppearingDigit < 4;

                    if (thirdCondition) {
                        const overPercentage = percentages[`over${prediction}`] || 0;
                        validS2Markets.push({
                            symbol,
                            mode: 'S2',
                            lastN,
                            overPercentage,
                            mostDigit: fullDistribution.mostAppearingDigit,
                            leastDigit: fullDistribution.leastAppearingDigit,
                            prediction: prediction,
                            contractType: contractType,
                            stake: 0 // Will be calculated below
                        });
                    }
                }
            }
        }
    }

    // Execute S1 trades with proper locking
    // Allow only ONE concurrent trade to prevent simultaneous purchases
    const activeTradeCount = Object.keys(activeContracts).length;
    const maxConcurrentTrades = 1; // Limit to 1 concurrent trade

    if (validS1Markets.length > 0 && activeTradeCount < maxConcurrentTrades) {
        // Sort by over percentage (highest first) and pick the best one
        validS1Markets.sort((a, b) => b.overPercentage - a.overPercentage);
        const selectedMarket = validS1Markets[0];

        // CRITICAL: Check if symbol already has active S1 trade BEFORE acquiring lock
        if (activeS1Symbols.has(selectedMarket.symbol)) {
            console.log(`⚠️ ${selectedMarket.symbol} already has active S1 trade, skipping`);
            return;
        }

        // DUAL PREVENTION: Check both stake-based and signature-based duplicate prevention
        console.log(`🎯 [S1] Checking trade: ${selectedMarket.symbol}, stake=$${selectedMarket.stake}, prediction=${selectedMarket.prediction}`);

        if (!canPlaceStakeBasedTrade(selectedMarket.symbol, selectedMarket.stake, 'ghost_ai') ||
            !isTradeSignatureUnique(selectedMarket.symbol, selectedMarket.prediction, selectedMarket.stake, 'ghost_ai')) {
            console.log(`🚫 [S1] Trade BLOCKED for ${selectedMarket.symbol}`);
            // Try the next best market if available
            let traded = false;
            for (let i = 1; i < validS1Markets.length && i < 3; i++) {
                const alternativeMarket = validS1Markets[i];

                // Check if alternative also has active S1
                if (activeS1Symbols.has(alternativeMarket.symbol)) {
                    continue;
                }

                if (canPlaceStakeBasedTrade(alternativeMarket.symbol, alternativeMarket.stake, 'ghost_ai') &&
                    isTradeSignatureUnique(alternativeMarket.symbol, alternativeMarket.prediction, alternativeMarket.stake, 'ghost_ai')) {
                    // Record both stake and signature
                    recordPendingStake(alternativeMarket.symbol, alternativeMarket.stake, 'ghost_ai');
                    recordTradeSignature(alternativeMarket.symbol, alternativeMarket.prediction, alternativeMarket.stake, 'ghost_ai');
                    activeS1Symbols.add(alternativeMarket.symbol);
                    console.log(`🔒 Added ${alternativeMarket.symbol} to activeS1Symbols (alternative)`);
                    addBotLog(`🔄 ${selectedMarket.symbol} blocked, trading alternative: ${alternativeMarket.symbol}`, 'info');
                    executeTradeWithTracking(alternativeMarket);
                    traded = true;
                    break;
                }
            }
            if (!traded) {
                addBotLog(`⚠️ All top S1 markets blocked by duplicate prevention`, 'warning');
            }
            return;
        }

        // DUAL RECORDING: Record both stake and signature
        console.log(`✅ [S1] Trade ALLOWED for ${selectedMarket.symbol}, recording protections`);
        recordPendingStake(selectedMarket.symbol, selectedMarket.stake, 'ghost_ai');
        recordTradeSignature(selectedMarket.symbol, selectedMarket.prediction, selectedMarket.stake, 'ghost_ai');
        activeS1Symbols.add(selectedMarket.symbol);
        console.log(`🔒 Added ${selectedMarket.symbol} to activeS1Symbols`);

        addBotLog(`🎯 Found ${validS1Markets.length} valid S1 market(s) | Trading best: ${selectedMarket.symbol} (${selectedMarket.overPercentage.toFixed(1)}% over ${selectedMarket.prediction}) | Active trades: ${activeTradeCount}/${maxConcurrentTrades}`, 'info');

        const lastNStr = selectedMarket.lastN.join(', ');
        const s1Operator = botState.s1PercentageOperator || '>=';
        addBotLog(`✓ S1 Entry: ${selectedMarket.symbol} | Last ${selectedMarket.lastN.length}: [${lastNStr}] ${botState.s1DigitOperator} ${botState.s1MaxDigit} | ${selectedMarket.contractType} ${selectedMarket.prediction}%: ${selectedMarket.overPercentage.toFixed(1)}% ${s1Operator} ${botState.s1Percentage}% | Most: ${selectedMarket.mostDigit} (>4) | Least: ${selectedMarket.leastDigit} (<4) | Stake: $${selectedMarket.stake.toFixed(2)}`, 'info');

        executeTradeWithTracking(selectedMarket);
    } else if (validS1Markets.length > 0 && activeTradeCount >= maxConcurrentTrades) {
        // Only log occasionally to avoid spam
        if (Math.random() < 0.05) {
            addBotLog(`⚠️ Max concurrent trades reached: ${activeTradeCount}/${maxConcurrentTrades}`, 'warning');
        }
    } else if (botState.s1Blocked && botState.martingaleStepCount === 0) {
        // Log reminder that S1 is blocked when not in recovery
        if (Math.random() < 0.01) { // Log occasionally to avoid spam
            addBotLog(`⚠️ S1 is currently BLOCKED (${botState.s1ConsecutiveLosses} consecutive losses). Waiting for S2 recovery...`, 'warning');
        }
    }

    // Debug logging for S2 recovery state
    if (botState.martingaleStepCount > 0 && validS2Markets.length === 0 && Math.random() < 0.02) {
        addBotLog(`⏳ S2 Recovery: Scanning ${symbolsToScan.length} markets... No valid S2 conditions found yet. (Step ${botState.martingaleStepCount}, Active S2: ${botState.activeS2Count})`, 'info');
    }

    // Execute best S2 recovery trade (if in recovery mode and no active S2)
    if (validS2Markets.length > 0 && botState.activeS2Count < 1) {
        // Pick the market with the highest over percentage
        validS2Markets.sort((a, b) => b.overPercentage - a.overPercentage);
        const selected = validS2Markets[0];

        // Calculate martingale stake for S2 FIRST
        const accumulatedLosses = botState.accumulatedStakesLost;
        const recoveryMultiplier = 100 / botState.payoutPercentage;
        const calculatedStake = parseFloat((accumulatedLosses * recoveryMultiplier).toFixed(2));

        // DUAL PREVENTION: Check both stake and signature for S2 with REAL stake
        console.log(`🎯 [S2] Checking recovery trade: ${selected.symbol}, stake=$${calculatedStake}, prediction=${selected.prediction}`);
        if (!canPlaceStakeBasedTrade(selected.symbol, calculatedStake, 'ghost_ai') ||
            !isTradeSignatureUnique(selected.symbol, selected.prediction, calculatedStake, 'ghost_ai')) {
            console.log(`🚫 [S2] Trade BLOCKED for ${selected.symbol}`);

            // Try alternative markets with calculated stake
            let traded = false;
            for (let i = 1; i < validS2Markets.length && i < 3; i++) {
                const alternative = validS2Markets[i];
                if (canPlaceStakeBasedTrade(alternative.symbol, calculatedStake, 'ghost_ai') &&
                    isTradeSignatureUnique(alternative.symbol, alternative.prediction, calculatedStake, 'ghost_ai')) {
                    // Record both stake and signature for the alternative
                    console.log(`✅ [S2] Trade ALLOWED for ${alternative.symbol}, recording protections`);
                    recordPendingStake(alternative.symbol, calculatedStake, 'ghost_ai');
                    recordTradeSignature(alternative.symbol, alternative.prediction, calculatedStake, 'ghost_ai');
                    selected.symbol = alternative.symbol;
                    selected.lastN = alternative.lastN;
                    selected.overPercentage = alternative.overPercentage;
                    selected.mostDigit = alternative.mostDigit;
                    selected.leastDigit = alternative.leastDigit;
                    addBotLog(`🔄 S2 using alternative market: ${alternative.symbol}`, 'info');
                    traded = true;
                    break;
                }
            }
            if (!traded) {
                addBotLog(`⚠️ All top S2 markets blocked by duplicate prevention`, 'warning');
                return;
            }
        } else {
            // Record both stake and signature for the selected market
            console.log(`✅ [S2] Trade ALLOWED for ${selected.symbol}, recording protections`);
            recordPendingStake(selected.symbol, calculatedStake, 'ghost_ai');
            recordTradeSignature(selected.symbol, selected.prediction, calculatedStake, 'ghost_ai');
        }

        // Set the calculated stake
        selected.stake = calculatedStake;
        botState.currentStake = selected.stake;
        botState.recoverySymbol = selected.symbol;

        const lastNStr = selected.lastN.join(', ');
        const s2Operator = botState.s2PercentageOperator || '>=';
        addBotLog(`✓ S2 Recovery: ${validS2Markets.length} market(s) valid | Trading ${selected.symbol} | Last ${selected.lastN.length}: [${lastNStr}] ${botState.s2DigitOperator} ${botState.s2MaxDigit} | Over ${selected.prediction}%: ${selected.overPercentage.toFixed(1)}% ${s2Operator} ${botState.s2Percentage}% | Most: ${selected.mostDigit} (>4) | Least: ${selected.leastDigit} (<4) | ${selected.contractType} ${selected.prediction} | Stake: $${selected.stake.toFixed(2)}`, 'warning');

        executeTradeWithTracking(selected);
    }
}

function executeTradeWithTracking(marketData) {
    // CRITICAL: Set trade cooldown to prevent immediate re-scanning
    lastTradeTime = Date.now();

    // Stake-based prevention should already be in place, but double-check
    if (expectedStakes[marketData.symbol] !== marketData.stake) {
        console.warn(`⚠️ Stake-based prevention not in place for ${marketData.symbol}:$${marketData.stake}`);
        if (!canPlaceStakeBasedTrade(marketData.symbol, marketData.stake, 'ghost_ai')) {
            addBotLog(`⚠️ Failed stake-based check for ${marketData.symbol}`, 'warning');
            return;
        }
        recordPendingStake(marketData.symbol, marketData.stake, 'ghost_ai');
    }

    // CRITICAL FIX: Don't create pending contract here - let app.js handle it when buy response comes
    // This prevents duplicate contract tracking with different IDs

    // Note: activeS1Symbols.add() is now done immediately after lock acquisition in scanAndPlaceMultipleTrades()
    // to prevent race conditions. Keeping this as a safety check in case executeTradeWithTracking is called directly.
    if (marketData.mode === 'S1' && !activeS1Symbols.has(marketData.symbol)) {
        activeS1Symbols.add(marketData.symbol);
    }

    // Track S2 count
    if (marketData.mode === 'S2') {
        botState.activeS2Count++;
    }

    // DIAGNOSTIC: Capture last 6 digits when conditions are met and prepare to monitor next 2 ticks
    const last6Digits = (marketTickHistory[marketData.symbol] || []).slice(-6);
    postTradeTickMonitoring[marketData.symbol] = {
        ticksToCapture: 2,
        capturedTicks: [],
        tradeTime: Date.now(),
        last6Digits: last6Digits,
        strategy: marketData.mode
    };

    addBotLog(`🔍 PRE-TRADE SNAPSHOT for ${marketData.symbol}: Last 6 digits = [${last6Digits.join(', ')}] | Will monitor next 2 ticks for timing analysis`, 'info');

    // Show comprehensive digit analysis before purchase
    showComprehensiveDigitAnalysis(marketData.symbol, marketData.prediction);

    // Send purchase request with strategy info in passthrough
    sendBotPurchaseWithStrategy(marketData.prediction, marketData.stake, marketData.symbol, marketData.mode, marketData.contractType);
}

// Function to show comprehensive digit analysis (matching XML before_purchase logic)
function showComprehensiveDigitAnalysis(symbol, prediction) {
    const lastDigits = marketTickHistory[symbol] || [];
    const percentages = marketDigitPercentages[symbol] || {};

    if (lastDigits.length >= 20) {
        const last6Digits = lastDigits.slice(-6);

        // Show analysis notification (similar to XML before_purchase)
        showToast(`Analysis for ${symbol}: Last 6 digits [${last6Digits.join(', ')}] | Prediction: OVER ${prediction}`, 'info', 5000);

        // Log detailed analysis
        let analysisText = `📊 Digit Analysis for ${symbol} (Last 20 ticks):\n`;
        for (let digit = 0; digit <= 9; digit++) {
            const percentage = percentages[digit] || 0;
            analysisText += `#${digit}: ${percentage.toFixed(1)}% | `;
        }

        addBotLog(analysisText.slice(0, -3), 'info'); // Remove last " | "

        // Show technical indicators if available
        if (emaValue !== null || smaValue !== null) {
            addBotLog(`📈 Technical Indicators: EMA(100): ${emaValue ? emaValue.toFixed(4) : 'N/A'} | SMA(50): ${smaValue ? smaValue.toFixed(4) : 'N/A'}`, 'info');
        }
    }
}

function sendBotPurchase(prediction, stake, symbol) {
    sendBotPurchaseWithStrategy(prediction, stake, symbol, 'S1');
}

function sendBotPurchaseWithStrategy(prediction, stake, symbol, strategy, contractType = null) {
    console.log('sendBotPurchase: Preparing to send purchase for', symbol, 'prediction', prediction, 'stake', stake, 'strategy', strategy);

    // STAKE-BASED: Check for duplicate trades (exact same stake = same trade, different stake = different trade type)
    const existingStake = expectedStakes[symbol];
    if (existingStake !== undefined && existingStake !== stake) {
        // Different stake on same symbol - block this different trade type
        console.error(`❌ STAKE CONFLICT: ${symbol} has pending stake $${existingStake}, can't place $${stake}`);
        addBotLog(`❌ Stake conflict on ${symbol} (pending: $${existingStake}, requested: $${stake})`, 'error');

        // Clean up
        if (strategy === 'S1') {
            activeS1Symbols.delete(symbol);
            console.log(`🔓 Removed ${symbol} from activeS1Symbols due to stake conflict`);
        }
        return;
    }

    // STAKE-BASED: Validate we have recorded the pending stake
    if (expectedStakes[symbol] !== stake) {
        console.error(`❌ STAKE VALIDATION FAILED: Expected stake ${expectedStakes[symbol]} != ${stake} for ${symbol}! Aborting purchase.`);
        addBotLog(`❌ Stake validation failed for ${symbol}`, 'error');

        // Clean up if S1
        if (strategy === 'S1') {
            activeS1Symbols.delete(symbol);
            console.log(`🔓 Removed ${symbol} from activeS1Symbols due to stake validation failure`);
        }
        return;
    }

    // Stake should already be recorded by the stake-based system
    // If not recorded yet, record it now (defensive programming)
    if (expectedStakes[symbol] === undefined) {
        expectedStakes[symbol] = stake;
        console.log(`📝 Recorded expected stake for ${symbol}: $${stake.toFixed(2)}`);
    }

    // Determine contract type
    let finalContractType;
    if (contractType) {
        finalContractType = contractType === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
    } else {
        finalContractType = prediction <= 4 ? "DIGITOVER" : "DIGITUNDER";
    }

    const purchaseRequest = {
        "buy": 1,
        "price": stake,
        // Pass the symbol, barrier, and strategy so we know where the result came from
        "passthrough": {
            "purpose": "ghost_ai_trade",
            "run_id": botState.runId,
            "symbol": symbol,
            "barrier": prediction,
            "strategy": strategy,
            "stake": stake
        },
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": finalContractType,
            "currency": "USD",
            "duration": 1,
            "duration_unit": "t",
            "symbol": symbol,
            "barrier": prediction,
        }
    };

    console.log('sendBotPurchase: Sending request:', purchaseRequest);

    const strategyLabel = strategy === 'S1' ? 'S1 Entry' : 'S2 Recovery';
    addBotLog(`Executing ${strategyLabel} on ${symbol}: ${prediction <= 4 ? 'OVER' : 'UNDER'} ${prediction} with stake $${parseFloat(stake).toFixed(2)}`, 'trade');

    sendAPIRequest(purchaseRequest).then(() => {
        console.log('sendBotPurchase: Request sent successfully');
        // Keep stake locked until trade completes - cleanup happens in app.js
    }).catch(error => {
        console.error('sendBotPurchase: Request failed:', error);

        // CRITICAL: Clean up on failure - remove stake lock immediately
        delete expectedStakes[symbol]; // Remove expected stake
        console.log(`🗑️ Removed expected stake for ${symbol} due to purchase failure`);

        if (strategy === 'S1') {
            activeS1Symbols.delete(symbol);
            console.log(`🔓 Removed ${symbol} from activeS1Symbols due to purchase failure`);
        }

        addBotLog(`❌ Purchase failed for ${symbol}: ${error.message || 'Unknown error'}`, 'error');
    });
}

/**
 * Toggle function for bot start/stop buttons (works for both Speedbot and Ghost AI sections)
 */
function toggleBot() {
    if (isBotRunning) {
        stopGhostAiBot();
    } else {
        startGhostAiBot();
    }
}

/**
 * Clear Ghost AI trade history
 */
function clearGhostAIHistory() {
    if (confirm('Are you sure you want to clear the trade history? This cannot be undone.')) {
        if (botHistoryTableBody) {
            botHistoryTableBody.innerHTML = '';
        }
        addBotLog('📋 Trade history cleared by user', 'info');
        showToast('Trade history cleared', 'success');
    }
}

/**
 * Format elapsed time in HH:MM:SS format
 */
function formatElapsedTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Update bot timer display
 */
function updateBotTimer() {
    if (!botStartTime) return;

    const elapsed = Date.now() - botStartTime;
    const timeString = formatElapsedTime(elapsed);

    const timerDisplay = document.getElementById('botTimerDisplay');
    if (timerDisplay) {
        timerDisplay.textContent = timeString;
    }
}

/**
 * Start the bot timer
 */
function startBotTimer() {
    // Update immediately
    updateBotTimer();

    // Update every second
    botTimerInterval = setInterval(updateBotTimer, 1000);
}

/**
 * Stop the bot timer
 */
function stopBotTimer() {
    if (botTimerInterval) {
        clearInterval(botTimerInterval);
        botTimerInterval = null;
    }
    botStartTime = null;

    // Reset display
    const timerDisplay = document.getElementById('botTimerDisplay');
    if (timerDisplay) {
        timerDisplay.textContent = '00:00:00';
    }
}

// Add event listener for clear history button
document.addEventListener('DOMContentLoaded', () => {
    const clearHistoryBtn = document.getElementById('clear-ghost-ai-history');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearGhostAIHistory);
    }
});