// ===================================
// GHOST_TRADES - ENHANCED TRADING PLATFORM
// Improved Error Handling & Code Organization
// ===================================

// --- Constants ---
const APP_ID = 111038;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

// --- Account Types ---
const ACCOUNT_TYPES = {
    DEMO: 'demo',
    REAL: 'real'
};

// --- Deriv OAuth Configuration ---
const OAUTH_CONFIG = {
    app_id: '111038',
    authorization_url: 'https://oauth.deriv.com/oauth2/authorize',
    token_url: 'https://oauth.deriv.com/oauth2/token',
    // Dynamic redirect URI to support Localhost, Render, and Custom Domain automatically
    redirect_uri: window.location.origin + window.location.pathname,
    scope: 'read,trade,payments,trading_information,admin',
    brand: 'deriv',
    language: 'EN',
    response_type: 'token' // Using implicit flow for direct token response
};

// --- Core State ---
let activeSymbols = [];
window.activeSymbols = activeSymbols; // Expose globally for other modules (ai_ui.js)
let lastPrices = {};
let currentContractId = null;

// --- Bot Toggle State ---
let isBotRunning = false; // NEW: State for the bot
let botLoopInterval = null; // NEW: To hold the bot's running interval

// --- GLOBAL MARKET DATA STRUCTURE ---
// Stores the last 20 digits for every subscribed volatility index.
let marketTickHistory = {};
// Stores percentage analysis for each digit (0-9) for each market
let marketDigitPercentages = {};
// Stores the last 100 digits for distribution analysis
let marketFullTickDigits = {};

// --- GLOBAL TRADE LOCK MECHANISM ---
// Prevents duplicate trades on the same symbol from different bots
let globalTradeLocks = {}; // { symbol: { timestamp, botType } }
const TRADE_LOCK_DURATION = 5000; // 5 seconds lock per symbol (increased for safety)
// ----------------------------------------

// --- ERROR TOAST DEDUPLICATION ---
// Prevents showing the same error toast multiple times
let recentErrors = new Map(); // { errorCode: timestamp }
const ERROR_TOAST_COOLDOWN = 5000; // Don't show same error within 5 seconds
// ----------------------------------------

// --- Chart Setup ---
let currentChart = null;
let candleSeries = null;
let CHART_MARKET = 'R_100'; // Default market: Volatility 100 Index
const CHART_INTERVAL = '60'; // 1 minute interval

// --- DOM Elements ---
// Authentication & Dashboard
const apiTokenInput = document.getElementById('apiTokenInput');
const authContainer = document.querySelector('.auth-container');
const statusMessage = document.getElementById('statusMessage');
const loginButton = document.getElementById('loginButton');
const dashboard = document.getElementById('dashboard');
const loginIdDisplay = document.getElementById('loginIdDisplay');
const balanceDisplay = document.getElementById('balanceDisplay');
const symbolCountDisplay = document.getElementById('symbolCountDisplay');

// Navigation
const dashboardNav = document.getElementById('dashboard-nav');
const speedbotNav = document.getElementById('speedbot-nav');
const ghostaiNav = document.getElementById('ghostai-nav');
const ghosteoddNav = document.getElementById('ghost-eodd-nav');
const aiStrategyNav = document.getElementById('ghostai-strategy-nav');
const hedgingNav = document.getElementById('hedging-nav');

// Trading Interface
const tradingInterface = document.getElementById('trading-interface');
const ghostaiInterface = document.getElementById('ghostai-interface');
const ghosteoddInterface = document.getElementById('ghost-eodd-interface');
const aiStrategyInterface = document.getElementById('ai-strategy-interface');
const hedgingInterface = document.getElementById('hedging-interface');
const chartContainer = document.getElementById('chart-container');
const tradeMessageContainer = document.getElementById('tradeMessageContainer');
const tickerTableBody = document.querySelector('#tickerTable tbody');

// Trading Controls
const marketSelector = document.getElementById('marketSelector');
const stakeInput = document.getElementById('stakeInput');
const durationInput = document.getElementById('durationInput');
const buyButtonUp = document.getElementById('buyButtonUp');
const buyButtonDown = document.getElementById('buyButtonDown');

const botInitialStake = document.getElementById('botInitialStake');
const botTargetProfit = document.getElementById('botTargetProfit');
const botPayoutPercentage = document.getElementById('botPayoutPercentage');
const botStopLoss = document.getElementById('botStopLoss');
const botMaxMartingale = document.getElementById('botMaxMartingale');
const botLogContainer = document.getElementById('bot-log-container');
const botHistoryTableBody = document.querySelector('#bot-history-table tbody');

// --- Ghost AI Bot State ---
let botState = {
    activeSymbol: null,
    recoverySymbol: null, // Market symbol to stick to during Martingale recovery
    initialStake: 1.0,
    targetProfit: 50.0,
    payoutPercentage: 96,
    stopLoss: 20.0,
    maxMartingaleSteps: 5,
    currentStake: 1.0,
    totalProfit: 0.0,
    totalLoss: 0.0,
    accumulatedStakesLost: 0.0, // Accumulate stake amounts lost for martingale calculation
    activeStrategy: 'S1', // S1 or S2
    martingaleStepCount: 0,
    isTrading: false, // To prevent placing a new trade while one is active
    runId: null,
    winCount: 0, // Number of wins
    lossCount: 0, // Number of losses
    winPercentage: 0, // Win percentage
    s1LossSymbol: null, // Symbol where S1 loss occurred, to avoid in recovery
    totalStake: 0.0, // Total stake across all trades
    totalPayout: 0.0, // Total payout across all trades
    runsCount: 0, // Number of times bot has been started
};

// --- Additional Bot State for Missing Elements ---
let emaValue = null;
let smaValue = null;

// --- OAuth State ---
window.oauthState = {
    access_token: null,
    refresh_token: null,
    account_type: ACCOUNT_TYPES.DEMO, // Default to demo
    login_id: null
};

// Navigation elements already declared above

// ===================================
// MESSAGE ROUTER
// ===================================

