let currentUserId = null;
let currentUserRole = null;
let currentUsername = null;
let socket = null;
let confirmCallback = null;
let masterOverview = null;
let balanceModalData = null;
let ordersOffset = 0;
let ordersHasMore = true;
let isLoadingOrders = false;

// Initialize Socket.io and check admin access
document.addEventListener('DOMContentLoaded', () => {
    checkAdminAuthentication();
    initializeSocket();
    initializeDarkMode();
});

function checkAdminAuthentication() {
    const authToken = localStorage.getItem('authToken');
    const userData = localStorage.getItem('userData');

    if (!authToken || !userData) {
        window.location.href = 'index.html';
        return;
    }

    try {
        const user = JSON.parse(userData);

        // Redirect non-admin users back to index.html
        if (user.role !== 'admin') {
            showToast('Unauthorized access. Redirecting...', 'error');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);
            return;
        }

        currentUserId = user.id;
        currentUserRole = user.role;
        currentUsername = user.username;

        updateUserDisplay();
        updateAdminDashboard();
    } catch (error) {
        console.error('Error parsing user data:', error);
        window.location.href = 'index.html';
    }
}

function initializeSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to WebSocket');
        showToast('Connected to real-time updates', 'info');
    });

    socket.on('orderCreated', (order) => {
        console.log('New order created:', order);
        showToast(`New order #${order.id} created!`, 'info');
        updateAdminDashboard();
    });

    socket.on('orderClaimed', (order) => {
        console.log('Order claimed:', order);
        showToast(`Order #${order.id} has been claimed!`, 'info');
        updateAdminDashboard();
    });

    socket.on('orderCompleted', (order) => {
        console.log('Order completed:', order);
        showToast(`Order #${order.id} completed!`, 'success');
        updateAdminDashboard();
    });

    socket.on('newTransactionRequest', (data) => {
        console.log('New transaction request:', data);
        const amount = parseFloat(data.amount);
        const isKes = data.metadata && data.metadata.currency === 'KES';
        const displayAmount = isKes ? `Ksh ${amount.toFixed(2)}` : formatCurrency(amount);

        showToast(`New ${data.type} request from ${data.username} for ${displayAmount}`, 'info');
        loadTransactionRequests();
    });

    socket.on('walletUpdated', (data) => {
        console.log('Wallet updated:', data);
        // Refresh user management to show updated balances
        loadMasterOverview();
    });

    socket.on('orderReadyForRelease', (order) => {
        console.log('Order ready for release:', order);
        showToast(`Order #${order.id} is ready for release!`, 'info');
        updateAdminDashboard();
    });

    socket.on('orderCancelled', (order) => {
        console.log('Order cancelled:', order);
        showToast(`Order #${order.id} has been cancelled`, 'info');
        updateAdminDashboard();
    });

    socket.on('transactionRequestReviewed', (data) => {
        console.log('Transaction request reviewed:', data);
        // Refresh to show updated state
        loadMasterOverview();
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from WebSocket');
    });
}

// Dark Mode Functions
function initializeDarkMode() {
    const isDark = localStorage.getItem('darkMode') === 'true';
    if (isDark) {
        document.documentElement.classList.add('dark');
    }
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('darkMode', isDark);
    showToast(isDark ? 'Dark mode enabled' : 'Light mode enabled', 'info');
}

// Bulk Order Functions
let bulkOrdersCache = [];

function toggleBulkSection() {
    const container = document.getElementById('bulk-form-container');
    const icon = document.getElementById('bulk-toggle-icon');
    if (container) container.classList.toggle('hidden');
    if (icon) icon.style.transform = container.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
}

