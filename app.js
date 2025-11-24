// --- Core Deriv API Setup ---
const APP_ID = 111038; 
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
let connection = null;
let activeSymbols = []; 
let lastPrices = {}; 
let currentContractId = null; // NEW: To store the ID of the current open contract for tracking

// --- Chart Setup ---
let currentChart = null; 
let candleSeries = null; 
let CHART_MARKET = 'R_100'; // Default market: Volatility 100 Index
const CHART_INTERVAL = '60'; // 1 minute interval

// --- DOM Elements ---
// Authentication & Dashboard
const apiTokenInput = document.getElementById('apiTokenInput');
const statusMessage = document.getElementById('statusMessage');
const loginButton = document.getElementById('loginButton');
const dashboard = document.getElementById('dashboard');
const loginIdDisplay = document.getElementById('loginIdDisplay');
const balanceDisplay = document.getElementById('balanceDisplay');
const symbolCountDisplay = document.getElementById('symbolCountDisplay');

// Trading Interface
const tradingInterface = document.getElementById('trading-interface'); 
const chartContainer = document.getElementById('chart-container'); 
const tradeMessageContainer = document.getElementById('tradeMessageContainer'); 
const tickerTableBody = document.querySelector('#tickerTable tbody'); 

// Trading Controls (NEW)
const marketSelector = document.getElementById('marketSelector');
const stakeInput = document.getElementById('stakeInput');
const durationInput = document.getElementById('durationInput');
const buyButtonUp = document.getElementById('buyButtonUp');
const buyButtonDown = document.getElementById('buyButtonDown');


// ----------------------------------------------------
// 1. WebSocket Connection Handler (UNCHANGED)
// ----------------------------------------------------

function connectToDeriv() {
    if (connection && (connection.readyState === WebSocket.OPEN || connection.readyState === WebSocket.CONNECTING)) {
        return;
    }

    connection = new WebSocket(WS_URL);
    statusMessage.textContent = "Connecting to Deriv...";

    connection.onopen = (event) => {
        console.log("WebSocket connection established!");
        statusMessage.textContent = "Connected. Click Login to authorize.";
    };

    connection.onmessage = handleIncomingMessage;

    connection.onerror = (error) => {
        console.error("WebSocket Error:", error);
        statusMessage.textContent = "Connection Error! Please check console and try refreshing.";
    };

    connection.onclose = () => {
        console.log("WebSocket connection closed.");
    };
}

function sendAPIRequest(request) {
    if (connection && connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify(request));
    } else {
        console.error("Connection not open. Cannot send request:", request);
        statusMessage.textContent = "Attempting to reconnect...";
        connectToDeriv(); 
    }
}

// ----------------------------------------------------
// 2. Authorization and Primary Flow (UNCHANGED)
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
        statusMessage.textContent = "Please enter a valid API Token.";
        return;
    }

    loginButton.disabled = true;
    statusMessage.textContent = "Authorizing...";

    if (connection && connection.readyState === WebSocket.OPEN) {
        authorizeAndProceed(apiToken);
    } else {
        connectToDeriv(); 
        connection.onopen = () => {
            authorizeAndProceed(apiToken);
        };
    }
}

// ----------------------------------------------------
// 3. Trade Action Functions (NEW & UPDATED)
// ----------------------------------------------------

function requestBalance() {
    const balanceRequest = { "balance": 1, "subscribe": 1 }; 
    sendAPIRequest(balanceRequest);
}

function requestActiveSymbols() {
    const symbolsRequest = { "active_symbols": "brief", "product_type": "basic" };
    sendAPIRequest(symbolsRequest);
}

function subscribeToAllVolatilities() {
    const volatilitySymbols = activeSymbols
        .filter(symbol => symbol.market === 'synthetic_index')
        .map(symbol => symbol.symbol);

    if (volatilitySymbols.length === 0) {
        console.warn("No volatility symbols found.");
        return;
    }

    sendAPIRequest({ "forget_all": "ticks" }); 

    volatilitySymbols.forEach(symbol => {
        sendAPIRequest({ "ticks": symbol, "subscribe": 1 });

        if (!document.getElementById(`row-${symbol}`)) {
            const row = tickerTableBody.insertRow();
            row.id = `row-${symbol}`;
            
            const symbolCell = row.insertCell(0);
            symbolCell.textContent = symbol.replace('R_', 'V-'); 
            
            row.insertCell(1).textContent = '--'; 
            row.insertCell(2).textContent = '--'; 
        }
    });
}

