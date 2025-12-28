// ===================================
// HEDGING MODULE
// ===================================

/**
 * Hedging State Management
 */
const hedgingState = {
    activeDualHedges: {}, // { symbol: { callContractId, putContractId, stake, timestamp } }
    activeMultiHedges: {}, // { symbol: { contracts: [], stake, timestamp } }
    activeLookbackHedges: {}, // { runId: { symbol, hlContractId, clContractId, stake, duration, timestamp, hlPL: 0, clPL: 0 } }
    totalHedgeProfit: 0,
    hedgeHistory: [],
    lookbackHistory: [] // Store completed Lookback trades
};

/**
 * Executes a dual hedge by placing simultaneous CALL and PUT contracts
 * @param {string} symbol - The market symbol to hedge
 * @param {number} stake - The stake amount for each contract
 */
function executeDualHedge(symbol, stake) {
    console.log(`🛡️ Executing dual hedge on ${symbol} with stake $${stake}`);

    // Validate inputs
    if (!symbol || !stake || stake < 0.35) {
        showToast('Invalid parameters for dual hedge', 'error');
        return;
    }

    // Check if connection is available
    if (!connection || connection.readyState !== WebSocket.OPEN) {
        showToast('Connection not available for hedging', 'error');
        return;
    }

    // Create unique run ID for this hedge
    const hedgeRunId = `hedge_dual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create CALL (High) contract request
    const callRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": "CALL",
            "currency": "USD",
            "duration": 1,
            "duration_unit": "t",
            "symbol": symbol,
        },
        "passthrough": {
            "purpose": "hedge_trade",
            "hedge_type": "dual",
            "contract_type": "CALL",
            "run_id": hedgeRunId,
            "symbol": symbol,
            "stake": stake
        }
    };

    // Create PUT (Low) contract request
    const putRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": "PUT",
            "currency": "USD",
            "duration": 1,
            "duration_unit": "t",
            "symbol": symbol,
        },
        "passthrough": {
            "purpose": "hedge_trade",
            "hedge_type": "dual",
            "contract_type": "PUT",
            "run_id": hedgeRunId,
            "symbol": symbol,
            "stake": stake
        }
    };

    // Track the hedge
    hedgingState.activeDualHedges[symbol] = {
        callContractId: null,
        putContractId: null,
        stake: stake,
        timestamp: Date.now(),
        runId: hedgeRunId
    };

    // Send both requests simultaneously (bypassing trade locks as specified)
    sendAPIRequest(callRequest)
        .then(() => console.log(`✅ CALL contract placed for ${symbol}`))
        .catch(error => console.error(`❌ Failed to place CALL contract:`, error));

    sendAPIRequest(putRequest)
        .then(() => console.log(`✅ PUT contract placed for ${symbol}`))
        .catch(error => console.error(`❌ Failed to place PUT contract:`, error));

    // Update UI status
    updateHedgeStatus('dual', symbol, stake);
}

/**
 * Opens multiple contracts of the same type with 50ms delays
 * @param {number} count - Number of contracts to place (max 4)
 * @param {string} contractType - 'CALL' or 'PUT'
 * @param {string} symbol - The market symbol to hedge
 * @param {number} stake - The stake amount for each contract
 */
function openMultipleContracts(count, contractType, symbol, stake) {
    const maxContracts = Math.min(count, 4);
    console.log(`🔄 Opening ${maxContracts} ${contractType} contracts on ${symbol} at stake $${stake}`);

    // Validate inputs
    if (!symbol || !stake || stake < 0.35) {
        showToast('Invalid parameters for multi-entry', 'error');
        return;
    }

    if (!connection || connection.readyState !== WebSocket.OPEN) {
        showToast('Connection not available for hedging', 'error');
        return;
    }

    const hedgeRunId = `hedge_multi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    for (let i = 0; i < maxContracts; i++) {
        setTimeout(() => {
            const request = {
                "buy": 1,
                "price": stake,
                "parameters": {
                    "amount": stake,
                    "basis": "stake",
                    "contract_type": contractType,
                    "currency": "USD",
                    "duration": 1,
                    "duration_unit": "t",
                    "symbol": symbol,
                },
                "passthrough": {
                    "purpose": "hedge_trade",
                    "hedge_type": "multi",
                    "contract_index": i + 1,
                    "total_contracts": maxContracts,
                    "contract_type": contractType,
                    "run_id": hedgeRunId
                }
            };

            sendAPIRequest(request)
                .then(() => console.log(`✅ Contract ${i + 1}/${maxContracts} (${contractType}) placed for ${symbol}`))
                .catch(error => console.error(`❌ Failed to place contract ${i + 1}:`, error));

        }, i * 50);
    }

    updateHedgeStatus('multi', symbol, stake, maxContracts);
}