function generateRandomAmounts(count, total, min, max) {
    if (min * count > total || max * count < total) return null;

    let amounts = [];

    // 1. Coverage: Ensure we hit every "whole dollar" segment if possible
    const floorMin = Math.floor(min);
    const floorMax = Math.floor(max);
    const segments = [];
    for (let i = floorMin; i <= floorMax; i++) {
        segments.push(i);
    }

    // Shuffle segments to assign them to random order slots
    const shuffledSegments = [...segments].sort(() => Math.random() - 0.5);

    // Pick unique segment values for the first few orders
    for (let i = 0; i < Math.min(count - 1, shuffledSegments.length); i++) {
        const seg = shuffledSegments[i];
        const sMin = Math.max(min, seg);
        const sMax = Math.min(max, seg + 0.99);
        // Random value in this segment's range
        amounts.push(sMin + (Math.random() * (sMax - sMin)));
    }

    // 2. Fill the rest with random values in full range
    while (amounts.length < count) {
        amounts.push(min + Math.random() * (max - min));
    }

    // 3. Balancing & Jitter: Reach target sum while maintaining uniqueness
    // We iterate to spread the values and hit the sum
    const iterations = count * 50;
    for (let i = 0; i < iterations; i++) {
        const idx1 = Math.floor(Math.random() * count);
        const idx2 = Math.floor(Math.random() * count);
        if (idx1 === idx2) continue;

        const maxMove = Math.min(amounts[idx1] - min, max - amounts[idx2]);
        if (maxMove > 0) {
            const jitter = Math.random() * maxMove * 0.4;
            amounts[idx1] -= jitter;
            amounts[idx2] += jitter;
        }
    }

    // 4. Force rounding and exact sum correction
    amounts = amounts.map(v => Math.round(v * 100) / 100);
    // Ensure all are within bounds after rounding
    amounts = amounts.map(v => Math.max(min, Math.min(max, v)));

    let currentSum = amounts.reduce((a, b) => a + b, 0);
    let diff = Math.round((total - currentSum) * 100) / 100;

    // Distribute remaining cents while maintaining uniqueness
    let safety = 0;
    while (Math.abs(diff) > 0.001 && safety < 2000) {
        const step = diff > 0 ? 0.01 : -0.01;
        const idx = Math.floor(Math.random() * count);

        const candidate = Math.round((amounts[idx] + step) * 100) / 100;

        // Uniqueness check: Is this candidate value already in the list?
        if (candidate >= min && candidate <= max && !amounts.includes(candidate)) {
            amounts[idx] = candidate;
            diff = Math.round((diff - step) * 100) / 100;
        }
        safety++;
    }

    // Final shuffle to not have the "coverage" orders always at the start
    return amounts.sort(() => Math.random() - 0.5);
}

function previewBulkOrders() {
    const count = parseInt(document.getElementById('bulk-count').value);
    const total = parseFloat(document.getElementById('bulk-total').value);
    const min = parseFloat(document.getElementById('bulk-min').value);
    const max = parseFloat(document.getElementById('bulk-max').value);

    if (!count || !total || !min || !max) {
        showToast('Please fill all fields', 'error');
        return;
    }

    if (min * count > total) {
        showToast(`Impossible! Minimum ${min} * ${count} = ${min * count} > Total ${total}`, 'error');
        return;
    }

    if (max * count < total) {
        showToast(`Impossible! Maximum ${max} * ${count} = ${max * count} < Total ${total}`, 'error');
        return;
    }

    // Try generation (retry up to 5 times)
    let amounts = null;
    for (let i = 0; i < 5; i++) {
        const candidate = generateRandomAmounts(count, total, min, max);
        const valid = candidate.every(a => a >= min && a <= max);
        if (valid) {
            amounts = candidate;
            break;
        }
    }

    // Fallback if random fails: uniform distribution
    if (!amounts) {
        showToast('Random distribution failed constraints. Using uniform distribution.', 'warning');
        const avg = total / count;
        amounts = new Array(count).fill(avg);
    }

    bulkOrdersCache = amounts.map(amount => ({
        amount: parseFloat(amount.toFixed(2)),
        description: `Bulk Order - Random Gen`
    }));

    const previewList = document.getElementById('bulk-preview-list');
    previewList.innerHTML = '';

    bulkOrdersCache.forEach((order, index) => {
        const div = document.createElement('div');
        div.className = 'flex justify-between text-sm';
        div.innerHTML = `<span>Order #${index + 1}</span> <span class="font-mono font-bold">$${order.amount.toFixed(2)}</span>`;
        previewList.appendChild(div);
    });

    document.getElementById('bulk-preview-sum').textContent = bulkOrdersCache.reduce((a, o) => a + o.amount, 0).toFixed(2);
    document.getElementById('bulk-preview').classList.remove('hidden');
}

async function submitBulkOrders() {
    if (bulkOrdersCache.length === 0) {
        showToast('Please preview orders first', 'error');
        return;
    }

    try {
        const response = await authenticatedFetch('/orders/bulk', {
            method: 'POST',
            body: JSON.stringify({ orders: bulkOrdersCache })
        });

        if (response.ok) {
            showToast('Batch created successfully!', 'success');
            document.getElementById('bulk-form-container').classList.add('hidden');
            bulkOrdersCache = [];
            // Refresh logic
            refreshData();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to create bulk orders', 'error');
        }
    } catch (error) {
        console.error(error);
        showToast('Server error', 'error');
    }
}
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';

    toast.className = `${bgColor} text-white px-6 py-4 rounded-lg shadow-lg transform transition-all duration-300 flex items-center space-x-3 max-w-md pointer-events-auto`;
    toast.innerHTML = `
        <i class="ti ti-${type === 'success' ? 'check' : type === 'error' ? 'x' : 'info-circle'} text-2xl"></i>
        <span class="font-medium">${message}</span>
    `;

    const container = document.getElementById('toast-container');
    if (container) {
        container.appendChild(toast);
    } else {
        // Create container if missing
        const newContainer = document.createElement('div');
        newContainer.id = 'toast-container';
        newContainer.className = 'fixed top-4 right-4 z-50 flex flex-col space-y-4';
        document.body.appendChild(newContainer);
        newContainer.appendChild(toast);
    }

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Confirmation Dialog
function showConfirmDialog(title, message, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-dialog').classList.remove('hidden');
    confirmCallback = callback;

    document.getElementById('confirm-action-btn').onclick = () => {
        if (confirmCallback) confirmCallback();
        closeConfirmDialog();
    };
}

