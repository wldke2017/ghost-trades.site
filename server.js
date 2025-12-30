require('dotenv').config();
const express = require('express');
const http = require('http');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const sequelize = require('./db');
const User = require('./models/user');
const Wallet = require('./models/wallet');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();
const server = http.createServer(app);
let io = { emit: () => { } };

const setupSocket = (socketIoInstance) => {
  io = socketIoInstance;
  app.set('socketio', io);
  console.log('Socket.IO instance initialized for Escrow App');

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('register', (userId) => {
      socket.join(`user_${userId}`);
      console.log(`Socket ${socket.id} joined room user_${userId}`);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
};

const PORT = process.env.PORT || 3000;

// Security & Optimization Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Apply general rate limiter
app.use('/api/', apiLimiter);

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// Database Sync & Seeding
const syncOptions = process.env.NODE_ENV === 'production' ? {} : { alter: true };
sequelize.sync(syncOptions).then(async () => {
  logger.info(`Database synced (Options: ${JSON.stringify(syncOptions)})`);
  try {
    const adminExists = await User.findOne({ where: { role: 'admin' } });
    if (!adminExists) {
      const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin083';
      await User.create({ username: 'Admin', password: adminPassword, role: 'admin' });
      logger.info('Admin user created');
    }
  } catch (error) {
    logger.error('Error seeding users:', error.message);
  }
});

// Route Registrations
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const walletRoutes = require('./routes/wallets');
const transactionRequestRoutes = require('./routes/transactionRequests');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const mpesaRoutes = require('./routes/mpesa');
const aiStrategyRoutes = require('./routes/ai_strategy');

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/wallets', walletRoutes);
app.use('/transaction-requests', transactionRequestRoutes);
app.use('/orders', orderRoutes);
app.use('/admin', adminRoutes);
app.use('/api/mpesa', mpesaRoutes);
app.use('/api/ai', aiStrategyRoutes);

// Health Check Endpoint for Render
app.get('/health', (req, res) => res.status(200).send('OK'));

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Server startup
if (require.main === module) {
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      logger.info('HTTP server closed');
      sequelize.close();
      process.exit(0);
    });
  });
}

module.exports = app;
module.exports.io = io;
module.exports.server = server;
module.exports.setupSocket = setupSocket;