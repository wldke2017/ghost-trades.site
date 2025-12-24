// [CRITICAL FIX]: These must be on Window object to sync with auth.js
// auth.js sets window.currentUserId, window.currentUserRole, window.currentUsername
const getGlobalState = () => ({
    userId: window.currentUserId || null,
    role: window.currentUserRole || null,
    username: window.currentUsername || null
});

let currentUserId = window.currentUserId || null;
let currentUserRole = window.currentUserRole || null;
let currentUsername = window.currentUsername || null;
let allOrders = [];
let allHistory = [];

let statusChart = null;
let volumeChart = null;
let socket = null;
let confirmCallback = null;
let historyOffset = 0;
let historyHasMore = true;
let isLoadingHistory = false;

// Initialize Socket.io
document.addEventListener('DOMContentLoaded', () => {
    // Sync with window-level variables from auth.js
    console.log('[Initialization] Syncing global state from window object');
    currentUserId = window.currentUserId || null;
    currentUserRole = window.currentUserRole || null;
    currentUsername = window.currentUsername || null;
    console.log('[Initialization] State synced:', { currentUserId, currentUserRole, currentUsername });

    checkAuthentication();
    initializeSocket();
    initializeDarkMode();
});

function initializeSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to WebSocket');
        showToast('Connected to real-time updates', 'info');
    });

    socket.on('orderCreated', (order) => {
        console.log('New order created:', order);
        showToast(`New order #${order.id} created!`, 'info');
        updateDashboard();
    });

    socket.on('orderClaimed', (order) => {
        console.log('Order claimed:', order);
        showToast(`Order #${order.id} has been claimed!`, 'info');
        updateDashboard();
    });

    socket.on('orderCompleted', (order) => {
        console.log('Order completed:', order);
        showToast(`Order #${order.id} completed!`, 'success');
        updateDashboard();
    });

    socket.on('orderReadyForRelease', (order) => {
        console.log('Order ready for release:', order);
        if (currentUserRole === 'admin') {
            showToast(`Order #${order.id} is ready for release!`, 'info');
        } else if (order.middleman_id === currentUserId) {
            showToast(`Your work on order #${order.id} is submitted! Waiting for admin approval.`, 'success');
        }
        updateDashboard();
    });

    socket.on('orderCancelled', (order) => {
        console.log('Order cancelled:', order);
        showToast(`Order #${order.id} has been cancelled`, 'info');
        updateDashboard();
    });

    socket.on('newTransactionRequest', (data) => {
        console.log('New transaction request:', data);
        if (currentUserRole === 'admin') {
            showToast(`New ${data.type} request from ${data.username} for ${parseFloat(data.amount).toFixed(2)}`, 'info');
            // Admin functions are handled in admin-app.js
        }
    });

    socket.on('transactionRequestReviewed', (data) => {
        console.log('Transaction request reviewed:', data);
        if (data.user_id === currentUserId) {
            showToast(`Your ${data.type} request has been ${data.status}!`, data.status === 'approved' ? 'success' : 'error');
            updateDashboard();
        }
    });

    socket.on('walletUpdated', (data) => {
        console.log('Wallet updated:', data);
        if (data.user_id === currentUserId) {
            // Update balance displays without full dashboard reload
            const availBalance = parseFloat(data.available_balance || 0);
            const lockBalance = parseFloat(data.locked_balance || 0);

            document.getElementById('avail-bal').textContent = formatCurrency(availBalance);
            document.getElementById('lock-bal').textContent = formatCurrency(lockBalance);

            // Sync withdrawal modal balance if open
            const withdrawalBal = document.getElementById('withdrawal-available-balance');
            if (withdrawalBal) {
                withdrawalBal.textContent = formatCurrency(availBalance);
            }

            showToast('Balance updated!', 'info');

            // Also refresh transaction history to show new transactions
            if (currentUserRole === 'middleman') {
                loadActiveOrders();
                loadEarningsDashboard();
            }
        }
        // Admin dashboard updates are handled in admin-app.js
    });

    socket.on('paymentFailed', (data) => {
        console.log('Payment failed:', data);
        if (data.user_id === currentUserId) {
            showToast(data.message || 'Payment failed', 'error');
        }
    });

    socket.on('mpesaStatus', (data) => {
        console.log('[Socket] M-Pesa Status:', data);
        if (data.userId === currentUserId && typeof handleMpesaStatus === 'function') {
            handleMpesaStatus(data);
        }
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

    // Update charts with new theme
    if (statusChart && volumeChart) {
        updateCharts();
    }
}

// Toast notification function
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';

    toast.className = `${bgColor} text-white px-6 py-4 rounded-lg shadow-lg transform transition-all duration-300 flex items-center space-x-3 max-w-md`;
    toast.innerHTML = `
        <i class="ti ti-${type === 'success' ? 'check' : type === 'error' ? 'x' : 'info-circle'} text-2xl"></i>
        <span class="font-medium">${message}</span>
    `;

    const container = document.getElementById('toast-container');
    container.appendChild(toast);

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

// Order Details Modal
function showOrderDetails(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    const modal = document.getElementById('order-modal');
    const content = document.getElementById('order-modal-content');

    const statusColors = {
        'PENDING': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        'CLAIMED': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        'COMPLETED': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        'READY_FOR_RELEASE': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
        'DISPUTED': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        'CANCELLED': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
    };

    content.innerHTML = `
        <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900 dark:to-indigo-900 rounded-lg p-4">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-gray-600 dark:text-gray-400">Order ID</p>
                        <p class="text-2xl font-bold text-gray-900 dark:text-white">#${order.id}</p>
                    </div>
                    <span class="px-4 py-2 rounded-full text-sm font-semibold ${statusColors[order.status]}">${order.status}</span>
                </div>
            </div>
            
            <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-1">Order Amount</p>
                <p class="text-3xl font-bold text-blue-600 dark:text-blue-400">$${parseFloat(order.amount).toFixed(2)}</p>
            </div>
            
            <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-1">Commission (5%)</p>
                <p class="text-3xl font-bold text-green-600 dark:text-green-400">$${(order.amount * 0.05).toFixed(2)}</p>
            </div>
            
            <div class="col-span-2 bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">Description</p>
                <p class="text-gray-900 dark:text-white">${order.description || 'No description provided'}</p>
            </div>
            
            <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-1">Created Date</p>
                <p class="text-gray-900 dark:text-white">${new Date(order.createdAt).toLocaleString()}</p>
            </div>
            
            <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-1">Last Updated</p>
                <p class="text-gray-900 dark:text-white">${new Date(order.updatedAt).toLocaleString()}</p>
            </div>
        </div>
        
        ${order.status === 'PENDING' && currentUserRole === 'middleman' ? `
            <button onclick="claimOrderWithConfirm(${order.id}); closeOrderModal();" 
                    class="w-full mt-6 bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition">
                Claim This Order
            </button>
        ` : ''}
        
        ${currentUserRole === 'admin' && order.status !== 'COMPLETED' && order.status !== 'CANCELLED' ? `
            <div class="grid grid-cols-2 gap-3 mt-6">
                ${order.status === 'CLAIMED' ? `
                    <button onclick="adminReleaseOrder(${order.id}); closeOrderModal();"
                            class="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-3 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition">
                        <i class="ti ti-check"></i> Complete Order
                    </button>
                ` : ''}
                <button onclick="adminCancelOrder(${order.id}); closeOrderModal();"
                        class="bg-gradient-to-r from-red-500 to-red-600 text-white px-4 py-3 rounded-lg font-semibold hover:from-red-600 hover:to-red-700 transition">
                    <i class="ti ti-x"></i> Cancel Order
                </button>
            </div>
        ` : ''}
    `;

    modal.classList.remove('hidden');
}

function closeOrderModal() {
    document.getElementById('order-modal').classList.add('hidden');
}

async function updateDashboard() {
    console.log('[Dashboard] updateDashboard() called');

    // CRITICAL: Always sync local variables from window.* variables
    // auth.js sets window.currentUserId etc. after login, so we must read from there
    currentUserId = window.currentUserId || null;
    currentUserRole = window.currentUserRole || null;
    currentUsername = window.currentUsername || null;

    console.log('[Dashboard] Current user:', { userId: currentUserId, role: currentUserRole, username: currentUsername });

    // Update user display in header (even if not logged in)
    updateUserDisplay();

    if (!currentUserId) {
        console.log('[Dashboard] No user logged in, skipping dashboard update');
        return;
    }

    // Show/hide sections based on role
    toggleSectionsByRole();

    // Load personal data for all users
    await loadWallet();
    await loadOrders();
    await fetchHistory();
    updateAnalytics();

    // Load role-specific data only for the appropriate roles
    if (currentUserRole === 'middleman') {
        await loadEarningsDashboard();
        await loadActiveOrders();
    }
    // Admin data is loaded separately in admin-app.js, not here
    updateUserDisplay();
    updateCurrencyLabels();
}

function updateUserDisplay() {
    const userDisplay = document.getElementById('current-user-display');
    const roleBadge = document.getElementById('user-role-badge');

    if (userDisplay) {
        if (currentUsername && currentUserRole) {
            // Display just the username prominently
            userDisplay.textContent = currentUsername;

            // Show role badge with appropriate styling
            if (roleBadge) {
                roleBadge.classList.remove('hidden');

                if (currentUserRole === 'admin') {
                    roleBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md';
                    roleBadge.innerHTML = '<i class="ti ti-crown"></i> ADMIN';
                } else {
                    roleBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md';
                    roleBadge.innerHTML = '<i class="ti ti-briefcase"></i> MIDDLEMAN';
                }
            }
        } else {
            userDisplay.textContent = 'Please Login';
            if (roleBadge) {
                roleBadge.classList.add('hidden');
            }
        }
    }
}

// Mobile Menu Toggle
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    menu.classList.toggle('hidden');
}

