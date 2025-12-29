// ===================================
// TRADING INTERFACE FUNCTIONS
// ===================================

// Track balance subscription ID to cancel when switching accounts
let currentBalanceSubscriptionId = null;

function requestBalance() {
    // Cancel previous balance subscription if it exists
    if (currentBalanceSubscriptionId) {
        console.log('🔄 Cancelling previous balance subscription:', currentBalanceSubscriptionId);
        sendAPIRequest({ "forget": currentBalanceSubscriptionId });
        currentBalanceSubscriptionId = null;
    }

    const balanceRequest = { "balance": 1, "subscribe": 1 };
    sendAPIRequest(balanceRequest);
}

function requestActiveSymbols() {
    const symbolsRequest = { "active_symbols": "brief", "product_type": "basic" };
    sendAPIRequest(symbolsRequest);
}

function subscribeToAllVolatilities() {
    console.log('🔍 Debugging activeSymbols array:', activeSymbols);
    console.log('🔍 Total symbols received:', activeSymbols.length);

    // Debug: Show all markets available
    const markets = [...new Set(activeSymbols.map(s => s.market))];
    console.log('🔍 Available markets:', markets);

    // Debug: Show ALL symbols and their markets
    console.log('🔍 All available symbols:');
    activeSymbols.forEach(symbol => {
        console.log(`  - ${symbol.symbol} (${symbol.market})`);
    });

    // Debug: Show synthetic indices specifically
    const syntheticSymbols = activeSymbols.filter(s => s.market === 'synthetic_index');
    console.log('🔍 Synthetic indices found:', syntheticSymbols.length);
    syntheticSymbols.forEach(symbol => {
        console.log(`  - ${symbol.symbol} (${symbol.market})`);
    });

    // Try different market name variations
    const alternativeSynthetic = activeSymbols.filter(s =>
        s.market === 'synthetic_index' ||
        s.market === 'synthetic' ||
        s.market === 'volatility' ||
        s.market === 'derived'
    );
    console.log('🔍 Alternative synthetic market names:', alternativeSynthetic.length);

    // Filter for ALLOWED synthetic indices (Volatility, Jump, Daily Reset)
    const volatilitySymbols = activeSymbols
        .filter(symbol => symbol.market === 'synthetic_index' && isAllowedBotMarket(symbol.symbol))
        .map(symbol => symbol.symbol);

    console.log(`✅ Subscribing to ${volatilitySymbols.length} synthetic indices:`, volatilitySymbols);

    if (volatilitySymbols.length === 0) {
        console.warn("⚠️ No synthetic indices found! This will prevent the bot from working.");
        console.warn("⚠️ Check if active_symbols request succeeded and contains synthetic_index market symbols.");

        // Try subscribing to ALL symbols as fallback
        const allSymbols = activeSymbols.map(s => s.symbol);
        console.log('🔄 Fallback: Subscribing to ALL available symbols:', allSymbols);

        volatilitySymbols.push(...allSymbols);
    }

    sendAPIRequest({ "forget_all": "ticks" });

    volatilitySymbols.forEach((symbol, index) => {
        sendAPIRequest({ "ticks_history": symbol, "count": 1, "end": "latest", "style": "ticks", "subscribe": 1 });

        // Initialize market tick history
        marketTickHistory[symbol] = [];
        marketDigitPercentages[symbol] = {
            0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0
        };
        marketFullTickDigits[symbol] = [];

        // Fetch historical tick data for distribution analysis (100 ticks immediately)
        console.log(`📊 Fetching 100 historical ticks for ${symbol}...`);
        fetchTickHistory(symbol);

        if (!document.getElementById(`row-${symbol}`)) {
            const row = tickerTableBody.insertRow();
            row.id = `row-${symbol}`;

            const symbolCell = row.insertCell(0);
            // Better display names for various indices
            let displayName = symbol;

            // Volatility Indices
            if (symbol.startsWith('R_')) displayName = symbol.replace('R_', 'Vol ');
            else if (symbol.startsWith('1HZ')) displayName = symbol.replace('1HZ', 'Vol ').replace('V', '');

            // Jump Indices
            else if (symbol.startsWith('JD')) displayName = symbol.replace('JD', 'Jump ');

            // Crash/Boom
            else if (symbol.includes('CRASH')) displayName = symbol.replace('CRASH', 'Crash ');
            else if (symbol.includes('BOOM')) displayName = symbol.replace('BOOM', 'Boom ');

            // Daily Reset Indices
            else if (symbol.includes('RDBEAR')) displayName = 'Bear Market Index';
            else if (symbol.includes('RDBULL')) displayName = 'Bull Market Index';

            // Step Indices
            else if (symbol === 'STPIDX') displayName = 'Step Index';

            // DEX Indices
            else if (symbol.startsWith('DEX')) displayName = symbol.replace('DEX', 'DEX ').replace('DN', ' Down').replace('UP', ' Up');

            // Drift Switching
            else if (symbol.startsWith('DRIFT')) displayName = symbol.replace('DRIFT', 'Drift ');

            // Add (1s) suffix for 1-second indices
            if (symbol.startsWith('1HZ') || symbol.includes('1s')) {
                displayName += ' (1s)';
            }

            symbolCell.textContent = displayName;

            row.insertCell(1).textContent = '--';
            row.insertCell(2).textContent = '--';
        }
    });

    // Hide skeleton and show table after a delay to simulate loading
    setTimeout(() => {
        const skeleton = document.getElementById('marketWatchSkeleton');
        const table = document.getElementById('tickerTable');
        if (skeleton && table) {
            skeleton.style.display = 'none';
            table.style.display = 'table';
        }
    }, 2000);
}

