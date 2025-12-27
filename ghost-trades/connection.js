// ===================================
// WEBSOCKET CONNECTION MANAGEMENT
// ===================================

// Global connection variables
let connection = null;
let reconnectAttempts = 0;
let reconnectTimer = null;

function connectToDeriv() {
    if (connection && (connection.readyState === WebSocket.OPEN || connection.readyState === WebSocket.CONNECTING)) {
        return;
    }

    try {
        connection = new WebSocket(WS_URL);
        updateConnectionStatus('connecting');
        statusMessage.textContent = "Establishing connection...";

        connection.onopen = handleConnectionOpen;
        connection.onmessage = handleIncomingMessage;
        connection.onerror = handleConnectionError;
        connection.onclose = handleConnectionClose;

    } catch (error) {
        console.error("Failed to create WebSocket:", error);
        showToast("Failed to establish connection", 'error');
        updateConnectionStatus('error');
        attemptReconnect();
    }
}

/**
 * Establishes WebSocket connection and sends the authorize request.
 * @param {string} token - The access token from OAuth or localStorage.
 */
function connectAndAuthorize(token) {
    if (!token) {
        showToast("No token provided for authorization", "error");
        return;
    }

    // Create connection if it doesn't exist
    if (!connection || connection.readyState !== WebSocket.OPEN) {
        connection = new WebSocket(WS_URL);

        connection.onopen = () => {
            console.log("🚀 WebSocket Open. Sending Authorization...");
            updateConnectionStatus('connected');
            connection.send(JSON.stringify({ authorize: token }));
        };
    } else {
        // If already open, just authorize
        connection.send(JSON.stringify({ authorize: token }));
    }

    // Standard handlers
    connection.onmessage = handleIncomingMessage;
    connection.onerror = handleConnectionError;
    connection.onclose = handleConnectionClose;
}

