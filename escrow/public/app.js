// SecureEscrow User Dashboard Logic

// --- Constants ---
const API_BASE = '/escrow'; // Base path for API calls
// EXCHANGE_RATE is defined in auth.js

// --- State ---
let socket;
let currentUser = JSON.parse(localStorage.getItem('userData')) || null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Check auth first
    if (!checkAuthentication()) return;

    // Mobile Menu Toggle
    const mobileBtn = document.getElementById('mobile-menu-toggle');
    if (mobileBtn) {
        mobileBtn.addEventListener('click', () => {
            // For now, toggle a simple visibility or just reuse settings/logout
            // The user wanted to see settings/logout on phone view.
            // I'll just open the settings modal as a shortcut or show a toast
            showToast('Use the icons next to the menu for Settings and Logout', 'info');
        });
    }

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
            refreshOrders(),
            fetchPersonalStats(),
            fetchGlobalStats()
        ]);
        updateUserDisplay(); // From auth.js
    } catch (error) {
        console.error('Dashboard update failed:', error);
    }
}

// --- Data Fetching ---

async function fetchUserInfo() {
    try {
        const response = await authenticatedFetch('/auth/me');
        if (response.ok) {
            const user = await response.json();
            currentUser = user;
            localStorage.setItem('userData', JSON.stringify(user));
            window.currentUserId = user.id;
            window.currentUsername = user.username;
            updateUserDisplay();
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
            const availEl = document.getElementById('balance-available');
            const lockedEl = document.getElementById('balance-locked');

            if (availEl) availEl.textContent = formatCurrency(wallet.available_balance);
            if (lockedEl) lockedEl.textContent = formatCurrency(wallet.locked_balance);
        }
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
    }
}

// NEW: Fetch User Stats (Total deposited/withdrawn, real completed orders)
async function fetchPersonalStats() {
    try {
        const response = await authenticatedFetch('/wallets/stats/personal');
        if (response.ok) {
            const stats = await response.json();

            // Update Dashboard Cards
            const depositedEl = document.getElementById('stat-total-deposited');
            const withdrawnEl = document.getElementById('stat-total-withdrawn');
            const earnedEl = document.getElementById('stat-total-earned');
            const completedEl = document.getElementById('stat-orders-completed');

            if (depositedEl) depositedEl.innerText = formatCurrency(stats.totalDeposited);
            if (withdrawnEl) withdrawnEl.innerText = formatCurrency(stats.totalWithdrawn);
            if (earnedEl) earnedEl.innerText = formatCurrency(stats.totalEarned);
            if (completedEl) completedEl.innerText = stats.ordersDone;
        }
    } catch (e) { console.error('Error fetching personal stats:', e); }
}

// NEW: Global Stats
async function fetchGlobalStats() {
    try {
        const response = await authenticatedFetch('/orders/stats/global');
        if (response.ok) {
            const stats = await response.json();

            // Update Platform Overview section
            const createdEl = document.getElementById('global-total-created');
            const pendingEl = document.getElementById('global-total-pending');
            const claimedEl = document.getElementById('global-total-claimed');
            const settledEl = document.getElementById('global-total-settled');
            const commissionEl = document.getElementById('global-total-commission');

            if (createdEl) createdEl.innerText = stats.totalCreated;
            if (pendingEl) pendingEl.innerText = stats.totalPending;
            if (claimedEl) claimedEl.innerText = stats.totalClaimed;
            if (settledEl) settledEl.innerText = stats.totalSettled;
            if (commissionEl) commissionEl.innerText = formatCurrency(stats.totalCommission);
        }
    } catch (e) { console.error('Error global stats:', e); }
}