function requestMarketData(symbol) {
    if (!currentChart) initializeChart();
    CHART_MARKET = symbol;

    const historyRequest = {
        "ticks_history": symbol,
        "end": "latest",
        "count": 400,
        "adjust_start_time": 1,
        "style": "candles",
        "granularity": CHART_INTERVAL,
        "subscribe": 0
    };
    sendAPIRequest(historyRequest);

    tradeMessageContainer.textContent = `Loading data for ${symbol}...`;
}

/**
 * Fetches historical tick data for a symbol to build full digit distribution
 * @param {string} symbol - The symbol to fetch tick history for
 */
function fetchTickHistory(symbol) {
    const tickHistoryRequest = {
        "ticks_history": symbol,
        "end": "latest",
        "count": 100,
        "style": "ticks",
        "subscribe": 0
    };
    sendAPIRequest(tickHistoryRequest);
}

function handleMarketChange() {
    const newSymbol = marketSelector.value;
    requestMarketData(newSymbol);
    updateDigitAnalysisDisplay(newSymbol);
}

/**
 * Handles distribution market selector change
 */
function handleDistributionMarketChange() {
    const distributionMarketSelector = document.getElementById('distributionMarketSelector');
    if (distributionMarketSelector) {
        const selectedSymbol = distributionMarketSelector.value;
        updateDigitAnalysisDisplay(selectedSymbol);
    }
}

/**
 * Refreshes the distribution data by fetching new 100 ticks
 */
function refreshDistributionData() {
    const distributionMarketSelector = document.getElementById('distributionMarketSelector');
    if (!distributionMarketSelector) return;

    const selectedSymbol = distributionMarketSelector.value;

    // Show loading state
    const skeleton = document.getElementById('digitAnalysisSkeleton');
    const content = document.getElementById('digitAnalysisContent');
    if (skeleton && content) {
        skeleton.style.display = 'block';
        content.style.display = 'none';
    }

    // Fetch fresh 100 ticks
    console.log(`🔄 Refreshing distribution data for ${selectedSymbol}...`);
    fetchTickHistory(selectedSymbol);

    // Show toast notification
    if (typeof showToast === 'function') {
        showToast(`Refreshing ${selectedSymbol} distribution data...`, 'info');
    }
}

/**
 * Updates the last digit indicator (red dot) for the current market
 * @param {string} symbol - The symbol to update indicator for
 * @param {number} lastDigit - The last digit from the latest tick
 */
function updateLastDigitIndicator(symbol, lastDigit) {
    // Check which market is selected for distribution display
    const distributionMarketSelector = document.getElementById('distributionMarketSelector');
    const selectedDistributionMarket = distributionMarketSelector ? distributionMarketSelector.value : null;

    // Only update if this is the currently selected distribution market
    if (selectedDistributionMarket && selectedDistributionMarket !== symbol) {
        return;
    }

    // Remove active class from all indicators
    for (let i = 0; i <= 9; i++) {
        const indicator = document.getElementById(`lastDigitIndicator${i}`);
        if (indicator) {
            indicator.classList.remove('active');
        }
    }

    // Add active class to the current digit's indicator
    const currentIndicator = document.getElementById(`lastDigitIndicator${lastDigit}`);
    if (currentIndicator) {
        currentIndicator.classList.add('active');
    }
}

/**
 * Sends a buy request to the Deriv API.
 * @param {string} action - 'CALL' for Up or 'PUT' for Down.
 */