/**
 * Executes a multi-hedge by placing up to 4 contracts with 50ms delays
 * @param {string} symbol - The market symbol to hedge
 * @param {number} stake - The stake amount for each contract
 * @param {number} count - Number of contracts to place (max 4)
 */
function executeMultiHedge(symbol, stake, count) {
    openMultipleContracts(count, 'CALL', symbol, stake);
}

/**
 * Executes a Lookback hedge by opening both High-Low and Close-Low contracts
 * @param {string} symbol - The trading symbol
 * @param {number} stake - The stake amount for each contract
 * @param {number} duration - Duration in minutes (minimum 1)
 */
function executeLookbackHedge(symbol, stake, duration = 1) {
    console.log(`🛡️ Executing Lookback Hedge on ${symbol} with stake $${stake} and duration ${duration}m`);

    // Validate inputs
    if (!symbol || !stake || stake < 0.35) {
        showToast('Invalid parameters for Lookback hedge', 'error');
        return;
    }

    if (duration < 1) {
        showToast('Duration must be at least 1 minute', 'error');
        return;
    }

    // Check if connection is available
    if (!connection || connection.readyState !== WebSocket.OPEN) {
        showToast('Connection not available for hedging', 'error');
        return;
    }

    // Create unique run ID for this hedge
    const hedgeRunId = `hedge_lookback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // LBFLOATCALL (High-Low) PROPOSAL request
    const highLowRequest = {
        "proposal": 1,
        "amount": stake,
        "contract_type": "LBFLOATCALL",
        "currency": "USD",
        "duration": duration,
        "duration_unit": "m",
        "symbol": symbol,
        "multiplier": 1,
        "passthrough": {
            "purpose": "lookback_hedge_proposal",
            "hedge_type": "lookback",
            "contract_type": "LBFLOATCALL",
            "run_id": hedgeRunId,
            "symbol": symbol,
            "stake": stake
        }
    };

    // LBFLOATPUT (Close-Low) PROPOSAL request
    const closeLowRequest = {
        "proposal": 1,
        "amount": stake,
        "contract_type": "LBFLOATPUT",
        "currency": "USD",
        "duration": duration,
        "duration_unit": "m",
        "symbol": symbol,
        "multiplier": 1,
        "passthrough": {
            "purpose": "lookback_hedge_proposal",
            "hedge_type": "lookback",
            "contract_type": "LBFLOATPUT",
            "run_id": hedgeRunId,
            "symbol": symbol,
            "stake": stake
        }
    };

    // Track the hedge with runId as key
    hedgingState.activeLookbackHedges[hedgeRunId] = {
        symbol: symbol,
        hlContractId: null,
        clContractId: null,
        stake: stake,
        duration: duration,
        timestamp: Date.now(),
        runId: hedgeRunId,
        hlPL: 0,
        clPL: 0
    };

    // Send both requests simultaneously
    sendAPIRequest(highLowRequest)
        .then(() => console.log(`✅ LBFLOATCALL (High-Low) PROPOSAL requested for ${symbol}`))
        .catch(error => console.error(`❌ Failed to request High-Low proposal:`, error));

    sendAPIRequest(closeLowRequest)
        .then(() => console.log(`✅ LBFLOATPUT (Close-Low) PROPOSAL requested for ${symbol}`))
        .catch(error => console.error(`❌ Failed to request Close-Low proposal:`, error));

    // Update UI status
    updateHedgeStatus('lookback', symbol, stake);
    showToast(`Lookback Hedge executed on ${symbol} (${duration}m)`, 'success');

    // Update display
    updateLookbackContractsDisplay();
}

/**
 * Updates the hedging interface status display
 * @param {string} type - 'dual', 'multi', or 'lookback'
 * @param {string} symbol - Market symbol
 * @param {number} stake - Stake amount
 * @param {number} count - Number of contracts (for multi-hedge)
 */
function updateHedgeStatus(type, symbol, stake, count = 1) {
    const statusElement = document.getElementById('hedge-status');
    if (!statusElement) return;

    const timestamp = new Date().toLocaleTimeString();
    const totalStake = stake * (type === 'dual' || type === 'lookback' ? 2 : count);

    let statusText = '';
    if (type === 'dual') {
        statusText = `${timestamp}: Dual hedge executed on ${symbol} - 2 contracts ($${stake} each, total $${totalStake})`;
    } else if (type === 'lookback') {
        statusText = `${timestamp}: Lookback hedge executed on ${symbol} - High-Low + Close-Low ($${stake} each, total $${totalStake})`;
    } else {
        statusText = `${timestamp}: Multi-hedge executed on ${symbol} - ${count} contracts ($${stake} each, total $${totalStake})`;
    }

    statusElement.textContent = statusText;

    // Show toast notification
    if (typeof showToast === 'function') {
        const hedgeType = type === 'dual' ? 'Dual' : type === 'lookback' ? 'Lookback' : 'Multi';
        showToast(`${hedgeType} hedge executed on ${symbol}`, 'success');
    }
}

/**
 * Executes Over/Under hedge by placing simultaneous OVER and UNDER contracts
 * @param {string} symbol - The market symbol to hedge
 * @param {number} barrier - The barrier digit (0-9)
 * @param {number} stake - The stake amount for each contract
 */
function executeOverUnderHedge(symbol, barrier, stake) {
    console.log(`🛡️ Executing Over/Under hedge on ${symbol} with barrier ${barrier} and stake $${stake}`);

    if (!symbol || !stake || stake < 0.35) {
        showToast('Invalid parameters for Over/Under hedge', 'error');
        return;
    }

    if (!connection || connection.readyState !== WebSocket.OPEN) {
        showToast('Connection not available for hedging', 'error');
        return;
    }

    const hedgeRunId = `hedge_overunder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const overRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": "DIGITOVER",
            "currency": "USD",
            "duration": 5,
            "duration_unit": "t",
            "symbol": symbol,
            "barrier": barrier.toString()
        },
        "passthrough": {
            "purpose": "hedge_trade",
            "hedge_type": "overunder",
            "contract_type": "DIGITOVER",
            "run_id": hedgeRunId,
            "symbol": symbol,
            "stake": stake
        }
    };

    const underRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": "DIGITUNDER",
            "currency": "USD",
            "duration": 5,
            "duration_unit": "t",
            "symbol": symbol,
            "barrier": barrier.toString()
        },
        "passthrough": {
            "purpose": "hedge_trade",
            "hedge_type": "overunder",
            "contract_type": "DIGITUNDER",
            "run_id": hedgeRunId,
            "symbol": symbol,
            "stake": stake
        }
    };

    sendAPIRequest(overRequest)
        .then(() => console.log(`✅ OVER contract placed for ${symbol}`))
        .catch(error => console.error(`❌ Failed to place OVER contract:`, error));

    sendAPIRequest(underRequest)
        .then(() => console.log(`✅ UNDER contract placed for ${symbol}`))
        .catch(error => console.error(`❌ Failed to place UNDER contract:`, error));

    updateHedgeStatus('overunder', symbol, stake);
}