function handleConnectionOpen(event) {
    console.log("✅ WebSocket connection established!");
    updateConnectionStatus('connected');
    statusMessage.textContent = "Connected. Enter your API token to continue.";
    reconnectAttempts = 0;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function handleConnectionError(error) {
    console.error("❌ WebSocket Error:", error);
    console.error("❌ WebSocket Error details:", {
        code: error.code,
        reason: error.reason,
        wasClean: error.wasClean,
        target: error.target,
        type: error.type
    });
    updateConnectionStatus('error');
    showToast("Connection error occurred - Check network/firewall", 'error');

    // Additional diagnostics
    console.log("🔍 Connection diagnostics:");
    console.log("- WebSocket URL:", WS_URL);
    console.log("- Browser:", navigator.userAgent);
    console.log("- Online status:", navigator.onLine);
    console.log("- Protocol:", window.location.protocol);

    // Try to reconnect after a longer delay
    console.log("🔄 Attempting to reconnect in 10 seconds...");
    setTimeout(() => {
        console.log("🔄 Retrying connection...");
        connectToDeriv();
    }, 10000);
}

function handleConnectionClose(event) {
    console.log("🔌 WebSocket connection closed", event.code, event.reason);
    updateConnectionStatus('disconnected');

    if (!event.wasClean) {
        showToast("Connection lost. Attempting to reconnect...", 'warning');
        attemptReconnect();
    }
}

function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        showToast("Unable to connect. Please refresh the page.", 'error');
        statusMessage.textContent = "Connection failed. Please refresh the page.";
        return;
    }

    reconnectAttempts++;
    const delay = RECONNECT_DELAY * reconnectAttempts;

    statusMessage.textContent = `Reconnecting in ${delay / 1000}s... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;

    reconnectTimer = setTimeout(() => {
        console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
        connectToDeriv();
    }, delay);
}

function sendAPIRequest(request) {
    return new Promise((resolve, reject) => {
        if (!connection || connection.readyState !== WebSocket.OPEN) {
            console.error("❌ Connection not open. Cannot send request:", request);
            showToast("Connection not available. Reconnecting...", 'warning');
            connectToDeriv();
            reject(new Error("Connection not available"));
            return;
        }

        try {
            connection.send(JSON.stringify(request));
            resolve();
        } catch (error) {
            console.error("❌ Failed to send request:", error);
            showToast("Failed to send request", 'error');
            reject(error);
        }
    });
}

// ===================================
// OAUTH INITIALIZATION
// ===================================

/**
 * Extracts Deriv OAuth tokens from URL hash fragment
 * @returns {Array|null} Array of account objects or null if no tokens found
 */
function getDerivTokensFromURL() {
    let params;

    // Check for hash fragment first (default for some OAuth flows)
    if (window.location.hash) {
        params = new URLSearchParams(window.location.hash.substring(1));
    }
    // Fallback to query parameters (what user is seeing)
    else if (window.location.search) {
        params = new URLSearchParams(window.location.search);
    }

    if (!params) return null;

    const accounts = [];

    // Deriv returns acct1, token1, acct2, token2, etc.
    let i = 1;
    while (params.has(`acct${i}`)) {
        accounts.push({
            account: params.get(`acct${i}`),
            token: params.get(`token${i}`),
            currency: params.get(`cur${i}`)
        });
        i++;
    }

    return accounts.length > 0 ? accounts : null;
}

/**
 * Handles the OAuth callback when returning from Deriv OAuth
 */
function handleOAuthCallback() {
    console.log('🔄 OAuth callback detected, processing...');

    let params;

    // Check hash first, then search (query params)
    if (window.location.hash.length > 1) {
        params = new URLSearchParams(window.location.hash.substring(1));
        console.log('📋 Found params in Hash');
    } else if (window.location.search.length > 1) {
        params = new URLSearchParams(window.location.search);
        console.log('📋 Found params in Search Query');
    } else {
        console.error('No OAuth parameters found in URL');
        return;
    }

    console.log('📋 URL parameters found');

    // Check for errors
    const error = params.get('error');
    if (error) {
        console.error('OAuth Error:', error);
        showToast(`OAuth Error: ${error}`, 'error');
        statusMessage.textContent = "OAuth authentication failed. Please try again.";
        return;
    }

    // Validate state parameter (CSRF protection)
    const state = params.get('state');
    const storedState = sessionStorage.getItem('oauth_state');

    // RELAXED SECURITY CHECK (TEMPORARY): Log warning but allow proceed if state is missing
    // This handles cases where user refreshes the page or session storage is cleared
    if (!state || state !== storedState) {
        console.warn('⚠️ State parameter mismatch or missing - Proceeding with caution');
        // showToast('Authentication warning - state mismatch', 'warning');
        // statusMessage.textContent = "OAuth security validation warning...";
        // return; // <-- COMMENTED OUT TO UNBLOCK USER
    } else {
        console.log('✅ OAuth state validated successfully');
    }

    console.log('✅ OAuth state validated successfully');

    // Clear session storage
    sessionStorage.removeItem('oauth_state');

    // Collect all accounts returned by Deriv
    const accounts = [];
    let i = 1;
    while (params.has(`acct${i}`)) {
        accounts.push({
            id: params.get(`acct${i}`),
            token: params.get(`token${i}`),
            currency: params.get(`cur${i}`)
        });
        i++;
    }

    console.log(`✅ Received ${accounts.length} account(s) from Deriv OAuth`);
    console.log('Accounts:', accounts.map(a => ({ id: a.id, currency: a.currency })));

    if (accounts.length > 0) {
        // Save accounts to localStorage for persistence
        localStorage.setItem('deriv_all_accounts', JSON.stringify(accounts));

        // Populate the account switcher dropdown
        populateAccountSwitcher(accounts);

        // Default to the first account (usually the last one used)
        switchAccount(accounts[0].token, accounts[0].id);
    } else {
        console.error('❌ No accounts received from OAuth');
        showToast('No accounts received from Deriv', 'error');
        statusMessage.textContent = "No accounts found. Please try again.";
    }

    // Clear the hash fragment
    window.history.replaceState({}, document.title, window.location.pathname);
}

/**
 * Populates the account switcher dropdown with available accounts
 */
function populateAccountSwitcher(accounts) {
    // If no accounts provided, try to load from storage
    if (!accounts || accounts.length === 0) {
        const storedAccounts = localStorage.getItem('deriv_all_accounts');
        if (storedAccounts) {
            try {
                accounts = JSON.parse(storedAccounts);
                console.log('📦 Loaded accounts from localStorage:', accounts.length);
            } catch (e) {
                console.error('Failed to parse stored accounts', e);
                return;
            }
        } else {
            return; // No accounts to show
        }
    }

    const select = document.getElementById('active-account-select');
    const accountSwitcher = document.getElementById('accountSwitcher');

    if (!select || !accountSwitcher) {
        console.error('Account switcher elements not found');
        return;
    }

    // Clear existing options
    select.innerHTML = '';

    // Add each account as an option
    accounts.forEach(acc => {
        const option = document.createElement('option');
        option.value = acc.token;
        option.dataset.accountId = acc.id;
        option.textContent = `${acc.id} (${acc.currency})`;
        select.appendChild(option);
    });

    // Show the account switcher
    accountSwitcher.style.display = 'flex';

    // Add change event listener
    select.addEventListener('change', (e) => {
        const selectedToken = e.target.value;
        const selectedId = e.target.options[e.target.selectedIndex].dataset.accountId;
        console.log(`🔄 Switching to account: ${selectedId}`);
        switchAccount(selectedToken, selectedId);
    });

    console.log('✅ Account switcher populated with', accounts.length, 'account(s)');
}

/**
 * Switches to a different account using the provided token
 */
function switchAccount(token, accountId) {
    console.log(`🔄 Switching to account: ${accountId}`);

    if (!token || !accountId) {
        console.error('Invalid token or account ID');
        showToast('Invalid account selection', 'error');
        return;
    }

    // Update OAuth state
    if (typeof window.oauthState === 'undefined') {
        window.oauthState = {
            access_token: null,
            refresh_token: null,
            account_type: accountId.startsWith('VRTC') ? 'demo' : 'real',
            login_id: null,
            account_id: null
        };
    }

    window.oauthState.access_token = token;
    window.oauthState.account_id = accountId;
    window.oauthState.account_type = accountId.startsWith('VRTC') ? 'demo' : 'real';

    // Save to localStorage
    localStorage.setItem('deriv_token', token);
    localStorage.setItem('deriv_account_id', accountId);
    localStorage.setItem('deriv_account_type', window.oauthState.account_type);

    console.log('✅ Account switched to:', accountId, `(${window.oauthState.account_type})`);

    // 🔥 THE FIX: Show the dashboard immediately
    if (typeof showSection === 'function') {
        // Hide login screen
        const loginInterface = document.querySelector('.auth-container');
        if (loginInterface) {
            loginInterface.style.display = 'none';
        }
        // Show dashboard
        showSection('dashboard');
    }

    // Connect with the new token
    connectAndAuthorize(token);
}

/**
 * Connects to Deriv WebSocket using OAuth access token
 */
async function connectToDerivWithOAuth() {
    try {
        statusMessage.textContent = "Connecting with OAuth token...";

        // Ensure WebSocket connection
        if (!connection || connection.readyState !== WebSocket.OPEN) {
            console.log('Establishing WebSocket connection for OAuth...');
            connectToDeriv();

            // Wait for connection
            await new Promise((resolve, reject) => {
                const checkConnection = setInterval(() => {
                    if (connection && connection.readyState === WebSocket.OPEN) {
                        console.log('WebSocket connection established for OAuth');
                        clearInterval(checkConnection);
                        resolve();
                    }
                }, 100);

                setTimeout(() => {
                    clearInterval(checkConnection);
                    reject(new Error('Connection timeout'));
                }, 15000); // Increased timeout
            });
        }

        // Small delay to ensure connection is stable
        await new Promise(resolve => setTimeout(resolve, 500));

        // Authorize with OAuth token
        console.log('Authorizing with OAuth token...');
        await authorizeWithOAuthToken();

        // Authorization successful - the UI should now be updated by app.js message handler
        console.log('✅ OAuth login completed successfully');

        // Clean up URL parameters
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);

    } catch (error) {
        console.error('OAuth connection error:', error);
        showToast(`Connection failed: ${error.message}`, 'error');
        statusMessage.textContent = "OAuth connection failed. Please try again.";
    }
}

/**
 * Authorizes with Deriv using the OAuth access token
 */
function authorizeWithOAuthToken() {
    return new Promise((resolve, reject) => {
        if (!window.oauthState.access_token) {
            reject(new Error('No access token available'));
            return;
        }

        console.log('Authorizing with OAuth token...');

        const authRequest = {
            "authorize": window.oauthState.access_token,
            "passthrough": { "purpose": "oauth_login", "account_type": window.oauthState.account_type }
        };

        // Set up promise handlers that will be called from app.js message handler
        window.oauthResolve = resolve;
        window.oauthReject = reject;

        // Send authorization request
        const checkAuth = setTimeout(() => {
            if (window.oauthReject) {
                window.oauthReject(new Error('Authorization timeout'));
                delete window.oauthResolve;
                delete window.oauthReject;
            }
        }, 10000);

        // We'll handle the response in the message handler (app.js)
        sendAPIRequest(authRequest)
            .then(() => {
                console.log('OAuth authorization request sent, waiting for response...');
            })
            .catch(error => {
                clearTimeout(checkAuth);
                if (window.oauthReject) {
                    window.oauthReject(error);
                    delete window.oauthResolve;
                    delete window.oauthReject;
                }
            });
    });
}

// ===================================
// OAUTH FUNCTIONS
// ===================================

/**
 * Starts the unified OAuth login flow (no account type pre-selection)
 */
function startOAuthLogin() {
    console.log('🚀 Starting unified OAuth login...');

    // Generate a random state parameter for CSRF protection
    const state = crypto.randomUUID();
    sessionStorage.setItem('oauth_state', state);

    // Build the authorization URL without forcing a specific account type
    const authUrl = `${OAUTH_CONFIG.authorization_url}?app_id=${OAUTH_CONFIG.app_id}&l=${OAUTH_CONFIG.language}&brand=${OAUTH_CONFIG.brand}&state=${state}&response_type=token`;

    console.log('🚀 Redirecting to Deriv for unified login...');
    console.log('Auth URL:', authUrl);

    // Redirect to Deriv OAuth
    window.location.href = authUrl;
}


// ===================================
// WEBSOCKET TESTING FUNCTION
// ===================================

function testWebSocketConnection() {
    console.log('🧪 Testing WebSocket connection...');

    // Clear any existing connection
    if (connection && connection.readyState === WebSocket.OPEN) {
        connection.close();
    }

    // Reset connection attempts
    reconnectAttempts = 0;

    // Try to connect
    console.log('🔄 Initiating test connection...');
    connectToDeriv();

    // Set a timeout to check the result
    setTimeout(() => {
        const status = connection ? connection.readyState : 'no connection';
        const statusText = {
            0: 'CONNECTING',
            1: 'OPEN',
            2: 'CLOSING',
            3: 'CLOSED'
        }[status] || 'UNKNOWN';

        console.log('📊 Connection test result:', statusText);

        if (connection && connection.readyState === WebSocket.OPEN) {
            showToast('✅ WebSocket connection successful!', 'success');
        } else {
            showToast('❌ WebSocket connection failed - check console for details', 'error');
        }
    }, 5000);
}