function sendPurchaseRequest(action) {
    const symbol = marketSelector.value;
    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);

    // Validation
    if (!symbol) {
        showToast("Please select a market", 'warning');
        return;
    }

    if (isNaN(stake) || stake < 0.35) {
        showToast("Minimum stake is 0.35 USD", 'warning');
        stakeInput.focus();
        return;
    }

    if (isNaN(duration) || duration < 1) {
        showToast("Minimum duration is 1 tick", 'warning');
        durationInput.focus();
        return;
    }

    // Disable buttons to prevent double-submission
    buyButtonUp.disabled = true;
    buyButtonDown.disabled = true;

    const actionText = action === 'CALL' ? 'UP' : 'DOWN';
    tradeMessageContainer.innerHTML = `
        <svg class="message-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>Placing ${actionText} trade on ${symbol}...</span>
    `;

    const purchaseRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": (action === 'CALL' ? "CALL" : "PUT"),
            "currency": "USD",
            "duration": duration,
            "duration_unit": "t",
            "symbol": symbol,
        }
    };

    sendAPIRequest(purchaseRequest)
        .catch(error => {
            buyButtonUp.disabled = false;
            buyButtonDown.disabled = false;
            showToast("Failed to place trade", 'error');
        });
}

// ----------------------------------------------------
// 2. Authorization and Primary Flow
// ----------------------------------------------------

function authorizeAndProceed(apiToken) {
    const authRequest = {
        "authorize": apiToken,
        "passthrough": { "purpose": "initial_login" }
    };
    sendAPIRequest(authRequest);
}

function handleLogin() {
    const apiToken = apiTokenInput.value.trim();

    if (!apiToken) {
        statusMessage.textContent = "⚠️ Please enter a valid API Token.";
        showToast("API Token is required", 'warning');
        apiTokenInput.focus();
        return;
    }

    // Validate token format (basic check)
    if (apiToken.length < 10) {
        statusMessage.textContent = "⚠️ Invalid API Token format.";
        showToast("API Token appears to be invalid", 'error');
        return;
    }

    // Save the API token for session persistence
    localStorage.setItem('deriv_token', apiToken);
    localStorage.setItem('deriv_account_type', 'demo'); // Assume demo for manual login

    setButtonLoading(loginButton, true);
    statusMessage.textContent = "Authorizing your account...";

    if (connection && connection.readyState === WebSocket.OPEN) {
        authorizeAndProceed(apiToken);
    } else {
        connectToDeriv();
        const checkConnection = setInterval(() => {
            if (connection && connection.readyState === WebSocket.OPEN) {
                clearInterval(checkConnection);
                authorizeAndProceed(apiToken);
            }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
            clearInterval(checkConnection);
            if (!connection || connection.readyState !== WebSocket.OPEN) {
                setButtonLoading(loginButton, false);
                showToast("Connection timeout. Please try again.", 'error');
            }
        }, 10000);
    }
}

// ----------------------------------------------------
// 3. Symbol Population
// ----------------------------------------------------

function populateMarketSelector() {
    marketSelector.innerHTML = '';
    console.log('📊 Populating market selector with symbols...');

    const volatilitySymbols = activeSymbols
        .filter(symbol => symbol.market === 'synthetic_index')
        .sort((a, b) => a.symbol.localeCompare(b.symbol));

    console.log(`📊 Found ${volatilitySymbols.length} symbols for market selector`);

    volatilitySymbols.forEach(symbolData => {
        const option = document.createElement('option');
        option.value = symbolData.symbol;

        // Better display names for various indices (matching ticker table logic)
        let displayName = symbolData.symbol;
        const symbol = symbolData.symbol;

        // Volatility Indices
        if (symbol.startsWith('R_')) displayName = symbol.replace('R_', 'Vol ');
        else if (symbol.startsWith('1HZ')) displayName = symbol.replace('1HZ', 'Vol ').replace('V', '');

        // Jump Indices
        else if (symbol.startsWith('JD')) displayName = symbol.replace('JD', 'Jump ');

        // Crash/Boom
        else if (symbol.includes('CRASH')) displayName = symbol.replace('CRASH', 'Crash ');
        else if (symbol.includes('BOOM')) displayName = symbol.replace('BOOM', 'Boom ');

        // Range Break
        else if (symbol.includes('RDBEAR')) displayName = 'Bear Break';
        else if (symbol.includes('RDBULL')) displayName = 'Bull Break';

        // Step Indices
        else if (symbol === 'STPIDX') displayName = 'Step Index';

        // DEX Indices
        else if (symbol.startsWith('DEX')) displayName = symbol.replace('DEX', 'DEX ').replace('DN', ' Down').replace('UP', ' Up');

        // Drift Switching
        else if (symbol.startsWith('DRIFT')) displayName = symbol.replace('DRIFT', 'Drift ');

        // Add (1s) suffix for 1-second indices
        if (symbol.startsWith('1HZ') || symbol.includes('1s')) {
            displayName += ' (1s)';
        }

        option.textContent = `${displayName} (${symbolData.display_name})`;
        marketSelector.appendChild(option);
    });

    // Ensure the default market is selected
    if (marketSelector.querySelector(`option[value="${CHART_MARKET}"]`)) {
        marketSelector.value = CHART_MARKET;
    } else if (volatilitySymbols.length > 0) {
        CHART_MARKET = volatilitySymbols[0].symbol;
        marketSelector.value = CHART_MARKET;
    }

    console.log('📊 Market selector populated with options:', marketSelector.options.length);

    // Initialize digit analysis display for the default market
    updateDigitAnalysisDisplay(CHART_MARKET);
}