/**
 * Executes Match/Differ hedge by placing simultaneous MATCH and DIFFER contracts
 * @param {string} symbol - The market symbol to hedge
 * @param {number} stake - The stake amount for each contract
 */
function executeMatchDifferHedge(symbol, stake) {
    console.log(`🛡️ Executing Match/Differ hedge on ${symbol} with stake $${stake}`);

    if (!symbol || !stake || stake < 0.35) {
        showToast('Invalid parameters for Match/Differ hedge', 'error');
        return;
    }

    if (!connection || connection.readyState !== WebSocket.OPEN) {
        showToast('Connection not available for hedging', 'error');
        return;
    }

    const hedgeRunId = `hedge_matchdiffer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const matchRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": "DIGITMATCH",
            "currency": "USD",
            "duration": 5,
            "duration_unit": "t",
            "symbol": symbol,
            "barrier": "5"
        },
        "passthrough": {
            "purpose": "hedge_trade",
            "hedge_type": "matchdiffer",
            "contract_type": "DIGITMATCH",
            "run_id": hedgeRunId,
            "symbol": symbol,
            "stake": stake
        }
    };

    const differRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": "DIGITDIFF",
            "currency": "USD",
            "duration": 5,
            "duration_unit": "t",
            "symbol": symbol,
            "barrier": "5"
        },
        "passthrough": {
            "purpose": "hedge_trade",
            "hedge_type": "matchdiffer",
            "contract_type": "DIGITDIFF",
            "run_id": hedgeRunId,
            "symbol": symbol,
            "stake": stake
        }
    };

    sendAPIRequest(matchRequest)
        .then(() => console.log(`✅ MATCH contract placed for ${symbol}`))
        .catch(error => console.error(`❌ Failed to place MATCH contract:`, error));

    sendAPIRequest(differRequest)
        .then(() => console.log(`✅ DIFFER contract placed for ${symbol}`))
        .catch(error => console.error(`❌ Failed to place DIFFER contract:`, error));

    updateHedgeStatus('matchdiffer', symbol, stake);
}

/**
 * Executes conditional Over/Under based on last N digits
 */
function executeConditionalOverUnder() {
    const symbol = document.getElementById('overunder-market').value;
    const barrier = parseInt(document.getElementById('overunder-barrier').value);
    const checkLast = parseInt(document.getElementById('overunder-check-last').value);
    const ifDigit = parseInt(document.getElementById('overunder-if-digit').value);
    const stake = parseFloat(document.getElementById('overunder-stake').value);

    console.log(`🛡️ Conditional Over/Under: Check last ${checkLast} digits, if last is ${ifDigit}, trade on ${symbol}`);

    if (!connection || connection.readyState !== WebSocket.OPEN) {
        showToast('Connection not available', 'error');
        return;
    }

    // Subscribe to ticks to check last N digits
    const tickSubscription = {
        "ticks_history": symbol,
        "adjust_start_time": 1,
        "count": checkLast,
        "end": "latest",
        "start": 1,
        "style": "ticks"
    };

    // Store the parameters for use in tick handler
    window.conditionalOverUnderParams = {
        symbol,
        barrier,
        checkLast,
        ifDigit,
        stake,
        active: true
    };

    sendAPIRequest(tickSubscription);
    showToast(`Monitoring ${symbol} for last ${checkLast} digits...`, 'info');
}

/**
 * Executes Multi-Market Match/Differ hedge
 */
function executeMultiMarketMatchDiffer() {
    const differMarkets = [];
    if (document.getElementById('md-r10').checked) differMarkets.push('R_10');
    if (document.getElementById('md-r25').checked) differMarkets.push('R_25');
    if (document.getElementById('md-r50').checked) differMarkets.push('R_50');
    if (document.getElementById('md-r75').checked) differMarkets.push('R_75');
    if (document.getElementById('md-r100').checked) differMarkets.push('R_100');

    const matchMarket = document.getElementById('matchdiffer-match-market').value;
    const digit = document.getElementById('matchdiffer-digit').value;
    const stake = parseFloat(document.getElementById('matchdiffer-stake').value);

    if (differMarkets.length === 0) {
        showToast('Please select at least one market for DIFFER', 'error');
        return;
    }

    if (!connection || connection.readyState !== WebSocket.OPEN) {
        showToast('Connection not available for hedging', 'error');
        return;
    }

    const hedgeRunId = `hedge_multimd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`🛡️ Multi-Market Match/Differ: DIFFER on ${differMarkets.join(', ')}, MATCH on ${matchMarket}`);

    // Place DIFFER on all selected markets
    differMarkets.forEach((market, index) => {
        setTimeout(() => {
            const differRequest = {
                "buy": 1,
                "price": stake,
                "parameters": {
                    "amount": stake,
                    "basis": "stake",
                    "contract_type": "DIGITDIFF",
                    "currency": "USD",
                    "duration": 5,
                    "duration_unit": "t",
                    "symbol": market,
                    "barrier": digit
                },
                "passthrough": {
                    "purpose": "hedge_trade",
                    "hedge_type": "multimarket_differ",
                    "contract_type": "DIGITDIFF",
                    "run_id": hedgeRunId,
                    "symbol": market,
                    "stake": stake
                }
            };

            sendAPIRequest(differRequest)
                .then(() => console.log(`✅ DIFFER contract placed on ${market}`))
                .catch(error => console.error(`❌ Failed to place DIFFER on ${market}:`, error));
        }, index * 50);
    });

    // Place MATCH on the selected market
    setTimeout(() => {
        const matchRequest = {
            "buy": 1,
            "price": stake,
            "parameters": {
                "amount": stake,
                "basis": "stake",
                "contract_type": "DIGITMATCH",
                "currency": "USD",
                "duration": 5,
                "duration_unit": "t",
                "symbol": matchMarket,
                "barrier": digit
            },
            "passthrough": {
                "purpose": "hedge_trade",
                "hedge_type": "multimarket_match",
                "contract_type": "DIGITMATCH",
                "run_id": hedgeRunId,
                "symbol": matchMarket,
                "stake": stake
            }
        };

        sendAPIRequest(matchRequest)
            .then(() => console.log(`✅ MATCH contract placed on ${matchMarket}`))
            .catch(error => console.error(`❌ Failed to place MATCH on ${matchMarket}:`, error));
    }, differMarkets.length * 50);

    showToast(`Multi-Market Match/Differ executed: ${differMarkets.length} DIFFER + 1 MATCH`, 'success');
}