function toggleSectionsByRole() {
    const createOrderSection = document.getElementById('create-order-section');
    const disputedOrdersSection = document.getElementById('disputed-orders');
    const adminOverviewSection = document.getElementById('admin-overview');
    const transactionRequestsSection = document.getElementById('transaction-requests-section');
    const auditTrailSection = document.getElementById('audit-trail-section');
    const systemHealthSection = document.getElementById('system-health-section');
    const earningsDashboard = document.getElementById('earnings-dashboard');
    const activeOrdersSection = document.getElementById('active-orders-section');
    const adminSwitchBtn = document.getElementById('admin-switch-btn');

    // Mobile Elements
    const mobileAdminBtn = document.getElementById('mobile-admin-btn');
    const mobileUserDisplay = document.getElementById('mobile-user-display');
    const mobileRoleBadge = document.getElementById('mobile-role-badge');
    const currentUserDisplay = document.getElementById('current-user-display');
    const userRoleBadge = document.getElementById('user-role-badge');

    // Sync mobile display
    if (mobileUserDisplay && currentUserDisplay) {
        mobileUserDisplay.textContent = currentUserDisplay.textContent;
    }

    if (currentUserRole === 'admin') {
        if (adminSwitchBtn) adminSwitchBtn.classList.remove('hidden');
        if (mobileAdminBtn) mobileAdminBtn.classList.remove('hidden');

        if (createOrderSection) createOrderSection.classList.remove('hidden');
        if (disputedOrdersSection) disputedOrdersSection.classList.remove('hidden');
        if (adminOverviewSection) adminOverviewSection.classList.remove('hidden');
        if (transactionRequestsSection) transactionRequestsSection.classList.remove('hidden');
        if (auditTrailSection) auditTrailSection.classList.remove('hidden');
        if (systemHealthSection) systemHealthSection.classList.remove('hidden');

        if (earningsDashboard) earningsDashboard.classList.add('hidden');
        if (activeOrdersSection) activeOrdersSection.classList.add('hidden');

        // Admin Badge
        if (mobileRoleBadge) {
            mobileRoleBadge.classList.remove('hidden');
            mobileRoleBadge.className = 'inline-block px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-[10px] font-bold mt-1';
            mobileRoleBadge.innerHTML = '<i class="ti ti-shield-check"></i> ADMIN';
        }
    } else {
        if (adminSwitchBtn) adminSwitchBtn.classList.add('hidden');
        if (mobileAdminBtn) mobileAdminBtn.classList.add('hidden');

        if (createOrderSection) createOrderSection.remove();
        if (disputedOrdersSection) disputedOrdersSection.classList.add('hidden');
        if (adminOverviewSection) adminOverviewSection.classList.add('hidden');
        if (transactionRequestsSection) transactionRequestsSection.classList.add('hidden');
        if (auditTrailSection) auditTrailSection.classList.add('hidden');
        if (systemHealthSection) systemHealthSection.classList.add('hidden');

        if (earningsDashboard) earningsDashboard.classList.remove('hidden');
        if (activeOrdersSection) activeOrdersSection.classList.remove('hidden');

        // User Badge
        if (mobileRoleBadge) {
            mobileRoleBadge.classList.remove('hidden');
            mobileRoleBadge.className = 'inline-block px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-bold mt-1';
            mobileRoleBadge.innerHTML = '<i class="ti ti-user"></i> USER';
        }

        loadEarningsDashboard();
        loadActiveOrders();
    }
}

