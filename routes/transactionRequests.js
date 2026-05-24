const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const { uploadLimiter, transactionLimiter } = require('../middleware/rateLimiter');
const TransactionRequest = require('../models/transactionRequest');
const Wallet = require('../models/wallet');
const Transaction = require('../models/transaction');
const User = require('../models/user');
const ActivityLog = require('../models/activityLog');
const sequelize = require('../db');
const { MPESA } = require('../config/constants');
const EXCHANGE_RATE = MPESA.EXCHANGE_RATE;

// Multer config for screenshots
const uploadsDir = path.join(__dirname, '../uploads');
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only image files are allowed!'));
  }
});

// Create deposit request
router.post('/deposit', authenticateToken, uploadLimiter, transactionLimiter, upload.single('screenshot'), validate('transactionRequest'), async (req, res) => {
  try {
    const { amount, notes } = req.body;
    let { metadata } = req.body;

    if (!req.file && !notes) {
      return res.status(400).json({ error: 'Screenshot or M-Pesa message is required for deposit requests' });
    }


    if (metadata && typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        console.error('Error parsing deposit metadata:', e);
      }
    }

    const minDeposit = (metadata && metadata.currency === 'KES') ? (5 * EXCHANGE_RATE) : 5;
    if (parseFloat(amount) < minDeposit) {
      const formattedLimit = (metadata && metadata.currency === 'KES') ? `${minDeposit} KES` : `$${minDeposit.toFixed(2)}`;
      return res.status(400).json({ error: `Minimum deposit amount is ${formattedLimit}` });
    }

    const transactionRequest = await TransactionRequest.create({
      user_id: req.user.id,
      type: 'deposit',
      amount: parseFloat(amount),
      screenshot_path: req.file ? req.file.filename : null,

      notes: notes || null,
      status: 'pending',
      metadata: metadata || null
    });

    const io = req.app.get('socketio');
    if (io) {
      io.emit('newTransactionRequest', {
        id: transactionRequest.id,
        type: 'deposit',
        user_id: req.user.id,
        username: req.user.username,
        amount: transactionRequest.amount,
        metadata: transactionRequest.metadata
      });
    }

    res.status(201).json({
      message: 'Deposit request submitted successfully. Waiting for admin approval.',
      request: transactionRequest
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create withdrawal request
router.post('/withdrawal', authenticateToken, transactionLimiter, validate('transactionRequest'), async (req, res) => {
  try {
    const { amount, notes, method } = req.body;
    let requestMetadata = {};

    if (parseFloat(amount) < 7) {
      return res.status(400).json({ error: 'Minimum withdrawal amount is $7.00' });
    }

    // Dynamic validations depending on method
    if (method === 'bank_transfer') {
      const { bank_name, account_name, account_number, swift_code } = req.body;
      if (!bank_name || !account_name || !account_number) {
        return res.status(400).json({ error: 'Bank Name, Account Name, and Account/IBAN number are required' });
      }
      requestMetadata = { 
        method: 'bank_transfer', 
        bank_name: bank_name.trim(), 
        account_name: account_name.trim(), 
        account_number: account_number.trim(), 
        swift_code: swift_code ? swift_code.trim() : '' 
      };
    } else if (method === 'crypto') {
      const { crypto_address, crypto_network } = req.body;
      if (!crypto_address || !crypto_network) {
        return res.status(400).json({ error: 'Crypto wallet address and network are required' });
      }
      requestMetadata = { 
        method: 'crypto', 
        crypto_address: crypto_address.trim(), 
        crypto_network: crypto_network.trim() 
      };
    } else if (method === 'paypal') {
      const { paypal_email } = req.body;
      if (!paypal_email || !paypal_email.includes('@')) {
        return res.status(400).json({ error: 'Valid PayPal email is required' });
      }
      requestMetadata = { 
        method: 'paypal', 
        paypal_email: paypal_email.trim() 
      };
    } else {
      // Default to mobile money (backward compatible)
      let { phone } = req.body;
      if (phone) phone = phone.trim();
      if (!phone || phone.length < 7 || phone.length > 20) {
        return res.status(400).json({ error: 'Valid phone number is required' });
      }
      requestMetadata = { method: 'mobile_money', phone };
    }

    const user = await User.findByPk(req.user.id);
    if (!user || (!user.is_verified && user.role !== 'admin')) {
      return res.status(403).json({ 
        error: 'Verification Required', 
        message: 'Please verify your email address in settings to enable withdrawals.',
        requires_verification: true 
      });
    }

    const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });

    if (!wallet || parseFloat(wallet.available_balance) < parseFloat(amount)) {
      return res.status(400).json({ error: 'Insufficient available balance' });
    }

    const transactionRequest = await TransactionRequest.create({
      user_id: req.user.id,
      type: 'withdrawal',
      amount: parseFloat(amount),
      notes: notes || null,
      metadata: requestMetadata,
      status: 'pending'
    });

    const io = req.app.get('socketio');
    if (io) {
      io.emit('newTransactionRequest', {
        id: transactionRequest.id,
        type: 'withdrawal',
        user_id: req.user.id,
        username: req.user.username,
        amount: transactionRequest.amount,
        metadata: transactionRequest.metadata
      });
    }

    res.status(201).json({
      message: 'Withdrawal request submitted successfully. Waiting for admin approval.',
      request: transactionRequest
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get my requests
router.get('/my-requests', authenticateToken, async (req, res) => {
  try {
    const requests = await TransactionRequest.findAll({
      where: { user_id: req.user.id },
      include: [{ model: User, as: 'reviewer', attributes: ['id', 'username'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADMIN: Review request
router.post('/:id/review', authenticateToken, isAdmin, validate('reviewTransaction'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { action, admin_notes } = req.body;
    const transactionRequest = await TransactionRequest.findByPk(req.params.id);

    if (!transactionRequest || transactionRequest.status !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Request not found or already reviewed' });
    }

    if (action === 'approve') {
      let wallet = await Wallet.findOne({ where: { user_id: transactionRequest.user_id }, transaction });
      if (!wallet) {
        wallet = await Wallet.create({ user_id: transactionRequest.user_id, available_balance: 0, locked_balance: 0 }, { transaction });
      }

      const balanceBefore = parseFloat(wallet.available_balance);
      let creditAmount = parseFloat(transactionRequest.amount);

      // Handle currency conversion if metadata indicates KES
      if (transactionRequest.type === 'deposit' &&
                transactionRequest.metadata &&
                transactionRequest.metadata.currency === 'KES') {

        const kesAmount = creditAmount;
        creditAmount = parseFloat((kesAmount / EXCHANGE_RATE).toFixed(2));

        // Update metadata with conversion details
        transactionRequest.metadata = {
          ...transactionRequest.metadata,
          original_amount: kesAmount,
          original_currency: 'KES',
          exchange_rate: EXCHANGE_RATE,
          converted_to_usd: creditAmount
        };
        transactionRequest.changed('metadata', true);
      }

      if (transactionRequest.type === 'deposit') {
        wallet.available_balance = balanceBefore + creditAmount;
      } else {
        if (balanceBefore < creditAmount) {
          throw new Error('Insufficient balance for withdrawal');
        }
        wallet.available_balance = balanceBefore - creditAmount;
      }

      await wallet.save({ transaction });

      await Transaction.create({
        user_id: transactionRequest.user_id,
        type: transactionRequest.type.toUpperCase(),
        amount: transactionRequest.type === 'deposit' ? creditAmount : -creditAmount,
        balance_before: balanceBefore,
        balance_after: wallet.available_balance,
        description: `${transactionRequest.type === 'deposit' ? 'Deposit' : 'Withdrawal'} approved by admin`
      }, { transaction });

      if (transactionRequest.type === 'deposit') {
        const walletService = require('../services/walletService');
        await walletService.checkAndApplyWelcomeBonus(transactionRequest.user_id, creditAmount, transaction);
      }

      await wallet.reload({ transaction });

      transactionRequest.status = 'approved';

      const io = req.app.get('socketio');
      if (io) {
        io.emit('walletUpdated', {
          user_id: transactionRequest.user_id,
          available_balance: wallet.available_balance,
          locked_balance: wallet.locked_balance
        });
      }
    } else {
      transactionRequest.status = 'rejected';
    }

    transactionRequest.admin_notes = admin_notes || null;
    transactionRequest.reviewed_by = req.user.id;
    transactionRequest.reviewed_at = new Date();

    await transactionRequest.save({ transaction });
    await transaction.commit();

    await ActivityLog.create({
      user_id: req.user.id,
      action: `transaction_${action}d`,
      metadata: { request_id: transactionRequest.id, amount: transactionRequest.amount, target_user: transactionRequest.user_id }
    });

    res.json({ message: `Transaction request ${action}d successfully`, request: transactionRequest });
  } catch (error) {
    if (transaction) await transaction.rollback();
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