function handleIncomingMessage(msg) {
    let data;

    try {
        data = JSON.parse(msg.data);
        console.log('📨 Received WebSocket message:', data.msg_type);
    } catch (error) {
        console.error("❌ Failed to parse message:", error);
        return;
    }

    // Handle API Errors
    if (data.error) {
        console.error("❌ API Error:", data.error.message);

        const errorMessages = {
            'InvalidToken': 'Invalid API Token. Please check and try again.',
            'AuthorizationRequired': 'Authorization required. Please login.',
            'RateLimit': 'Too many requests. Please wait a moment.',
            'DisabledClient': 'Your account is disabled. Please contact support.',
            'InputValidationFailed': 'Invalid input parameters.',
        };

        const userMessage = errorMessages[data.error.code] || data.error.message;

        // Check if we've shown this error recently (deduplication)
        const errorKey = `${data.error.code}_${data.msg_type || 'unknown'}`;
        const now = Date.now();
        const lastShown = recentErrors.get(errorKey);

        // Only show toast if this error hasn't been shown in the last 5 seconds
        if (!lastShown || (now - lastShown) > ERROR_TOAST_COOLDOWN) {
            showToast(userMessage, 'error');
            recentErrors.set(errorKey, now);

            // Clean up old entries (older than 10 seconds)
            for (const [key, timestamp] of recentErrors.entries()) {
                if (now - timestamp > ERROR_TOAST_COOLDOWN * 2) {
                    recentErrors.delete(key);
                }
            }
        } else {
            console.log('🔕 Suppressed duplicate error toast:', errorKey);
        }

        statusMessage.textContent = `❌ ${userMessage}`;

        // Re-enable buttons
        setButtonLoading(loginButton, false);
        buyButtonUp.disabled = false;
        buyButtonDown.disabled = false;

        // Update trade message if it's a purchase error
        if (data.msg_type === 'buy') {
            tradeMessageContainer.innerHTML = `
                <svg class="message-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                    <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span>❌ ${userMessage}</span>
            `;
        }

        return;
    }

    switch (data.msg_type) {
        case 'authorize':
            if (data.authorize) {
                console.log("✅ Authorization successful:", data.authorize.loginid);
                showToast(`Welcome! Logged in as ${data.authorize.loginid}`, 'success');

                // Store login ID in oauthState
                window.oauthState.login_id = data.authorize.loginid;
                localStorage.setItem('deriv_login_id', data.authorize.loginid);

                // Update UI using new UI module
                updateAuthUI(data);

                // --- CRITICAL SAFETY FIX: STOP ALL BOTS ON ACCOUNT SWITCH ---
                let botsStopped = false;

                // 1. Ghost AI Bot
                if (typeof isBotRunning !== 'undefined' && isBotRunning) {
                    console.warn('⚠️ Safety: Stopping Ghost AI Bot due to account switch/login');
                    stopGhostAiBot();
                    botsStopped = true;
                }

                // 2. Even/Odd Bot
                if (typeof evenOddBotState !== 'undefined' && evenOddBotState.isTrading) {
                    console.warn('⚠️ Safety: Stopping Even/Odd Bot due to account switch/login');
                    stopEvenOddBot();
                    botsStopped = true;
                }

                // 3. Market Summary Bot (Check global state if it exists)
                if (window.marketSummaryBotState && window.marketSummaryBotState.isActive) {
                    console.warn('⚠️ Safety: Stopping Market Summary Bot due to account switch/login');
                    stopMarketSummaryBot();
                    botsStopped = true;
                }

                if (botsStopped) {
                    showToast('Safety: All running bots have been stopped due to account switch.', 'warning', 5000);
                }
                // -----------------------------------------------------------

                // Check if it's OAuth authorization
                const isOAuth = data.echo_req && data.echo_req.passthrough && data.echo_req.passthrough.purpose === 'oauth_login';

                // Resolve OAuth promise if it exists
                if (window.oauthResolve) {
                    console.log('OAuth authorization completed successfully');
                    window.oauthResolve();
                    delete window.oauthResolve;
                    delete window.oauthReject;
                }

                // For OAuth logins, set loading state
                if (isOAuth) {
                    statusMessage.textContent = "Loading your account data...";
                }

                // Request balance and active symbols
                console.log('🔄 Requesting balance and symbols after authorization...');
                if (typeof requestBalance === 'function') {
                    requestBalance();
                }
                if (typeof requestActiveSymbols === 'function') {
                    requestActiveSymbols();
                }
            }
            break;

        case 'balance':
            if (data.balance) {
                // Store subscription ID for cancellation when switching accounts
                if (data.subscription && data.subscription.id) {
                    if (typeof currentBalanceSubscriptionId !== 'undefined') {
                        currentBalanceSubscriptionId = data.subscription.id;
                        console.log('✅ Balance subscription ID stored:', currentBalanceSubscriptionId);
                    }
                }
                updateBalanceUI(data.balance.balance, data.balance.currency);
            }
            break;

        case 'active_symbols':
            if (data.active_symbols) {
                activeSymbols = data.active_symbols;
                window.activeSymbols = activeSymbols; // Ensure global ref is updated
                const count = activeSymbols.length;
                symbolCountDisplay.textContent = `${count} markets`;

                console.log(`✅ Loaded ${count} active symbols`);
                console.log('📋 First 10 symbols for debugging:', activeSymbols.slice(0, 10));
                showToast(`${count} markets loaded successfully`, 'success');

                populateMarketSelector();
                subscribeToAllVolatilities();

                // Populate AI Market Selector (with retry mechanism)
                console.log('🔄 Attempting to populate AI Market Selector...');
                if (typeof window.updateAIMarketSelector === 'function') {
                    window.updateAIMarketSelector(activeSymbols);
                } else {
                    console.warn('⚠️ window.updateAIMarketSelector not yet defined, will retry in 500ms');
                    // Retry after a short delay to ensure ai_ui.js is loaded
                    setTimeout(() => {
                        if (typeof window.updateAIMarketSelector === 'function') {
                            console.log('🔄 Retrying AI Market Selector population...');
                            window.updateAIMarketSelector(activeSymbols);
                        } else {
                            console.error('❌ AI Market Selector still not available after retry');
                        }
                    }, 500);
                }
            } else {
                console.error('❌ No active_symbols data received from Deriv API');
                showToast('Failed to load markets from Deriv', 'error');
            }
            break;

        case 'history':
            if (data.history && data.history.candles) {
                const historyData = data.history.candles.map(c => ({
                    time: parseInt(c.epoch),
                    open: parseFloat(c.open),
                    high: parseFloat(c.high),
                    low: parseFloat(c.low),
                    close: parseFloat(c.close),
                })).reverse();

                candleSeries.setData(historyData);
                tradeMessageContainer.textContent = `Chart loaded for ${data.echo_req.ticks_history}. Ready to trade.`;
            } else if (data.history && data.history.times) {
                // Handle tick history for distribution analysis
                const symbol = data.echo_req.ticks_history;
                const quotes = data.history.quotes || [];
                const digits = quotes.map(quote => parseInt(quote.toString().slice(-1)));
                marketFullTickDigits[symbol] = digits.slice(-100); // Keep last 100

                // Log detailed information
                console.log(`✅ Loaded ${digits.length} historical ticks for ${symbol} distribution analysis`);
                console.log(`   Actual ticks stored: ${marketFullTickDigits[symbol].length}`);

                // Count digit distribution for verification
                const counts = {};
                marketFullTickDigits[symbol].forEach(d => {
                    counts[d] = (counts[d] || 0) + 1;
                });
                console.log(`   Digit counts:`, counts);

                // Update the distribution display if this is the selected market
                const distributionMarketSelector = document.getElementById('distributionMarketSelector');
                if (distributionMarketSelector && distributionMarketSelector.value === symbol) {
                    if (typeof updateDigitAnalysisDisplay === 'function') {
                        console.log(`🔄 Updating distribution display for ${symbol}`);
                        updateDigitAnalysisDisplay(symbol);
                    }
                } else {
                    console.log(`ℹ️ Data loaded for ${symbol}, but currently viewing ${distributionMarketSelector?.value || 'unknown'}`);
                }
            }
            break;

        case 'tick':
            if (data.tick) {
                const symbol = data.tick.symbol;
                const price = parseFloat(data.tick.quote);

                // 1. Update Chart (only if it's the market being tracked by the chart)
                if (symbol === CHART_MARKET) {
                    if (candleSeries) {
                        const newCandle = {
                            time: parseInt(data.tick.epoch),
                            open: parseFloat(data.tick.open),
                            high: parseFloat(data.tick.high),
                            low: parseFloat(data.tick.low),
                            close: price,
                        };
                        candleSeries.update(newCandle);
                    }
                }

                // 2. Update Full Tick Digits for distribution analysis (keep last 100)
                if (marketFullTickDigits[symbol]) {
                    const digit = parseInt(price.toString().slice(-1));
                    marketFullTickDigits[symbol].push(digit);
                    if (marketFullTickDigits[symbol].length > 100) {
                        marketFullTickDigits[symbol].shift();
                    }

                    // Update the last digit indicator (red dot)
                    if (typeof updateLastDigitIndicator === 'function') {
                        updateLastDigitIndicator(symbol, digit);
                    }

                    // Update distribution display if this is the selected market (every 10 ticks to avoid too many updates)
                    const distributionMarketSelector = document.getElementById('distributionMarketSelector');
                    if (distributionMarketSelector && distributionMarketSelector.value === symbol) {
                        // Update every 10 ticks
                        if (marketFullTickDigits[symbol].length % 10 === 0) {
                            if (typeof updateDigitAnalysisDisplay === 'function') {
                                updateDigitAnalysisDisplay(symbol);
                            }
                        }
                    }
                }

                // 3. Update Ticker Watch Table
                updateTickerUI(symbol, price, lastPrices[symbol]);
                lastPrices[symbol] = price;

                // 4. Feed AI Strategy Runner
                if (window.aiStrategyRunner && window.aiStrategyRunner.isActive) {
                    const aiTickContext = {
                        symbol: symbol,
                        tick: price,
                        digits: marketFullTickDigits[symbol] || [],
                        lastDigit: parseInt(price.toString().slice(-1)),
                        // We can add more context like percentages if needed, but digits array often sufficient for simple strategies
                    };
                    window.aiStrategyRunner.execute(aiTickContext);
                }

                // 5. Feed Ghost AI Bot
                if (isBotRunning && typeof handleBotTick === 'function') {
                    handleBotTick(data.tick);
                }

                // 6. Feed Ghost Even/Odd Bot
                if (evenOddBotState && evenOddBotState.isTrading && typeof handleEvenOddTick === 'function') {
                    handleEvenOddTick(data.tick);
                }
            }
            break;

        case 'buy':
            buyButtonUp.disabled = false;
            buyButtonDown.disabled = false;

            const contractInfo = data.buy;
            const passthrough = data.echo_req.passthrough;

            // Check if this is a Ghost AI bot trade
            if (passthrough && passthrough.purpose === 'ghost_ai_trade' && passthrough.run_id === botState.runId) {
                if (contractInfo) {
                    const strategy = passthrough.strategy || 'S1';
                    const strategyLabel = strategy === 'S1' ? 'S1 Entry' : 'S2 Recovery';

                    // CRITICAL FIX: Track contract with actual contract_id from API
                    // This is the ONLY place we add to activeContracts for Ghost AI
                    window.activeContracts[contractInfo.contract_id] = {
                        symbol: passthrough.symbol,
                        strategy: strategy,
                        stake: passthrough.stake,
                        startTime: Date.now()
                    };

                    console.log(`✅ Ghost AI: Tracking contract ${contractInfo.contract_id} for ${passthrough.symbol} (${strategy})`);
                    console.log(`📊 Active contracts now:`, Object.keys(window.activeContracts));

                    addBotLog(`✅ ${strategyLabel} contract opened: ${contractInfo.contract_id} | ${passthrough.symbol} | Stake: $${passthrough.stake.toFixed(2)}`);

                    // START LIVE CONTRACT MONITORING - Track every tick for this contract
                    if (typeof addLiveContract === 'function') {
                        const entryTick = contractInfo.entry_tick_display_value ? parseInt(contractInfo.entry_tick_display_value.slice(-1)) : '?';
                        const contractType = (passthrough.barrier <= 4) ? 'OVER' : 'UNDER';
                        addLiveContract(contractInfo.contract_id, passthrough.symbol, entryTick, passthrough.barrier, contractType);
                    }

                    sendAPIRequest({
                        "proposal_open_contract": 1,
                        "contract_id": contractInfo.contract_id,
                        "subscribe": 1,
                        "passthrough": {
                            "purpose": "ghost_ai_trade",
                            "run_id": botState.runId,
                            "symbol": passthrough.symbol,
                            "barrier": passthrough.barrier,
                            "strategy": strategy,
                            "stake": passthrough.stake
                        }
                    });
                }
            }
            // Check if this is a GHOST_E/ODD bot trade
            else if (passthrough && passthrough.purpose === 'ghost_even_odd_trade' && passthrough.run_id === evenOddBotState.runId) {
                if (contractInfo) {
                    // Track this contract for the Even/Odd bot
                    evenOddBotState.activeContracts[contractInfo.contract_id] = {
                        symbol: passthrough.symbol,
                        stake: passthrough.stake,
                        pattern: passthrough.pattern,
                        prediction_type: passthrough.prediction_type
                    };

                    addEvenOddBotLog(`✅ ${passthrough.symbol} contract opened: ${contractInfo.contract_id} | ${passthrough.prediction_type} | Pattern: ${passthrough.pattern}`, 'info');

                    sendAPIRequest({
                        "proposal_open_contract": 1,
                        "contract_id": contractInfo.contract_id,
                        "subscribe": 1,
                        "passthrough": {
                            "purpose": "ghost_even_odd_trade",
                            "run_id": evenOddBotState.runId,
                            "symbol": passthrough.symbol,
                            "prediction_type": passthrough.prediction_type,
                            "pattern": passthrough.pattern,
                            "stake": passthrough.stake
                        }
                    });
                }
            }
            // Check if this is a Market Summary bot trade
            else if (passthrough && passthrough.purpose === 'market_summary_trade' && passthrough.run_id === window.marketSummaryBotState.runId) {
                if (contractInfo) {
                    window.marketSummaryBotState.activeContracts[contractInfo.contract_id] = {
                        symbol: passthrough.symbol,
                        barrier: passthrough.barrier,
                        type: passthrough.type,
                        stake: passthrough.stake
                    };

                    addMarketSummaryLog(`✅ Contract opened: ${contractInfo.contract_id} | ${passthrough.symbol} ${passthrough.type} ${passthrough.barrier}`, 'info');

                    sendAPIRequest({
                        "proposal_open_contract": 1,
                        "contract_id": contractInfo.contract_id,
                        "subscribe": 1,
                        "passthrough": {
                            "purpose": "market_summary_trade",
                            "run_id": window.marketSummaryBotState.runId,
                            "symbol": passthrough.symbol,
                            "barrier": passthrough.barrier,
                            "type": passthrough.type,
                            "stake": passthrough.stake
                        }
                    });
                }
            }
            // Check if this is a Lookback Hedge trade
            else if (passthrough && passthrough.purpose === 'lookback_hedge' && passthrough.run_id) {
                if (contractInfo) {
                    const runId = passthrough.run_id;
                    const contractType = passthrough.contract_type;

                    console.log(`✅ Lookback: ${contractType} contract opened: ${contractInfo.contract_id}`);

                    // Update hedge state with contract ID
                    if (typeof updateLookbackHedgeContract === 'function') {
                        updateLookbackHedgeContract(runId, contractType, contractInfo.contract_id, contractInfo.buy_price);
                    }

                    // Subscribe to contract updates for real-time P/L
                    sendAPIRequest({
                        "proposal_open_contract": 1,
                        "contract_id": contractInfo.contract_id,
                        "subscribe": 1,
                        "passthrough": {
                            "purpose": "lookback_hedge",
                            "run_id": runId,
                            "contract_type": contractType,
                            "symbol": passthrough.symbol
                        }
                    });
                }
            }
            else if (contractInfo) {
                currentContractId = contractInfo.contract_id;
                const payout = parseFloat(contractInfo.payout).toFixed(2);

                showToast(`Trade placed successfully! Contract ID: ${contractInfo.contract_id}`, 'success');

                updateTradeMessageUI(`
                    <svg class="message-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <polyline points="22 4 12 14.01 9 11.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>✅ Trade placed! Contract: ${contractInfo.contract_id} | Payout: ${payout} ${contractInfo.currency}</span>
                `);

                sendAPIRequest({ "proposal_open_contract": 1, "contract_id": currentContractId, "subscribe": 1 });
            }
            break;

        case 'proposal':
            if (data.proposal) {
                const proposal = data.proposal;
                const passthrough = data.echo_req.passthrough;

                // Check if this is a Lookback Hedge proposal
                if (passthrough && passthrough.purpose === 'lookback_hedge_proposal') {
                    console.log(`✅ Proposal received for Lookback Hedge (${passthrough.contract_type}): ${proposal.id}`);

                    // Execute the BUY request using the proposal ID
                    const buyRequest = {
                        "buy": proposal.id,
                        "price": proposal.ask_price,
                        "passthrough": {
                            "purpose": "lookback_hedge", // Switch back to original purpose for buy handler
                            "hedge_type": "lookback",
                            "contract_type": passthrough.contract_type,
                            "run_id": passthrough.run_id,
                            "symbol": passthrough.symbol,
                            "stake": passthrough.stake
                        }
                    };

                    sendAPIRequest(buyRequest)
                        .then(() => console.log(`✅ Buy request sent for ${passthrough.contract_type} on ${passthrough.symbol}`))
                        .catch(error => {
                            console.error(`❌ Failed to buy proposal ${proposal.id}:`, error);
                            showToast(`Failed to execute ${passthrough.contract_type}: ${error.message}`, 'error');
                        });
                }
            }
            break;

        case 'proposal_open_contract':
            const contract = data.proposal_open_contract;

            if (contract.is_expired) {
                const passthrough = data.echo_req.passthrough;

                // Check if this is an AI Strategy trade (Result Handling)
                if (passthrough && passthrough.purpose === 'ai_strategy_trade') {
                    // Check contract result
                    console.log(`🤖 AI Strategy Trade Result: ${contract.symbol} | Profit: ${contract.profit}`);

                    // Call UI handler for Martingale/Stats
                    if (typeof window.handleAIStrategyResult === 'function') {
                        window.handleAIStrategyResult(contract);
                    }

                    sendAPIRequest({ "forget": contract.id });
                }

                // Check if this is a Ghost AI bot trade that we need to process
                else if (passthrough && passthrough.purpose === 'ghost_ai_trade' && passthrough.run_id === botState.runId) {

                    // CRITICAL FIX: Improved contract cleanup logic
                    console.log(`🤖 Ghost AI Trade Result: ${contract.symbol} | Strategy: ${passthrough.strategy || 'S1'} | Profit: ${contract.profit} | Contract ID: ${contract.contract_id}`);
                    console.log(`🔍 Active contracts before cleanup:`, Object.keys(window.activeContracts));

                    // Add symbol and barrier info to the contract for history logging
                    contract.symbol = passthrough.symbol;
                    contract.barrier = passthrough.barrier;
                    contract.strategy = passthrough.strategy || 'S1';

                    // Remove from active contracts tracking and release trade lock
                    // Use contract.contract_id as primary, fallback to contract.id
                    const contractIdToRemove = contract.contract_id || contract.id;

                    if (window.activeContracts[contractIdToRemove]) {
                        const contractInfo = window.activeContracts[contractIdToRemove];

                        console.log(`✅ Found and removing contract ${contractIdToRemove} from activeContracts`);

                        // CRITICAL: Remove expected stake and trade signature for this symbol
                        if (expectedStakes[contractInfo.symbol] !== undefined) {
                            const stake = expectedStakes[contractInfo.symbol];
                            delete expectedStakes[contractInfo.symbol];
                            console.log(`🗑️ Removed expected stake for ${contractInfo.symbol}`);

                            // Also clear the trade signature
                            clearTradeSignature(contractInfo.symbol, passthrough.barrier, stake, 'ghost_ai');
                        }

                        // Remove from S1 symbols tracking if it was an S1 trade
                        if (contractInfo.strategy === 'S1') {
                            console.log(`🔓 Removing ${contractInfo.symbol} from activeS1Symbols`);
                            window.activeS1Symbols.delete(contractInfo.symbol);
                        }

                        // Decrement S2 counter if it was an S2 trade
                        if (contractInfo.strategy === 'S2' && botState.activeS2Count > 0) {
                            botState.activeS2Count--;
                            console.log(`📉 S2 count decremented to ${botState.activeS2Count}`);
                        }

                        delete window.activeContracts[contractIdToRemove];

                        // Release trade lock for this symbol
                        releaseTradeLock(contract.symbol, 'ghost_ai');
                    } else {
                        // Contract not found - use fallback cleanup
                        console.error(`❌ Contract ${contractIdToRemove} NOT found in activeContracts!`);
                        console.error(`Available contracts:`, Object.keys(window.activeContracts));

                        // Fallback: Clean up by symbol AND strategy to prevent stuck state
                        let foundAndRemoved = false;
                        const targetStrategy = passthrough.strategy || 'S1';

                        for (const [id, info] of Object.entries(window.activeContracts)) {
                            if (info.symbol === contract.symbol && info.strategy === targetStrategy) {
                                console.log(`🔧 Fallback cleanup: Removing contract ${id} for symbol ${contract.symbol} (${targetStrategy})`);

                                // CRITICAL: Remove expected stake and signature (fallback)
                                if (expectedStakes[info.symbol] !== undefined) {
                                    const stake = expectedStakes[info.symbol];
                                    delete expectedStakes[info.symbol];
                                    console.log(`🗑️ Removed expected stake for ${info.symbol} (fallback)`);

                                    // Also clear the trade signature (fallback)
                                    clearTradeSignature(info.symbol, passthrough.barrier, stake, 'ghost_ai');
                                }

                                if (info.strategy === 'S1') {
                                    console.log(`🔓 Removing ${info.symbol} from activeS1Symbols (fallback)`);
                                    window.activeS1Symbols.delete(info.symbol);
                                }

                                if (info.strategy === 'S2' && botState.activeS2Count > 0) {
                                    botState.activeS2Count--;
                                    console.log(`📉 S2 count decremented to ${botState.activeS2Count} (fallback)`);
                                }

                                delete window.activeContracts[id];
                                releaseTradeLock(contract.symbol, 'ghost_ai');
                                foundAndRemoved = true;
                                break;
                            }
                        }

                        if (!foundAndRemoved) {
                            console.error(`❌ Could not find any contract for symbol ${contract.symbol} with strategy ${targetStrategy}`);
                            // Force cleanup to prevent permanent lock
                            console.log(`🔧 Force cleanup: Removing ${contract.symbol} from activeS1Symbols and releasing lock`);

                            // CRITICAL: Remove expected stake and signature (force cleanup)
                            if (expectedStakes[contract.symbol] !== undefined) {
                                const stake = expectedStakes[contract.symbol];
                                delete expectedStakes[contract.symbol];
                                console.log(`🗑️ Removed expected stake for ${contract.symbol} (force cleanup)`);

                                // Also clear the trade signature (force cleanup)
                                clearTradeSignature(contract.symbol, passthrough.barrier, stake, 'ghost_ai');
                            }

                            window.activeS1Symbols.delete(contract.symbol);
                            releaseTradeLock(contract.symbol, 'ghost_ai');
                        }
                    }

                    console.log(`🔍 Active contracts after cleanup:`, Object.keys(window.activeContracts));
                    console.log(`🔍 Active S1 symbols after cleanup:`, Array.from(window.activeS1Symbols));

                    // STOP LIVE CONTRACT MONITORING - Remove from live tracker
                    if (typeof removeLiveContract === 'function') {
                        removeLiveContract(contractIdToRemove);
                    }

                    // CRITICAL: Only add to history if not already processed (prevents duplicates)
                    if (!window.processedContracts.has(contractIdToRemove)) {
                        addBotTradeHistory(contract, contract.profit);
                        window.processedContracts.add(contractIdToRemove);
                        console.log(`✅ Added contract ${contractIdToRemove} to trade history`);
                    } else {
                        console.log(`⚠️ Skipped duplicate history entry for contract ${contractIdToRemove}`);
                    }

                    sendAPIRequest({ "forget": contract.id }); // Unsubscribe

                    // Notification on win
                    if (contract.profit > 0) {
                        const strategyLabel = contract.strategy === 'S1' ? 'S1' : 'S2';
                        showToast(`🎉 ${strategyLabel} Win: +$${contract.profit.toFixed(2)} on ${contract.symbol}`, 'success', 10000);
                    }

                    // --- Update P/L and Win/Loss counts immediately ---
                    const profit = parseFloat(contract.profit);
                    const isWin = profit > 0;
                    const stake = parseFloat(passthrough.stake || 0);

                    // Calculate payout correctly: for wins, payout = stake + profit; for losses, payout = 0
                    const payout = isWin ? stake + profit : 0;

                    // Debug log to verify calculations
                    console.log(`📊 Trade Complete: Stake: $${stake.toFixed(2)} | Profit: $${profit.toFixed(2)} | Payout: $${payout.toFixed(2)}`);

                    // Update total P/L
                    botState.totalPL += profit;

                    // Update total stake and payout
                    botState.totalStake += stake;
                    botState.totalPayout += payout;

                    // Verify the math
                    console.log(`📊 Running Totals: Total Stake: $${botState.totalStake.toFixed(2)} | Total Payout: $${botState.totalPayout.toFixed(2)} | Total P/L: $${botState.totalPL.toFixed(2)} | Calculated P/L: $${(botState.totalPayout - botState.totalStake).toFixed(2)}`);

                    // Update win/loss counts
                    if (isWin) {
                        botState.winCount++;
                    } else {
                        botState.lossCount++;
                    }

                    // Update win percentage immediately for all trades
                    updateWinPercentage();

                    // Update UI immediately after counts change
                    updateProfitLossDisplay();

                    // --- Strategy-Specific Logic ---
                    if (contract.strategy === 'S1') {
                        if (!isWin) {
                            // S1 Loss - Track consecutive losses
                            botState.accumulatedStakesLost += passthrough.stake;
                            botState.martingaleStepCount = 1; // Activate S2 recovery
                            botState.s1LossSymbol = contract.symbol;
                            botState.s1ConsecutiveLosses++;

                            addBotLog(`❌ S1 Loss #${botState.s1ConsecutiveLosses}: $${profit.toFixed(2)} on ${contract.symbol} | Total P/L: $${botState.totalPL.toFixed(2)}`, 'loss');

                            // Check if we should block S1
                            if (botState.s1ConsecutiveLosses >= botState.s1MaxLosses) {
                                botState.s1Blocked = true;
                                addBotLog(`🚫 S1 BLOCKED after ${botState.s1ConsecutiveLosses} consecutive losses! Only S2 recovery trades allowed until losses recovered.`, 'error');
                            }

                            addBotLog(`🔄 S2 Recovery Mode Activated | Accumulated Loss: $${botState.accumulatedStakesLost.toFixed(2)}`, 'warning');
                        } else {
                            // S1 Win - Reset consecutive loss counter
                            botState.s1ConsecutiveLosses = 0; // Reset on win
                            addBotLog(`✅ S1 Win: +$${profit.toFixed(2)} on ${contract.symbol} | Total P/L: $${botState.totalPL.toFixed(2)} | Consecutive losses reset`, 'win');
                        }
                    } else {
                        // S2 Recovery trades handle martingale
                        // Note: S2 counter is already decremented in cleanup logic above

                        if (!isWin) {
                            botState.martingaleStepCount++;

                            addBotLog(`❌ S2 Loss: $${profit.toFixed(2)} on ${contract.symbol} | Total P/L: $${botState.totalPL.toFixed(2)} | Martingale Step ${botState.martingaleStepCount}`, 'loss');

                            // Check for Stop-Loss
                            if (Math.abs(botState.totalPL) >= botState.stopLoss) {
                                addBotLog(`🛑 Stop-Loss Hit: -$${Math.abs(botState.totalPL).toFixed(2)} / $${botState.stopLoss.toFixed(2)} | Bot Stopped`, 'error');
                                stopGhostAiBot();
                                return;
                            }

                            // Accumulate stake amounts lost for martingale calculation
                            botState.accumulatedStakesLost += passthrough.stake;
                            const accumulatedLosses = botState.accumulatedStakesLost;
                            const recoveryMultiplier = 100 / botState.payoutPercentage;
                            const nextStake = accumulatedLosses * recoveryMultiplier;

                            botState.currentStake = parseFloat(nextStake.toFixed(2));
                            addBotLog(`📊 Accumulated Stakes Lost: $${botState.accumulatedStakesLost.toFixed(2)} | Next Stake: $${botState.currentStake.toFixed(2)}`, 'info');

                            // Check for Max Martingale Steps after calculating stake
                            if (botState.martingaleStepCount > botState.maxMartingaleSteps) {
                                addBotLog(`🛑 Max Martingale Steps (${botState.maxMartingaleSteps}) Reached | Bot Stopped`, 'error');
                                stopGhostAiBot();
                                return;
                            }

                            addBotLog(`⚠️ Recovery Mode: Stake → $${botState.currentStake.toFixed(2)} | Locked on ${botState.recoverySymbol}`, 'warning');
                        } else {
                            // S2 Win - Reset martingale
                            addBotLog(`✅ S2 Win: +$${profit.toFixed(2)} on ${contract.symbol} | Total P/L: $${botState.totalPL.toFixed(2)} | Martingale reset`, 'win');

                            // Reset martingale state and unblock S1
                            botState.currentStake = botState.initialStake;
                            botState.activeStrategy = 'S1';
                            botState.martingaleStepCount = 0;
                            botState.recoverySymbol = null;
                            botState.s1LossSymbol = null;
                            botState.accumulatedStakesLost = 0.0;
                            botState.s1ConsecutiveLosses = 0; // Reset consecutive losses

                            if (botState.s1Blocked) {
                                botState.s1Blocked = false;
                                addBotLog(`✅ S1 UNBLOCKED! Losses recovered. S1 trades now allowed again.`, 'win');
                            }

                            addBotLog(`🔄 S2 Recovery Successful! Martingale reset | Back to base stake: $${botState.currentStake.toFixed(2)}`, 'info');
                        }
                    }

                    // Check for target profit
                    if (botState.totalPL >= botState.targetProfit) {
                        addBotLog(`🎉 Target Profit Reached: $${botState.totalPL.toFixed(2)} / $${botState.targetProfit.toFixed(2)}`, 'win');
                        stopGhostAiBot();
                    }
                }
                // Check if it's a GHOST_E/ODD bot trade
                else if (passthrough && passthrough.purpose === 'ghost_even_odd_trade' && passthrough.run_id === evenOddBotState.runId) {

                    // Add symbol and prediction info to the contract for history logging
                    contract.symbol = passthrough.symbol;
                    contract.prediction_type = passthrough.prediction_type;
                    contract.pattern = passthrough.pattern;

                    addEvenOddBotTradeHistory(contract, contract.profit);

                    sendAPIRequest({ "forget": contract.id }); // Unsubscribe

                    // Remove from active contracts and release trade lock
                    const contractIdToRemove = contract.contract_id || contract.id;

                    if (evenOddBotState.activeContracts[contractIdToRemove]) {
                        delete evenOddBotState.activeContracts[contractIdToRemove];

                        // Release trade lock for this symbol
                        releaseTradeLock(contract.symbol, 'ghost_eodd');
                    } else {
                        console.error(`❌ E/ODD Contract ${contractIdToRemove} NOT found in activeContracts!`);

                        // Fallback cleanup by symbol
                        for (const [id, info] of Object.entries(evenOddBotState.activeContracts)) {
                            if (info.symbol === contract.symbol) {
                                console.log(`🔧 Fallback: Removing E/ODD contract ${id} for ${contract.symbol}`);
                                delete evenOddBotState.activeContracts[id];
                                releaseTradeLock(contract.symbol, 'ghost_eodd');
                                break;
                            }
                        }
                    }

                    // Notification on win
                    if (contract.profit > 0) {
                        showToast(`🎉 E/ODD Bot Win: +$${contract.profit.toFixed(2)} on ${contract.symbol}`, 'success', 10000);
                    }
                    // Check if it's a Market Summary bot trade
                    else if (passthrough && passthrough.purpose === 'market_summary_trade' && passthrough.run_id === window.marketSummaryBotState.runId) {
                        contract.symbol = passthrough.symbol;
                        contract.barrier = passthrough.barrier;
                        contract.type = passthrough.type;

                        sendAPIRequest({ "forget": contract.id });

                        // Remove from active contracts
                        if (window.marketSummaryBotState.activeContracts[contract.contract_id]) {
                            delete window.marketSummaryBotState.activeContracts[contract.contract_id];
                        }

                        // Update profit/loss
                        window.marketSummaryBotState.totalPL += contract.profit;

                        if (contract.profit > 0) {
                            window.marketSummaryBotState.winCount++;
                            showToast(`🎉 Market Summary Win: +$${contract.profit.toFixed(2)} on ${contract.symbol}`, 'success', 10000);
                            addMarketSummaryLog(`✅ Win: +$${contract.profit.toFixed(2)} on ${contract.symbol} | Total P/L: $${window.marketSummaryBotState.totalPL.toFixed(2)}`, 'win');

                            // Reset martingale on win
                            window.marketSummaryBotState.currentStake = window.marketSummaryBotState.initialStake;
                            window.marketSummaryBotState.martingaleStep = 0;
                            window.marketSummaryBotState.accumulatedLoss = 0;
                        } else {
                            window.marketSummaryBotState.lossCount++;
                            addMarketSummaryLog(`❌ Loss: $${contract.profit.toFixed(2)} on ${contract.symbol} | Total P/L: $${window.marketSummaryBotState.totalPL.toFixed(2)}`, 'loss');

                            // Apply martingale
                            window.marketSummaryBotState.martingaleStep++;
                            window.marketSummaryBotState.accumulatedLoss += Math.abs(contract.profit);
                            window.marketSummaryBotState.currentStake = parseFloat((window.marketSummaryBotState.currentStake * window.marketSummaryBotState.martingaleMultiplier).toFixed(2));

                            addMarketSummaryLog(`🔄 Martingale Step ${window.marketSummaryBotState.martingaleStep} | Next Stake: $${window.marketSummaryBotState.currentStake.toFixed(2)}`, 'warning');
                        }

                        // Check stop conditions
                        if (window.marketSummaryBotState.totalPL >= window.marketSummaryBotState.targetProfit) {
                            addMarketSummaryLog(`🎉 Target Profit Reached: $${window.marketSummaryBotState.totalPL.toFixed(2)}`, 'win');
                            stopMarketSummaryBot();
                        } else if (Math.abs(window.marketSummaryBotState.totalPL) >= window.marketSummaryBotState.stopLoss && window.marketSummaryBotState.totalPL < 0) {
                            addMarketSummaryLog(`🛑 Stop Loss Hit: -$${Math.abs(window.marketSummaryBotState.totalPL).toFixed(2)}`, 'error');
                            stopMarketSummaryBot();
                        }

                        updateMarketSummaryProfitDisplay();
                    }

                    // Update GLOBAL martingale (not symbol-specific)
                    const isWin = contract.profit > 0;
                    updateGlobalMartingale(contract.symbol, isWin, contract.profit);

                    // Update global money management
                    updateMoneyManagement(isWin, contract.profit);

                    evenOddBotState.totalPL = mm.totalProfit;
                    evenOddBotState.winCount = mm.winCount;
                    evenOddBotState.lossCount = mm.lossCount;

                    // Check for target profit or stop loss
                    if (mm.totalProfit >= mm.targetProfit) {
                        addEvenOddBotLog(`🎉 Target profit reached: $${mm.totalProfit.toFixed(2)} / $${mm.targetProfit.toFixed(2)}`, 'win');
                        stopEvenOddBot();
                    } else if (Math.abs(mm.totalProfit) >= mm.stopLoss && mm.totalProfit < 0) {
                        addEvenOddBotLog(`🛑 Stop loss hit: -$${Math.abs(mm.totalProfit).toFixed(2)} / $${mm.stopLoss.toFixed(2)}`, 'error');
                        stopEvenOddBot();
                    }

                    updateEvenOddProfitLossDisplay();
                }
                // Check if this is a Lookback Hedge contract
                else if (passthrough && passthrough.purpose === 'lookback_hedge') {
                    const contractId = contract.contract_id;
                    const profit = parseFloat(contract.profit);

                    // Update real-time P/L
                    if (typeof updateLookbackContractPL === 'function') {
                        updateLookbackContractPL(contractId, profit);
                    }

                    // Handle completed contract
                    if (contract.is_expired || contract.is_sold) {
                        console.log(`📊 Lookback contract ${passthrough.contract_type} completed: ${contractId}, P/L: $${profit.toFixed(2)}`);

                        // Check if both contracts in the pair are complete
                        const runId = passthrough.run_id;
                        if (hedgingState && hedgingState.activeLookbackHedges && hedgingState.activeLookbackHedges[runId]) {
                            const hedge = hedgingState.activeLookbackHedges[runId];

                            // Mark this contract as complete
                            if (passthrough.contract_type === 'LBFLOATCALL') {
                                hedge.hlComplete = true;
                            } else if (passthrough.contract_type === 'LBFLOATPUT') {
                                hedge.clComplete = true;
                            }

                            // If both are complete, finalize the hedge
                            if (hedge.hlComplete && hedge.clComplete) {
                                const totalPL = (hedge.hlPL || 0) + (hedge.clPL || 0);
                                console.log(`✅ Lookback pair complete: ${hedge.symbol}, Total P/L: $${totalPL.toFixed(2)}`);

                                if (typeof completeLookbackHedge === 'function') {
                                    completeLookbackHedge(runId, totalPL);
                                }

                                showToast(`Lookback Hedge closed: ${hedge.symbol}, P/L: ${totalPL >= 0 ? '+' : ''}$${totalPL.toFixed(2)}`, totalPL >= 0 ? 'success' : 'error');
                            }
                        }

                        // Unsubscribe from updates
                        sendAPIRequest({ "forget": contract.id });
                    }
                }
                else if (contract.contract_id === currentContractId) {
                    const status = contract.is_sold ? 'SOLD' : 'EXPIRED';
                    const profit = parseFloat(contract.profit).toFixed(2);
                    const classColor = profit >= 0 ? 'price-up' : 'price-down';

                    updateTradeMessageUI(`<span class="${classColor}">💵 ${status}! P/L: ${profit} ${contract.currency}</span>`);
                    sendAPIRequest({ "forget": contract.id });
                    currentContractId = null;
                }
            } else if (contract.contract_id === currentContractId) {
                const pnl = parseFloat(contract.profit).toFixed(2);
                const pnlClass = pnl >= 0 ? 'price-up' : 'price-down';

                // Show real-time technical indicators during trade
                let techIndicatorText = '';
                if (emaValue !== null || smaValue !== null) {
                    techIndicatorText = ` | EMA: ${emaValue ? emaValue.toFixed(2) : 'N/A'} SMA: ${smaValue ? smaValue.toFixed(2) : 'N/A'}`;
                }

                updateTradeMessageUI(`
                    Contract Open: Running P/L: <span class="${pnlClass}">${pnl} ${contract.currency}</span>
                    (Entry: ${contract.entry_tick_display_value})${techIndicatorText}
                `);
            }
            break;

        default:
            // console.log("Unhandled message type:", data.msg_type, data);
            break;
    }
}

