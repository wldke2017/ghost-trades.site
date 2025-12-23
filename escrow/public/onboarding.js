/**
 * SecureEscrow User Onboarding Guide
 * Uses intro.js to provide a guided tour of the application.
 */

function startOnboarding() {
    const intro = introJs();

    intro.setOptions({
        steps: [
            {
                title: 'Welcome to SecureEscrow! 👋',
                intro: 'This quick tour will show you how to navigate your liquidity banking dashboard and start earning commissions.'
            },
            {
                element: '#earnings-dashboard',
                intro: 'Here you can track your performance, including total orders completed and your earned commissions.',
                position: 'bottom'
            },
            {
                element: '#balance-cards',
                intro: 'This is your digital wallet. <b>Available Balance</b> can be used to claim orders. <b>Locked Balance</b> is your active collateral.',
                position: 'bottom'
            },
            {
                element: '#deposit-btn',
                intro: 'Need more liquidity? Use the <b>Deposit</b> button to add funds instantly via M-Pesa or manual bank transfer.',
                position: 'top'
            },
            {
                element: '#available-orders-section',
                intro: 'Browse and claim new escrow orders here. Each order you successfully middleman earns you a <b>5% commission</b>!',
                position: 'top'
            },
            {
                element: '#active-orders-section',
                intro: 'Once you claim an order, it appears here. Follow the steps to complete the transaction and release your collateral + earnings.',
                position: 'top'
            },
            {
                element: '#withdraw-btn',
                intro: 'Ready to enjoy your profits? Request a <b>Withdrawal</b> to your M-Pesa number anytime. We process requests within 24 hours.',
                position: 'top'
            },
            {
                element: '#settings-btn',
                intro: 'Update your profile, change your password, and manage your M-Pesa payout number in the <b>Settings</b> panel.',
                position: 'left'
            },
            {
                title: 'You\'re All Set! 🚀',
                intro: 'Start claiming orders and building your reputation as a top middleman. Happy earning!'
            }
        ],
        showProgress: true,
        showBullets: false,
        exitOnOverlayClick: false,
        nextLabel: 'Next →',
        prevLabel: '← Back',
        doneLabel: 'Got it!'
    });

    intro.oncomplete(function () {
        localStorage.setItem('onboardingCompleted', 'true');
        showToast('Onboarding completed! You can restart it anytime from the header.', 'success');
    });

    intro.onexit(function () {
        // Optional: Save progress if they exit halfway? 
        // For now, only mark as completed if they finish.
    });

    intro.start();
}

// Auto-start for new users
window.addEventListener('load', () => {
    const onboardingCompleted = localStorage.getItem('onboardingCompleted');
    const isLoginPage = window.location.pathname.includes('login') || window.location.pathname.includes('register');

    // Check if user is logged in (has token)
    const token = localStorage.getItem('authToken');

    if (token && !onboardingCompleted && !isLoginPage) {
        // Delay slightly for dashboard data to load
        setTimeout(() => {
            // Only start if they are actually on the main dashboard
            const dashboard = document.getElementById('middleman-active-section');
            if (dashboard) {
                startOnboarding();
            }
        }, 2000);
    }
});
