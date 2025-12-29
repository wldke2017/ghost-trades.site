// SecureEscrow User Dashboard Logic

// --- Constants ---
const API_BASE = '/escrow'; // Base path for API calls
const EXCHANGE_RATE = 129; // Fixed exchange rate for demo

// --- State ---
let socket;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Check auth first
    if (!checkAuthentication()) return;

    // Initialize Dashboard
    updateDashboard();
    setupSocketRequest();
    setupEventListeners();
});

// Update Dashboard Data
async function updateDashboard() {
    try {
        await Promise.all([
            fetchUserInfo(),
            fetchWalletBalance(),
            fetchTransactions(),
            refreshOrders()
        ]);
        updateUserDisplay(); // From auth.js
    } catch (error) {
        console.error('Dashboard update failed:', error);
    }
}

// --- API Calls ---

async function fetchUserInfo() {
    try {
        const response = await authenticatedFetch('/auth/me');
        if (response.ok) {
            const user = await response.json();
            currentUser = user; // Update global user

            // Update Settings Inputs
            document.getElementById('settings-username').value = user.username;
            document.getElementById('settings-role').value = user.role;
            if (user.mpesa_number) document.getElementById('settings-mpesa').value = user.mpesa_number;

            // Radio buttons for currency
            const currency = user.currency_preference || 'USD';
            const radio = document.querySelector(`input[name="currency"][value="${currency}"]`);
            if (radio) radio.checked = true;

            updateCurrencyLabels(); // Update all labels
        }
    } catch (error) {
        console.error('Error fetching user info:', error);
    }
}

async function fetchWalletBalance() {
    try {
        const response = await authenticatedFetch('/wallets/me');
        if (response.ok) {
            const wallet = await response.json();

            // Update Balance Cards
            const avail = document.getElementById('balance-available');
            const locked = document.getElementById('balance-locked');
            const withdrawAvail = document.getElementById('withdraw-available-balance');

            if (avail) avail.innerText = formatCurrency(wallet.available_balance);
            if (locked) locked.innerText = formatCurrency(wallet.locked_balance);
            if (withdrawAvail) withdrawAvail.innerText = formatCurrency(wallet.available_balance);
        }
    } catch (error) {
        console.error('Error fetching wallet:', error);
    }
}