// ===================================
// INITIALIZATION (Place this at the very end of app.js)
// ===================================

function handleOAuthRedirectAndInit() {
    console.log('🔄 Checking for OAuth redirect...');
    const hash = window.location.hash;
    const search = window.location.search;

    // 1. FIRST: Check if we're returning from OAuth callback (Deriv uses token1/acct1 format)
    // Check both Hash and Search Query
    if ((hash && (hash.includes('token1=') || hash.includes('acct1='))) ||
        (search && (search.includes('token1=') || search.includes('acct1=')))) {
        console.log('🎯 OAuth parameters detected! Processing before UI load...');
        // Process the OAuth callback immediately
        if (typeof handleOAuthCallback === 'function') {
            handleOAuthCallback();
        }
        return; // Stop here, handleOAuthCallback will redirect to dashboard
    }

    // 2. Check for old-style access_token format (fallback)
    if (hash.includes('access_token')) {
        // Token found in URL hash fragment (after a successful OAuth redirect)
        const params = new URLSearchParams(hash.substring(1));
        const token = params.get('access_token');

        if (token) {
            console.log('✅ OAuth access_token found in URL hash');
            // Save the token for future sessions
            localStorage.setItem('deriv_token', token);

            // Clean the URL hash fragment (highly recommended for security)
            window.history.replaceState({}, document.title, window.location.pathname);

            // Connect and start the authorized session
            connectAndAuthorize(token);
            showSection('dashboard');
            return;
        }
    }

    // 3. SECOND: Check if one is saved from a previous successful login
    const storedToken = localStorage.getItem('deriv_token');
    const storedAccountType = localStorage.getItem('deriv_account_type');
    const storedAccountId = localStorage.getItem('deriv_account_id');

    if (storedToken) {
        console.log('✅ Using stored token from previous session');
        console.log('Account type:', storedAccountType, 'Account ID:', storedAccountId);

        // Restore OAuth state
        window.oauthState.access_token = storedToken;
        window.oauthState.account_type = storedAccountType || 'demo';
        window.oauthState.account_id = storedAccountId;

        // Show loading message
        if (statusMessage) {
            statusMessage.textContent = "Restoring your session...";
        }

        // Restore account switcher
        if (typeof populateAccountSwitcher === 'function') {
            populateAccountSwitcher(); // Loads from localStorage
        }

        // Connect and authorize with stored token
        connectAndAuthorize(storedToken);
        showSection('dashboard');
    } else {
        // 4. No token found. User needs to login.
        console.log('ℹ️ No token found. User needs to initiate login via OAuth buttons.');
        showSection('auth-container');
        // Just establish a basic connection for manual API token login
        connectToDeriv();
    }
}

// function updateGhostAIButtonStates moved to ui.js

// Add this line where you set up other event listeners in app.js
document.addEventListener('DOMContentLoaded', () => {
    // Ghost AI toggle buttons (all three)
    const ghostAIButtonIds = ['ghost-ai-toggle-button', 'ghost-ai-toggle-button-bottom', 'ghost-ai-toggle-button-history'];

    ghostAIButtonIds.forEach(buttonId => {
        const button = document.getElementById(buttonId);
        if (button) {
            button.addEventListener('click', toggleBot);
        }
    });
});

// Final Step: Call the functions to start the application when the script loads
handleOAuthRedirectAndInit();
setupNavigation();