function requestMarketData(symbol) {
    if (!currentChart) initializeChart();
    CHART_MARKET = symbol; // Update the global variable for tick matching

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

function handleMarketChange() {
    const newSymbol = marketSelector.value;
    requestMarketData(newSymbol); 
}

/**
 * Sends a buy request to the Deriv API.
 * @param {string} action - 'CALL' for Up or 'PUT' for Down.
 */
function sendPurchaseRequest(action) {
    const symbol = marketSelector.value;
    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);
    
    if (!symbol || isNaN(stake) || stake <= 0 || isNaN(duration) || duration < 1) {
        tradeMessageContainer.textContent = "❌ Please check market, stake (min 0.35), and duration (min 1 tick) values.";
        return;
    }
    
    // Disable buttons to prevent spamming
    buyButtonUp.disabled = true;
    buyButtonDown.disabled = true;
    tradeMessageContainer.textContent = `Attempting to buy ${symbol} ${action}...`;

    const purchaseRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": (action === 'CALL' ? "CALL" : "PUT"),
            "currency": "USD", // Assuming USD based on balance display
            "duration": duration,
            "duration_unit": "t", // 't' for ticks
            "symbol": symbol,
        }
    };
    
    sendAPIRequest(purchaseRequest);
}


// ----------------------------------------------------
// 4. Chart Initialization (UNCHANGED)
// ----------------------------------------------------

function initializeChart() {
    if (currentChart) return; 

    currentChart = LightweightCharts.create(chartContainer, {
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
        layout: {
            backgroundColor: '#ffffff',
            textColor: 'rgba(33, 56, 120, 1)',
        },
        grid: {
            vertLines: { color: '#e0e0e0' },
            horzLines: { color: '#e0e0e0' },
        },
        timeScale: {
            timeVisible: true,
            secondsVisible: false,
        },
    });

    candleSeries = currentChart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderDownColor: '#ef5350',
        borderUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        wickUpColor: '#26a69a',
    });

    new ResizeObserver(() => {
        if (currentChart) {
            currentChart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
        }
    }).observe(chartContainer);
    
    const loadingMessage = chartContainer.querySelector('p');
    if (loadingMessage) loadingMessage.style.display = 'none'; 
}


// ----------------------------------------------------
// 5. Symbol Population (NEW)
// ----------------------------------------------------

function populateMarketSelector() {
    marketSelector.innerHTML = ''; 

    const volatilitySymbols = activeSymbols
        .filter(symbol => symbol.market === 'synthetic_index')
        .sort((a, b) => a.symbol.localeCompare(b.symbol));

    volatilitySymbols.forEach(symbolData => {
        const option = document.createElement('option');
        option.value = symbolData.symbol; 
        option.textContent = `${symbolData.symbol.replace('R_', 'V-')} (${symbolData.display_name})`; 
        marketSelector.appendChild(option);
    });

    // Ensure the default market is selected
    if (marketSelector.querySelector(`option[value="${CHART_MARKET}"]`)) {
        marketSelector.value = CHART_MARKET; 
    } else if (volatilitySymbols.length > 0) {
        CHART_MARKET = volatilitySymbols[0].symbol; // Set the first symbol as default
        marketSelector.value = CHART_MARKET;
    }
}


// ----------------------------------------------------
// 6. Message Router (UPDATED)
// ----------------------------------------------------