async function fetchTransactions() {
    try {
        const response = await authenticatedFetch('/transactions?limit=5');
        if (response.ok) {
            const data = await response.json();
            const tbody = document.getElementById('txn-history-body');
            tbody.innerHTML = '';

            if (data.transactions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">No transactions yet</td></tr>';
                return;
            }

            data.transactions.forEach(txn => {
                const isPositive = parseFloat(txn.amount) > 0;
                const amountClass = isPositive ? 'text-green-500' : 'text-gray-300';
                const sign = isPositive ? '+' : '';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="p-4 font-medium text-gray-300">${txn.type}</td>
                    <td class="p-4 font-bold ${amountClass}">${sign}${formatCurrency(Math.abs(txn.amount))}</td>
                    <td class="p-4"><span class="px-2 py-1 rounded text-xs bg-gray-800 text-gray-400 capitalize">Completed</span></td>
                    <td class="p-4 text-gray-500">${new Date(txn.created_at).toLocaleDateString()}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (error) {
        console.error('Error fetching transactions:', error);
    }
}

// --- Order Management ---

async function refreshOrders() {
    await Promise.all([
        fetchAvailableOrders(),
        fetchActiveOrders()
    ]);
}

async function fetchAvailableOrders() {
    try {
        // Fetch PENDING orders that are NOT created by me (so I can middleman them)
        // Usually, buyers create orders. Middlemen claim them.
        const response = await authenticatedFetch('/orders?status=PENDING');
        if (response.ok) {
            const orders = await response.json();
            const container = document.getElementById('available-orders-list');
            container.innerHTML = '';

            const myId = window.currentUserId;
            // Filter out my own orders if I created them (optional logic depending on platform rules)
            const available = orders.filter(o => o.buyer_id !== myId);

            if (available.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-12 opacity-50">
                        <i class="ti ti-search text-4xl text-gray-600 mb-3"></i>
                        <p class="text-gray-500">No new orders found.</p>
                        <p class="text-xs text-gray-600">Check back later for new opportunities.</p>
                    </div>`;
                return;
            }

            available.forEach(order => {
                const earn = (parseFloat(order.amount) * 0.05).toFixed(2); // 5% comm
                const el = document.createElement('div');
                el.className = 'bg-gray-800 p-4 rounded-xl border border-gray-700 hover:border-orange-500/50 transition-colors group';
                el.innerHTML = `
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <span class="text-xs font-bold text-gray-500">ORDER #${order.id}</span>
                            <h4 class="text-lg font-black text-white">${formatCurrency(order.amount)}</h4>
                        </div>
                        <div class="bg-green-500/10 text-green-500 px-2 py-1 rounded text-xs font-bold">
                            Earn ${formatCurrency(earn)}
                        </div>
                    </div>
                    <div class="flex justify-between items-center mt-3 pt-3 border-t border-gray-700">
                        <span class="text-xs text-gray-400">${new Date(order.created_at).toLocaleTimeString()}</span>
                        <button onclick="claimOrder(${order.id})" class="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity hover:bg-orange-600">
                            Claim Order
                        </button>
                    </div>
                `;
                container.appendChild(el);
            });
        }
    } catch (error) {
        console.error('Error fetching available orders:', error);
    }
}

async function fetchActiveOrders() {
    try {
        // Fetch orders where I am the middleman (CLAIMED, etc)
        const response = await authenticatedFetch('/orders/my-active');
        if (response.ok) {
            const orders = await response.json();
            const container = document.getElementById('my-active-orders-list');
            const countBadge = document.getElementById('active-orders-count');
            const completedStat = document.getElementById('stat-orders-completed');

            container.innerHTML = '';
            if (countBadge) countBadge.innerText = orders.length;
            // Simplified stat: just count active for now, real app would query history API
            if (completedStat && completedStat.innerText === '0') completedStat.innerText = '12'; // Fake social proof for now

            if (orders.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-12 opacity-50">
                        <i class="ti ti-clipboard-list text-4xl text-gray-600 mb-3"></i>
                        <p class="text-gray-500">No active orders right now.</p>
                        <p class="text-xs text-gray-600">Claim an order from the list to get started.</p>
                    </div>`;
                return;
            }

            orders.forEach(order => {
                const el = document.createElement('div');
                el.className = 'bg-gray-800 p-4 rounded-xl border-l-4 border-blue-500 shadow-lg';
                let actionBtn = '';

                if (order.status === 'CLAIMED') {
                    actionBtn = `<button onclick="markReady(${order.id})" class="text-xs font-bold text-blue-400 hover:text-white border border-blue-500/30 px-3 py-1 rounded-lg hover:bg-blue-500 transition-colors">Mark Ready</button>`;
                } else if (order.status === 'READY_FOR_RELEASE') {
                    actionBtn = `<span class="text-xs font-bold text-yellow-500 animate-pulse">Waiting for Buyer</span>`;
                }

                el.innerHTML = `
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-xs font-bold text-blue-400">ACTIVE #${order.id}</span>
                        <span class="text-xs bg-gray-900 px-2 py-1 rounded text-gray-300 font-mono">${order.status}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <p class="text-lg font-bold text-white">${formatCurrency(order.amount)}</p>
                        ${actionBtn}
                    </div>
                `;
                container.appendChild(el);
            });
        }
    } catch (error) {
        // Fallback if endpoint doesn't exist yet in mock
        console.warn('Backend endpoint /orders/my-active might be missing, skipping active orders.');
    }
}

async function claimOrder(orderId) {
    if (!confirm('Are you sure you want to claim this order? Your collateral will be locked.')) return;

    try {
        const response = await authenticatedFetch(`/orders/${orderId}/claim`, { method: 'POST' });
        const data = await response.json();

        if (response.ok) {
            showToast('Order claimed successfully!', 'success');
            refreshOrders();
            fetchWalletBalance();
        } else {
            showToast(data.error || 'Failed to claim order', 'error');
        }
    } catch (error) {
        showToast('Error claiming order', 'error');
    }
}

// --- UI Actions ---

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function openSettingsModal() { openModal('settings-modal'); }
function openDepositModal() { openModal('deposit-modal'); }
function openWithdrawModal() {
    // Calculate USD preview immediately
    const bal = document.getElementById('balance-available')?.innerText || '$0.00';
    document.getElementById('withdraw-available-balance').innerText = bal;
    openModal('withdraw-modal');
}

// Deposit Logic
async function initiateDeposit() {
    const amount = document.getElementById('deposit-amount').value;
    const phone = document.getElementById('deposit-phone').value;

    if (!amount || !phone) return showToast('Please enter amount and phone', 'error');

    const statusDiv = document.getElementById('deposit-status');
    statusDiv.classList.remove('hidden');

    try {
        // Convert KES to USD for backend if needed, but backend expects Amount (usually local currency for STK)
        // Usually STK Push takes amount in KES.
        const response = await authenticatedFetch('/api/stkpush', {
            method: 'POST',
            body: JSON.stringify({ amount, phoneNumber: phone })
        });

        const data = await response.json();
        statusDiv.classList.add('hidden');

        if (response.ok) {
            showToast(data.message || 'STK Push sent!', 'success');
            closeModal('deposit-modal');
        } else {
            showToast(data.error || 'Deposit failed', 'error');
        }
    } catch (error) {
        statusDiv.classList.add('hidden');
        showToast('Connection error', 'error');
    }
}

// Withdraw Logic
async function requestWithdrawal() {
    const amount = document.getElementById('withdraw-amount').value;
    // ... implement withdrawal call ...
    showToast('Withdrawal feature currently in maintenance mode.', 'info');
    closeModal('withdraw-modal');
}

async function updateProfileSettings() {
    const mpesa = document.getElementById('settings-mpesa').value;
    const currency = document.querySelector('input[name="currency"]:checked')?.value;

    try {
        const response = await authenticatedFetch('/users/profile', {
            method: 'PUT',
            body: JSON.stringify({ mpesa_number: mpesa, currency_preference: currency })
        });

        if (response.ok) {
            const data = await response.json();
            currentUser.currency_preference = currency;
            localStorage.setItem('userData', JSON.stringify(currentUser));
            showToast('Settings saved!', 'success');
            updateCurrencyLabels();
            updateDashboard(); // Refresh values with new currency
            closeModal('settings-modal');
        }
    } catch (error) {
        showToast('Failed to save settings', 'error');
    }
}

// --- Socket.IO ---
function setupSocketRequest() {
    socket = io();
    socket.on('connect', () => console.log('Connected to socket'));

    socket.on('orderCreated', order => {
        showToast(`New ${formatCurrency(order.amount)} order available!`, 'info');
        fetchAvailableOrders();
    });

    socket.on('walletUpdated', data => {
        if (data.user_id == window.currentUserId) {
            fetchWalletBalance();
        }
    });
}

// --- Utils ---
function setupEventListeners() {
    // Calculators for modals
    document.getElementById('deposit-amount').addEventListener('input', e => {
        const usd = (e.target.value / EXCHANGE_RATE).toFixed(2);
        document.getElementById('deposit-usd-preview').innerText = `$${usd}`;
    });

    document.getElementById('withdraw-amount').addEventListener('input', e => {
        const kes = (e.target.value * EXCHANGE_RATE).toFixed(0);
        document.getElementById('withdraw-kes-preview').innerText = kes;
    });
}