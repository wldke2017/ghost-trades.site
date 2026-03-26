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
const socketIo = require('socket.io');

let io = socketIo(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ["GET", "POST"],
    credentials: true
  }
});

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

setupSocket(io);

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

// Helper to safely add a column if it doesn't already exist
const addColumnIfMissing = async (table, column, definition) => {
  try {
    await sequelize.query(
      `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${column} ${definition};`
    );
  } catch (err) {
    logger.warn(`addColumnIfMissing ${table}.${column}: ${err.message}`);
  }
};

sequelize.sync(syncOptions).then(async () => {
  logger.info(`Database synced (Options: ${JSON.stringify(syncOptions)})`);

  // Ensure all columns added in the OTP auth feature exist in the database
  await addColumnIfMissing('users', 'is_verified',       'BOOLEAN NOT NULL DEFAULT FALSE');
  await addColumnIfMissing('users', 'otp_code',          'VARCHAR(255)');
  await addColumnIfMissing('users', 'otp_expires_at',    'TIMESTAMP WITH TIME ZONE');
  await addColumnIfMissing('users', 'full_name',         'VARCHAR(255)');
  await addColumnIfMissing('users', 'email',             'VARCHAR(255)');
  await addColumnIfMissing('users', 'phone_number',      'VARCHAR(255)');
  await addColumnIfMissing('users', 'country',           'VARCHAR(255)');
  await addColumnIfMissing('users', 'avatar_path',       'VARCHAR(255)');
  await addColumnIfMissing('users', 'mpesa_number',      'VARCHAR(255)');
  await addColumnIfMissing('users', 'currency_preference', "VARCHAR(255) DEFAULT 'USD'");
  logger.info('Schema column check complete.');

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

    // Self-pinging to prevent Render from sleeping (free tier)
    if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
      const https = require('https');
      const url = process.env.RENDER_EXTERNAL_URL;
      
      setInterval(() => {
        https.get(`${url}/health`, (res) => {
          logger.info(`Self-ping successful: ${res.statusCode}`);
        }).on('error', (err) => {
          logger.error('Self-ping failed:', err.message);
        });
      }, 10 * 60 * 1000); // Ping every 10 minutes
    }
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