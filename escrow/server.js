require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const fetch = require('node-fetch');
const sequelize = require('./db');
const User = require('./models/user');
const Wallet = require('./models/wallet');
const Order = require('./models/order');
const TransactionRequest = require('./models/transactionRequest');
const ActivityLog = require('./models/activityLog');
const Transaction = require('./models/transaction');
const { claimOrder, finalizeOrder, disputeOrder } = require('./escrowService');
const { authenticateToken, isAdmin, isMiddleman, JWT_SECRET } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { validate } = require('./middleware/validator');
const { apiLimiter, authLimiter, transactionLimiter, uploadLimiter } = require('./middleware/rateLimiter');
const logger = require('./utils/logger');
const { initiateSTKPush } = require('./utils/mpesa');

const app = express();
const server = http.createServer(app);
// Socket.IO setup (handled via setupSocket for monorepo)
let io = { emit: () => { } }; // Mock object until initialized

const setupSocket = (socketIoInstance) => {
  io = socketIoInstance;
  console.log('Socket.IO instance initialized for Escrow App');

  // Socket.io connection for real-time updates
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
};
const PORT = process.env.PORT || 3000;
const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 0.05;

// M-Pesa Configuration
const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  businessShortCode: process.env.MPESA_BUSINESS_SHORTCODE,
  passkey: process.env.MPESA_PASSKEY,
  callbackUrl: process.env.MPESA_CALLBACK_URL
};

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'deposit-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for development, enable in production
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

app.use(compression());

// Body Parser Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Files
// Static Files - Use absolute path for monorepo compatibility
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Apply general rate limiter to all routes
app.use('/api/', apiLimiter);

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});




// Sync database (alter: true will update schema without dropping data)
// Sync database (alter: true will update schema without dropping data)
// NOTE: In a strict production environment, you should use Migrations instead of sync({alter:true})
// We keep alter: true here to ensure your new columns are added, but be aware of the risks.
sequelize.sync({ alter: true }).then(async () => {
  console.log('Database synced');
  // Seed default users if they don't exist
  try {
    const adminExists = await User.findOne({ where: { username: 'Admin', role: 'admin' } });
    const middlemanExists = await User.findOne({ where: { username: 'middleman1' } });

    if (!adminExists) {
      // SECURITY: Prefer environment variable, fallback to default only if necessary
      const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin083';
      await User.create({ username: 'Admin', password: adminPassword, role: 'admin' });

      if (process.env.ADMIN_DEFAULT_PASSWORD) {
        console.log('Admin user created with configured environment password');
      } else {
        console.warn('⚠️  SECURITY WARNING: Admin user created with default password (Admin083).');
        console.warn('⚠️  Action Required: Log in and change this password immediately!');
      }
    } else {
      // FORCE PASSWORD UPDATE (Requested by User)
      // This ensures the live production database gets updated on the next deploy
      adminExists.password = 'Lu4373212';
      await adminExists.save();
      console.log('🔐 Admin password PROACTIVELY updated to requested value (Lu4373212).');
    }
    if (!middlemanExists) {
      await User.create({ username: 'middleman1', password: 'middleman123', role: 'middleman' });
      console.log('Middleman user created (username: middleman1)');
    }
  } catch (error) {
    console.log('Error seeding users:', error.message);
  }
});

// Routes

// ============ AUTHENTICATION ROUTES ============

