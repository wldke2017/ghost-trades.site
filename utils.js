// ===================================
// UTILITY FUNCTIONS
// ===================================

/**
 * Attempts to acquire a trade lock for a symbol
 * @param {string} symbol - The symbol to lock
 * @param {string} botType - Type of bot requesting lock ('ghost_ai' or 'ghost_eodd')
 * @returns {boolean} - True if lock acquired, false if symbol is already locked
 */
function acquireTradeLock(symbol, botType) {
    const now = Date.now();
    
    // Check if there's an existing lock
    if (globalTradeLocks[symbol]) {
        const lock = globalTradeLocks[symbol];
        const timeSinceLock = now - lock.timestamp;
        
        // If lock is still active (within duration)
        if (timeSinceLock < TRADE_LOCK_DURATION) {
            console.log(`⚠️ Trade lock active on ${symbol} by ${lock.botType} (${(TRADE_LOCK_DURATION - timeSinceLock)}ms remaining)`);
            return false;
        }
        
        // Lock has expired, can be overwritten
        console.log(`🔓 Expired lock on ${symbol} from ${lock.botType}, acquiring new lock for ${botType}`);
    }
    
    // Acquire the lock
    globalTradeLocks[symbol] = {
        timestamp: now,
        botType: botType
    };
    
    console.log(`🔒 Trade lock acquired on ${symbol} by ${botType} for ${TRADE_LOCK_DURATION}ms`);
    return true;
}

/**
 * Releases a trade lock for a symbol
 * @param {string} symbol - The symbol to unlock
 * @param {string} botType - Type of bot releasing lock
 */
function releaseTradeLock(symbol, botType) {
    if (globalTradeLocks[symbol] && globalTradeLocks[symbol].botType === botType) {
        delete globalTradeLocks[symbol];
        console.log(`🔓 Trade lock released on ${symbol} by ${botType}`);
    }
}

/**
 * Clears all trade locks (useful when stopping bots)
 */
function clearAllTradeLocks() {
    const count = Object.keys(globalTradeLocks).length;
    globalTradeLocks = {};
    if (count > 0) {
        console.log(`🔓 Cleared ${count} trade lock(s)`);
    }
}

/**
 * Debug function to check distribution data status
 * Call this from console: checkDistributionData()
 */
function checkDistributionData() {
    console.log('=== DISTRIBUTION DATA STATUS ===');
    
    const distributionMarketSelector = document.getElementById('distributionMarketSelector');
    const selectedSymbol = distributionMarketSelector?.value || 'unknown';
    
    console.log(`Selected Market: ${selectedSymbol}`);
    console.log(`\nAll Markets Data:`);
    
    Object.keys(marketFullTickDigits).forEach(symbol => {
        const tickCount = marketFullTickDigits[symbol]?.length || 0;
        console.log(`  ${symbol}: ${tickCount} ticks`);
        
        if (tickCount > 0) {
            const counts = {};
            marketFullTickDigits[symbol].forEach(d => {
                counts[d] = (counts[d] || 0) + 1;
            });
            console.log(`    Distribution:`, counts);
        }
    });
    
    console.log(`\nSelected Market (${selectedSymbol}) Details:`);
    if (marketFullTickDigits[selectedSymbol]) {
        console.log(`  Total ticks: ${marketFullTickDigits[selectedSymbol].length}`);
        console.log(`  First 10 digits:`, marketFullTickDigits[selectedSymbol].slice(0, 10));
        console.log(`  Last 10 digits:`, marketFullTickDigits[selectedSymbol].slice(-10));
    } else {
        console.log(`  ❌ No data available for ${selectedSymbol}`);
    }
    
    console.log('=== END STATUS ===');
}

// Make it available globally
window.checkDistributionData = checkDistributionData;

