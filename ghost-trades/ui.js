// ===================================
// UI UPDATE LOGIC
// ===================================

/**
 * Update UI after successful authorization
 * @param {object} data - The authorize response data
 */
function updateAuthUI(data) {
    const loginId = data.authorize.loginid;

    // Update displays
    if (typeof loginIdDisplay !== 'undefined') loginIdDisplay.textContent = loginId;

    // Hide login container
    const loginInterface = document.querySelector('.auth-container');
    if (loginInterface) {
        loginInterface.style.display = 'none';
    }

    // Show dashboard
    if (typeof showSection === 'function') {
        showSection('dashboard');
    }

    // Update connection status
    if (typeof updateConnectionStatus === 'function') {
        updateConnectionStatus('connected');
    }

    // Reset buttons
    const loginButton = document.getElementById('loginButton');
    if (loginButton && typeof setButtonLoading === 'function') {
        setButtonLoading(loginButton, false);
    }
}

/**
 * Update Balance Display
 * @param {string|number} balance - Account balance
 * @param {string} currency - Account currency
 */
function updateBalanceUI(balance, currency) {
    const formattedBalance = parseFloat(balance).toFixed(2);

    // Main Dashboard Balance
    const balanceDisplay = document.getElementById('balanceDisplay');
    if (balanceDisplay) {
        if (typeof formatCurrency === 'function') {
            balanceDisplay.textContent = formatCurrency(formattedBalance, currency);
        } else {
            balanceDisplay.textContent = `${formattedBalance} ${currency}`;
        }
    }

    // Header Balance
    const headerBalance = document.getElementById('headerBalance');
    const headerBalanceAmount = document.getElementById('headerBalanceAmount');

    if (headerBalance && headerBalanceAmount) {
        headerBalance.style.display = 'flex';
        if (typeof formatCurrency === 'function') {
            headerBalanceAmount.textContent = formatCurrency(formattedBalance, currency);
        } else {
            headerBalanceAmount.textContent = `${formattedBalance} ${currency}`;
        }
    }

    // Show logout button
    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.style.display = 'flex';
    }
}

/**
 * Update Ticker Watch Table Row
 * @param {string} symbol - Market symbol
 * @param {number} price - Current price
 * @param {number} lastPrice - Previous price
 */
function updateTickerUI(symbol, price, lastPrice) {
    // Check if row exists
    const row = document.getElementById(`row-${symbol}`);
    if (!row) return;

    const priceCell = row.cells[1];
    const changeCell = row.cells[2];

    // Calculate change
    if (lastPrice) {
        priceCell.classList.remove('price-up', 'price-down');

        if (price > lastPrice) {
            priceCell.classList.add('price-up');
            row.style.backgroundColor = '#e6ffe6'; // Light green flash
        } else if (price < lastPrice) {
            priceCell.classList.add('price-down');
            row.style.backgroundColor = '#ffe6e6'; // Light red flash
        }

        const percentageChange = ((price - lastPrice) / lastPrice) * 100;
        changeCell.textContent = `${percentageChange.toFixed(2)}%`;

        // Remove flash effect
        setTimeout(() => {
            row.style.backgroundColor = '';
        }, 500);
    }

    priceCell.textContent = price.toFixed(5);
}

/**
 * Update Trading Message / Status
 * @param {string} htmlContent - HTML content to display
 */
function updateTradeMessageUI(htmlContent) {
    if (typeof tradeMessageContainer !== 'undefined') {
        tradeMessageContainer.innerHTML = htmlContent;
    }
}

/**
 * Update Ghost AI Button States (All 3 buttons)
 * @param {boolean} isRunning - Whether the bot is running
 */
function updateGhostAIButtonStates(isRunning) {
    const buttons = [
        document.getElementById('ghost-ai-toggle-button'),
        document.getElementById('ghost-ai-toggle-button-bottom'),
        document.getElementById('ghost-ai-toggle-button-history')
    ];

    buttons.forEach(button => {
        if (button) {
            if (isRunning) {
                button.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="6" y="6" width="12" height="12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Stop Bot</span>
                `;
                button.classList.remove('btn-start', 'primary-button');
                button.classList.add('btn-stop', 'stop-button');
            } else {
                button.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <polygon points="5 3 19 12 5 21 5 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Start Bot</span>
                `;
                button.classList.remove('btn-stop', 'stop-button');
                button.classList.add('btn-start', 'primary-button');
            }
        }
    });
}