function closeConfirmDialog() {
    document.getElementById('confirm-dialog').classList.add('hidden');
    confirmCallback = null;
}

function updateUserDisplay() {
    const userDisplay = document.getElementById('current-user-display');
    if (userDisplay && currentUsername) {
        userDisplay.textContent = currentUsername;
    }
}

async function updateAdminDashboard() {
    if (!currentUserId) return;

    // Default load: All orders, no search
    await loadMasterOverview();
    await loadTransactionRequests();
    await loadDisputes();
    updateSystemHealthCards();
    updateUserDisplay();
    updateCurrencyLabels();
}

let filterTimeout = null;
function filterAdminOrders() {
    // Clear existing timeout for debouncing search
    if (filterTimeout) clearTimeout(filterTimeout);

    // Debounce to avoid too many API calls while typing
    filterTimeout = setTimeout(async () => {
        ordersOffset = 0; // Reset pagination
        ordersHasMore = true;
        await loadMasterOverview(false); // Force fresh load
    }, 400);
}

async function loadMasterOverview(loadMore = false) {
    if (isLoadingOrders && loadMore) return;
    isLoadingOrders = true;

    try {
        const limit = 10;
        const offset = loadMore ? ordersOffset : 0;

        // Get filter values from UI
        const status = document.getElementById('admin-order-filter')?.value || 'ALL';
        const search = document.getElementById('admin-order-search')?.value || '';

        let url = `/admin/overview?ordersLimit=${limit}&ordersOffset=${offset}`;
        if (status !== 'ALL') url += `&status=${status}`;
        if (search.trim() !== '') url += `&search=${encodeURIComponent(search.trim())}`;

        const response = await authenticatedFetch(url);

        if (!response.ok) {
            console.error('Failed to load master overview');
            return;
        }

        const data = await response.json();

        if (loadMore) {
            // Append new orders to existing ones
            masterOverview = {
                ...data,
                orders: [...(masterOverview?.orders || []), ...(data.orders || [])]
            };
            ordersOffset += limit;
        } else {
            // Fresh load
            masterOverview = data;
            ordersOffset = limit;
        }

        ordersHasMore = data.ordersHasMore;

        // Display God-Mode Orders
        displayGodModeOrders();

        // Display User Management
        displayUserManagement();

    } catch (error) {
        console.error('Error loading master overview:', error);
    } finally {
        isLoadingOrders = false;
    }
}

function displayGodModeOrders() {
    const ordersBody = document.getElementById('god-mode-orders-body');
    const emptyState = document.getElementById('empty-god-orders');

    if (!ordersBody) {
        console.warn('god-mode-orders-body element not found');
        return;
    }

    ordersBody.innerHTML = '';

    if (!masterOverview || !masterOverview.orders || masterOverview.orders.length === 0) {
        if (emptyState) {
            emptyState.classList.remove('hidden');
        }
        return;
    }

    if (emptyState) {
        emptyState.classList.add('hidden');
    }

    const statusColors = {
        'PENDING': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        'CLAIMED': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        'COMPLETED': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        'DISPUTED': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        'CANCELLED': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
    };

    masterOverview.orders.forEach(order => {
        const row = document.createElement('tr');
        row.className = 'border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition';

        const actions = [];

        if (order.status === 'CLAIMED' || order.status === 'READY_FOR_RELEASE') {
            actions.push(`
                <button onclick="adminReleaseOrder(${order.id})"
                        class="px-3 py-1 bg-green-600 text-white rounded text-xs font-semibold hover:bg-green-700 transition">
                    <i class="ti ti-check"></i> Release
                </button>
            `);
        }

        if (order.status !== 'COMPLETED' && order.status !== 'CANCELLED') {
            actions.push(`
                <button onclick="adminCancelOrder(${order.id})"
                        class="px-3 py-1 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700 transition">
                    <i class="ti ti-x"></i> Cancel
                </button>
            `);
        }

        row.innerHTML = `
            <td class="py-3 px-4 font-semibold text-gray-900 dark:text-white">#${order.id}</td>
            <td class="py-3 px-4 font-bold text-gray-900 dark:text-white">${formatCurrency(order.amount)}</td>
            <td class="py-3 px-4">
                <span class="inline-block px-2 py-1 rounded text-xs font-semibold ${statusColors[order.status]}">${order.status}</span>
            </td>
            <td class="py-3 px-4 text-gray-600 dark:text-gray-400">${order.buyer ? order.buyer.username : 'N/A'}</td>
            <td class="py-3 px-4 text-gray-600 dark:text-gray-400">${order.middleman ? order.middleman.username : 'Not claimed'}</td>
            <td class="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">${new Date(order.createdAt).toLocaleDateString()}</td>
            <td class="py-3 px-4">
                <div class="flex space-x-2">
                    ${actions.join('')}
                </div>
            </td>
        `;
        ordersBody.appendChild(row);
    });

    // Add Load More button if there are more orders
    const loadMoreContainer = document.getElementById('admin-orders-load-more');
    if (loadMoreContainer) {
        if (ordersHasMore) {
            loadMoreContainer.classList.remove('hidden');
            loadMoreContainer.innerHTML = `
                <div class="text-center py-4">
                    <button onclick="loadMoreAdminOrders()"
                            class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold transition flex items-center space-x-2 mx-auto">
                        <i class="ti ti-chevron-down"></i>
                        <span>Load More Orders</span>
                    </button>
                </div>
            `;
        } else {
            loadMoreContainer.classList.add('hidden');
        }
    }
}

