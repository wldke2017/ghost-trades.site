// ===================================
// HEDGING MODULE
// ===================================

/**
 * Hedging State Management
 */
const hedgingState = {
    activeDualHedges: {}, // { symbol: { callContractId, putContractId, stake, timestamp } }
    activeMultiHedges: {}, // { symbol: { contracts: [], stake, timestamp } }
    activeLookbackHedges: {}, // { symbol: { highLowContractId, closeLowContractId, stake, timestamp } }
    totalHedgeProfit: 0,
    hedgeHistory: []
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

    // LBFLOATCALL (High-Low) contract request - NO BASIS parameter for Lookback contracts
    const highLowRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "contract_type": "LBFLOATCALL",
            "currency": "USD",
            "duration": duration,
            "duration_unit": "m",
            "symbol": symbol
        },
        "passthrough": {
            "purpose": "lookback_hedge",
            "hedge_type": "lookback",
            "contract_type": "LBFLOATCALL",
            "run_id": hedgeRunId,
            "symbol": symbol,
            "stake": stake
        }
    };

    // LBFLOATPUT (Close-Low) contract request - NO BASIS parameter for Lookback contracts
    const closeLowRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "contract_type": "LBFLOATPUT",
            "currency": "USD",
            "duration": duration,
            "duration_unit": "m",
            "symbol": symbol
        },
        "passthrough": {
            "purpose": "lookback_hedge",
            "hedge_type": "lookback",
            "contract_type": "LBFLOATPUT",
            "run_id": hedgeRunId,
            "symbol": symbol,
            "stake": stake
        }
    };

    // Track the hedge
    hedgingState.activeLookbackHedges[symbol] = {
        highLowContractId: null,
        closeLowContractId: null,
        stake: stake,
        duration: duration,
        timestamp: Date.now(),
        runId: hedgeRunId
    };

    // Send both requests simultaneously
    sendAPIRequest(highLowRequest)
        .then(() => console.log(`✅ LBFLOATCALL (High-Low) contract placed for ${symbol}`))
        .catch(error => console.error(`❌ Failed to place High-Low contract:`, error));

    sendAPIRequest(closeLowRequest)
        .then(() => console.log(`✅ LBFLOATPUT (Close-Low) contract placed for ${symbol}`))
        .catch(error => console.error(`❌ Failed to place Close-Low contract:`, error));

    // Update UI status
    updateHedgeStatus('lookback', symbol, stake);
    showToast(`Lookback Hedge executed on ${symbol} (${duration}m)`, 'success');
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

console.log('✅ Hedging module loaded');