function handleIncomingMessage(msg) {
    const data = JSON.parse(msg.data);

    if (data.error) {
        console.error("API Error:", data.error.message);
        statusMessage.textContent = `Authorization Failed: ${data.error.message}`;
        tradeMessageContainer.textContent = `❌ Purchase Error: ${data.error.message}`; // Display trade errors
        loginButton.disabled = false;
        buyButtonUp.disabled = false;
        buyButtonDown.disabled = false;
        return;
    }

    switch (data.msg_type) {
        case 'authorize':
            if (data.authorize) {
                // ... (Existing AUTH SUCCESS logic) ...
                loginButton.style.display = 'none'; 
                dashboard.style.display = 'block';
                tradingInterface.style.display = 'flex'; 
                loginIdDisplay.textContent = data.authorize.loginid;
                
                requestBalance();
                requestActiveSymbols();
                
                initializeChart();
                requestMarketData(CHART_MARKET); 
            }
            break;

        case 'balance':
            if (data.balance) {
                const balance = parseFloat(data.balance.balance).toFixed(2);
                balanceDisplay.textContent = `${balance} ${data.balance.currency}`;
                
                // Update header balance
                const headerBalance = document.getElementById('headerBalance');
                const headerBalanceAmount = document.getElementById('headerBalanceAmount');
                if (headerBalance && headerBalanceAmount) {
                    headerBalance.style.display = 'flex';
                    headerBalanceAmount.textContent = `${balance} ${data.balance.currency}`;
                }
            }
            break;

        case 'active_symbols':
            if (data.active_symbols) {
                activeSymbols = data.active_symbols;
                symbolCountDisplay.textContent = `${activeSymbols.length} symbols loaded.`;
                
                populateMarketSelector(); 
                subscribeToAllVolatilities();
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
            }
            break;

        case 'tick':
            if (data.tick) {
                const symbol = data.tick.symbol;
                const price = parseFloat(data.tick.quote);
                const epoch = parseInt(data.tick.epoch);
                
                // 1. Update Chart (only if it's the market being tracked by the chart)
                if (symbol === CHART_MARKET) { 
                    const newCandle = {
                        time: epoch,
                        open: parseFloat(data.tick.open),
                        high: parseFloat(data.tick.high),
                        low: parseFloat(data.tick.low),
                        close: price, 
                    };
                    candleSeries.update(newCandle); 
                }
                
                // 2. Update Ticker Watch Table
                const row = document.getElementById(`row-${symbol}`);
                if (row) {
                    // ... (Existing Ticker Watch logic) ...
                    const priceCell = row.cells[1];
                    const changeCell = row.cells[2];
                    
                    if (lastPrices[symbol]) {
                        const lastPrice = lastPrices[symbol];
                        
                        priceCell.classList.remove('price-up', 'price-down');
                        if (price > lastPrice) {
                            priceCell.classList.add('price-up');
                        } else if (price < lastPrice) {
                            priceCell.classList.add('price-down');
                        }
                        
                        const percentageChange = ((price - lastPrice) / lastPrice) * 100;
                        changeCell.textContent = `${percentageChange.toFixed(2)}%`;
                        
                        row.style.backgroundColor = (price > lastPrice) ? '#e6ffe6' : '#ffe6e6';
                        setTimeout(() => {
                            row.style.backgroundColor = '';
                        }, 500); 
                    }

                    priceCell.textContent = price.toFixed(5); 
                    lastPrices[symbol] = price; 
                }
            }
            break;
            
        case 'buy':
            buyButtonUp.disabled = false;
            buyButtonDown.disabled = false;
            
            if (data.buy) {
                const contract = data.buy;
                currentContractId = contract.contract_id;
                tradeMessageContainer.innerHTML = `✅ **PURCHASE SUCCESS!** Contract ID: ${contract.contract_id}. Payout: ${contract.payout} ${contract.currency}.`;
                
                // Optional: Request contract details subscription here
                sendAPIRequest({ "proposal_open_contract": 1, "contract_id": currentContractId, "subscribe": 1 });
            }
            break;

        case 'proposal_open_contract':
            const contract = data.proposal_open_contract;
            
            if (contract.is_expired) {
                // Contract is finished
                const status = contract.is_sold ? 'SOLD' : 'EXPIRED';
                const profit = parseFloat(contract.profit).toFixed(2);
                const classColor = profit >= 0 ? 'price-up' : 'price-down';
                
                tradeMessageContainer.innerHTML = `
                    <span class="${classColor}">💵 ${status}! Profit/Loss: ${profit} ${contract.currency}</span> 
                    <br>Ready for new trade.`;
                
                // Forget the contract stream to save bandwidth
                sendAPIRequest({ "forget": contract.id });
                currentContractId = null;
            } else {
                // Contract is still open (update running profit/loss)
                const pnl = parseFloat(contract.profit).toFixed(2);
                const pnlClass = pnl >= 0 ? 'price-up' : 'price-down';
                
                tradeMessageContainer.innerHTML = `
                    Contract Open: Running P/L: <span class="${pnlClass}">${pnl} ${contract.currency}</span>
                    (Entry: ${contract.entry_tick_display_value})
                `;
            }
            break;
            
        default:
            // console.log("Unhandled message type:", data.msg_type, data);
            break;
    }
}

// Initial connection attempt on page load
connectToDeriv();