// Toast Notification System
function showToast(message, type = 'info', duration = null) {
    // Set default duration based on type for quicker clearing
    if (duration === null) {
        const durations = {
            error: 2000,    // 2 seconds for errors
            warning: 3000,  // 3 seconds for warnings
            success: 3000,  // 3 seconds for success
            info: 4000      // 4 seconds for info
        };
        duration = durations[type] || 4000;
    }

    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="22 4 12 14.01 9 11.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="12" y1="16" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="8" x2="12.01" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    };

    const closeIcon = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.info}</div>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" title="Close">${closeIcon}</button>
    `;

    // Add close button event listener
    const closeButton = toast.querySelector('.toast-close');
    closeButton.addEventListener('click', () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(400px)';
        setTimeout(() => toast.remove(), 300);
    });

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) { // Check if still in DOM
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(400px)';
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
}

// Update Connection Status Indicator
function updateConnectionStatus(status) {
    const statusElement = document.getElementById('connection-status');
    const statusText = statusElement.querySelector('.status-text');

    statusElement.className = `connection-status ${status}`;

    const statusMessages = {
        connecting: 'Connecting...',
        connected: 'Connected',
        disconnected: 'Disconnected',
        error: 'Connection Error'
    };

    statusText.textContent = statusMessages[status] || status;
}

// Logout function to clear session
function logout() {
    console.log('🚪 Logging out...');
    
    // Clear localStorage
    localStorage.removeItem('deriv_token');
    localStorage.removeItem('deriv_account_type');
    localStorage.removeItem('deriv_account_id');
    localStorage.removeItem('deriv_login_id');
    
    // Clear OAuth state
    oauthState.access_token = null;
    oauthState.account_type = ACCOUNT_TYPES.DEMO;
    oauthState.account_id = null;
    oauthState.login_id = null;
    
    // Close WebSocket connection
    if (connection && connection.readyState === WebSocket.OPEN) {
        connection.close();
    }
    
    // Show toast
    showToast('Logged out successfully', 'success');
    
    // Reload page to reset state
    setTimeout(() => {
        window.location.reload();
    }, 500);
}

// Show/Hide Loading State
function setButtonLoading(button, isLoading) {
    const btnText = button.querySelector('.btn-text');
    const btnLoader = button.querySelector('.btn-loader');

    if (btnText && btnLoader) {
        if (isLoading) {
            btnText.style.display = 'none';
            btnLoader.style.display = 'block';
            button.disabled = true;
        } else {
            btnText.style.display = 'block';
            btnLoader.style.display = 'none';
            button.disabled = false;
        }
    }
}

// Format Currency
function formatCurrency(amount, currency = 'USD') {
    return `${parseFloat(amount).toFixed(2)} ${currency}`;
}

// Format Timestamp
function formatTime(timestamp) {
    return new Date(timestamp * 1000).toLocaleTimeString();
}

// ===================================
// TECHNICAL INDICATORS FUNCTIONS
// ===================================

function calculateEMA(data, period) {
    if (data.length < period) return null;

    const multiplier = 2 / (period + 1);
    let ema = data[0];

    for (let i = 1; i < data.length; i++) {
        ema = (data[i] * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
}

function calculateSMA(data, period) {
    if (data.length < period) return null;

    const sum = data.slice(-period).reduce((acc, val) => acc + val, 0);
    return sum / period;
}

function updateTechnicalIndicators() {
    // Get current tick data from any subscribed market
    const symbols = Object.keys(marketTickHistory);
    if (symbols.length === 0) return;

    // Use the first symbol for technical indicators (could be made configurable)
    const symbol = symbols[0];
    const tickData = marketTickHistory[symbol];

    if (tickData && tickData.length >= 50) { // Minimum data for SMA
        emaValue = calculateEMA(tickData, 100); // EMA period 100
        smaValue = calculateSMA(tickData, 50);  // SMA period 50

        // Log technical indicators occasionally
        if (Math.random() < 0.01) { // Log ~1% of the time to avoid spam
            addBotLog(`📊 EMA(100): ${emaValue ? emaValue.toFixed(4) : 'N/A'} | SMA(50): ${smaValue ? smaValue.toFixed(4) : 'N/A'}`);
        }
    }
}