// ===================================
// LOOKBACK HEDGE ENHANCEMENTS
// ===================================

/**
 * Toggle duration mode between Auto and Manual
 */
function toggleDurationMode() {
    const durationInput = document.getElementById('lookback-duration');
    const isAuto = document.querySelector('input[name="duration-mode"]:checked').value === 'auto';
    durationInput.disabled = isAuto;

    if (isAuto) {
        const symbol = document.getElementById('lookback-market').value;
        const duration = calculateDynamicDuration(symbol);
        durationInput.value = duration;
    }
}

/**
 * Calculate optimal duration based on market volatility
 */
function calculateDynamicDuration(symbol) {
    const recentTicks = marketTickHistory[symbol] || [];

    if (recentTicks.length < 20) {
        console.log('📊 Insufficient data for dynamic duration, using default 1 min');
        return 1;
    }

    // Calculate volatility from last 20 ticks
    const prices = recentTicks.slice(-20).map(t => parseFloat(t.quote));
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const volatility = ((high - low) / avgPrice) * 100;

    console.log(`📊 Market volatility: ${volatility.toFixed(3)}%`);

    // Dynamic duration based on volatility
    if (volatility > 1.5) {
        console.log('⚡ High volatility detected: Using 1 minute duration');
        return 1;
    } else if (volatility > 0.8) {
        console.log('📈 Moderate volatility: Using 2 minute duration');
        return 2;
    } else {
        console.log('📉 Low volatility: Using 3 minute duration');
        return 3;
    }
}