async function loadMoreAdminOrders() {
    await loadMasterOverview(true);
}

function displayUserManagement() {
    const usersBody = document.getElementById('user-management-body');

    if (!usersBody) {
        console.warn('user-management-body element not found');
        return;
    }

    usersBody.innerHTML = '';

    if (!masterOverview || !masterOverview.users) return;

    const roleColors = {
        'admin': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
        'middleman': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        'buyer': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    };

    const statusColors = {
        'active': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        'disabled': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        'blocked': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
    };

    masterOverview.users.forEach(user => {
        const row = document.createElement('tr');
        row.className = 'border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition';

        const isCurrentUser = user.id === currentUserId;

        row.innerHTML = `
            <td class="py-3 px-4 font-semibold text-gray-900 dark:text-white">${user.username}</td>
            <td class="py-3 px-4">
                <span class="inline-block px-2 py-1 rounded text-xs font-semibold ${roleColors[user.role]}">${user.role.toUpperCase()}</span>
            </td>
            <td class="py-3 px-4">
                <span class="inline-block px-2 py-1 rounded text-xs font-semibold ${statusColors[user.status]}">${user.status.toUpperCase()}</span>
            </td>
            <td class="py-3 px-4 font-bold text-green-600 dark:text-green-400">${formatCurrency(user.available_balance)}</td>
            <td class="py-3 px-4 font-bold text-purple-600 dark:text-purple-400">${formatCurrency(user.locked_balance)}</td>
            <td class="py-3 px-4 font-bold text-blue-600 dark:text-blue-400">${formatCurrency(user.total_balance)}</td>
            <td class="py-3 px-4">
                <div class="flex space-x-1 flex-wrap">
                    <button onclick="showDepositModal(${user.id}, '${user.username}')"
                            class="px-2 py-1 bg-green-600 text-white rounded text-xs font-semibold hover:bg-green-700 transition">
                        <i class="ti ti-plus"></i> Deposit
                    </button>
                    <button onclick="showWithdrawModal(${user.id}, '${user.username}', ${user.available_balance})"
                            class="px-2 py-1 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700 transition">
                        <i class="ti ti-minus"></i> Withdraw
                    </button>
                    ${!isCurrentUser ? `
                        <button onclick="updateUserStatus(${user.id}, 'disabled')"
                                class="px-2 py-1 bg-yellow-600 text-white rounded text-xs font-semibold hover:bg-yellow-700 transition ${user.status === 'disabled' ? 'opacity-50 cursor-not-allowed' : ''}"
                                ${user.status === 'disabled' ? 'disabled' : ''}>
                            <i class="ti ti-ban"></i> Disable
                        </button>
                        <button onclick="updateUserStatus(${user.id}, 'blocked')"
                                class="px-2 py-1 bg-orange-600 text-white rounded text-xs font-semibold hover:bg-orange-700 transition ${user.status === 'blocked' ? 'opacity-50 cursor-not-allowed' : ''}"
                                ${user.status === 'blocked' ? 'disabled' : ''}>
                            <i class="ti ti-lock"></i> Block
                        </button>
                        <button onclick="updateUserStatus(${user.id}, 'active')"
                                class="px-2 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 transition ${user.status === 'active' ? 'opacity-50 cursor-not-allowed' : ''}"
                                ${user.status === 'active' ? 'disabled' : ''}>
                            <i class="ti ti-check"></i> Activate
                        </button>
                        <button onclick="deleteUser(${user.id}, '${user.username}')"
                                class="px-2 py-1 bg-red-700 text-white rounded text-xs font-semibold hover:bg-red-800 transition">
                            <i class="ti ti-trash"></i> Delete
                        </button>
                    ` : '<span class="text-xs text-gray-400">(You)</span>'}
                </div>
            </td>
        `;
        usersBody.appendChild(row);
    });
}