async function loadWallet() {
    console.log('[Wallet] loadWallet() called for user:', currentUserId);
    if (!currentUserId) {
        console.log('[Wallet] No currentUserId, skipping load');
        return;
    }
    try {
        // Always fetch fresh wallet data from the server - no caching
        // Add cache-busting parameter to ensure fresh data
        const url = `/wallets/me?t=${Date.now()}`;
        console.log('[Wallet] Fetching from:', url);
        const response = await authenticatedFetch(url);

        console.log('[Wallet] Response status:', response.status);

        if (!response.ok) {
            if (response.status === 404) {
                console.log('[Wallet] Wallet not found (404), setting to 0.00');
                document.getElementById('avail-bal').textContent = formatCurrency(0);
                document.getElementById('lock-bal').textContent = formatCurrency(0);
                return;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const wallet = await response.json();
        console.log('[Wallet] Received wallet data:', wallet);

        // Ensure we're displaying the exact values from the database
        // Handle both string and number types from the API
        const availBalance = parseFloat(wallet.available_balance || 0);
        const lockBalance = parseFloat(wallet.locked_balance || 0);

        console.log('[Wallet] Parsed balances:', { availBalance, lockBalance });

        const availEl = document.getElementById('avail-bal');
        const lockEl = document.getElementById('lock-bal');

        if (availEl) {
            availEl.textContent = formatCurrency(availBalance);
            console.log('[Wallet] Updated avail-bal element to:', formatCurrency(availBalance));
        } else {
            console.error('[Wallet] ERROR: avail-bal element not found!');
        }

        if (lockEl) {
            lockEl.textContent = formatCurrency(lockBalance);
            console.log('[Wallet] Updated lock-bal element to:', formatCurrency(lockBalance));
        } else {
            console.error('[Wallet] ERROR: lock-bal element not found!');
        }

        console.log('[Wallet] ✅ Wallet successfully loaded and displayed');
    } catch (error) {
        console.error('[Wallet] ❌ Error loading wallet:', error);
        document.getElementById('avail-bal').textContent = 'Error';
        document.getElementById('lock-bal').textContent = 'Error';
        showToast('Failed to load wallet balance', 'error');
    }
}

// Manual refresh balance function
async function refreshBalance() {
    showToast('Refreshing balance...', 'info');
    await loadWallet();
    showToast('Balance refreshed!', 'success');
}

async function loadOrders() {
    try {
        const response = await authenticatedFetch('/orders');
        allOrders = await response.json();
        filterOrders();
    } catch (error) {
        console.error('Error loading orders:', error);
        showToast('Failed to load orders', 'error');
    }
}

function filterOrders() {
    const searchTerm = document.getElementById('order-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('order-status-filter')?.value || 'all';
    const amountFilter = document.getElementById('order-amount-filter')?.value || 'all';

    let filtered = allOrders.filter(order => {
        const matchesSearch = order.id.toString().includes(searchTerm) ||
            (order.description && order.description.toLowerCase().includes(searchTerm));

        const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

        let matchesAmount = true;
        if (amountFilter !== 'all') {
            const amount = parseFloat(order.amount);
            if (amountFilter === '0-100') matchesAmount = amount >= 0 && amount <= 100;
            else if (amountFilter === '100-500') matchesAmount = amount > 100 && amount <= 500;
            else if (amountFilter === '500-1000') matchesAmount = amount > 500 && amount <= 1000;
            else if (amountFilter === '1000+') matchesAmount = amount > 1000;
        }

        return matchesSearch && matchesStatus && matchesAmount;
    });

    displayOrders(filtered);
}

function displayOrders(orders) {
    const ordersList = document.getElementById('orders-list');
    const emptyOrders = document.getElementById('empty-orders');
    const orderCount = document.getElementById('order-count');

    const pendingOrders = orders.filter(o => o.status === 'PENDING');

    ordersList.innerHTML = '';

    if (pendingOrders.length === 0) {
        emptyOrders.classList.remove('hidden');
        orderCount.textContent = '0 Orders';
    } else {
        emptyOrders.classList.add('hidden');
        orderCount.textContent = `${pendingOrders.length} Order${pendingOrders.length > 1 ? 's' : ''}`;

        pendingOrders.forEach(order => {
            const orderCard = document.createElement('div');
            orderCard.className = 'border border-gray-200 dark:border-gray-700 rounded-xl p-5 hover:shadow-md transition-all hover:border-blue-300 dark:hover:border-blue-600 bg-gradient-to-r from-white to-blue-50 dark:from-gray-800 dark:to-blue-900';

            const adminActions = currentUserRole === 'admin' ? `
                <div class="flex space-x-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <button onclick="event.stopPropagation(); adminCancelOrder(${order.id});"
                            class="flex-1 bg-red-500 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-red-600 transition">
                        <i class="ti ti-x"></i> Cancel Order
                    </button>
                    <button onclick="event.stopPropagation(); showOrderDetails(${order.id});"
                            class="flex-1 bg-blue-500 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600 transition">
                        <i class="ti ti-eye"></i> View Details
                    </button>
                </div>
            ` : '';

            orderCard.innerHTML = `
                <div class="flex items-center justify-between" onclick="showOrderDetails(${order.id});" style="cursor: pointer;">
                    <div class="flex items-center space-x-4">
                        <div class="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                            <i class="ti ti-clock text-2xl text-blue-600 dark:text-blue-400"></i>
                        </div>
                        <div>
                            <div class="flex items-center space-x-2">
                                <h3 class="font-bold text-gray-900 dark:text-white">Order #${order.id}</h3>
                                <span class="bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 text-xs font-semibold px-2 py-1 rounded">PENDING</span>
                            </div>
                            <p class="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">${formatCurrency(order.amount)}</p>
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${order.description || 'No description'}</p>
                            <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">Created ${new Date(order.createdAt).toLocaleDateString()}</p>
                        </div>
                    </div>
                    ${currentUserRole === 'middleman' ? `
                        <button onclick="event.stopPropagation(); claimOrderWithConfirm(${order.id});" 
                                class="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition transform hover:scale-105 shadow-md flex items-center space-x-2">
                            <span>Claim Order</span>
                            <i class="ti ti-arrow-right"></i>
                        </button>
                    ` : ''}
                </div>
                ${adminActions}
            `;
            ordersList.appendChild(orderCard);
        });
    }
}

async function fetchHistory(loadMore = false) {
    if (isLoadingHistory) return;
    isLoadingHistory = true;

    try {
        const limit = 6;
        const offset = loadMore ? historyOffset : 0;
        const url = `/transactions?limit=${limit}&offset=${offset}`;

        const response = await authenticatedFetch(url);
        if (!response.ok) {
            throw new Error('Failed to fetch transactions');
        }
        const data = await response.json();

        if (loadMore) {
            allHistory = [...allHistory, ...(data.transactions || [])];
            historyOffset += limit;
        } else {
            allHistory = data.transactions || [];
            historyOffset = limit;
        }

        historyHasMore = data.hasMore;
        filterHistory();
    } catch (error) {
        console.error('Error loading transaction history:', error);
        // Fallback to old order-based history if transactions endpoint fails
        try {
            const response = await authenticatedFetch('/orders');
            const orders = await response.json();
            allHistory = orders.filter(order => order.status === 'COMPLETED')
                .map(order => ({
                    type: 'ORDER_COMPLETED',
                    amount: order.amount * 0.05,
                    description: `Order #${order.id} commission`,
                    created_at: order.updatedAt,
                    Order: order
                }));
            filterHistory();
        } catch (e) {
            console.error('Fallback also failed:', e);
        }
    } finally {
        isLoadingHistory = false;
    }
}

function filterHistory() {
    const searchTerm = document.getElementById('history-search')?.value.toLowerCase() || '';

    // If there's a search term, show all loaded transactions that match
    // If no search term, show only the paginated results
    let filtered;
    if (searchTerm) {
        filtered = allHistory.filter(tx => {
            return (tx.description && tx.description.toLowerCase().includes(searchTerm)) ||
                (tx.type && tx.type.toLowerCase().includes(searchTerm)) ||
                (tx.Order && tx.Order.id && tx.Order.id.toString().includes(searchTerm));
        });
    } else {
        // No search - show all loaded transactions (paginated)
        filtered = allHistory;
    }

    displayHistory(filtered);
}

async function loadMoreHistory() {
    await fetchHistory(true);
}

function displayHistory(transactions) {
    const historyBody = document.getElementById('history-body');
    const emptyHistory = document.getElementById('empty-history');
    const loadMoreContainer = document.getElementById('load-more-container');

    if (!historyBody) return;
    historyBody.innerHTML = '';

    if (!transactions || transactions.length === 0) {
        if (emptyHistory) emptyHistory.classList.remove('hidden');
        if (loadMoreContainer) loadMoreContainer.classList.add('hidden');
    } else {
        if (emptyHistory) emptyHistory.classList.add('hidden');

        // Transaction type colors
        const typeColors = {
            'DEPOSIT': { bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-600 dark:text-green-400', icon: 'ti-plus' },
            'WITHDRAWAL': { bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-600 dark:text-red-400', icon: 'ti-minus' },
            'ORDER_CREATED': { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-600 dark:text-blue-400', icon: 'ti-lock' },
            'ORDER_CLAIMED': { bg: 'bg-purple-100 dark:bg-purple-900', text: 'text-purple-600 dark:text-purple-400', icon: 'ti-lock' },
            'ORDER_COMPLETED': { bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-600 dark:text-green-400', icon: 'ti-check' },
            'ORDER_CANCELLED': { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-400', icon: 'ti-x' },
            'COMMISSION_EARNED': { bg: 'bg-emerald-100 dark:bg-emerald-900', text: 'text-emerald-600 dark:text-emerald-400', icon: 'ti-coin' },
            'COMMISSION_PAID': { bg: 'bg-orange-100 dark:bg-orange-900', text: 'text-orange-600 dark:text-orange-400', icon: 'ti-coin' },
            'DISPUTE_REFUND': { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-600 dark:text-blue-400', icon: 'ti-arrow-back' },
            'DISPUTE_FORFEIT': { bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-600 dark:text-red-400', icon: 'ti-alert-triangle' }
        };

        transactions.forEach(tx => {
            const colors = typeColors[tx.type] || { bg: 'bg-gray-100', text: 'text-gray-600', icon: 'ti-transfer' };
            const date = new Date(tx.created_at).toLocaleString();
            const amount = parseFloat(tx.amount || 0);
            const isPositive = amount >= 0;
            const amountClass = isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
            const amountPrefix = isPositive ? '+' : '';
            const orderId = tx.Order ? `#${tx.Order.id}` : (tx.order_id ? `#${tx.order_id}` : '-');

            const row = document.createElement('tr');
            row.className = 'border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition';
            row.innerHTML = `
                <td class="py-4 px-4">
                    <div class="flex items-center space-x-2">
                        <div class="w-8 h-8 ${colors.bg} rounded-full flex items-center justify-center">
                            <i class="ti ${colors.icon} ${colors.text}"></i>
                        </div>
                        <span class="font-medium text-gray-900 dark:text-white text-sm">${tx.type.replace(/_/g, ' ')}</span>
                    </div>
                </td>
                <td class="py-4 px-4">
                    <span class="font-bold ${amountClass}">${amountPrefix}${formatCurrency(Math.abs(amount))}</span>
                </td>
                <td class="py-4 px-4">
                    <span class="text-gray-600 dark:text-gray-400 text-sm">${orderId}</span>
                </td>
                <td class="py-4 px-4">
                    <span class="text-gray-700 dark:text-gray-300 text-sm">${tx.description || '-'}</span>
                </td>
                <td class="py-4 px-4 text-gray-500 dark:text-gray-400 text-sm">${date}</td>
            `;
            historyBody.appendChild(row);
        });

        // Show/hide load more button
        if (loadMoreContainer) {
            if (historyHasMore) {
                loadMoreContainer.classList.remove('hidden');
                loadMoreContainer.innerHTML = `
                    <div class="text-center py-4">
                        <button onclick="loadMoreHistory()"
                                class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold transition flex items-center space-x-2 mx-auto">
                            <i class="ti ti-chevron-down"></i>
                            <span>Load More Transactions</span>
                        </button>
                    </div>
                `;
            } else {
                loadMoreContainer.classList.add('hidden');
            }
        }
    }
}

function updateAnalytics() {
    const totalOrders = allOrders.length;
    const completedOrders = allOrders.filter(o => o.status === 'COMPLETED').length;
    const pendingOrders = allOrders.filter(o => o.status === 'PENDING').length;
    const disputedOrders = allOrders.filter(o => o.status === 'DISPUTED').length;
    const totalCommission = allOrders
        .filter(o => o.status === 'COMPLETED')
        .reduce((sum, o) => sum + (parseFloat(o.amount) * 0.05), 0);

    document.getElementById('stat-total-orders').textContent = totalOrders;
    document.getElementById('stat-completed').textContent = completedOrders;
    document.getElementById('stat-pending').textContent = pendingOrders;
    document.getElementById('stat-commission').textContent = formatCurrency(totalCommission);

    updateCharts();
}

function updateCharts() {
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#9ca3af' : '#4b5563';
    const gridColor = isDark ? '#374151' : '#e5e7eb';

    // Status Distribution Chart
    const statusData = {
        'PENDING': allOrders.filter(o => o.status === 'PENDING').length,
        'CLAIMED': allOrders.filter(o => o.status === 'CLAIMED').length,
        'COMPLETED': allOrders.filter(o => o.status === 'COMPLETED').length,
        'DISPUTED': allOrders.filter(o => o.status === 'DISPUTED').length,
        'CANCELLED': allOrders.filter(o => o.status === 'CANCELLED').length
    };

    if (statusChart) statusChart.destroy();

    const statusCtx = document.getElementById('statusChart').getContext('2d');
    statusChart = new Chart(statusCtx, {
        type: 'doughnut',
        data: {
            labels: ['Pending', 'Claimed', 'Completed', 'Disputed', 'Cancelled'],
            datasets: [{
                data: [statusData.PENDING, statusData.CLAIMED, statusData.COMPLETED, statusData.DISPUTED, statusData.CANCELLED],
                backgroundColor: ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#6b7280'],
                borderWidth: 2,
                borderColor: isDark ? '#1f2937' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor, padding: 15, font: { size: 12 } }
                }
            }
        }
    });

    // Volume Chart
    const last7Days = [];
    const volumeData = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        last7Days.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

        const dayOrders = allOrders.filter(o => {
            const orderDate = new Date(o.createdAt);
            return orderDate.toDateString() === date.toDateString();
        });
        volumeData.push(dayOrders.reduce((sum, o) => sum + parseFloat(o.amount), 0));
    }

    if (volumeChart) volumeChart.destroy();

    const volumeCtx = document.getElementById('volumeChart').getContext('2d');
    volumeChart = new Chart(volumeCtx, {
        type: 'line',
        data: {
            labels: last7Days,
            datasets: [{
                label: 'Transaction Volume ($)',
                data: volumeData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: textColor, padding: 15, font: { size: 12 } }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: textColor },
                    grid: { color: gridColor }
                },
                x: {
                    ticks: { color: textColor },
                    grid: { color: gridColor }
                }
            }
        }
    });
}

function claimOrderWithConfirm(orderId) {
    showConfirmDialog(
        'Claim Order',
        `Are you sure you want to claim order #${orderId}? This will lock your collateral.`,
        () => claimOrder(orderId)
    );
}

async function claimOrder(orderId) {
    try {
        const response = await authenticatedFetch(`/orders/${orderId}/claim`, {
            method: 'POST',
        });

        const result = await response.json();

        if (response.ok) {
            showToast(result.message || 'Order claimed successfully!', 'success');
            updateDashboard();
        } else {
            showToast(result.error || 'Failed to claim order', 'error');
        }
    } catch (error) {
        console.error('Error claiming order:', error);
        showToast('Error claiming order: ' + error.message, 'error');
    }
}

// Load earnings dashboard for middleman
async function loadEarningsDashboard() {
    try {
        const response = await authenticatedFetch('/middleman/earnings');
        const earnings = await response.json();
        console.log('[Earnings] Loaded data payload:', earnings);

        if (document.getElementById('earnings-total')) {
            document.getElementById('earnings-total').textContent = formatCurrency(earnings.totalEarnings);
        }
        if (document.getElementById('earnings-month')) {
            document.getElementById('earnings-month').textContent = formatCurrency(earnings.monthlyEarnings);
        }
        if (document.getElementById('earnings-success-rate')) {
            document.getElementById('earnings-success-rate').textContent = earnings.successRate;
        }
        if (document.getElementById('earnings-avg-order')) {
            document.getElementById('earnings-avg-order').textContent = formatCurrency(earnings.avgOrderValue);
        }

        // Update new stats with explicit logging
        const depositEl = document.getElementById('total-deposited');
        const withdrawEl = document.getElementById('total-withdrawn');

        console.log('[Earnings] Updating elements:', {
            depositEl: !!depositEl,
            withdrawEl: !!withdrawEl,
            valDeposited: earnings.totalDeposited,
            valWithdrawn: earnings.totalWithdrawn
        });

        if (depositEl) depositEl.textContent = formatCurrency(earnings.totalDeposited);
        if (withdrawEl) withdrawEl.textContent = formatCurrency(earnings.totalWithdrawn);

        // Pending stats
        const pendingDepEl = document.getElementById('pending-deposited');
        const pendingWithEl = document.getElementById('pending-withdrawn');
        if (pendingDepEl) pendingDepEl.textContent = formatCurrency(earnings.pendingDeposited || 0);
        if (pendingWithEl) pendingWithEl.textContent = formatCurrency(earnings.pendingWithdrawn || 0);
    } catch (error) {
        console.error('Error loading earnings:', error);
    }
}

// Load active orders for middleman
async function loadActiveOrders() {
    try {
        const response = await authenticatedFetch('/middleman/active-orders');
        const activeOrders = await response.json();

        const activeOrdersList = document.getElementById('active-orders-list');
        const emptyActiveOrders = document.getElementById('empty-active-orders');
        const activeOrderCount = document.getElementById('active-order-count');

        activeOrdersList.innerHTML = '';

        if (activeOrders.length === 0) {
            emptyActiveOrders.classList.remove('hidden');
            activeOrderCount.textContent = '0 Active';
        } else {
            emptyActiveOrders.classList.add('hidden');
            activeOrderCount.textContent = `${activeOrders.length} Active`;

            activeOrders.forEach(order => {
                const orderCard = document.createElement('div');
                const isReadyForRelease = order.status === 'READY_FOR_RELEASE';

                orderCard.className = `border-2 ${isReadyForRelease ? 'border-green-300 dark:border-green-700 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900 dark:to-emerald-900' : 'border-blue-200 dark:border-blue-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900 dark:to-indigo-900'} rounded-xl p-5`;

                const timeSinceClaimed = Math.floor((new Date() - new Date(order.updatedAt)) / (1000 * 60 * 60));

                orderCard.innerHTML = `
                    <div class="flex items-center justify-between">
                        <div class="flex items-center space-x-4 flex-1">
                            <div class="w-14 h-14 ${isReadyForRelease ? 'bg-green-100 dark:bg-green-800' : 'bg-blue-100 dark:bg-blue-800'} rounded-xl flex items-center justify-center">
                                <i class="ti ${isReadyForRelease ? 'ti-check-circle text-green-600 dark:text-green-300' : 'ti-clock text-blue-600 dark:text-blue-300'} text-3xl"></i>
                            </div>
                            <div class="flex-1">
                                <div class="flex items-center space-x-2 mb-1">
                                    <h3 class="font-bold text-lg text-gray-900 dark:text-white">Order #${order.id}</h3>
                                    <span class="px-2 py-1 rounded text-xs font-semibold ${isReadyForRelease ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200'}">
                                        ${isReadyForRelease ? 'AWAITING RELEASE' : 'IN PROGRESS'}
                                    </span>
                                </div>
                                <p class="text-2xl font-bold ${isReadyForRelease ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'} mb-2">
                                    ${formatCurrency(order.amount)}
                                </p>
                                <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">${order.description || 'No description'}</p>
                                <div class="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                                    <div class="flex items-center space-x-1">
                                        <i class="ti ti-clock"></i>
                                        <span>${timeSinceClaimed}h ago</span>
                                    </div>
                                    <div class="flex items-center space-x-1">
                                        <i class="ti ti-wallet"></i>
                                        <span>Commission: ${formatCurrency(order.amount * 0.05)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-col space-y-2 ml-4">
                            ${!isReadyForRelease ? `
                                <button onclick="completeOrderAsMiddleman(${order.id})" 
                                        class="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition shadow-md flex items-center space-x-2">
                                    <i class="ti ti-check"></i>
                                    <span>Mark Complete</span>
                                </button>
                            ` : `
                                <div class="bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200 px-6 py-3 rounded-lg font-semibold text-center">
                                    <i class="ti ti-hourglass"></i> Waiting for Admin
                                </div>
                            `}
                            <button onclick="showOrderDetails(${order.id})" 
                                    class="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-6 py-2 rounded-lg font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 transition">
                                <i class="ti ti-eye"></i> View Details
                            </button>
                        </div>
                    </div>
                `;

                activeOrdersList.appendChild(orderCard);
            });
        }
    } catch (error) {
        console.error('Error loading active orders:', error);
    }
}

// Complete order as middleman
async function completeOrderAsMiddleman(orderId) {
    showConfirmDialog(
        'Complete Order',
        `Are you sure you've completed the work for order #${orderId}? This will notify the admin for fund release.`,
        async () => {
            try {
                const response = await authenticatedFetch(`/orders/${orderId}/complete`, {
                    method: 'POST'
                });

                const result = await response.json();

                if (response.ok) {
                    showToast(result.message || 'Order marked as complete!', 'success');
                    updateDashboard();
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













function exportToCSV() {
    const completedOrders = allHistory.filter(o => o.status === 'COMPLETED');

    if (completedOrders.length === 0) {
        showToast('No completed transactions to export', 'error');
        return;
    }

    let csv = 'Order ID,Amount,Commission,Status,Date\n';

    completedOrders.forEach(order => {
        const commission = (order.amount * 0.05).toFixed(2);
        const date = new Date(order.updatedAt).toLocaleDateString();
        csv += `${order.id},${order.amount},${commission},${order.status},${date}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `escrow-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    showToast('Transaction history exported successfully!', 'success');
}

// ============ TRANSACTION REQUEST SYSTEM ============

// User functions - Request deposit/withdrawal
function showDepositRequestModal() {
    document.getElementById('deposit-request-modal').classList.remove('hidden');
    // Initialize tab switching
    initializeDepositTabs();
}

function closeDepositRequestModal() {
    document.getElementById('deposit-request-modal').classList.add('hidden');
    document.getElementById('deposit-request-form').reset();
    document.getElementById('mpesa-deposit-form').reset();
    // Reset to manual deposit tab
    switchToManualDeposit();
}

function initializeDepositTabs() {
    const manualTab = document.getElementById('manual-deposit-tab');
    const mpesaTab = document.getElementById('mpesa-deposit-tab');

    manualTab.addEventListener('click', switchToManualDeposit);
    mpesaTab.addEventListener('click', switchToMpesaDeposit);

    // Start with manual deposit
    switchToManualDeposit();
}

function switchToManualDeposit() {
    document.getElementById('manual-deposit-tab').classList.add('active-tab');
    document.getElementById('mpesa-deposit-tab').classList.remove('active-tab');
    document.getElementById('deposit-request-form').classList.remove('hidden');
    document.getElementById('mpesa-deposit-form').classList.add('hidden');
}

function switchToMpesaDeposit() {
    document.getElementById('mpesa-deposit-tab').classList.add('active-tab');
    document.getElementById('manual-deposit-tab').classList.remove('active-tab');
    document.getElementById('mpesa-deposit-form').classList.remove('hidden');
    document.getElementById('deposit-request-form').classList.add('hidden');
}

function showWithdrawalRequestModal() {
    const availBal = document.getElementById('avail-bal').textContent;
    document.getElementById('withdrawal-available-balance').textContent = availBal;

    // Pre-fill phone number if available in userData
    const userData = JSON.parse(localStorage.getItem('userData'));
    if (userData && userData.mpesa_number) {
        document.getElementById('withdrawal-phone').value = userData.mpesa_number;
    } else if (userData && userData.phone_number) {
        document.getElementById('withdrawal-phone').value = userData.phone_number;
    }

    document.getElementById('withdrawal-request-modal').classList.remove('hidden');
}

function closeWithdrawalRequestModal() {
    document.getElementById('withdrawal-request-modal').classList.add('hidden');
    document.getElementById('withdrawal-request-form').reset();
}

async function submitDepositRequest(event) {
    event.preventDefault();

    const amount = document.getElementById('deposit-amount').value;
    const screenshot = document.getElementById('deposit-screenshot').files[0];
    const notes = document.getElementById('deposit-notes').value;

    if (!screenshot) {
        showToast('Please upload a payment screenshot', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('amount', amount);
    formData.append('screenshot', screenshot);
    formData.append('notes', notes);

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch('/escrow/transaction-requests/deposit', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Request failed');
        }

        const result = await response.json();
        showToast('Deposit request submitted! Waiting for admin approval.', 'success');
        closeDepositRequestModal();
    } catch (error) {
        console.error('Deposit request error:', error);
        showToast('Failed to submit request: ' + error.message, 'error');
    }
}

async function submitMpesaDeposit(event) {
    event.preventDefault();

    const amount = document.getElementById('mpesa-amount').value;
    const phoneNumber = document.getElementById('mpesa-phone').value;

    if (!amount || parseFloat(amount) <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }

    if (!phoneNumber || !/^254[0-9]{9}$/.test(phoneNumber)) {
        showToast('Please enter a valid phone number in format 254XXXXXXXXX', 'error');
        return;
    }

    try {
        const response = await authenticatedFetch('/api/stkpush', {
            method: 'POST',
            body: JSON.stringify({
                amount: parseFloat(amount),
                phoneNumber: phoneNumber
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Payment initiation failed');
        }

        const result = await response.json();

        // Show the waiting overlay!
        showMpesaOverlay(amount, phoneNumber);

        showToast(result.message || 'M-Pesa payment initiated successfully!', 'success');
        closeDepositRequestModal();

    } catch (error) {
        console.error('M-Pesa deposit error:', error);
        showToast('Failed to initiate M-Pesa payment: ' + error.message, 'error');
    }
}

// M-Pesa Overlay Helpers
function showMpesaOverlay(amount, phone) {
    const overlay = document.getElementById('mpesa-waiting-overlay');
    const amountEl = document.getElementById('mpesa-waiting-amount');
    const phoneEl = document.getElementById('mpesa-waiting-phone');
    const titleEl = document.getElementById('mpesa-waiting-title');
    const textEl = document.getElementById('mpesa-waiting-text');
    const iconContainer = document.getElementById('mpesa-center-icon');
    const ring = document.getElementById('mpesa-progress-ring');
    const footer = document.getElementById('mpesa-waiting-footer');

    if (!overlay) return;

    // Reset UI
    amountEl.textContent = formatCurrency(amount);
    phoneEl.textContent = phone;
    titleEl.textContent = 'Waiting for Payment';
    textEl.textContent = 'Please check your phone and enter your M-Pesa PIN.';
    iconContainer.innerHTML = '<div class="animate-pulse"><i class="ti ti-phone-calling text-3xl text-blue-500"></i></div>';
    ring.classList.remove('text-green-500', 'text-red-500');
    ring.classList.add('text-blue-500');
    ring.style.strokeDashoffset = '0';
    footer.classList.add('hidden');

    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    document.body.style.overflow = 'hidden'; // Prevent scroll
}

function handleMpesaStatus(data) {
    const titleEl = document.getElementById('mpesa-waiting-title');
    const textEl = document.getElementById('mpesa-waiting-text');
    const iconContainer = document.getElementById('mpesa-center-icon');
    const ring = document.getElementById('mpesa-progress-ring');
    const footer = document.getElementById('mpesa-waiting-footer');

    if (data.status === 'SUCCESS') {
        titleEl.textContent = 'Payment Received!';
        textEl.textContent = `Successfully deposited ${formatCurrency(data.amount)} to your wallet.`;
        iconContainer.innerHTML = '<i class="ti ti-circle-check text-5xl text-green-500 scale-110 transition-transform"></i>';
        ring.classList.replace('text-blue-500', 'text-green-500');

        // Refresh balance automatically
        loadWallet();

        // Auto-close after 3 seconds
        setTimeout(() => {
            closeMpesaOverlay();
        }, 4000);

    } else if (data.status === 'FAILED') {
        titleEl.textContent = 'Payment Failed';
        textEl.textContent = data.message || 'The transaction could not be completed.';
        iconContainer.innerHTML = '<i class="ti ti-circle-x text-5xl text-red-500"></i>';
        ring.classList.replace('text-blue-500', 'text-red-500');
        footer.classList.remove('hidden');
    }
}

function closeMpesaOverlay() {
    const overlay = document.getElementById('mpesa-waiting-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        document.body.style.overflow = ''; // Restore scroll
    }
}

async function submitWithdrawalRequest(event) {
    event.preventDefault();

    const amount = document.getElementById('withdrawal-amount').value;
    const phone = document.getElementById('withdrawal-phone').value;
    const notes = document.getElementById('withdrawal-notes').value;
    const confirmed = document.getElementById('withdrawal-confirm').checked;

    if (!confirmed) {
        showToast('Please confirm your M-Pesa number is correct', 'error');
        return;
    }

    if (!phone || !/^254[0-9]{9}$/.test(phone)) {
        showToast('Please enter a valid M-Pesa phone number (254XXXXXXXXX)', 'error');
        return;
    }

    try {
        const response = await authenticatedFetch('/transaction-requests/withdrawal', {
            method: 'POST',
            body: JSON.stringify({ amount, phone, notes })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Request failed');
        }

        const result = await response.json();
        showToast('Withdrawal request submitted! Waiting for admin approval.', 'success');
        closeWithdrawalRequestModal();
    } catch (error) {
        console.error('Withdrawal request error:', error);
        showToast('Failed to submit request: ' + error.message, 'error');
    }
}

async function showMyTransactionRequests() {
    console.log('[TransactionRequests] Loading my transaction requests...');
    try {
        const response = await authenticatedFetch('/transaction-requests/my-requests');

        console.log('[TransactionRequests] Response status:', response.status);

        if (!response.ok) {
            throw new Error('Failed to load requests');
        }

        const requests = await response.json();
        console.log('[TransactionRequests] Received requests:', requests.length, requests);

        const listContainer = document.getElementById('my-requests-list');
        const emptyState = document.getElementById('empty-my-requests');

        if (requests.length === 0) {
            listContainer.classList.add('hidden');
            emptyState.classList.remove('hidden');
        } else {
            listContainer.classList.remove('hidden');
            emptyState.classList.add('hidden');

            listContainer.innerHTML = requests.map(req => {
                const statusColors = {
                    'pending': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
                    'approved': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
                    'rejected': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                };

                const typeColors = {
                    'deposit': 'bg-green-100 dark:bg-green-900',
                    'withdrawal': 'bg-red-100 dark:bg-red-900',
                    'mpesa_deposit': 'bg-blue-100 dark:bg-blue-900'
                };

                const typeIcons = {
                    'deposit': 'ti-plus',
                    'withdrawal': 'ti-minus',
                    'mpesa_deposit': 'ti-device-mobile'
                };

                return `
                    <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                        <div class="flex items-center justify-between mb-3">
                            <div class="flex items-center space-x-3">
                                <div class="w-10 h-10 ${typeColors[req.type] || 'bg-gray-100 dark:bg-gray-900'} rounded-lg flex items-center justify-center">
                                    <i class="ti ${typeIcons[req.type] || 'ti-transfer'} text-xl ${req.type === 'deposit' || req.type === 'mpesa_deposit' ? 'text-green-600 dark:text-green-400' : req.type === 'withdrawal' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}"></i>
                                </div>
                                <div>
                                    <p class="font-semibold text-gray-900 dark:text-white">${req.type.toUpperCase()}</p>
                                    <p class="text-sm text-gray-500 dark:text-gray-400">${new Date(req.createdAt).toLocaleString()}</p>
                                </div>
                            </div>
                            <div class="text-right">
                                <p class="text-2xl font-bold text-gray-900 dark:text-white">${formatCurrency(req.amount)}</p>
                                <span class="inline-block px-2 py-1 rounded text-xs font-semibold ${statusColors[req.status]}">${req.status.toUpperCase()}</span>
                            </div>
                        </div>
                        ${req.notes ? `<p class="text-sm text-gray-600 dark:text-gray-400 mb-2"><strong>Notes:</strong> ${req.notes}</p>` : ''}
                        ${req.admin_notes ? `<p class="text-sm text-gray-600 dark:text-gray-400"><strong>Admin Response:</strong> ${req.admin_notes}</p>` : ''}
                        ${req.screenshot_path ? `<a href="/uploads/${req.screenshot_path}" target="_blank" class="text-sm text-blue-600 dark:text-blue-400 hover:underline"><i class="ti ti-photo"></i> View Screenshot</a>` : ''}
                    </div>
                `;
            }).join('');
        }

        document.getElementById('my-requests-modal').classList.remove('hidden');
    } catch (error) {
        console.error('Error loading requests:', error);
        showToast('Failed to load requests', 'error');
    }
}

function closeMyRequestsModal() {
    document.getElementById('my-requests-modal').classList.add('hidden');
}

// Create New Order function (for Admin)
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
                    await updateDashboard();
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

// M-Pesa Deposit Functions
function switchDepositTab(tabName) {
    const manualTab = document.getElementById('manual-deposit-tab');
    const mpesaTab = document.getElementById('mpesa-deposit-tab');
    const manualForm = document.getElementById('deposit-request-form');
    const mpesaForm = document.getElementById('mpesa-deposit-form');

    if (tabName === 'manual') {
        // Show manual deposit form
        manualForm.classList.remove('hidden');
        mpesaForm.classList.add('hidden');

        // Update tab styling
        manualTab.classList.add('active-tab');
        mpesaTab.classList.remove('active-tab');
    } else if (tabName === 'mpesa') {
        // Show M-Pesa form
        manualForm.classList.add('hidden');
        mpesaForm.classList.remove('hidden');

        // Update tab styling
        mpesaTab.classList.add('active-tab');
        manualTab.classList.remove('active-tab');
    }
}

async function submitMpesaDeposit(event) {
    event.preventDefault();

    const amount = document.getElementById('mpesa-amount').value;
    const phoneNumber = document.getElementById('mpesa-phone').value;
    const submitButton = event.target.querySelector('button[type="submit"]');

    // Validate inputs
    if (!amount || parseFloat(amount) <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }

    if (!phoneNumber || !/^254[0-9]{9}$/.test(phoneNumber)) {
        showToast('Invalid phone number. Use format: 254XXXXXXXXX', 'error');
        return;
    }

    try {
        // Disable button and show loading state
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="ti ti-loader animate-spin"></i> Processing...';

        const response = await authenticatedFetch('/api/stkpush', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: parseFloat(amount),
                phoneNumber: phoneNumber
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showToast(result.message || 'M-Pesa prompt sent! Check your phone.', 'success');

            // Close modal and reset form
            closeDepositRequestModal();
            document.getElementById('mpesa-deposit-form').reset();

            // Show additional info
            setTimeout(() => {
                showToast('Enter your M-Pesa PIN to complete payment', 'info');
            }, 2000);
        } else {
            showToast(result.error || 'Failed to initiate M-Pesa payment', 'error');
        }
    } catch (error) {
        console.error('M-Pesa deposit error:', error);
        showToast('Error: ' + error.message, 'error');
    } finally {
        // Re-enable button
        submitButton.disabled = false;
        submitButton.innerHTML = 'Pay with M-Pesa';
    }
}

// Logout function is now in auth.js - removed duplicate

// ============ SETTINGS & PROFILE FUNCTIONS ============

function showSettings() {
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        settingsModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Prevent scrolling
        loadProfileSettings(); // Fetch fresh data
    }
}

function closeSettings() {
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        settingsModal.classList.add('hidden');
        document.body.style.overflow = ''; // Restore scrolling
    }
}

function switchSettingsTab(tabName) {
    const profileTab = document.getElementById('settings-tab-profile');
    const securityTab = document.getElementById('settings-tab-security');
    const btnProfile = document.getElementById('tab-btn-profile');
    const btnSecurity = document.getElementById('tab-btn-security');

    if (tabName === 'profile') {
        profileTab.classList.remove('hidden');
        securityTab.classList.add('hidden');

        btnProfile.classList.add('border-blue-500', 'text-blue-600', 'dark:text-blue-400', 'font-semibold');
        btnProfile.classList.remove('border-transparent', 'text-gray-500');

        btnSecurity.classList.remove('border-blue-500', 'text-blue-600', 'dark:text-blue-400', 'font-semibold');
        btnSecurity.classList.add('border-transparent', 'text-gray-500');
    } else {
        profileTab.classList.add('hidden');
        securityTab.classList.remove('hidden');

        btnSecurity.classList.add('border-blue-500', 'text-blue-600', 'dark:text-blue-400', 'font-semibold');
        btnSecurity.classList.remove('border-transparent', 'text-gray-500');

        btnProfile.classList.remove('border-blue-500', 'text-blue-600', 'dark:text-blue-400', 'font-semibold');
        btnProfile.classList.add('border-transparent', 'text-gray-500');
    }
}

async function loadProfileSettings() {
    try {
        const response = await authenticatedFetch('/auth/me');
        const user = await response.json();

        if (response.ok) {
            // Populate Basic Info
            document.getElementById('settings-username').value = user.username;
            document.getElementById('settings-role').value = user.role.toUpperCase();

            // Populate New Fields
            document.getElementById('settings-fullname').value = user.full_name || '';
            document.getElementById('settings-email').value = user.email || '';
            document.getElementById('settings-phone').value = user.phone_number || '';
            document.getElementById('settings-country').value = user.country || '';

            // Populate Preferences
            document.getElementById('settings-currency').value = user.currency_preference || 'USD';

            // Update Avatar Preview
            if (user.avatar_path) {
                document.getElementById('settings-avatar-preview').src = `/uploads/${user.avatar_path}`;
            }

            // Update Profile Header
            const displayName = user.full_name || user.username;
            document.getElementById('profile-display-name').textContent = displayName;
            document.getElementById('profile-display-email').textContent = user.email || 'No email set';
        }
    } catch (error) {
        console.error('Error loading profile:', error);
        showToast('Failed to load profile data', 'error');
    }
}

async function updateProfile(event) {
    event.preventDefault();

    const full_name = document.getElementById('settings-fullname').value;
    const email = document.getElementById('settings-email').value;
    const phone_number = document.getElementById('settings-phone').value;
    const country = document.getElementById('settings-country').value;
    const currency_preference = document.getElementById('settings-currency').value;
    const button = event.target.querySelector('button');

    try {
        button.disabled = true;
        button.innerHTML = '<i class="ti ti-loader animate-spin"></i> Saving...';

        const response = await authenticatedFetch('/users/profile', {
            method: 'PUT',
            body: JSON.stringify({
                full_name,
                email,
                phone_number,
                country,
                currency_preference,
                mpesa_number: phone_number // Sync mpesa number with phone for now
            })
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Profile updated successfully!', 'success');
            // Update local storage user data to reflect new currency preference immediately
            const userData = JSON.parse(localStorage.getItem('userData'));
            if (userData) {
                userData.currency_preference = currency_preference;
                localStorage.setItem('userData', JSON.stringify(userData));
            }
            // Reload dashboard to apply currency changes
            updateDashboard();
        } else {
            showToast(result.error || 'Failed to update profile', 'error');
        }
    } catch (error) {
        console.error('Update profile error:', error);
        showToast('Error: ' + error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="ti ti-device-floppy"></i> <span>UPDATE PROFILE</span>';
    }
}

async function changePassword(event) {
    event.preventDefault();

    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const button = event.target.querySelector('button');

    if (newPassword !== confirmPassword) {
        showToast('New passwords do not match!', 'error');
        return;
    }

    if (newPassword.length < 6) {
        showToast('Password must be at least 6 characters', 'error');
        return;
    }

    try {
        button.disabled = true;
        button.innerHTML = '<i class="ti ti-loader animate-spin"></i> Updating...';

        const response = await authenticatedFetch('/users/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Password changed successfully!', 'success');
            event.target.reset();
        } else {
            showToast(result.error || 'Failed to change password', 'error');
        }
    } catch (error) {
        console.error('Change password error:', error);
        showToast('Error: ' + error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="ti ti-lock"></i> <span>Update Password</span>';
    }
}

async function uploadAvatar(input) {
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) {
        showToast('Image too large (Max 2MB)', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    try {
        showToast('Uploading avatar...', 'info');

        const token = localStorage.getItem('authToken');
        const response = await fetch('/users/avatar', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Avatar updated!', 'success');
            // Update preview
            document.getElementById('settings-avatar-preview').src = `/uploads/${result.avatar_path}`;
        } else {
            showToast(result.error || 'Failed to upload avatar', 'error');
        }
    } catch (error) {
        console.error('Avatar upload error:', error);
        showToast('Error uploading avatar', 'error');
    }
}

async function initializeApp() {
    // Authentication is already checked in auth.js on DOMContentLoaded
    // Just update the dashboard
    await updateDashboard();
}

window.onload = initializeApp;