/**
 * Execute Lookback Hedge with mode selection
 */
function executeLookbackHedgeWithMode() {
    const symbol = document.getElementById('lookback-market').value;
    const stake = parseFloat(document.getElementById('lookback-stake').value);
    const isAuto = document.querySelector('input[name="duration-mode"]:checked').value === 'auto';

    let duration;
    if (isAuto) {
        duration = calculateDynamicDuration(symbol);
        document.getElementById('lookback-duration').value = duration;
    } else {
        duration = parseInt(document.getElementById('lookback-duration').value);
    }

    executeLookbackHedge(symbol, stake, duration);
}

/**
 * Update Lookback hedge state with contract IDs
 */
function updateLookbackHedgeContract(runId, contractType, contractId, buyPrice) {
    if (hedgingState.activeLookbackHedges[runId]) {
        if (contractType === 'LBFLOATCALL') {
            hedgingState.activeLookbackHedges[runId].hlContractId = contractId;
            hedgingState.activeLookbackHedges[runId].hlBuyPrice = buyPrice;
        } else if (contractType === 'LBFLOATPUT') {
            hedgingState.activeLookbackHedges[runId].clContractId = contractId;
            hedgingState.activeLookbackHedges[runId].clBuyPrice = buyPrice;
        }
        updateLookbackContractsDisplay();
    }
}