function updateSystemHealthCards() {
    if (!masterOverview) return;

    // Update stats for admin.html
    const totalUsersEl = document.getElementById('stat-total-users');
    const activeOrdersEl = document.getElementById('stat-active-orders');
    const pendingRequestsEl = document.getElementById('stat-pending-requests');
    const totalBalanceEl = document.getElementById('stat-total-balance');

    if (totalUsersEl) {
        totalUsersEl.textContent = masterOverview.users ? masterOverview.users.length : 0;
    }

    if (activeOrdersEl && masterOverview.orders) {
        const activeOrders = masterOverview.orders.filter(o => o.status === 'CLAIMED' || o.status === 'READY_FOR_RELEASE').length;
        activeOrdersEl.textContent = activeOrders;
    }

    if (pendingRequestsEl && masterOverview.pendingRequests !== undefined) {
        pendingRequestsEl.textContent = masterOverview.pendingRequests;
    }

    if (totalBalanceEl && masterOverview.users) {
        const totalBalance = masterOverview.users.reduce((sum, u) => {
            return sum + parseFloat(u.available_balance || 0) + parseFloat(u.locked_balance || 0);
        }, 0);
        totalBalanceEl.textContent = formatCurrency(totalBalance);
    }

    // Legacy support for index.html elements (if they exist)
    const totalEscrowEl = document.getElementById('total-escrow-volume');
    const activeDisputesEl = document.getElementById('active-disputes');
    const systemLiquidityEl = document.getElementById('system-liquidity');

    if (totalEscrowEl && masterOverview.orders) {
        const totalEscrow = masterOverview.orders
            .filter(o => o.status === 'CLAIMED')
            .reduce((sum, o) => sum + parseFloat(o.amount), 0);
        totalEscrowEl.textContent = formatCurrency(totalEscrow);
    }

    if (activeDisputesEl && masterOverview.orders) {
        const disputes = masterOverview.orders.filter(o => o.status === 'DISPUTED').length;
        activeDisputesEl.textContent = disputes;
    }

    if (systemLiquidityEl && masterOverview.users) {
        const liquidity = masterOverview.users
            .reduce((sum, u) => sum + parseFloat(u.available_balance), 0);
        systemLiquidityEl.textContent = formatCurrency(liquidity);
    }
}