// Register new user
app.post('/auth/register', authLimiter, validate('register'), async (req, res) => {
  try {
    const { username, password, role, full_name, email, phone_number, country } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Prevent registration as admin - only developer can be admin
    if (role === 'admin') {
      return res.status(403).json({ error: 'Cannot register as admin. Only middleman accounts can be created.' });
    }

    if (!role || role !== 'middleman') {
      return res.status(400).json({ error: 'Invalid role. Only "middleman" role is allowed for registration.' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const newUser = await User.create({
      username,
      password,
      role,
      full_name,
      email,
      phone_number,
      country
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login user
app.post('/auth/login', authLimiter, validate('login'), async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user
    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check user status
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is disabled or blocked' });
    }

    // Validate password
    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user info (protected route)
app.get('/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'username', 'role', 'createdAt', 'avatar_path', 'mpesa_number', 'currency_preference', 'full_name', 'email', 'phone_number', 'country']
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Profile Settings (M-Pesa, Currency)
// Update Profile Settings (M-Pesa, Currency, Personal Info)
app.put('/users/profile', authenticateToken, async (req, res) => {
  try {
    const { mpesa_number, currency_preference, full_name, email, phone_number, country } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Update allowed fields
    if (mpesa_number !== undefined) user.mpesa_number = mpesa_number;
    if (currency_preference !== undefined) user.currency_preference = currency_preference;
    if (full_name !== undefined) user.full_name = full_name;
    if (email !== undefined) user.email = email;
    if (phone_number !== undefined) user.phone_number = phone_number;
    if (country !== undefined) user.country = country;

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: {
        mpesa_number: user.mpesa_number,
        currency_preference: user.currency_preference,
        full_name: user.full_name,
        email: user.email,
        phone_number: user.phone_number,
        country: user.country
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Change Password
app.post('/users/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Validate current password
    const isValid = await user.validatePassword(currentPassword);
    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect current password' });
    }

    // Update password (hooks will hash it)
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload Avatar
app.post('/users/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Optional: Delete old avatar file if it exists
    user.avatar_path = req.file.filename;
    await user.save();

    res.json({
      message: 'Avatar uploaded successfully',
      avatar_path: user.avatar_path
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ PROTECTED ROUTES ============

// Get current user's wallet (protected) - must come before /:user_id route
app.get('/wallets/me', authenticateToken, async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    // Convert DECIMAL values to proper numbers for consistent frontend display
    const walletData = {
      id: wallet.id,
      user_id: wallet.user_id,
      available_balance: parseFloat(wallet.available_balance || 0).toFixed(2),
      locked_balance: parseFloat(wallet.locked_balance || 0).toFixed(2),
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt
    };

    res.json(walletData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get wallet by user_id (protected)
app.get('/wallets/:user_id', authenticateToken, async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ where: { user_id: req.params.user_id } });
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    // Convert DECIMAL values to proper numbers for consistent frontend display
    const walletData = {
      id: wallet.id,
      user_id: wallet.user_id,
      available_balance: parseFloat(wallet.available_balance || 0).toFixed(2),
      locked_balance: parseFloat(wallet.locked_balance || 0).toFixed(2),
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt
    };

    res.json(walletData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get transaction history for current user
app.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { type, limit = 50, offset = 0 } = req.query;

    const whereClause = { user_id: req.user.id };
    if (type && type !== 'all') {
      whereClause.type = type;
    }

    const transactions = await Transaction.findAll({
      where: whereClause,
      include: [
        { model: Order, attributes: ['id', 'amount', 'status', 'description'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const count = await Transaction.count({ where: whereClause });

    res.json({
      transactions,
      total: count,
      hasMore: offset + transactions.length < count
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk create orders (Admin only, protected)
app.post('/admin/orders/bulk', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { count, totalAmount, minAmount, maxAmount, description } = req.body;

    // Validation
    if (!count || count < 1 || count > 100) {
      return res.status(400).json({ error: 'Order count must be between 1 and 100' });
    }

    if (!totalAmount || totalAmount <= 0) {
      return res.status(400).json({ error: 'Total amount must be greater than 0' });
    }

    if (!minAmount || minAmount <= 0 || !maxAmount || maxAmount <= 0) {
      return res.status(400).json({ error: 'Min and max amounts must be greater than 0' });
    }

    if (minAmount > maxAmount) {
      return res.status(400).json({ error: 'Min amount cannot be greater than max amount' });
    }

    if (count * minAmount > totalAmount) {
      return res.status(400).json({ error: 'Total amount too low for minimum requirements' });
    }

    if (count * maxAmount < totalAmount) {
      return res.status(400).json({ error: 'Total amount too high for maximum limits' });
    }

    // Generate random amounts that sum to totalAmount
    const amounts = generateRandomAmounts(count, totalAmount, minAmount, maxAmount);

    const transaction = await sequelize.transaction();

    try {
      const createdOrders = [];

      for (const amount of amounts) {
        // Get Admin's wallet to lock funds
        let adminWallet = await Wallet.findOne({ where: { user_id: req.user.id }, transaction });

        // If admin has no wallet, create one
        if (!adminWallet) {
          adminWallet = await Wallet.create({
            user_id: req.user.id,
            available_balance: 0,
            locked_balance: 0
          }, { transaction });
        }

        // Check balance
        if (parseFloat(adminWallet.available_balance) < amount) {
          await transaction.rollback();
          return res.status(400).json({ error: `Insufficient funds for order amount ${amount.toFixed(2)}` });
        }

        // Lock the funds
        adminWallet.available_balance = parseFloat(adminWallet.available_balance) - amount;
        adminWallet.locked_balance = parseFloat(adminWallet.locked_balance) + amount;
        await adminWallet.save({ transaction });

        // Create order
        const order = await Order.create({
          buyer_id: req.user.id,
          amount: amount,
          vault_amount: amount,
          description: description || `Bulk order - ${amount.toFixed(2)}`
        }, { transaction });

        // Record transaction
        await Transaction.create({
          user_id: req.user.id,
          order_id: order.id,
          type: 'ORDER_CREATED',
          amount: -amount,
          balance_before: parseFloat(adminWallet.available_balance) + amount,
          balance_after: parseFloat(adminWallet.available_balance),
          description: `Bulk order #${order.id} - ${amount.toFixed(2)} locked`
        }, { transaction });

        createdOrders.push(order);
      }

      await transaction.commit();

      // Emit WebSocket events
      createdOrders.forEach(order => {
        io.emit('orderCreated', order);
      });

      io.emit('walletUpdated', {
        user_id: req.user.id,
        available_balance: adminWallet.available_balance,
        locked_balance: adminWallet.locked_balance
      });

      res.status(201).json({
        message: `Successfully created ${createdOrders.length} bulk orders`,
        created: createdOrders.length,
        totalAmount: totalAmount,
        orders: createdOrders.map(o => ({ id: o.id, amount: o.amount }))
      });

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

  } catch (error) {
    console.error('Bulk order creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to generate random amounts that sum to total
function generateRandomAmounts(count, total, min, max) {
  const amounts = [];

  // For all but the last order, generate random amounts
  for (let i = 0; i < count - 1; i++) {
    const remainingOrders = count - i - 1;
    const remainingTotal = total - amounts.reduce((sum, a) => sum + a, 0);
    const maxForThis = Math.min(max, remainingTotal - (remainingOrders * min));
    const minForThis = Math.max(min, remainingTotal - (remainingOrders * max));

    const randomAmount = Math.random() * (maxForThis - minForThis) + minForThis;
    amounts.push(Math.round(randomAmount * 100) / 100); // Round to 2 decimal places
  }

  // Last amount is what's remaining to reach the total
  const remaining = total - amounts.reduce((sum, a) => sum + a, 0);
  amounts.push(Math.round(remaining * 100) / 100);

  return amounts;
}

// M-Pesa Integration Functions
async function getMpesaAccessToken() {
  const auth = Buffer.from(MPESA_CONFIG.consumerKey + ':' + MPESA_CONFIG.consumerSecret).toString('base64');

  console.log('Auth Header being sent:', auth);

  try {
    const response = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/json'
      }
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error('M-Pesa API error response:', responseText);
      throw new Error(`M-Pesa API error: ${response.status} - ${responseText}`);
    }

    const data = JSON.parse(responseText);

    if (!data.access_token) {
      throw new Error('No token returned');
    }

    return data.access_token;
  } catch (error) {
    console.error('Error getting M-Pesa access token:', error);
    if (error.response) {
      console.error(error.response.data);
    }
    throw new Error('Failed to get M-Pesa access token: ' + error.message);
  }
}

function generateMpesaPassword() {
  // Generate 14-digit timestamp (YYYYMMDDHHMMSS)
  const now = new Date();
  const timestamp = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');

  const passwordString = MPESA_CONFIG.businessShortCode + MPESA_CONFIG.passkey + timestamp;
  return {
    password: Buffer.from(passwordString).toString('base64'),
    timestamp: timestamp
  };
}

// M-Pesa STK Push Route
app.post('/api/stkpush', authenticateToken, async (req, res) => {
  try {
    const { amount, phoneNumber } = req.body;

    // Validate inputs
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    if (!phoneNumber || !/^254[0-9]{9}$/.test(phoneNumber)) {
      return res.status(400).json({ error: 'Invalid phone number format. Use 254XXXXXXXXX' });
    }

    // Get M-Pesa access token
    const accessToken = await getMpesaAccessToken();

    // Generate password and timestamp
    const { password, timestamp } = generateMpesaPassword();

    // Prepare STK Push request
    const stkPushData = {
      BusinessShortCode: MPESA_CONFIG.businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(parseFloat(amount)), // M-Pesa requires integer
      PartyA: phoneNumber,
      PartyB: MPESA_CONFIG.businessShortCode,
      PhoneNumber: phoneNumber,
      CallBackURL: MPESA_CONFIG.callbackUrl,
      AccountReference: `User${req.user.id}`,
      TransactionDesc: 'Wallet Deposit'
    };

    console.log('Initiating STK Push:', {
      amount: stkPushData.Amount,
      phone: phoneNumber,
      timestamp: timestamp
    });

    // Send STK Push request
    const response = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(stkPushData)
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error('M-Pesa STK Push error:', responseData);
      return res.status(response.status).json({
        error: 'M-Pesa payment initiation failed',
        details: responseData
      });
    }

    console.log('STK Push successful:', responseData);

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'mpesa_stkpush_initiated',
      metadata: {
        amount: stkPushData.Amount,
        phone: phoneNumber,
        checkoutRequestId: responseData.CheckoutRequestID
      }
    });

    res.json({
      success: true,
      message: 'M-Pesa prompt sent to your phone. Please enter your PIN.',
      checkoutRequestId: responseData.CheckoutRequestID,
      merchantRequestId: responseData.MerchantRequestID
    });

  } catch (error) {
    console.error('STK Push error:', error);
    res.status(500).json({ error: 'Failed to initiate M-Pesa payment: ' + error.message });
  }
});

// M-Pesa Callback Route
app.post('/api/callback', async (req, res) => {
  try {
    console.log('=== M-Pesa Callback Received ===');
    console.log(JSON.stringify(req.body, null, 2));

    const callbackData = req.body;

    // Extract callback details
    if (callbackData.Body && callbackData.Body.stkCallback) {
      const stkCallback = callbackData.Body.stkCallback;
      const resultCode = stkCallback.ResultCode;
      const resultDesc = stkCallback.ResultDesc;
      const merchantRequestId = stkCallback.MerchantRequestID;
      const checkoutRequestId = stkCallback.CheckoutRequestID;

      if (resultCode === 0) {
        // Payment successful
        console.log('✅ Payment Successful!');

        // Find the user who initiated this request
        // We stored the CheckoutRequestID in ActivityLog metadata
        // Note: In Sequelize, querying JSONB fields depends on dialect. 
        // For simplicity/compatibility, we might need a raw query or clearer association.
        // But let's try a direct ActivityLog search.

        try {
          // Find the log entry that contains this checkoutRequestId
          // This is inefficient for large scale but works for MVP
          const logs = await ActivityLog.findAll({
            where: { action: 'mpesa_stkpush_initiated' },
            order: [['createdAt', 'DESC']],
            limit: 50 // Look at recent logs
          });

          const matchingLog = logs.find(log => log.metadata && log.metadata.checkoutRequestId === checkoutRequestId);

          if (matchingLog) {
            const userId = matchingLog.user_id;
            const amount = parseFloat(callbackData.Body.stkCallback.CallbackMetadata.Item.find(i => i.Name === 'Amount').Value);
            const mpesaReceipt = callbackData.Body.stkCallback.CallbackMetadata.Item.find(i => i.Name === 'MpesaReceiptNumber').Value;
            const phone = callbackData.Body.stkCallback.CallbackMetadata.Item.find(i => i.Name === 'PhoneNumber').Value;

            console.log(`Found matching user ${userId} for amount ${amount}`);

            // Start transaction to update wallet
            const t = await sequelize.transaction();

            try {
              // Find or Create Wallet
              let wallet = await Wallet.findOne({ where: { user_id: userId }, transaction: t });
              if (!wallet) {
                wallet = await Wallet.create({ user_id: userId, available_balance: 0, locked_balance: 0 }, { transaction: t });
              }

              // Check if transaction already processed (idempotency)
              const existingTx = await Transaction.findOne({ where: { description: { [sequelize.Op.like]: `%${mpesaReceipt}%` } }, transaction: t });

              if (!existingTx) {
                // Credit Wallet
                wallet.available_balance = parseFloat(wallet.available_balance) + amount;
                await wallet.save({ transaction: t });

                // Create Transaction Record
                await Transaction.create({
                  user_id: userId,
                  type: 'DEPOSIT',
                  amount: amount,
                  balance_before: parseFloat(wallet.available_balance) - amount,
                  balance_after: parseFloat(wallet.available_balance),
                  description: `M-Pesa Deposit: ${mpesaReceipt}`,
                  metadata: { mpesaReceipt, phone, checkoutRequestId }
                }, { transaction: t });

                await t.commit();

                console.log('Wallet funded successfully');

                // Notify User via Socket
                io.emit('walletUpdated', {
                  user_id: userId,
                  available_balance: wallet.available_balance,
                  locked_balance: wallet.locked_balance,
                  message: `Received ${amount} KES from M-Pesa`
                });
              } else {
                console.log('Transaction already processed');
                await t.rollback();
              }

            } catch (err) {
              await t.rollback();
              console.error('Database transaction error:', err);
            }

          } else {
            console.error('Could not find user for CheckoutRequestID:', checkoutRequestId);
          }
        } catch (err) {
          console.error('Error finding user log:', err);
        }

      } else {
        // Payment failed or cancelled
        console.log('❌ Payment Failed!');
        console.log('Result Code:', resultCode);
        console.log('Description:', resultDesc);

        // Try to find the user and notify them
        try {
          const logs = await ActivityLog.findAll({
            where: { action: 'mpesa_stkpush_initiated' },
            order: [['createdAt', 'DESC']],
            limit: 50
          });

          const matchingLog = logs.find(log => log.metadata && log.metadata.checkoutRequestId === checkoutRequestId);

          if (matchingLog) {
            const userId = matchingLog.user_id;

            // Map result codes to user-friendly messages
            const errorMessages = {
              '1032': 'You cancelled the M-Pesa payment',
              '1': 'Insufficient balance in M-Pesa account',
              '2001': 'Wrong PIN entered. Please try again',
              '1037': 'Payment request timed out',
              '1025': 'Unable to process payment. Please try again'
            };

            const userMessage = errorMessages[resultCode] || `Payment failed: ${resultDesc}`;

            // Log the failed attempt
            await ActivityLog.create({
              user_id: userId,
              action: 'mpesa_payment_failed',
              metadata: {
                resultCode,
                resultDesc,
                checkoutRequestId,
                merchantRequestId
              }
            });

            // Notify user via WebSocket
            io.emit('paymentFailed', {
              user_id: userId,
              message: userMessage,
              resultCode: resultCode
            });

            console.log(`Notified user ${userId} about payment failure: ${userMessage}`);
          }
        } catch (err) {
          console.error('Error notifying user of payment failure:', err);
        }
      }
    }

    // Always respond with 200 OK to acknowledge receipt
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received successfully' });

  } catch (error) {
    console.error('Callback processing error:', error);
    // Still return 200 to prevent M-Pesa from retrying
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received' });
  }
});

// Create order (Admin only, protected)
app.post('/orders', authenticateToken, isAdmin, validate('createOrder'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { amount, description } = req.body;

    // Validate amount
    if (!amount || parseFloat(amount) <= 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const orderAmount = parseFloat(amount);

    // Get Admin's wallet to lock funds
    let adminWallet = await Wallet.findOne({ where: { user_id: req.user.id }, transaction });

    // If admin has no wallet, create one (bootstrapping)
    if (!adminWallet) {
      // Check if this is the very first order or special case? 
      // For now, allow creation but require funds.
      // Actually, let's create it with 0 balance and fail the check below if they don't have funds.
      adminWallet = await Wallet.create({
        user_id: req.user.id,
        available_balance: 0,
        locked_balance: 0
      }, { transaction });
    }

    // Check balance
    if (parseFloat(adminWallet.available_balance) < orderAmount) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Insufficient funds in Admin wallet to create this order.' });
    }

    // Lock the funds
    adminWallet.available_balance = parseFloat(adminWallet.available_balance) - orderAmount;
    adminWallet.locked_balance = parseFloat(adminWallet.locked_balance) + orderAmount;
    await adminWallet.save({ transaction });

    // Create order with authenticated admin as buyer
    const order = await Order.create({
      buyer_id: req.user.id,
      amount: orderAmount,
      vault_amount: orderAmount,
      description
    }, { transaction });

    // Record transaction for admin (order created - funds locked)
    const balanceBefore = parseFloat(adminWallet.available_balance) + orderAmount;
    await Transaction.create({
      user_id: req.user.id,
      order_id: order.id,
      type: 'ORDER_CREATED',
      amount: -orderAmount,
      balance_before: balanceBefore,
      balance_after: parseFloat(adminWallet.available_balance),
      description: `Created order #${order.id} - $${orderAmount.toFixed(2)} locked`
    }, { transaction });

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'order_created',
      metadata: { order_id: order.id, amount: order.amount, description: order.description }
    }, { transaction });

    await transaction.commit();

    // Emit WebSocket event (outside transaction)
    io.emit('orderCreated', order);
    io.emit('walletUpdated', {
      user_id: req.user.id,
      available_balance: adminWallet.available_balance,
      locked_balance: adminWallet.locked_balance
    });

    res.status(201).json(order);
  } catch (error) {
    if (transaction) await transaction.rollback();
    res.status(400).json({ error: error.message });
  }
});

// Get all orders (protected)
app.get('/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await Order.findAll({
      attributes: ['id', 'amount', 'status', 'createdAt', 'updatedAt'],
    });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Claim order (Middleman only, protected)
app.post('/orders/:id/claim', authenticateToken, isMiddleman, async (req, res) => {
  try {
    const result = await claimOrder(req.user.id, req.params.id);

    // Get updated wallet for real-time update
    const updatedWallet = await Wallet.findOne({ where: { user_id: req.user.id } });

    // Emit WebSocket event for wallet update
    io.emit('walletUpdated', {
      user_id: req.user.id,
      available_balance: updatedWallet.available_balance,
      locked_balance: updatedWallet.locked_balance
    });

    // Log activity
    const order = await Order.findByPk(req.params.id);
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'order_claimed',
      metadata: { order_id: req.params.id, amount: order.amount }
    });

    // Emit WebSocket event
    io.emit('orderClaimed', order);

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Mark order as complete (Middleman marks work as done)
app.post('/orders/:id/complete', authenticateToken, isMiddleman, async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if user is the middleman for this order
    if (order.middleman_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You can only complete orders you claimed' });
    }

    if (order.status !== 'CLAIMED') {
      return res.status(400).json({ error: 'Order must be in CLAIMED status to complete' });
    }

    // Update status to READY_FOR_RELEASE
    order.status = 'READY_FOR_RELEASE';
    await order.save();

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'order_completed',
      metadata: { order_id: req.params.id, amount: order.amount }
    });

    // Emit WebSocket event
    io.emit('orderReadyForRelease', order);

    res.json({
      message: 'Order marked as complete. Waiting for admin to release funds.',
      order
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get middleman's earnings summary
app.get('/middleman/earnings', authenticateToken, isMiddleman, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all completed orders for this middleman
    const completedOrders = await Order.findAll({
      where: {
        middleman_id: userId,
        status: 'COMPLETED'
      }
    });

    // Calculate total earnings (5% commission)
    const totalEarnings = completedOrders.reduce((sum, order) => {
      return sum + (parseFloat(order.amount) * COMMISSION_RATE);
    }, 0);

    // Calculate this month's earnings
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyOrders = completedOrders.filter(order =>
      new Date(order.updatedAt) >= startOfMonth
    );

    const monthlyEarnings = monthlyOrders.reduce((sum, order) => {
      return sum + (parseFloat(order.amount) * COMMISSION_RATE);
    }, 0);

    // Get all orders (including disputed) for success rate
    const allMyOrders = await Order.findAll({
      where: { middleman_id: userId }
    });

    const successRate = allMyOrders.length > 0
      ? Math.round((completedOrders.length / allMyOrders.length) * 100)
      : 0;

    // Calculate average order value
    const avgOrderValue = completedOrders.length > 0
      ? completedOrders.reduce((sum, order) => sum + parseFloat(order.amount), 0) / completedOrders.length
      : 0;

    res.json({
      totalEarnings: totalEarnings.toFixed(2),
      monthlyEarnings: monthlyEarnings.toFixed(2),
      successRate,
      avgOrderValue: avgOrderValue.toFixed(2),
      totalCompletedOrders: completedOrders.length,
      totalOrders: allMyOrders.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get middleman's active orders
app.get('/middleman/active-orders', authenticateToken, isMiddleman, async (req, res) => {
  try {
    const activeOrders = await Order.findAll({
      where: {
        middleman_id: req.user.id,
        status: ['CLAIMED', 'READY_FOR_RELEASE']
      },
      order: [['createdAt', 'DESC']]
    });

    res.json(activeOrders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Release order (Admin confirms and releases funds with commission)
app.post('/orders/:id/release', authenticateToken, isAdmin, async (req, res) => {
  try {
    const orderData = await Order.findByPk(req.params.id);

    if (!orderData) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (orderData.status !== 'READY_FOR_RELEASE' && orderData.status !== 'CLAIMED') {
      return res.status(400).json({ error: 'Order must be ready for release or claimed' });
    }

    const result = await finalizeOrder(req.params.id, COMMISSION_RATE);

    // Get updated wallet for real-time update
    const updatedWallet = await Wallet.findOne({ where: { user_id: orderData.middleman_id } });

    // Emit WebSocket event for wallet update
    io.emit('walletUpdated', {
      user_id: orderData.middleman_id,
      available_balance: updatedWallet.available_balance,
      locked_balance: updatedWallet.locked_balance
    });

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'order_released',
      metadata: {
        order_id: req.params.id,
        amount: orderData.amount,
        commission: parseFloat(orderData.amount) * COMMISSION_RATE
      }
    });

    // Emit WebSocket event
    const updatedOrder = await Order.findByPk(req.params.id);
    io.emit('orderCompleted', updatedOrder);

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Resolve dispute (Admin only, protected)
app.post('/orders/:id/resolve', authenticateToken, isAdmin, validate('resolveDispute'), async (req, res) => {
  try {
    const { winner } = req.body; // 'middleman' or 'buyer'

    if (!['middleman', 'buyer'].includes(winner)) {
      return res.status(400).json({ error: 'Winner must be either "middleman" or "buyer"' });
    }

    const orderData = await Order.findByPk(req.params.id);
    if (!orderData) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (orderData.status !== 'DISPUTED') {
      return res.status(400).json({ error: 'Order is not in disputed status' });
    }

    const transaction = await sequelize.transaction();

    try {
      const middlemanWallet = await Wallet.findOne({
        where: { user_id: orderData.middleman_id },
        transaction
      });

      if (!middlemanWallet) {
        throw new Error('Middleman wallet not found');
      }

      if (winner === 'middleman') {
        // Middleman wins: unlock collateral + pay commission
        const commission = parseFloat(orderData.amount) * COMMISSION_RATE;
        const payoutAmount = parseFloat(orderData.amount) - commission;

        // Store balances before for transaction records
        const middlemanBalanceBefore = parseFloat(middlemanWallet.available_balance);

        // Find Buyer Wallet
        const buyerWallet = await Wallet.findOne({
          where: { user_id: orderData.buyer_id },
          transaction
        });

        let buyerBalanceBefore = 0;
        if (buyerWallet) {
          buyerBalanceBefore = parseFloat(buyerWallet.available_balance);
          // Buyer pays: decrease locked (buyer already locked funds when order was created)
          buyerWallet.locked_balance = parseFloat(buyerWallet.locked_balance) - parseFloat(orderData.amount);
          await buyerWallet.save({ transaction });
          // Note: Commission handling is implicit - buyer loses full amount, middleman gets (amount - commission)
        }

        // Unlock collateral first
        middlemanWallet.locked_balance = parseFloat(middlemanWallet.locked_balance) - parseFloat(orderData.amount);
        middlemanWallet.available_balance = parseFloat(middlemanWallet.available_balance) + parseFloat(orderData.amount);
        // Add payout (buyer's payment minus commission)
        middlemanWallet.available_balance = parseFloat(middlemanWallet.available_balance) + payoutAmount;
        orderData.status = 'COMPLETED';

        await middlemanWallet.save({ transaction });
        await orderData.save({ transaction });

        // Record transactions
        if (buyerWallet) {
          await Transaction.create({
            user_id: orderData.buyer_id,
            order_id: req.params.id,
            type: 'DISPUTE_REFUND',
            amount: -parseFloat(orderData.amount),
            balance_before: buyerBalanceBefore,
            balance_after: buyerWallet.available_balance,
            description: `Dispute resolved - buyer lost order #${req.params.id} - ${orderData.amount.toFixed(2)} refunded to middleman`
          }, { transaction });
        }

        await Transaction.create({
          user_id: orderData.middleman_id,
          order_id: req.params.id,
          type: 'DISPUTE_REFUND',
          amount: parseFloat(orderData.amount) + payoutAmount,
          balance_before: middlemanBalanceBefore,
          balance_after: middlemanWallet.available_balance,
          description: `Dispute resolved - middleman won order #${req.params.id} - collateral ${orderData.amount.toFixed(2)} + payout ${payoutAmount.toFixed(2)} unlocked`
        }, { transaction });
        await transaction.commit();

        // Emit WebSocket updates
        if (buyerWallet) {
          io.emit('walletUpdated', {
            user_id: orderData.buyer_id,
            available_balance: buyerWallet.available_balance,
            locked_balance: buyerWallet.locked_balance
          });
        }

        // Emit WebSocket event for wallet update
        io.emit('walletUpdated', {
          user_id: orderData.middleman_id,
          available_balance: middlemanWallet.available_balance,
          locked_balance: middlemanWallet.locked_balance
        });

        // Log activity
        await ActivityLog.create({
          user_id: req.user.id,
          action: 'dispute_resolved',
          metadata: { order_id: req.params.id, winner: 'middleman', commission: commission }
        });

        // Emit WebSocket event
        io.emit('orderCompleted', orderData);

        return res.json({
          message: `Dispute resolved in favor of middleman. Collateral unlocked and ${commission.toFixed(2)} commission paid.`,
          winner: 'middleman'
        });
      } else {
        // Buyer wins: return collateral to middleman, return funds to buyer
        // Store balances before for transaction records
        const middlemanBalanceBefore = parseFloat(middlemanWallet.available_balance);

        // Find Buyer Wallet
        const buyerWallet = await Wallet.findOne({
          where: { user_id: orderData.buyer_id },
          transaction
        });

        let buyerBalanceBefore = 0;
        if (buyerWallet) {
          buyerBalanceBefore = parseFloat(buyerWallet.available_balance);
          // Buyer gets refund: move locked to available
          buyerWallet.available_balance = parseFloat(buyerWallet.available_balance) + parseFloat(orderData.amount);
          buyerWallet.locked_balance = parseFloat(buyerWallet.locked_balance) - parseFloat(orderData.amount);
          await buyerWallet.save({ transaction });
        }

        middlemanWallet.available_balance = parseFloat(middlemanWallet.available_balance) + parseFloat(orderData.amount);
        middlemanWallet.locked_balance = parseFloat(middlemanWallet.locked_balance) - parseFloat(orderData.amount);
        orderData.status = 'CANCELLED';

        await middlemanWallet.save({ transaction });
        await orderData.save({ transaction });

        // Record transactions
        if (buyerWallet) {
          await Transaction.create({
            user_id: orderData.buyer_id,
            order_id: req.params.id,
            type: 'DISPUTE_REFUND',
            amount: parseFloat(orderData.amount),
            balance_before: buyerBalanceBefore,
            balance_after: buyerWallet.available_balance,
            description: `Dispute resolved - buyer won order #${req.params.id} - ${orderData.amount.toFixed(2)} refunded`
          }, { transaction });
        }

        await Transaction.create({
          user_id: orderData.middleman_id,
          order_id: req.params.id,
          type: 'DISPUTE_FORFEIT',
          amount: parseFloat(orderData.amount),
          balance_before: middlemanBalanceBefore,
          balance_after: middlemanWallet.available_balance,
          description: `Dispute resolved - middleman lost order #${req.params.id} - collateral ${orderData.amount.toFixed(2)} returned`
        }, { transaction });
        await transaction.commit();

        // Emit WebSocket updates
        if (buyerWallet) {
          io.emit('walletUpdated', {
            user_id: orderData.buyer_id,
            available_balance: buyerWallet.available_balance,
            locked_balance: buyerWallet.locked_balance
          });
        }

        // Emit WebSocket event for wallet update
        io.emit('walletUpdated', {
          user_id: orderData.middleman_id,
          available_balance: middlemanWallet.available_balance,
          locked_balance: middlemanWallet.locked_balance
        });

        // Log activity
        await ActivityLog.create({
          user_id: req.user.id,
          action: 'dispute_resolved',
          metadata: { order_id: req.params.id, winner: 'buyer' }
        });

        // Emit WebSocket event
        io.emit('orderCancelled', orderData);

        return res.json({
          message: 'Dispute resolved in favor of buyer. Collateral returned to middleman, no commission paid.',
          winner: 'buyer'
        });
      }
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get master overview (Admin only, protected)
app.get('/admin/overview', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { ordersLimit = 10, ordersOffset = 0 } = req.query;

    // Get all users with their wallets
    const users = await User.findAll({
      include: [{
        model: Wallet,
        required: false
      }]
    });

    // Get orders with pagination
    const orders = await Order.findAll({
      include: [
        { model: User, as: 'buyer', attributes: ['id', 'username', 'role'] },
        { model: User, as: 'middleman', attributes: ['id', 'username', 'role'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(ordersLimit),
      offset: parseInt(ordersOffset)
    });

    // Get total orders count for pagination
    const totalOrders = await Order.count();

    // Get pending transaction requests count
    const pendingRequests = await TransactionRequest.count({
      where: { status: 'pending' }
    });

    res.json({
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        status: u.status,
        available_balance: u.Wallet ? parseFloat(u.Wallet.available_balance || 0).toFixed(2) : '0.00',
        locked_balance: u.Wallet ? parseFloat(u.Wallet.locked_balance || 0).toFixed(2) : '0.00',
        total_balance: u.Wallet ?
          (parseFloat(u.Wallet.available_balance || 0) + parseFloat(u.Wallet.locked_balance || 0)).toFixed(2) :
          '0.00'
      })),
      orders: orders,
      totalOrders: totalOrders,
      ordersHasMore: parseInt(ordersOffset) + orders.length < totalOrders,
      pendingRequests: pendingRequests
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ADMIN WALLET MANAGEMENT ROUTES ============

// Deposit funds to any wallet (Admin only, protected)
app.post('/admin/wallets/:user_id/deposit', authenticateToken, isAdmin, validate('walletTransaction'), async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = parseInt(req.params.user_id);

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const transaction = await sequelize.transaction();

    try {
      // Find or create wallet
      let wallet = await Wallet.findOne({ where: { user_id: userId }, transaction });

      if (!wallet) {
        wallet = await Wallet.create({ user_id: userId, available_balance: 0, locked_balance: 0 }, { transaction });
      }

      // Store balance before for transaction record
      const balanceBefore = parseFloat(wallet.available_balance);

      // Add funds
      wallet.available_balance = balanceBefore + parseFloat(amount);
      await wallet.save({ transaction });

      // Record transaction
      await Transaction.create({
        user_id: userId,
        type: 'DEPOSIT',
        amount: parseFloat(amount),
        balance_before: balanceBefore,
        balance_after: wallet.available_balance,
        description: `Manual admin deposit - ${parseFloat(amount).toFixed(2)}`
      }, { transaction });

      // Create TransactionRequest record for history tracking
      await TransactionRequest.create({
        user_id: userId,
        type: 'deposit',
        amount: parseFloat(amount),
        status: 'approved',
        admin_notes: 'Manual Admin Deposit',
        reviewed_by: req.user.id,
        reviewed_at: new Date()
      }, { transaction });

      await transaction.commit();

      // Emit WebSocket event for real-time update
      io.emit('walletUpdated', {
        user_id: userId,
        available_balance: wallet.available_balance,
        locked_balance: wallet.locked_balance
      });

      // Log activity
      await ActivityLog.create({
        user_id: req.user.id,
        action: 'wallet_deposit',
        metadata: { target_user_id: userId, amount: parseFloat(amount), new_balance: wallet.available_balance }
      });

      res.json({
        message: `Successfully deposited ${parseFloat(amount).toFixed(2)}`,
        wallet: {
          user_id: wallet.user_id,
          available_balance: wallet.available_balance,
          locked_balance: wallet.locked_balance
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Withdraw funds from any wallet (Admin only, protected)
app.post('/admin/wallets/:user_id/withdraw', authenticateToken, isAdmin, validate('walletTransaction'), async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = parseInt(req.params.user_id);

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const transaction = await sequelize.transaction();

    try {
      const wallet = await Wallet.findOne({ where: { user_id: userId }, transaction });

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      if (parseFloat(wallet.available_balance) < parseFloat(amount)) {
        throw new Error('Insufficient available balance');
      }

      // Store balance before for transaction record
      const balanceBefore = parseFloat(wallet.available_balance);

      // Deduct funds
      wallet.available_balance = balanceBefore - parseFloat(amount);
      await wallet.save({ transaction });

      // Record transaction
      await Transaction.create({
        user_id: userId,
        type: 'WITHDRAWAL',
        amount: -parseFloat(amount),
        balance_before: balanceBefore,
        balance_after: wallet.available_balance,
        description: `Manual admin withdrawal - ${parseFloat(amount).toFixed(2)}`
      }, { transaction });

      // Create TransactionRequest record for history tracking
      await TransactionRequest.create({
        user_id: userId,
        type: 'withdrawal',
        amount: parseFloat(amount),
        status: 'approved',
        admin_notes: 'Manual Admin Withdrawal',
        reviewed_by: req.user.id,
        reviewed_at: new Date()
      }, { transaction });

      await transaction.commit();

      // Emit WebSocket event for real-time update
      io.emit('walletUpdated', {
        user_id: userId,
        available_balance: wallet.available_balance,
        locked_balance: wallet.locked_balance
      });

      // Log activity
      await ActivityLog.create({
        user_id: req.user.id,
        action: 'wallet_withdraw',
        metadata: { target_user_id: userId, amount: parseFloat(amount), new_balance: wallet.available_balance }
      });

      res.json({
        message: `Successfully withdrew ${parseFloat(amount).toFixed(2)}`,
        wallet: {
          user_id: wallet.user_id,
          available_balance: wallet.available_balance,
          locked_balance: wallet.locked_balance
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get system health (Admin only, protected)
app.get('/admin/system-health', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Get all wallets
    const wallets = await Wallet.findAll();

    // Calculate total liquidity (sum of all available balances)
    const totalLiquidity = wallets.reduce((sum, w) => sum + parseFloat(w.available_balance), 0);

    // Calculate total escrowed (sum of all locked balances)
    const totalEscrowed = wallets.reduce((sum, w) => sum + parseFloat(w.locked_balance), 0);

    // Get all active orders
    const activeOrders = await Order.findAll({
      where: { status: ['CLAIMED', 'READY_FOR_RELEASE'] }
    });

    // Calculate projected commission (5% of all active order amounts)
    const projectedCommission = activeOrders.reduce((sum, o) => sum + (parseFloat(o.amount) * COMMISSION_RATE), 0);

    res.json({
      totalLiquidity: totalLiquidity.toFixed(2),
      totalEscrowed: totalEscrowed.toFixed(2),
      projectedCommission: projectedCommission.toFixed(2),
      activeOrdersCount: activeOrders.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all users (Admin only, protected)
app.get('/admin/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'username', 'role', 'createdAt'],
      include: [{
        model: Wallet,
        required: false
      }],
      order: [['createdAt', 'DESC']]
    });

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get activity logs (Admin only, protected)
app.get('/admin/activity-logs', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;

    const logs = await ActivityLog.findAll({
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'username', 'role']
      }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user status (Admin only, protected)
app.patch('/admin/users/:id/status', authenticateToken, isAdmin, validate('updateUserStatus'), async (req, res) => {
  try {
    const { status } = req.body;
    const userId = parseInt(req.params.id);

    if (!['active', 'disabled', 'blocked'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be active, disabled, or blocked.' });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent admin from disabling themselves
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot modify your own account status' });
    }

    user.status = status;
    await user.save();

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'user_status_updated',
      metadata: { target_user_id: userId, old_status: user.previous('status'), new_status: status }
    });

    res.json({
      message: `User status updated to ${status}`,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete user (Admin only, protected) - Hard delete
app.delete('/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent admin from deleting themselves
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Hard delete the user
    await user.destroy();

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'user_deleted',
      metadata: { target_user_id: userId, username: user.username }
    });

    res.json({ message: 'User has been permanently deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Middleman Earnings Dashboard
app.get('/middleman/earnings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Total Earnings (Commissions)
    // Assuming commissions are recorded in Transaction with type 'COMMISSION' or 'EARNING' (?)
    // Or we calculate based on completed orders where middleman_id = userId
    // Let's use Orders for now as it's more direct for "Middleman Performance"

    // Find all completed orders by this middleman
    const completedOrders = await Order.findAll({
      where: {
        middleman_id: userId,
        status: 'COMPLETED'
      }
    });

    const totalOrders = await Order.count({
      where: { middleman_id: userId }
    });

    const totalEarnings = completedOrders.reduce((sum, order) => sum + (parseFloat(order.amount) * 0.05), 0);

    // Monthly Earnings
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyOrders = completedOrders.filter(o => new Date(o.updatedAt) >= firstDayOfMonth);
    const monthlyEarnings = monthlyOrders.reduce((sum, order) => sum + (parseFloat(order.amount) * 0.05), 0);

    // Success Rate
    const successRate = totalOrders > 0 ? Math.round((completedOrders.length / totalOrders) * 100) + '%' : '0%';

    // Avg Order Value
    const avgOrderValue = completedOrders.length > 0
      ? (completedOrders.reduce((sum, o) => sum + parseFloat(o.amount), 0) / completedOrders.length).toFixed(2)
      : '0.00';

    // 2. Deposits and Withdrawals
    // Robust data fetching with safe fallbacks
    let totalDepositedRaw = 0;
    let totalWithdrawnRaw = 0;
    let pendingDepositedRaw = 0;
    let pendingWithdrawnRaw = 0;

    try {
      // Helper function to safely get sum
      const safeSum = async (where) => {
        try {
          const result = await TransactionRequest.sum('amount', { where });
          return parseFloat(result || 0); // Handle null/string returns
        } catch (err) {
          console.error(`[Earnings] Error summing for query ${JSON.stringify(where)}:`, err.message);
          return 0;
        }
      };

      // Run in parallel for speed
      [totalDepositedRaw, totalWithdrawnRaw, pendingDepositedRaw, pendingWithdrawnRaw] = await Promise.all([
        safeSum({ user_id: userId, type: 'deposit', status: 'approved' }),
        safeSum({ user_id: userId, type: 'withdrawal', status: 'approved' }),
        safeSum({ user_id: userId, type: 'deposit', status: 'pending' }),
        safeSum({ user_id: userId, type: 'withdrawal', status: 'pending' })
      ]);

      console.log('[Earnings] Fetched stats:', {
        totalDepositedRaw, totalWithdrawnRaw, pendingDepositedRaw, pendingWithdrawnRaw
      });

    } catch (e) {
      console.error('[Earnings] Critical error fetching transaction stats:', e);
    }

    res.json({
      totalEarnings: '$' + (totalEarnings || 0).toFixed(2),
      monthlyEarnings: '$' + (monthlyEarnings || 0).toFixed(2),
      successRate: successRate || '0%',
      avgOrderValue: '$' + (avgOrderValue || '0.00'),
      // Ensure these fields are ALWAYS strings present in the JSON
      totalDeposited: '$' + totalDepositedRaw.toFixed(2),
      totalWithdrawn: '$' + totalWithdrawnRaw.toFixed(2),
      pendingDeposited: '$' + pendingDepositedRaw.toFixed(2),
      pendingWithdrawn: '$' + pendingWithdrawnRaw.toFixed(2)
    });

  } catch (error) {
    console.error('Error fetching earnings:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ TRANSACTION REQUEST ROUTES ============

// Create deposit request (with screenshot upload)
app.post('/transaction-requests/deposit', authenticateToken, uploadLimiter, transactionLimiter, upload.single('screenshot'), validate('transactionRequest'), async (req, res) => {
  try {
    const { amount, notes } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Screenshot is required for deposit requests' });
    }

    const transactionRequest = await TransactionRequest.create({
      user_id: req.user.id,
      type: 'deposit',
      amount: parseFloat(amount),
      screenshot_path: req.file.filename,
      notes: notes || null,
      status: 'pending'
    });

    // Emit WebSocket event to admin
    io.emit('newTransactionRequest', {
      id: transactionRequest.id,
      type: 'deposit',
      user_id: req.user.id,
      username: req.user.username,
      amount: transactionRequest.amount
    });

    res.status(201).json({
      message: 'Deposit request submitted successfully. Waiting for admin approval.',
      request: transactionRequest
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create withdrawal request
app.post('/transaction-requests/withdrawal', authenticateToken, transactionLimiter, validate('transactionRequest'), async (req, res) => {
  try {
    const { amount, notes } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    // Check if user has sufficient balance
    const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });

    if (!wallet || parseFloat(wallet.available_balance) < parseFloat(amount)) {
      return res.status(400).json({ error: 'Insufficient available balance' });
    }

    const transactionRequest = await TransactionRequest.create({
      user_id: req.user.id,
      type: 'withdrawal',
      amount: parseFloat(amount),
      notes: notes || null,
      status: 'pending'
    });

    // Emit WebSocket event to admin
    io.emit('newTransactionRequest', {
      id: transactionRequest.id,
      type: 'withdrawal',
      user_id: req.user.id,
      username: req.user.username,
      amount: transactionRequest.amount
    });

    res.status(201).json({
      message: 'Withdrawal request submitted successfully. Waiting for admin approval.',
      request: transactionRequest
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's own transaction requests
app.get('/transaction-requests/my-requests', authenticateToken, async (req, res) => {
  try {
    const requests = await TransactionRequest.findAll({
      where: { user_id: req.user.id },
      include: [
        { model: User, as: 'reviewer', attributes: ['id', 'username'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all transaction requests (Admin only)
app.get('/admin/transaction-requests', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { status } = req.query;

    const whereClause = status ? { status } : {};

    const requests = await TransactionRequest.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'user', attributes: ['id', 'username', 'role'] },
        { model: User, as: 'reviewer', attributes: ['id', 'username'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve/Reject transaction request (Admin only)
app.post('/admin/transaction-requests/:id/review', authenticateToken, isAdmin, validate('reviewTransaction'), async (req, res) => {
  try {
    const { action, admin_notes } = req.body; // action: 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be either "approve" or "reject"' });
    }

    const transactionRequest = await TransactionRequest.findByPk(req.params.id, {
      include: [{ model: User, as: 'user' }]
    });

    if (!transactionRequest) {
      return res.status(404).json({ error: 'Transaction request not found' });
    }

    if (transactionRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Request has already been reviewed' });
    }

    const transaction = await sequelize.transaction();

    try {
      if (action === 'approve') {
        // Find or create wallet
        let wallet = await Wallet.findOne({
          where: { user_id: transactionRequest.user_id },
          transaction
        });

        if (!wallet) {
          wallet = await Wallet.create({
            user_id: transactionRequest.user_id,
            available_balance: 0,
            locked_balance: 0
          }, { transaction });
        }

        // Store balance before for transaction record
        const balanceBefore = parseFloat(wallet.available_balance);

        if (transactionRequest.type === 'deposit') {
          // Add funds
          wallet.available_balance = balanceBefore + parseFloat(transactionRequest.amount);
        } else {
          // Deduct funds (withdrawal)
          if (balanceBefore < parseFloat(transactionRequest.amount)) {
            throw new Error('Insufficient balance for withdrawal');
          }
          wallet.available_balance = balanceBefore - parseFloat(transactionRequest.amount);
        }

        await wallet.save({ transaction });

        // Record transaction
        await Transaction.create({
          user_id: transactionRequest.user_id,
          type: transactionRequest.type.toUpperCase(),
          amount: transactionRequest.type === 'deposit' ? parseFloat(transactionRequest.amount) : -parseFloat(transactionRequest.amount),
          balance_before: balanceBefore,
          balance_after: wallet.available_balance,
          description: `${transactionRequest.type === 'deposit' ? 'Deposit' : 'Withdrawal'} approved by admin - ${parseFloat(transactionRequest.amount).toFixed(2)}`
        }, { transaction });

        transactionRequest.status = 'approved';

        // Emit WebSocket event for real-time update
        io.emit('walletUpdated', {
          user_id: transactionRequest.user_id,
          available_balance: wallet.available_balance,
          locked_balance: wallet.locked_balance
        });
      } else {
        transactionRequest.status = 'rejected';
      }

      transactionRequest.admin_notes = admin_notes || null;
      transactionRequest.reviewed_by = req.user.id;
      transactionRequest.reviewed_at = new Date();

      await transactionRequest.save({ transaction });
      await transaction.commit();

      // Log activity
      await ActivityLog.create({
        user_id: req.user.id,
        action: `transaction_${action}d`,
        metadata: { request_id: transactionRequest.id, type: transactionRequest.type, amount: transactionRequest.amount, user_id: transactionRequest.user_id }
      });

      // Emit WebSocket event
      io.emit('transactionRequestReviewed', {
        id: transactionRequest.id,
        user_id: transactionRequest.user_id,
        status: transactionRequest.status,
        type: transactionRequest.type,
        amount: transactionRequest.amount
      });

      res.json({
        message: `Transaction request ${action}d successfully`,
        request: transactionRequest
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ M-PESA INTEGRATION ROUTES ============

// Initiate M-Pesa STK Push for deposit
app.post('/api/stkpush', authenticateToken, transactionLimiter, async (req, res) => {
  try {
    const { amount, phoneNumber } = req.body;

    console.log('=== M-PESA STK PUSH DEBUG ===');
    console.log('Request body:', { amount, phoneNumber });
    console.log('BusinessShortCode:', MPESA_CONFIG.businessShortCode);
    console.log('Passkey:', MPESA_CONFIG.passkey);

    // Get M-Pesa access token
    const accessToken = await getMpesaAccessToken();
    console.log('Access token obtained:', accessToken ? 'YES' : 'NO');

    // Generate password and timestamp (create once and reuse)
    const { password, timestamp } = generateMpesaPassword();
    console.log('Generated timestamp:', timestamp);
    console.log('Generated password:', password);

    // Hardcode test phone number as requested
    const testPhoneNumber = '254708374149';

    // Prepare STK Push request
    const stkPushData = {
      BusinessShortCode: MPESA_CONFIG.businessShortCode, // 174379
      Password: password,
      Timestamp: timestamp, // Reuse the same timestamp
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: testPhoneNumber, // Hardcoded for testing
      PartyB: MPESA_CONFIG.businessShortCode, // 174379
      PhoneNumber: testPhoneNumber, // Hardcoded for testing
      CallBackURL: MPESA_CONFIG.callbackUrl,
      AccountReference: 'SecureEscrow Deposit',
      TransactionDesc: 'Deposit to SecureEscrow'
    };

    console.log('STK Push data:', JSON.stringify(stkPushData, null, 2));

    // Make STK Push request to M-Pesa
    const stkResponse = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(stkPushData)
    });

    console.log('M-Pesa response status:', stkResponse.status);
    console.log('M-Pesa response headers:', Object.fromEntries(stkResponse.headers.entries()));

    const responseText = await stkResponse.text();
    console.log('M-Pesa response body:', responseText);

    let stkResult;
    try {
      stkResult = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse M-Pesa response as JSON:', parseError);
      throw new Error('Invalid JSON response from M-Pesa: ' + responseText);
    }

    console.log('Parsed STK result:', stkResult);
    res.json(stkResult);

  } catch (error) {
    console.error('=== M-PESA STK PUSH ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    // Enhanced error logging as requested
    if (error.response) {
      console.error('M-Pesa Error Details:', error.response.data);
    } else {
      console.error('M-Pesa Error Details:', error.message);
    }

    res.status(500).json({
      error: 'Failed to initiate M-Pesa payment',
      details: error.message,
      stack: error.stack
    });
  }
});

// M-Pesa Callback endpoint (no authentication required)
app.post('/api/callback', async (req, res) => {
  try {
    const callbackData = req.body;
    console.log('M-Pesa Callback received:', JSON.stringify(callbackData, null, 2));

    // Always respond with success to acknowledge receipt
    res.json({ ResultCode: 0, ResultDesc: 'Callback received successfully' });

  } catch (error) {
    console.error('M-Pesa callback processing error:', error);
    res.status(500).json({ error: 'Callback processing failed' });
  }
});

// Dispute order (slashing, protected)
app.post('/orders/:id/dispute', authenticateToken, async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // If not admin, check if user is the buyer for this order
    if (req.user.role !== 'admin' && order.buyer_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: Only the order creator or admin can dispute orders' });
    }

    const result = await disputeOrder(req.params.id);

    // Get updated wallet for real-time update
    const updatedWallet = await Wallet.findOne({ where: { user_id: order.middleman_id } });

    // Emit WebSocket event for wallet update
    io.emit('walletUpdated', {
      user_id: order.middleman_id,
      available_balance: updatedWallet.available_balance,
      locked_balance: updatedWallet.locked_balance
    });

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'order_disputed',
      metadata: { order_id: req.params.id }
    });

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Cancel order (Admin only - can cancel any order)
app.post('/orders/:id/cancel', authenticateToken, isAdmin, async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot cancel completed orders' });
    }

    const transaction = await sequelize.transaction();

    try {
      // Store original status for WebSocket update check later
      const originalStatus = order.status;
      const hadMiddleman = order.middleman_id;

      // If order was claimed or ready for release, return collateral to middleman
      if ((order.status === 'CLAIMED' || order.status === 'READY_FOR_RELEASE') && order.middleman_id) {
        const middlemanWallet = await Wallet.findOne({
          where: { user_id: order.middleman_id },
          transaction
        });

        if (middlemanWallet) {
          const middlemanBalanceBefore = parseFloat(middlemanWallet.available_balance);
          middlemanWallet.available_balance = parseFloat(middlemanWallet.available_balance) + parseFloat(order.amount);
          middlemanWallet.locked_balance = parseFloat(middlemanWallet.locked_balance) - parseFloat(order.amount);
          await middlemanWallet.save({ transaction });

          // Record transaction for middleman
          await Transaction.create({
            user_id: order.middleman_id,
            order_id: req.params.id,
            type: 'ORDER_CANCELLED',
            amount: parseFloat(order.amount),
            balance_before: middlemanBalanceBefore,
            balance_after: middlemanWallet.available_balance,
            description: `Order #${req.params.id} cancelled - collateral ${order.amount.toFixed(2)} returned`
          }, { transaction });
        }
      }

      // Return funds to buyer
      const buyerWallet = await Wallet.findOne({
        where: { user_id: order.buyer_id },
        transaction
      });

      if (buyerWallet) {
        const buyerBalanceBefore = parseFloat(buyerWallet.available_balance);
        buyerWallet.available_balance = parseFloat(buyerWallet.available_balance) + parseFloat(order.amount);
        buyerWallet.locked_balance = parseFloat(buyerWallet.locked_balance) - parseFloat(order.amount);
        await buyerWallet.save({ transaction });

        // Record transaction for buyer
        await Transaction.create({
          user_id: order.buyer_id,
          order_id: req.params.id,
          type: 'ORDER_CANCELLED',
          amount: parseFloat(order.amount),
          balance_before: buyerBalanceBefore,
          balance_after: buyerWallet.available_balance,
          description: `Order #${req.params.id} cancelled - funds ${order.amount.toFixed(2)} refunded`
        }, { transaction });
      }

      order.status = 'CANCELLED';
      await order.save({ transaction });

      await transaction.commit();

      // Emit WebSocket updates
      if (buyerWallet) {
        io.emit('walletUpdated', {
          user_id: order.buyer_id,
          available_balance: buyerWallet.available_balance,
          locked_balance: buyerWallet.locked_balance
        });
      }

      // Emit WebSocket update for middleman if order was claimed/ready
      if ((originalStatus === 'CLAIMED' || originalStatus === 'READY_FOR_RELEASE') && hadMiddleman) {
        const updatedWallet = await Wallet.findOne({ where: { user_id: hadMiddleman } });
        if (updatedWallet) {
          io.emit('walletUpdated', {
            user_id: hadMiddleman,
            available_balance: updatedWallet.available_balance,
            locked_balance: updatedWallet.locked_balance
          });
        }
      }

      // Log activity
      await ActivityLog.create({
        user_id: req.user.id,
        action: 'order_cancelled',
        metadata: { order_id: req.params.id, amount: order.amount }
      });

      // Emit WebSocket event
      io.emit('orderCancelled', order);

      res.json({
        message: 'Order cancelled successfully',
        order
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Bulk Create Orders (Admin Only)
app.post('/orders/bulk', authenticateToken, isAdmin, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { orders } = req.body; // Expecting array of { amount, description }

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'Invalid orders data' });
    }

    // Limit bulk size
    if (orders.length > 50) {
      return res.status(400).json({ error: 'Bulk limit exceeded (max 50)' });
    }

    const createdOrders = [];

    for (const orderData of orders) {
      const order = await Order.create({
        amount: orderData.amount,
        status: 'PENDING',
        buyer_id: req.user.id,
        description: orderData.description || 'Bulk Order'
      }, { transaction });
      createdOrders.push(order);
    }

    await transaction.commit();

    // Log Activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'bulk_orders_created',
      metadata: { count: createdOrders.length, total_amount: orders.reduce((s, o) => s + parseFloat(o.amount), 0) }
    });

    // Notify clients 
    createdOrders.forEach(order => io.emit('orderCreated', order));

    res.status(201).json({
      message: `Successfully created ${createdOrders.length} orders`,
      orders: createdOrders
    });

  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ error: error.message });
  }
});

// Duplicate M-Pesa routes removed (using the detailed implementation above)

// 404 handler - must be after all routes
app.use(notFoundHandler);

// Error handler - must be last
app.use(errorHandler);

// Export app for monorepo integration
// When used standalone, start the server
if (require.main === module) {
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`WebSocket server is ready`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      logger.info('HTTP server closed');
      sequelize.close();
      process.exit(0);
    });
  });
}

// Export for monorepo
module.exports = app;
module.exports.io = io;
module.exports.server = server;
module.exports.setupSocket = setupSocket;