/**
 * Update Lookback contract P/L in real-time
 */
function updateLookbackContractPL(contractId, currentPL) {
    for (const runId in hedgingState.activeLookbackHedges) {
        const hedge = hedgingState.activeLookbackHedges[runId];
        if (hedge.hlContractId === contractId) {
            hedge.hlPL = currentPL;
            updateLookbackContractsDisplay();
            break;
        } else if (hedge.clContractId === contractId) {
            hedge.clPL = currentPL;
            updateLookbackContractsDisplay();
            break;
        }
    }
}

/**
 * Display active Lookback contracts
 */
function updateLookbackContractsDisplay() {
    const container = document.getElementById('lookback-contracts-list');
    const totalPLElement = document.getElementById('lookback-total-pl');
    const closeAllBtn = document.getElementById('close-all-lookback');

    const activeHedges = Object.keys(hedgingState.activeLookbackHedges);

    if (activeHedges.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 20px;">No active hedges</p>';
        totalPLElement.textContent = '$0.00';
        totalPLElement.style.color = 'var(--text-primary)';
        closeAllBtn.style.display = 'none';
        return;
    }

    closeAllBtn.style.display = 'block';
    let totalPL = 0;
    let html = '';

    activeHedges.forEach(runId => {
        const hedge = hedgingState.activeLookbackHedges[runId];
        const pairPL = (hedge.hlPL || 0) + (hedge.clPL || 0);
        totalPL += pairPL;

        const plColor = pairPL >= 0 ? '#10b981' : '#ef4444';
        const plSign = pairPL >= 0 ? '+' : '';

        html += `
            <div style="padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-md); border: 1px solid var(--glass-border);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div>
                        <strong>${hedge.symbol}</strong>
                        <span style="color: var(--text-muted); font-size: 0.85rem; margin-left: 8px;">${hedge.duration}m</span>
                    </div>
                    <button onclick="closeLookbackPair('${runId}')" class="btn-secondary" style="padding: 4px 10px; font-size: 0.8rem;">
                        Close Pair
                    </button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 0.85rem;">
                    <div>
                        <div style="color: var(--text-muted);">HL P/L</div>
                        <div style="color: ${(hedge.hlPL || 0) >= 0 ? '#10b981' : '#ef4444'};">
                            ${(hedge.hlPL || 0) >= 0 ? '+' : ''}$${(hedge.hlPL || 0).toFixed(2)}
                        </div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted);">CL P/L</div>
                        <div style="color: ${(hedge.clPL || 0) >= 0 ? '#10b981' : '#ef4444'};">
                            ${(hedge.clPL || 0) >= 0 ? '+' : ''}$${(hedge.clPL || 0).toFixed(2)}
                        </div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted);">Total P/L</div>
                        <div style="color: ${plColor}; font-weight: 600;">
                            ${plSign}$${pairPL.toFixed(2)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    const totalColor = totalPL >= 0 ? '#10b981' : '#ef4444';
    const totalSign = totalPL >= 0 ? '+' : '';
    totalPLElement.textContent = `${totalSign}$${totalPL.toFixed(2)}`;
    totalPLElement.style.color = totalColor;
}

/**
 * Close a Lookback hedge pair (both HL and CL contracts)
 */
function closeLookbackPair(runId) {
    const hedge = hedgingState.activeLookbackHedges[runId];
    if (!hedge) {
        console.error('Hedge not found:', runId);
        return;
    }

    console.log(`🛑 Closing Lookback pair for ${hedge.symbol} (runId: ${runId})`);

    // Send sell requests for both contracts
    if (hedge.hlContractId) {
        const sellHL = { "sell": hedge.hlContractId, "price": 0 };
        sendAPIRequest(sellHL)
            .then(() => console.log(`✅ Closed HL contract ${hedge.hlContractId}`))
            .catch(err => console.error(`❌ Failed to close HL:`, err));
    }

    if (hedge.clContractId) {
        const sellCL = { "sell": hedge.clContractId, "price": 0 };
        sendAPIRequest(sellCL)
            .then(() => console.log(`✅ Closed CL contract ${hedge.clContractId}`))
            .catch(err => console.error(`❌ Failed to close CL:`, err));
    }

    showToast(`Closing Lookback pair for ${hedge.symbol}`, 'info');
}

/**
 * Close all active Lookback hedges
 */
function closeAllLookbackHedges() {
    const activeHedges = Object.keys(hedgingState.activeLookbackHedges);
    if (activeHedges.length === 0) {
        showToast('No active Lookback hedges to close', 'info');
        return;
    }

    console.log(`🛑 Closing all ${activeHedges.length} Lookback hedge(s)`);
    activeHedges.forEach(runId => closeLookbackPair(runId));
    showToast(`Closing ${activeHedges.length} Lookback hedge pair(s)`, 'info');
}

/**
 * Remove completed Lookback hedge and add to history
 */
function completeLookbackHedge(runId, finalPL) {
    const hedge = hedgingState.activeLookbackHedges[runId];
    if (!hedge) return;

    // Add to history
    hedgingState.lookbackHistory.unshift({
        timestamp: Date.now(),
        symbol: hedge.symbol,
        duration: hedge.duration,
        stake: hedge.stake,
        pl: finalPL
    });

    // Keep only last 50 trades
    if (hedgingState.lookbackHistory.length > 50) {
        hedgingState.lookbackHistory = hedgingState.lookbackHistory.slice(0, 50);
    }

    // Remove from active
    delete hedgingState.activeLookbackHedges[runId];

    // Update displays
    updateLookbackContractsDisplay();
    updateLookbackHistoryDisplay();

    console.log(`✅ Lookback hedge completed: ${hedge.symbol}, P/L: $${finalPL.toFixed(2)}`);
}

/**
 * Update trade history display
 */
function updateLookbackHistoryDisplay() {
    const tbody = document.getElementById('lookback-history-body');

    if (hedgingState.lookbackHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">No trade history yet</td></tr>';
        return;
    }

    let html = '';
    hedgingState.lookbackHistory.forEach(trade => {
        const time = new Date(trade.timestamp).toLocaleTimeString();
        const plColor = trade.pl >= 0 ? '#10b981' : '#ef4444';
        const plSign = trade.pl >= 0 ? '+' : '';

        html += `
            <tr style="border-bottom: 1px solid var(--glass-border);">
                <td style="padding: 8px;">${time}</td>
                <td style="padding: 8px;">${trade.symbol}</td>
                <td style="padding: 8px; text-align: center;">${trade.duration}m</td>
                <td style="padding: 8px; text-align: right;">$${trade.stake.toFixed(2)}</td>
                <td style="padding: 8px; text-align: right; color: ${plColor}; font-weight: 600;">
                    ${plSign}$${trade.pl.toFixed(2)}
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

console.log('✅ Hedging module loaded');
