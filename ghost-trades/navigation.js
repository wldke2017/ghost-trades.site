// ===================================
// NAVIGATION HANDLING
// ===================================

function setupNavigation() {
    dashboardNav.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('dashboard');
    });

    speedbotNav.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('speedbot');
    });

    ghostaiNav.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('ghostai');
    });

    ghosteoddNav.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('ghost-eodd');
    });

    aiStrategyNav.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('ai-strategy');
    });

    hedgingNav.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('hedging');
    });
}

function showSection(sectionName) {
    console.log('🔄 Showing section:', sectionName);

    // Handle auth-container explicitly
    if (sectionName === 'auth-container') {
        if (authContainer) {
            authContainer.style.display = 'flex';
        }
        // Hide all other main sections
        dashboard.style.display = 'none';
        tradingInterface.style.display = 'none';
        ghostaiInterface.style.display = 'none';
        ghosteoddInterface.style.display = 'none';
        aiStrategyInterface.style.display = 'none';
        hedgingInterface.style.display = 'none';
    } else {
        // Hide auth container when showing any authenticated section
        if (authContainer) {
            authContainer.style.display = 'none';
        }

        dashboard.style.display = (sectionName === 'dashboard') ? 'flex' : 'none';
        tradingInterface.style.display = (sectionName === 'speedbot') ? 'flex' : 'none';
        ghostaiInterface.style.display = (sectionName === 'ghostai') ? 'flex' : 'none';
        ghosteoddInterface.style.display = (sectionName === 'ghost-eodd') ? 'flex' : 'none';
        aiStrategyInterface.style.display = (sectionName === 'ai-strategy') ? 'flex' : 'none';
        hedgingInterface.style.display = (sectionName === 'hedging') ? 'flex' : 'none';

        dashboardNav.classList.toggle('active', sectionName === 'dashboard');
        speedbotNav.classList.toggle('active', sectionName === 'speedbot');
        ghostaiNav.classList.toggle('active', sectionName === 'ghostai');
        ghosteoddNav.classList.toggle('active', sectionName === 'ghost-eodd');
        aiStrategyNav.classList.toggle('active', sectionName === 'ai-strategy');
        hedgingNav.classList.toggle('active', sectionName === 'hedging');

        // Initialize chart only when speedbot is shown
        if (sectionName === 'speedbot' && !currentChart) {
            initializeChart();
            requestMarketData(CHART_MARKET);
        }
    }
}