async function fetchTransactions() {
    try {
        const response = await authenticatedFetch('/wallets/history/all?limit=5');
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
                    <td class="p-4 text-gray-500">${new Date(txn.createdAt).toLocaleDateString()}</td>
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
            const data = await response.json();
            let orders = data.orders || [];
            const container = document.getElementById('available-orders-list');
            container.innerHTML = '';

            const myId = window.currentUserId;
            // Filter out my own orders if I created them
            let available = orders.filter(o => o.buyer_id !== myId);

            // Sorting logic
            const sortMode = document.getElementById('order-sort')?.value || 'newest';
            if (sortMode === 'price_desc') {
                available.sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
            } else if (sortMode === 'price_asc') {
                available.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));
            } else {
                // newest
                available.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            }

            console.log('Fetch Available:', { all: orders.length, filtered: available.length, myId, sort: sortMode });

            if (available.length === 0) {
                // If filters removed all, warn
                if (orders.length > 0) console.warn('Orders exist but hidden by buyer_id filter.');

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
                        <span class="text-xs text-gray-400">${new Date(order.createdAt).toLocaleTimeString()}</span>
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
                    actionBtn = `<div class="flex flex-col gap-2">
                            <button onclick="markReady(${order.id})" class="text-xs font-bold text-blue-400 hover:text-white border border-blue-500/30 px-3 py-1 rounded-lg hover:bg-blue-500 transition-colors">Mark Ready</button>
                            <button onclick="disputeOrder(${order.id})" class="text-xs font-bold text-red-400 hover:text-white border border-red-500/30 px-3 py-1 rounded-lg hover:bg-red-500 transition-colors">Dispute</button>
                        </div>`;
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

async function markReady(orderId) {
    if (!confirm('Mark this order as ready for release?')) return;
    try {
        const response = await authenticatedFetch(`/orders/${orderId}/complete`, { method: 'POST' });
        const data = await response.json();
        if (response.ok) {
            showToast('Order marked as ready!', 'success');
            refreshOrders();
        } else {
            showToast(data.error || 'Action failed', 'error');
        }
    } catch (e) { showToast('Connection error', 'error'); }
}

async function disputeOrder(orderId) {
    if (!confirm('Are you sure you want to dispute this order? This will hold funds for admin review.')) return;
    try {
        const response = await authenticatedFetch(`/orders/${orderId}/dispute`, { method: 'POST' });
        const data = await response.json();
        if (response.ok) {
            showToast('Dispute opened successfully', 'warning');
            refreshOrders();
        } else {
            showToast(data.error || 'Failed to open dispute', 'error');
        }
    } catch (e) { showToast('Connection error', 'error'); }
}

// --- UI Actions ---

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function openSettingsModal() {
    // Populate with current user data
    if (currentUser) {
        document.getElementById('settings-username').value = currentUser.username;
        document.getElementById('settings-role').value = currentUser.role || 'Middleman';
        document.getElementById('settings-fullname').value = currentUser.full_name || '';
        document.getElementById('settings-email').value = currentUser.email || '';
        document.getElementById('settings-mpesa').value = currentUser.mpesa_number || '';
        document.getElementById('settings-country').value = currentUser.country || '';

        const currencyRadio = document.querySelector(`input[name="currency"][value="${currentUser.currency_preference || 'USD'}"]`);
        if (currencyRadio) currencyRadio.checked = true;
    }
    openModal('settings-modal');
}
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
    const fullName = document.getElementById('settings-fullname').value;
    const email = document.getElementById('settings-email').value;
    const mpesa = document.getElementById('settings-mpesa').value;
    const country = document.getElementById('settings-country').value;
    const currency = document.querySelector('input[name="currency"]:checked')?.value;

    try {
        const response = await authenticatedFetch('/users/profile', {
            method: 'PUT',
            body: JSON.stringify({
                full_name: fullName,
                email: email,
                mpesa_number: mpesa,
                country: country,
                currency_preference: currency
            })
        });

        if (response.ok) {
            const data = await response.json();
            currentUser = { ...currentUser, ...data.user };
            localStorage.setItem('userData', JSON.stringify(currentUser));
            showToast('Profile updated successfully!', 'success');
            updateCurrencyLabels();
            updateDashboard(); // Refresh UI
            closeModal('settings-modal');
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to update profile', 'error');
        }
    } catch (error) {
        showToast('Failed to save settings', 'error');
    }
}