/**
 * Updates the digit analysis display for the selected market
 * @param {string} symbol - The symbol to display digit analysis for
 */
function updateDigitAnalysisDisplay(symbol) {
    const skeleton = document.getElementById('digitAnalysisSkeleton');
    const content = document.getElementById('digitAnalysisContent');

    // Show loading skeleton
    if (skeleton && content) {
        skeleton.style.display = 'block';
        content.style.display = 'none';
    }

    // Check if we have digit distribution data
    const distribution = calculateFullDigitDistribution(symbol);

    if (!distribution) {
        // No data available yet, keep skeleton visible
        console.log(`⏳ Waiting for digit distribution data for ${symbol}...`);
        setTimeout(() => updateDigitAnalysisDisplay(symbol), 1000);
        return;
    }

    console.log(`✅ Digit distribution for ${symbol}:`, distribution);
    console.log(`   Total ticks analyzed: ${distribution.totalTicks}`);
    console.log(`   Most appearing: ${distribution.mostAppearingDigit} (${distribution.counts[distribution.mostAppearingDigit]} times)`);
    console.log(`   Least appearing: ${distribution.leastAppearingDigit} (${distribution.counts[distribution.leastAppearingDigit]} times)`);

    // Hide skeleton and show content
    if (skeleton && content) {
        skeleton.style.display = 'none';
        content.style.display = 'block';
    }

    // Update summary
    const mostFrequentEl = document.getElementById('mostFrequentDigit');
    const leastFrequentEl = document.getElementById('leastFrequentDigit');
    const distributionCheckEl = document.getElementById('distributionCheck');
    const tickCountEl = document.getElementById('distributionTickCount');

    if (mostFrequentEl) {
        mostFrequentEl.textContent = `${distribution.mostAppearingDigit} (${distribution.counts[distribution.mostAppearingDigit]} times)`;
    }

    if (leastFrequentEl) {
        leastFrequentEl.textContent = `${distribution.leastAppearingDigit} (${distribution.counts[distribution.leastAppearingDigit]} times)`;
    }

    if (distributionCheckEl) {
        const isValid = distribution.mostAppearingDigit > 4 && distribution.leastAppearingDigit < 4;
        distributionCheckEl.textContent = isValid ? 'PASS' : 'FAIL';
        distributionCheckEl.className = `summary-value ${isValid ? 'pass' : 'fail'}`;
    }

    if (tickCountEl) {
        tickCountEl.textContent = `${distribution.totalTicks} ticks`;
        tickCountEl.className = distribution.totalTicks >= 100 ? 'summary-value' : 'summary-value warning';
    }

    // Sort digits by frequency to determine ranking
    const sortedDigits = Object.entries(distribution.counts)
        .map(([digit, count]) => ({ digit: parseInt(digit), count }))
        .sort((a, b) => b.count - a.count);

    // Update horizontal bars with color coding based on frequency ranking
    for (let digit = 0; digit <= 9; digit++) {
        const barEl = document.getElementById(`digitBar${digit}`);
        const percentEl = document.getElementById(`digitPercent${digit}`);

        if (barEl && percentEl) {
            const count = distribution.counts[digit];
            const percentage = (count / distribution.totalTicks) * 100;

            barEl.style.width = `${percentage.toFixed(1)}%`;
            percentEl.textContent = `${percentage.toFixed(1)}%`;

            // Remove all color classes
            barEl.classList.remove('most-frequent', 'second-frequent', 'third-frequent', 'least-frequent');

            // Find the rank of this digit
            const rank = sortedDigits.findIndex(item => item.digit === digit);

            // Apply color based on ranking
            // Green = most appearing (rank 0)
            // Blue = 2nd most appearing (rank 1)
            // Yellow = 3rd most appearing (rank 2)
            // Red = least appearing (rank 9)
            if (rank === 0) {
                barEl.classList.add('most-frequent');
            } else if (rank === 1) {
                barEl.classList.add('second-frequent');
            } else if (rank === 2) {
                barEl.classList.add('third-frequent');
            } else if (rank === 9) {
                barEl.classList.add('least-frequent');
            }
        }
    }
}