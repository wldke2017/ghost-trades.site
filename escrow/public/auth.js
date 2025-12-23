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
        <div id="auth-container" class="fixed inset-0 bg-gray-900 bg-opacity-95 flex items-center justify-center z-50 p-4">
            <div class="bg-gray-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-700">
                <!-- Header -->
                <div class="bg-gray-800 p-8 border-b border-gray-700 text-center">
                    <h1 class="text-2xl font-bold text-white mb-2">Escrow System</h1>
                    <div id="auth-toggle-text" class="text-sm text-gray-400">Sign in to your account</div>
                </div>

                <!-- Tabs -->
                <div class="flex border-b border-gray-700">
                    <button onclick="switchAuthTab('login')" id="login-tab" class="flex-1 py-4 font-bold text-blue-400 border-b-2 border-blue-400 bg-gray-800 hover:bg-gray-750 transition">
                        LOGIN
                    </button>
                    <button onclick="switchAuthTab('register')" id="register-tab" class="flex-1 py-4 font-bold text-gray-400 border-b-2 border-transparent hover:text-white transition">
                        REGISTER
                    </button>
                </div>
                
                <div class="p-8">
                    <!-- LOGIN FORM -->
                    <div id="login-form" class="space-y-5">
                        <div>
                            <label class="block text-xs font-bold text-gray-400 uppercase mb-2">Username</label>
                            <input type="text" id="login-username" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition" placeholder="Enter username">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-400 uppercase mb-2">Password</label>
                            <input type="password" id="login-password" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition" placeholder="Enter password" onkeypress="if(event.key==='Enter') handleLogin()">
                        </div>
                        
                        <button onclick="handleLogin()" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 rounded-xl transition shadow-lg mt-4">
                            LOGIN
                        </button>
                        
                         <button onclick="testLogin()" class="w-full bg-gray-700 text-gray-300 text-sm py-2 rounded-lg hover:bg-gray-600 transition">
                            Test Login (Demo)
                        </button>
                    </div>

                    <!-- REGISTER FORM -->
                    <div id="register-form" class="hidden space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                        <div>
                            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Full Name</label>
                            <input type="text" id="register-fullname" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Username</label>
                            <input type="text" id="register-username" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition">
                        </div>
                         <div>
                            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Email Address</label>
                            <input type="email" id="register-email" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition">
                        </div>
                         <div>
                            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Phone Number</label>
                            <input type="tel" id="register-phone" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Country</label>
                            <input type="text" id="register-country" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Password</label>
                            <input type="password" id="register-password" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition">
                        </div>
                         <div>
                            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Confirm Password</label>
                            <input type="password" id="register-confirm-password" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition">
                        </div>
                        
                        <input type="hidden" id="register-role" value="middleman">
                        
                        <button onclick="handleRegister()" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 rounded-xl transition shadow-lg mt-2">
                            REGISTER
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
    const headerText = document.getElementById('auth-toggle-text');

    if (tab === 'login') {
        loginTab.className = 'flex-1 py-4 font-bold text-blue-400 border-b-2 border-blue-400 bg-gray-800 hover:bg-gray-750 transition';
        registerTab.className = 'flex-1 py-4 font-bold text-gray-400 border-b-2 border-transparent hover:text-white transition';
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        if (headerText) headerText.textContent = 'Sign in to your account';
    } else {
        registerTab.className = 'flex-1 py-4 font-bold text-orange-500 border-b-2 border-orange-500 bg-gray-800 hover:bg-gray-750 transition';
        loginTab.className = 'flex-1 py-4 font-bold text-gray-400 border-b-2 border-transparent hover:text-white transition';
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        if (headerText) headerText.textContent = 'Create a new account';
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
                window.location.href = '/escrow/admin.html';
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
        const response = await fetch('/escrow/auth/register', {
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
                window.location.href = '/escrow/admin.html';
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