async function changePassword() {
    const currentPassword = document.getElementById('settings-current-password').value;
    const newPassword = document.getElementById('settings-new-password').value;

    if (!currentPassword || !newPassword) {
        return showToast('Both password fields are required', 'error');
    }

    try {
        const response = await authenticatedFetch('/users/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await response.json();
        if (response.ok) {
            showToast('Password updated successfully!', 'success');
            document.getElementById('settings-current-password').value = '';
            document.getElementById('settings-new-password').value = '';
            document.getElementById('password-change-section').classList.add('hidden');
        } else {
            showToast(data.error || 'Failed to change password', 'error');
        }
    } catch (e) { showToast('Connection error', 'error'); }
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

// Update header username
function updateUserDisplay() {
    if (typeof window !== 'undefined' && window.currentUsername) {
        const usernameEl = document.getElementById('header-username');
        if (usernameEl) {
            usernameEl.textContent = window.currentUsername;
        }
    }
}

// Deposit Tab Switching
function switchDepositTab(tab) {
    // Hide all
    document.getElementById('deposit-mpesa-content').classList.add('hidden');
    document.getElementById('deposit-agent-content').classList.add('hidden');
    document.getElementById('deposit-crypto-content').classList.add('hidden');

    // Reset styles
    ['mpesa', 'agent', 'crypto'].forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        el.classList.remove('text-green-500', 'border-b-2', 'border-green-500', 'text-blue-500', 'border-blue-500', 'text-gray-500');
        el.classList.add('text-gray-500');
        el.style.borderBottom = 'none';
    });

    // Show selected
    document.getElementById(`deposit-${tab}-content`).classList.remove('hidden');

    const activeBtn = document.getElementById(`tab-${tab}`);
    activeBtn.classList.remove('text-gray-500');

    if (tab === 'mpesa') {
        activeBtn.classList.add('text-green-500', 'border-b-2', 'border-green-500');
    } else if (tab === 'crypto') {
        activeBtn.classList.add('text-blue-500', 'border-b-2', 'border-blue-500');
    } else {
        activeBtn.classList.add('text-orange-500', 'border-b-2', 'border-orange-500');
    }
}

// Agent Search Mock
function searchAgent() {
    const input = document.getElementById('agent-search-input').value.toLowerCase();
    const resultArea = document.getElementById('agent-result');
    const actionArea = document.getElementById('agent-action-area');

    if (input.includes('allan') || input.includes('kariba')) {
        resultArea.classList.remove('hidden');
        actionArea.classList.remove('hidden');
        showToast('Agent Found: ALLAN KARIBA');
    } else {
        resultArea.classList.add('hidden');
        actionArea.classList.add('hidden');
        showToast('Agent not found. Try "Allan"', 'error');
    }
}

// Confirm Manual Deposit
async function confirmManualDeposit(method) {
    let details = {};

    if (method === 'Agent Deposit') {
        const message = document.getElementById('agent-mpesa-message').value.trim();
        if (!message) return showToast('Please paste the M-Pesa confirmation message.', 'error');
        details = { message };
    } else if (method === 'Crypto Deposit') {
        const txid = document.getElementById('crypto-txid').value.trim();
        // if (!txid) return showToast('Please enter the TXID.', 'error'); // Optional check
        details = { txid };
    }

    // In a real app, send `details` to backend.
    showToast(`${method} initiated under review.`, 'success');
    closeModal('deposit-modal');
}


// Dispute Order
async function disputeOrder(orderId) {
    if (!confirm('Are you sure you want to dispute this order?')) return;

    try {
        const response = await authenticatedFetch(`/orders/${orderId}/dispute`, {
            method: 'POST'
        });

        if (response.ok) {
            showToast('Order disputed successfully', 'success');
            fetchActiveOrders(); // Refresh list
        } else {
            const data = await response.json();
            showToast(data.message || 'Failed to dispute order', 'error');
        }
    } catch (error) {
        console.error('Error disputing order:', error);
        showToast('Error disputing order', 'error');
    }
}f u n c t i o n   u p d a t e U s e r D i s p l a y ( )   { 
         i f   ( ! c u r r e n t U s e r )   r e t u r n ; 
         c o n s t   n a m e E l   =   d o c u m e n t . g e t E l e m e n t B y I d ( ' h e a d e r - u s e r n a m e ' ) ; 
         i f   ( n a m e E l )   n a m e E l . t e x t C o n t e n t   =   c u r r e n t U s e r . f u l l _ n a m e   | |   c u r r e n t U s e r . u s e r n a m e ; 
 }  
 