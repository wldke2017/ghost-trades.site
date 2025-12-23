function navigateTo(path) {
    // Add a smooth transition effect
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.3s ease';

    setTimeout(() => {
        window.location.href = path;
    }, 300);
}

// Add keyboard navigation
document.addEventListener('keydown', (e) => {
    if (e.key === '1') {
        navigateTo('/ghost-trades');
    } else if (e.key === '2') {
        navigateTo('/escrow');
    }
});

// Add entrance animation
window.addEventListener('load', () => {
    document.body.style.opacity = '1';
});