async function loadTransactionRequests() {
    try {
        const response = await authenticatedFetch('/admin/transaction-requests?status=pending');

        if (!response.ok) {
            throw new Error('Failed to load transaction requests');
        }

        const requests = await response.json();

        const listContainer = document.getElementById('transaction-requests-list');
        const emptyState = document.getElementById('empty-transaction-requests');

        if (requests.length === 0) {
            listContainer.classList.add('hidden');
            emptyState.classList.remove('hidden');
        } else {
            listContainer.classList.remove('hidden');
            emptyState.classList.add('hidden');

            listContainer.innerHTML = requests.map(req => `
                <div class="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                    <div class="flex items-center justify-between mb-4">
                        <div class="flex items-center space-x-3">
                            <div class="w-12 h-12 ${req.type === 'deposit' ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'} rounded-lg flex items-center justify-center">
                                <i class="ti ${req.type === 'deposit' ? 'ti-plus' : 'ti-minus'} text-2xl ${req.type === 'deposit' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}"></i>
                            </div>
                            <div>
                                <p class="font-bold text-gray-900 dark:text-white">${req.type.toUpperCase()} REQUEST</p>
                                <p class="text-sm text-gray-600 dark:text-gray-400">From: <strong>${req.user.username}</strong></p>
                                <p class="text-xs text-gray-500 dark:text-gray-500">${new Date(req.createdAt).toLocaleString()}</p>
                            </div>
                        </div>
                        <div class="text-right">
                            ${(() => {
                    const isKes = req.metadata && req.metadata.currency === 'KES';
                    const amount = parseFloat(req.amount);
                    const adminPref = getUserCurrency();

                    if (isKes) {
                        const usdVal = (amount / EXCHANGE_RATE).toFixed(2);
                        const kesVal = amount.toFixed(2);

                        if (adminPref === 'KES') {
                            return `
                                            <p class="text-3xl font-bold text-gray-900 dark:text-white">Ksh ${kesVal}</p>
                                            <p class="text-sm text-gray-500 font-medium">≈ $${usdVal} USD</p>
                                        `;
                        } else {
                            return `
                                            <p class="text-3xl font-bold text-gray-900 dark:text-white">$${usdVal}</p>
                                            <p class="text-sm text-gray-500 font-medium">≈ Ksh ${kesVal} KES</p>
                                        `;
                        }
                    } else {
                        return `<p class="text-3xl font-bold text-gray-900 dark:text-white">${formatCurrency(amount)}</p>`;
                    }
                })()}
                        </div>
                    </div>
                    
                    ${req.type === 'withdrawal' && req.metadata && req.metadata.phone ? `
                        <div class="mb-3 p-3 bg-blue-50 dark:bg-blue-900/40 rounded-lg border border-blue-100 dark:border-blue-800 flex items-center justify-between">
                            <div>
                                <p class="text-xs text-blue-600 dark:text-blue-400 uppercase font-black tracking-wider mb-1">Payout M-Pesa Number</p>
                                <p class="text-lg font-bold text-blue-900 dark:text-blue-100">${req.metadata.phone}</p>
                            </div>
                            <div class="w-10 h-10 bg-blue-100 dark:bg-blue-800 rounded-full flex items-center justify-center">
                                <i class="ti ti-phone text-blue-600 dark:text-blue-400"></i>
                            </div>
                        </div>
                    ` : ''}
                    
                    ${req.notes ? `
                        <div class="mb-3 p-3 bg-white dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600">
                            <p class="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold mb-1">User Notes</p>
                            <p class="text-sm text-gray-600 dark:text-gray-300 italic">"${req.notes}"</p>
                        </div>
                    ` : ''}
                    
                    ${req.screenshot_path ? `
                        <div class="mb-3">
                            <a href="/uploads/${req.screenshot_path}" target="_blank" 
                               class="inline-flex items-center space-x-2 text-blue-600 dark:text-blue-400 hover:underline">
                                <i class="ti ti-photo"></i>
                                <span>View Payment Screenshot</span>
                            </a>
                        </div>
                    ` : ''}
                    
                    <div class="flex space-x-2">
                        <button onclick="reviewTransactionRequest(${req.id}, 'approve')" 
                                class="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition">
                            <i class="ti ti-check"></i> Approve
                        </button>
                        <button onclick="reviewTransactionRequest(${req.id}, 'reject')" 
                                class="flex-1 bg-gradient-to-r from-red-500 to-red-600 text-white px-4 py-2 rounded-lg font-semibold hover:from-red-600 hover:to-red-700 transition">
                            <i class="ti ti-x"></i> Reject
                        </button>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading transaction requests:', error);
    }
}

async function reviewTransactionRequest(requestId, action) {
    const actionText = action === 'approve' ? 'approve' : 'reject';
    const adminNotes = prompt(`${actionText.charAt(0).toUpperCase() + actionText.slice(1)} this request?\n\nOptional admin notes:`);

    if (adminNotes === null) return; // User cancelled

    try {
        const response = await authenticatedFetch(`/transaction-requests/${requestId}/review`, {
            method: 'POST',
            body: JSON.stringify({ action, admin_notes: adminNotes })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Review failed');
        }

        const result = await response.json();
        showToast(`Request ${actionText}d successfully!`, 'success');

        // Refresh data
        await loadTransactionRequests();
        await loadMasterOverview();
        updateSystemHealthCards();
    } catch (error) {
        console.error('Review error:', error);
        showToast('Failed to review request: ' + error.message, 'error');
    }
}

async function createNewOrder() {
    const amount = document.getElementById('order-amount').value;
    const description = document.getElementById('order-description').value || 'No description provided';

    if (!amount || amount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }

    showConfirmDialog(
        'Create Order',
        `Create an escrow order for $${amount}? This order will be assigned to you as the buyer.`,
        async () => {
            try {
                const response = await authenticatedFetch('/orders', {
                    method: 'POST',
                    body: JSON.stringify({
                        amount: parseFloat(amount),
                        description: description
                    }),
                });

                const result = await response.json();

                if (response.ok) {
                    showToast('Order created successfully!', 'success');
                    document.getElementById('order-amount').value = '';
                    document.getElementById('order-description').value = '';
                    updateAdminDashboard();
                } else {
                    showToast(result.error || 'Failed to create order', 'error');
                }
            } catch (error) {
                console.error('Error creating order:', error);
                showToast('Error creating order: ' + error.message, 'error');
            }
        }
    );
}

async function adminReleaseOrder(orderId) {
    showConfirmDialog(
        'Release Order',
        `Complete order #${orderId}? The middleman will receive their collateral back plus 5% commission.`,
        async () => {
            try {
                const response = await authenticatedFetch(`/orders/${orderId}/release`, {
                    method: 'POST',
                });

                const result = await response.json();

                if (response.ok) {
                    showToast(result.message || 'Order completed successfully!', 'success');
                    updateAdminDashboard();
                } else {
                    showToast(result.error || 'Failed to complete order', 'error');
                }
            } catch (error) {
                console.error('Error completing order:', error);
                showToast('Error completing order: ' + error.message, 'error');
            }
        }
    );
}

async function adminCancelOrder(orderId) {
    showConfirmDialog(
        'Cancel Order',
        `Are you sure you want to cancel order #${orderId}? If the order was claimed, the collateral will be returned to the middleman.`,
        async () => {
            try {
                const response = await authenticatedFetch(`/orders/${orderId}/cancel`, {
                    method: 'POST',
                });

                const result = await response.json();

                if (response.ok) {
                    showToast('Order cancelled successfully!', 'success');
                    updateAdminDashboard();
                } else {
                    showToast(result.error || 'Failed to cancel order', 'error');
                }
            } catch (error) {
                console.error('Error cancelling order:', error);
                showToast('Error cancelling order: ' + error.message, 'error');
            }
        }
    );
}

// Balance Adjustment Modal Functions
function showDepositModal(userId, username) {
    balanceModalData = { userId, username, type: 'deposit' };
    document.getElementById('balance-modal-title').textContent = 'Manual Deposit';
    document.getElementById('balance-username').textContent = username;
    document.getElementById('balance-amount').value = '';
    document.getElementById('balance-adjustment-modal').classList.remove('hidden');

    document.getElementById('balance-submit-btn').onclick = () => submitBalanceAdjustment();
}

function showWithdrawModal(userId, username, availableBalance) {
    balanceModalData = { userId, username, type: 'withdraw', availableBalance };
    document.getElementById('balance-modal-title').textContent = 'Manual Withdrawal';
    document.getElementById('balance-username').textContent = username;
    document.getElementById('balance-amount').value = '';
    document.getElementById('balance-adjustment-modal').classList.remove('hidden');

    document.getElementById('balance-submit-btn').onclick = () => submitBalanceAdjustment();
}

function closeBalanceModal() {
    document.getElementById('balance-adjustment-modal').classList.add('hidden');
    balanceModalData = null;
}

async function submitBalanceAdjustment() {
    if (!balanceModalData) return;

    const amount = parseFloat(document.getElementById('balance-amount').value);

    if (!amount || amount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }

    if (balanceModalData.type === 'withdraw' && amount > balanceModalData.availableBalance) {
        showToast('Withdrawal amount exceeds available balance', 'error');
        return;
    }

    try {
        const endpoint = balanceModalData.type === 'deposit'
            ? `/admin/wallets/${balanceModalData.userId}/deposit`
            : `/admin/wallets/${balanceModalData.userId}/withdraw`;

        const response = await authenticatedFetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({
                amount,
                notes: `Admin Manual ${balanceModalData.type}: ${currentUsername}`
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Operation failed');
        }

        const result = await response.json();
        showToast(`${balanceModalData.type === 'deposit' ? 'Deposit' : 'Withdrawal'} successful!`, 'success');

        closeBalanceModal();

        // Refresh admin dashboard to show updated balances
        await updateAdminDashboard();

        // The server already emits walletUpdated event via WebSocket
        // which will update the user's dashboard in real-time
    } catch (error) {
        console.error('Balance adjustment error:', error);
        showToast('Failed to adjust balance: ' + error.message, 'error');
    }
}

// Logout function
function logout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    showToast('Logged out successfully', 'info');
    window.location.href = 'index.html';
}

// Order Details Modal (reuse from app.js)
function showOrderDetails(orderId) {
    // This would need to be implemented or imported
    showToast('Order details not implemented in admin dashboard', 'info');
}

async function loadDisputes() {
    try {
        const response = await authenticatedFetch('/admin/overview');
        const data = await response.json();

        const disputesList = document.getElementById('disputes-list');
        const emptyDisputes = document.getElementById('empty-disputes');

        const disputedOrders = data.orders.filter(o => o.status === 'DISPUTED');
        disputesList.innerHTML = '';

        if (disputedOrders.length === 0) {
            disputesList.classList.add('hidden');
            emptyDisputes.classList.remove('hidden');
        } else {
            disputesList.classList.remove('hidden');
            emptyDisputes.classList.add('hidden');

            disputedOrders.forEach(order => {
                const disputeCard = document.createElement('div');
                disputeCard.className = 'bg-gradient-to-r from-red-900 to-orange-900 rounded-lg p-4 border border-red-700';

                disputeCard.innerHTML = `
                    <div class="flex items-center justify-between mb-4">
                        <div class="flex items-center space-x-3">
                            <div class="w-12 h-12 bg-red-100 dark:bg-red-800 rounded-lg flex items-center justify-center">
                                <i class="ti ti-alert-triangle text-2xl text-red-600 dark:text-red-300"></i>
                            </div>
                            <div>
                                <p class="font-bold text-white">Order #${order.id} Dispute</p>
                                <p class="text-sm text-red-200">Amount: <strong>${parseFloat(order.amount).toFixed(2)}</strong></p>
                                <p class="text-xs text-red-300">${new Date(order.createdAt).toLocaleString()}</p>
                            </div>
                        </div>
                        <div class="text-right">
                            <p class="text-sm text-red-200">Middleman: ${order.middleman ? order.middleman.username : 'N/A'}</p>
                            <p class="text-sm text-red-200">Buyer: ${order.buyer ? order.buyer.username : 'N/A'}</p>
                        </div>
                    </div>

                    <div class="bg-red-800 p-3 rounded-lg mb-4">
                        <p class="text-sm text-red-200">
                            <strong>Dispute Details:</strong> This order has been disputed. Decide whether to award the funds to the Middleman or return them to the Buyer.
                        </p>
                    </div>

                    <div class="flex space-x-2">
                        <button onclick="resolveDispute(${order.id}, 'middleman')"
                                class="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition">
                            <i class="ti ti-trophy"></i> Award Middleman
                        </button>
                        <button onclick="resolveDispute(${order.id}, 'buyer')"
                                class="flex-1 bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:from-blue-600 hover:to-indigo-700 transition">
                            <i class="ti ti-coin"></i> Refund Buyer
                        </button>
                    </div>
                `;
                disputesList.appendChild(disputeCard);
            });
        }
    } catch (error) {
        console.error('Error loading disputes:', error);
    }
}

async function resolveDispute(orderId, winner) {
    const winnerText = winner === 'middleman' ? 'Middleman (Worker)' : 'Buyer (Admin)';
    const message = winner === 'middleman'
        ? `Award this dispute to the Middleman? They will receive their collateral back plus 5% commission.`
        : `Award this dispute to the Buyer? The Middleman will get their collateral back but no commission will be paid.`;

    showConfirmDialog(
        `Resolve Dispute - Order #${orderId}`,
        message,
        async () => {
            try {
                const response = await authenticatedFetch(`/orders/${orderId}/resolve`, {
                    method: 'POST',
                    body: JSON.stringify({ winner })
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to resolve dispute');
                }

                const result = await response.json();
                showToast(result.message, 'success');
                updateAdminDashboard();
            } catch (error) {
                console.error('Error resolving dispute:', error);
                showToast('Failed to resolve dispute: ' + error.message, 'error');
            }
        }
    );
}


// Add event listeners for live preview
document.addEventListener('DOMContentLoaded', () => {
    // ... existing code ...

    // Add bulk order preview listeners
    ['bulk-order-count', 'bulk-total-amount', 'bulk-min-amount', 'bulk-max-amount'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', updateBulkPreview);
        }
    });
});

// Helper function to make authenticated requests

// User Management Functions
async function updateUserStatus(userId, status) {
    const statusMessages = {
        'active': 'Activate this user? They will regain full access to their account.',
        'disabled': 'Disable this user? They will be unable to login or perform any actions.',
        'blocked': 'BLOCK this user? This is a serious action for violating terms.'
    };

    showConfirmDialog(
        `${status.toUpperCase()} User`,
        statusMessages[status] || `Change user status to ${status}?`,
        async () => {
            try {
                const response = await authenticatedFetch(`/admin/users/${userId}/status`, {
                    method: 'PUT',
                    body: JSON.stringify({ status })
                });

                if (response.ok) {
                    showToast(`User status updated to ${status}`, 'success');
                    await loadMasterOverview(); // Refresh the list
                } else {
                    const data = await response.json();
                    showToast(data.error || 'Failed to update user status', 'error');
                }
            } catch (error) {
                console.error('Error updating user status:', error);
                showToast('Server error during status update', 'error');
            }
        }
    );
}

async function deleteUser(userId, username) {
    showConfirmDialog(
        'PERMANENTLY DELETE USER',
        `Are you absolutely sure you want to delete ${username}? This action CANNOT be undone and all their data will be lost.`,
        async () => {
            try {
                const response = await authenticatedFetch(`/admin/users/${userId}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    showToast('User deleted successfully', 'success');
                    await loadMasterOverview(); // Refresh the list
                } else {
                    const data = await response.json();
                    showToast(data.error || 'Failed to delete user', 'error');
                }
            } catch (error) {
                console.error('Error deleting user:', error);
                showToast('Server error during user deletion', 'error');
            }
        }
    );
}