// Authentication state
let authToken = null;
let currentUser = null;

// Toast notification function
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';

    toast.className = `${bgColor} text-white px-6 py-4 rounded-lg shadow-lg transform transition-all duration-300 flex items-center space-x-3 max-w-md`;
    toast.innerHTML = `
        <i class="ti ti-${type === 'success' ? 'check' : type === 'error' ? 'x' : 'info-circle'} text-2xl"></i>
        <span class="font-medium">${message}</span>
    `;

    const container = document.getElementById('toast-container') || document.body;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Check authentication on page load
function checkAuthentication() {
    authToken = localStorage.getItem('authToken');
    const userData = localStorage.getItem('userData');

    if (!authToken || !userData) {
        showLoginForm();
        return false;
    }

    try {
        currentUser = JSON.parse(userData);
        // Set global variables in app.js scope
        if (typeof window !== 'undefined') {
            window.currentUserId = currentUser.id;
            window.currentUserRole = currentUser.role;
            window.currentUsername = currentUser.username;
        }

        hideLoginForm();
        if (typeof updateDashboard === 'function') {
            updateDashboard();
        }
        return true;
    } catch (error) {
        console.error('Error parsing user data:', error);
        showLoginForm();
        return false;
    }
}

// Show login/register form
function showLoginForm() {
    const loginHTML = `
        <div id="auth-container" class="fixed inset-0 bg-gray-950 bg-opacity-95 flex items-center justify-center z-50 p-4">
            <div class="bg-gray-800 rounded-[2.5rem] shadow-2xl w-full max-w-5xl overflow-hidden border border-gray-700/50 flex flex-col md:flex-row min-h-[650px]">
                
                <!-- Left Side: Hero Image & Value Proposition -->
                <div class="hidden md:flex w-1/2 relative overflow-hidden bg-gray-900 p-12 flex-col justify-between">
                    <!-- Background Image with Overlay -->
                    <div class="absolute inset-0 z-0">
                        <img src="images/hero-image.png" alt="Secure Escrow" class="w-full h-full object-cover scale-110">
                        <div class="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/60 to-transparent"></div>
                    </div>
                    
                    <div class="relative z-10">
                        <div class="inline-flex items-center space-x-2 px-3 py-1 bg-orange-500/20 text-orange-400 rounded-full text-[10px] font-black uppercase tracking-widest border border-orange-500/30 mb-6">
                            <span class="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse"></span>
                            <span>Secure Liquidity Banking</span>
                        </div>
                        <h1 class="text-4xl lg:text-5xl font-black text-white leading-[1.1] tracking-tight">
                            Earn More, <br>
                            <span class="text-orange-500 underline decoration-orange-500/30 underline-offset-8">Risk Less.</span>
                        </h1>
                        <p class="text-gray-400 text-lg mt-6 max-w-sm leading-relaxed">
                            Join thousands of middlemen earning consistent commissions on Africa's most trusted escrow platform.
                        </p>
                    </div>

                    <div class="relative z-10 grid grid-cols-1 gap-4">
                        <div class="flex items-center space-x-4 p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
                            <div class="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center text-green-400">
                                <i class="ti ti-chart-arrows text-xl"></i>
                            </div>
                            <div>
                                <p class="text-white font-bold text-sm">High Commissions</p>
                                <p class="text-gray-400 text-xs">Up to 5% earned per transaction</p>
                            </div>
                        </div>
                        <div class="flex items-center space-x-4 p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
                            <div class="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                                <i class="ti ti-shield-check text-xl"></i>
                            </div>
                            <div>
                                <p class="text-white font-bold text-sm">Full Protection</p>
                                <p class="text-gray-400 text-xs">Funds held in audited secure escrow</p>
                            </div>
                        </div>
                        <div class="flex items-center space-x-4 p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
                            <div class="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-400">
                                <i class="ti ti-device-mobile text-xl"></i>
                            </div>
                            <div>
                                <p class="text-white font-bold text-sm">Instant Payouts</p>
                                <p class="text-gray-400 text-xs">M-Pesa integration for zero-wait cashouts</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Right Side: Auth Forms -->
                <div class="w-full md:w-1/2 bg-gray-800 flex flex-col relative">
                    <!-- Mobile Hero (Visible only on mobile) -->
                    <div class="md:hidden h-40 relative overflow-hidden">
                         <img src="images/hero-image.png" alt="Secure Escrow" class="w-full h-full object-cover">
                         <div class="absolute inset-0 bg-gradient-to-t from-gray-800 to-transparent"></div>
                    </div>

                    <div class="p-8 pt-10 flex flex-col h-full">
                        <div class="flex justify-between items-start mb-8">
                            <div>
                                <h2 class="text-3xl font-black text-white tracking-tight">Welcome</h2>
                                <p id="auth-toggle-text" class="text-gray-400 text-sm mt-1 font-medium">Please sign in to your dashboard</p>
                            </div>
                            <div class="w-14 h-14 bg-gray-900 rounded-2xl border border-gray-700 flex items-center justify-center shadow-xl">
                                <i class="ti ti-shield-lock text-orange-500 text-3xl"></i>
                            </div>
                        </div>

                        <!-- Auth Switcher -->
                        <div class="flex bg-gray-950 p-1 rounded-2xl border border-gray-700/50 mb-8 shadow-inner">
                            <button onclick="switchAuthTab('login')" id="login-tab" class="flex-1 py-3 px-4 rounded-xl font-bold text-orange-500 bg-gray-800 shadow-xl transition-all duration-300">
                                LOGIN
                            </button>
                            <button onclick="switchAuthTab('register')" id="register-tab" class="flex-1 py-3 px-4 rounded-xl font-bold text-gray-500 hover:text-gray-300 transition-all duration-300">
                                REGISTER
                            </button>
                        </div>
                        
                        <div class="flex-grow">
                            <!-- LOGIN FORM -->
                            <div id="login-form" class="space-y-6">
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Account Username</label>
                                    <div class="relative group">
                                        <div class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-orange-500 transition-colors">
                                            <i class="ti ti-user-circle text-xl"></i>
                                        </div>
                                        <input type="text" id="login-username" class="w-full bg-gray-900/50 border border-gray-700/50 rounded-2xl pl-12 pr-4 py-4 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 focus:bg-gray-900 transition-all" placeholder="Enter your username">
                                    </div>
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Secure Password</label>
                                    <div class="relative group">
                                        <div class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-orange-500 transition-colors">
                                            <i class="ti ti-lock-square text-xl"></i>
                                        </div>
                                        <input type="password" id="login-password" class="w-full bg-gray-900/50 border border-gray-700/50 rounded-2xl pl-12 pr-4 py-4 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 focus:bg-gray-900 transition-all" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" onkeypress="if(event.key==='Enter') handleLogin()">
                                    </div>
                                </div>
                                
                                <button onclick="handleLogin()" class="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-black py-5 rounded-2xl transition-all duration-300 shadow-[0_10px_30px_rgba(249,115,22,0.15)] hover:shadow-[0_10px_40px_rgba(249,115,22,0.25)] flex items-center justify-center space-x-3 transform active:scale-[0.98] mt-4">
                                    <span>ACCESS DASHBOARD</span>
                                    <i class="ti ti-chevron-right text-lg"></i>
                                </button>
                                
                            </div>

                            <!-- REGISTER FORM -->
                            <div id="register-form" class="hidden space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div class="space-y-1">
                                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1">Full Name</label>
                                        <input type="text" id="register-fullname" class="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-all">
                                    </div>
                                    <div class="space-y-1">
                                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1">Username</label>
                                        <input type="text" id="register-username" class="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-all">
                                    </div>
                                </div>
                                <div class="space-y-1">
                                    <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1">Email Address</label>
                                    <input type="email" id="register-email" class="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-all">
                                </div>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div class="space-y-1">
                                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1">Phone Number</label>
                                        <input type="tel" id="register-phone" class="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-all" placeholder="254...">
                                    </div>
                                    <div class="space-y-1">
                                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1">Country</label>
                                        <input type="text" id="register-country" class="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-all">
                                    </div>
                                </div>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div class="space-y-1">
                                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1">Password</label>
                                        <input type="password" id="register-password" class="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-all">
                                    </div>
                                    <div class="space-y-1">
                                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1">Confirm</label>
                                        <input type="password" id="register-confirm-password" class="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-all">
                                    </div>
                                </div>
                                
                                <input type="hidden" id="register-role" value="middleman">
                                
                                <button onclick="handleRegister()" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-black py-4 rounded-xl transition-all duration-300 shadow-lg shadow-orange-500/10 mt-2">
                                    CREATE ACCOUNT
                                </button>
                            </div>
                        </div>
                        
                        <div class="mt-4 pt-4 border-t border-gray-700/50 text-center">
                            <p class="text-gray-500 text-[10px] uppercase tracking-tighter">&copy; 2025 SecureEscrow. All Rights Reserved.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', loginHTML);
}

// Hide login form
function hideLoginForm() {
    const authContainer = document.getElementById('auth-container');
    if (authContainer) {
        authContainer.remove();
    }
}

// Switch between login and register tabs
function switchAuthTab(tab) {
    const loginTab = document.getElementById('login-tab');
    const registerTab = document.getElementById('register-tab');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const headerText = document.getElementById('auth-toggle-text');

    if (tab === 'login') {
        loginTab.className = 'flex-1 py-3 px-4 rounded-xl font-bold text-orange-500 bg-gray-800 shadow-xl transition-all duration-300';
        registerTab.className = 'flex-1 py-3 px-4 rounded-xl font-bold text-gray-500 hover:text-gray-300 transition-all duration-300';
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        if (headerText) headerText.textContent = 'Please sign in to your dashboard';
    } else {
        registerTab.className = 'flex-1 py-3 px-4 rounded-xl font-bold text-orange-500 bg-gray-800 shadow-xl transition-all duration-300';
        loginTab.className = 'flex-1 py-3 px-4 rounded-xl font-bold text-gray-500 hover:text-gray-300 transition-all duration-300';
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        if (headerText) headerText.textContent = 'Join the network and start earning';
    }
}


// Handle login
async function handleLogin() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        showToast('Please enter username and password', 'error');
        return;
    }

    try {
        const response = await fetch('auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();

        if (response.ok) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));

            authToken = data.token;
            currentUser = data.user;
            window.currentUserId = data.user.id;
            window.currentUserRole = data.user.role;
            window.currentUsername = data.user.username;

            showToast('Login successful!', 'success');
            hideLoginForm();

            // Update header display immediately
            if (typeof updateUserDisplay === 'function') {
                updateUserDisplay();
            }

            // Redirect based on role
            if (data.user.role === 'admin') {
                window.location.href = 'admin.html';
            } else {
                if (typeof updateDashboard === 'function') {
                    updateDashboard();
                }
            }
        } else {
            showToast(data.error || 'Login failed', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showToast('Login error: ' + error.message, 'error');
    }
}

// Handle registration
async function handleRegister() {
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;
    const full_name = document.getElementById('register-fullname').value;
    const email = document.getElementById('register-email').value;
    const phone_number = document.getElementById('register-phone').value;
    const country = document.getElementById('register-country').value;
    const role = document.getElementById('register-role').value;

    if (!username || !password || !email) {
        showToast('Please fill in all required fields (Username, Email, Password)', 'error');
        return;
    }

    if (password !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
    }

    try {
        const response = await fetch('auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                role,
                full_name,
                email,
                phone_number,
                country
            }),
        });

        const data = await response.json();

        if (response.ok) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));

            authToken = data.token;
            currentUser = data.user;
            window.currentUserId = data.user.id;
            window.currentUserRole = data.user.role;
            window.currentUsername = data.user.username;

            showToast('Registration successful!', 'success');
            hideLoginForm();

            // Redirect based on role
            if (data.user.role === 'admin') {
                window.location.href = 'admin.html';
            } else {
                if (typeof updateDashboard === 'function') {
                    updateDashboard();
                }
            }
        } else {
            showToast(data.error || 'Registration failed', 'error');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showToast('Registration error: ' + error.message, 'error');
    }
}

// Logout function
function logout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    authToken = null;
    currentUser = null;

    // Clear global variables
    if (typeof window !== 'undefined') {
        window.currentUserId = null;
        window.currentUserRole = null;
        window.currentUsername = null;
    }

    showToast('Logged out successfully', 'info');
    showLoginForm();
}

// Helper function to make authenticated requests
async function authenticatedFetch(url, options = {}) {
    const token = localStorage.getItem('authToken');
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const finalUrl = url;

    const response = await fetch(finalUrl, {
        ...options,
        headers,
    });

    // If unauthorized, logout and show login form
    if (response.status === 401 || response.status === 403) {
        logout();
    }

    return response;
}

const EXCHANGE_RATE = 129; // 1 USD = 129 KES

function getUserCurrency() {
    try {
        const user = JSON.parse(localStorage.getItem('userData'));
        return user?.currency_preference || 'USD';
    } catch { return 'USD'; }
}

function formatCurrency(amount) {
    const currency = getUserCurrency();
    const val = parseFloat(amount || 0);
    if (currency === 'KES') {
        return 'Ksh ' + (val * EXCHANGE_RATE).toFixed(2);
    }
    return '$' + val.toFixed(2);
}

// Helper to parse currency string back to float (removes $ or Ksh)
function parseCurrencyString(str) {
    if (!str) return 0;
    return parseFloat(str.replace(/[^0-9.-]+/g, ""));
}

/**
 * Syncs all UI elements with the 'currency-label' class to the current preference.
 */
function updateCurrencyLabels() {
    const currency = getUserCurrency();
    const labels = document.querySelectorAll('.currency-label');
    labels.forEach(el => {
        el.textContent = currency;
    });
    console.log(`[Currency] Labels updated to ${currency}`);
}