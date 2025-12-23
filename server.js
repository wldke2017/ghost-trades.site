require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve landing page at root
app.use('/', express.static(path.join(__dirname, 'landing')));

// Serve Ghost Trades app
app.use('/ghost-trades', express.static(path.join(__dirname, 'ghost-trades')));

// Mount SecureEscrow app
const escrowApp = require('./escrow/server');
app.use('/escrow', escrowApp);

// Redirect /ghost-trades to index.html
app.get('/ghost-trades', (req, res) => {
    res.sendFile(path.join(__dirname, 'ghost-trades', 'index.html'));
});

// Create HTTP server
const server = http.createServer(app);

// Start server
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 Multi-App Server Running                            ║
║                                                           ║
║   📍 Landing Page:    http://localhost:${PORT}              ║
║   ⚡ Ghost Trades:    http://localhost:${PORT}/ghost-trades  ║
║   🔒 SecureEscrow:    http://localhost:${PORT}/escrow        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});

module.exports = app;
