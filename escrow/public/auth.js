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
        <div id="auth-container" class="fixed inset-0 bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center z-50">
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-md">
                <div class="text-center mb-8">
                    <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-2">Escrow System</h1>
                    <p class="text-gray-600 dark:text-gray-400">Sign in to continue</p>
                </div>
                
                <div id="auth-tabs" class="flex mb-6 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                    <button onclick="switchAuthTab('login')" id="login-tab" class="flex-1 py-2 px-4 rounded-md font-semibold transition bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow">
                        Login
                    </button>
                    <button onclick="switchAuthTab('register')" id="register-tab" class="flex-1 py-2 px-4 rounded-md font-semibold transition text-gray-600 dark:text-gray-400">
                        Register
                    </button>
                </div>
                
                <div id="login-form">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Username</label>
                            <input type="text" id="login-username" class="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white" placeholder="Enter username">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Password</label>
                            <input type="password" id="login-password" class="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white" placeholder="Enter password" onkeypress="if(event.key==='Enter') handleLogin()">
                        </div>
                        <button onclick="handleLogin()" class="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-blue-600 hover:to-purple-700 transition">
                            Sign In
                        </button>
                        <button onclick="testLogin()" class="w-full mt-2 bg-gray-500 text-white py-2 rounded-lg font-semibold hover:bg-gray-600 transition">
                            Test Login (middleman1)
                        </button>
                    </div>
                    <div class="mt-4 p-3 bg-blue-50 dark:bg-blue-900 rounded-lg">
                        <p class="text-xs text-blue-800 dark:text-blue-200">
                            <strong>Default Login:</strong><br>
                            Admin: Admin / Admin083<br>
                            Middleman: middleman1 / middleman123
                        </p>
                    </div>
                </div>
                
                <div id="register-form" class="hidden">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Username</label>
                            <input type="text" id="register-username" class="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white" placeholder="Choose username">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Password</label>
                            <input type="password" id="register-password" class="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white" placeholder="Choose password" onkeypress="if(event.key==='Enter') handleRegister()">
                        </div>
                        <input type="hidden" id="register-role" value="middleman">
                        <div class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                            <p class="text-sm text-gray-700 dark:text-gray-300">
                                <strong>Account Type:</strong> Middleman
                            </p>
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                New accounts are created as Middleman by default. Only the developer can be Admin.
                            </p>
                        </div>
                        <button onclick="handleRegister()" class="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition">
                            Create Account
                        </button>
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

    if (tab === 'login') {
        loginTab.classList.add('bg-white', 'dark:bg-gray-600', 'text-blue-600', 'dark:text-blue-400', 'shadow');
        loginTab.classList.remove('text-gray-600', 'dark:text-gray-400');
        registerTab.classList.remove('bg-white', 'dark:bg-gray-600', 'text-blue-600', 'dark:text-blue-400', 'shadow');
        registerTab.classList.add('text-gray-600', 'dark:text-gray-400');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    } else {
        registerTab.classList.add('bg-white', 'dark:bg-gray-600', 'text-blue-600', 'dark:text-blue-400', 'shadow');
        registerTab.classList.remove('text-gray-600', 'dark:text-gray-400');
        loginTab.classList.remove('bg-white', 'dark:bg-gray-600', 'text-blue-600', 'dark:text-blue-400', 'shadow');
        loginTab.classList.add('text-gray-600', 'dark:text-gray-400');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
    }
}

// Test login function
function testLogin() {
    document.getElementById('login-username').value = 'middleman1';
    document.getElementById('login-password').value = 'middleman123';
    handleLogin();
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
        const response = await fetch('/escrow/auth/login', {
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
                window.location.href = '/admin.html';
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
    const role = document.getElementById('register-role').value;

    if (!username || !password) {
        showToast('Please enter username and password', 'error');
        return;
    }

    try {
        const response = await fetch('/escrow/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role }),
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
                window.location.href = '/admin.html';
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

    // Prepend /escrow prefix if url starts with / (and not already prefixed)
    const prefix = '/escrow';
    const finalUrl = (url.startsWith('/') && !url.startsWith(prefix))
        ? `${prefix}${url}`
        : url;

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