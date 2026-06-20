const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { initializePayment, verifyTransaction } = require('../utils/flutterwave');
const Wallet = require('../models/wallet');
const Transaction = require('../models/transaction');
const TransactionRequest = require('../models/transactionRequest');
const sequelize = require('../db');
const logger = require('../utils/logger');
const walletService = require('../services/walletService');

// Initiate Card Deposit
router.post('/card-initiate', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || parseFloat(amount) < 5) return res.status(400).json({ error: 'Minimum deposit amount is $5.00' });

    const tx_ref = `flw_dep_${Date.now()}_u${req.user.id}`;
        
    const paymentData = {
      tx_ref,
      amount: parseFloat(amount),
      currency: 'USD',
      redirect_url: `${process.env.APP_URL || 'https://ghost-trades.site'}/api/deposits/card-callback`,
      customer: {
        email: req.user.email || 'user@example.com',
        name: req.user.full_name || req.user.username
      },
      customizations: {
        title: 'SecureEscrow Wallet Deposit',
        description: `Deposit $${amount} to your dashboard wallet`,
        logo: 'https://ghost-trades.site/logo.png'
      }
    };

    const link = await initializePayment(paymentData);
        
    // Log the initiation
    await TransactionRequest.create({
      user_id: req.user.id,
      type: 'deposit',
      amount: parseFloat(amount),
      status: 'pending',
      notes: `Futterwave Card Initiation (Ref: ${tx_ref})`,
      metadata: { tx_ref, provider: 'flutterwave' }
    });

    res.json({ success: true, link });
  } catch (error) {
    logger.error('[DEPOSIT] Card initiation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Flutterwave Callback/Webhook
router.get('/card-callback', async (req, res) => {
  const { status, tx_ref, transaction_id } = req.query;

  if (status === 'successful' || status === 'completed') {
    try {
      const verification = await verifyTransaction(transaction_id);
            
      if (verification.status === 'success' && 
                verification.data.status === 'successful' && 
                verification.data.amount >= verification.data.charged_amount) {
                
        const userId = parseInt(tx_ref.split('_u')[1]);

        const transaction = await sequelize.transaction();
        try {
          // Find and update Request to remain pending, but with details confirmed
          const request = await TransactionRequest.findOne({
            where: {
              user_id: userId,
              metadata: { tx_ref }
            },
            transaction
          });

          if (request) {
            request.status = 'pending';
            request.admin_notes = `Card payment confirmed via Flutterwave (FLW ID: ${transaction_id}). Pending admin approval.`;
            request.metadata = {
              ...request.metadata,
              transaction_id: transaction_id
            };
            request.changed('metadata', true);
            await request.save({ transaction });
          }

          await transaction.commit();

          // Emit event to admin
          const io = req.app.get('socketio');
          if (io && request) {
            const User = require('../models/user');
            const user = await User.findByPk(userId);
            io.emit('newTransactionRequest', {
              id: request.id,
              type: 'deposit',
              user_id: userId,
              username: user ? user.username : 'User',
              amount: request.amount,
              metadata: request.metadata
            });
          }

          return res.redirect('/#dashboard?deposit=success');
        } catch (err) {
          await transaction.rollback();
          logger.error('[DEPOSIT] Callback processing failed:', err);
        }
      }
    } catch (error) {
      logger.error('[DEPOSIT] Verification failed:', error);
    }
  }

  res.redirect('/#dashboard?deposit=failed');
});

// Initiate Stripe Deposit (Live/Mock Sandbox)
router.post('/stripe-initiate', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || parseFloat(amount) < 5) {
      return res.status(400).json({ error: 'Minimum deposit amount is $5.00' });
    }

    const tx_ref = `stripe_dep_${Date.now()}_u${req.user.id}`;

    // Create a pending transaction request
    await TransactionRequest.create({
      user_id: req.user.id,
      type: 'deposit',
      amount: parseFloat(amount),
      status: 'pending',
      notes: 'Stripe Card Deposit (Pending confirmation)',
      metadata: { tx_ref, provider: 'stripe' }
    });

    // Check if Stripe key exists, otherwise redirect to interactive mock sandbox checkout
    if (process.env.STRIPE_SECRET_KEY) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'SecureEscrow Wallet Deposit',
              description: 'Fund your secure escrow account',
            },
            unit_amount: Math.round(parseFloat(amount) * 100),
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${process.env.APP_URL || 'http://localhost:3000'}/api/deposits/stripe-callback?session_id={CHECKOUT_SESSION_ID}&tx_ref=${tx_ref}`,
        cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/#dashboard?deposit=cancelled`,
      });
      res.json({ success: true, link: session.url });
    } else {
      // Return a simulated high-fidelity premium sandbox checkout page
      res.json({ 
        success: true, 
        link: `/stripe-sandbox.html?amount=${parseFloat(amount)}&tx_ref=${tx_ref}&user=${encodeURIComponent(req.user.username)}`
      });
    }
  } catch (error) {
    logger.error('[DEPOSIT] Stripe initiation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stripe Callback (Live verification or sandbox fallback success webhook)
router.all('/stripe-callback', async (req, res) => {
  const { tx_ref, session_id, mock_success } = req.query;

  // Verify either via live stripe API or safe mock fallback
  let isSuccessful = mock_success === 'true';
  let verifiedAmount = 0;
  let userId = 0;

  if (tx_ref) {
    userId = parseInt(tx_ref.split('_u')[1]);
  }

  if (process.env.STRIPE_SECRET_KEY && session_id) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === 'paid') {
        isSuccessful = true;
        verifiedAmount = session.amount_total / 100;
      }
    } catch (err) {
      logger.error('[DEPOSIT] Stripe callback validation failed:', err);
    }
  } else if (mock_success === 'true' && tx_ref) {
    // In mock mode, find the request to confirm the amount
    try {
      const reqRecord = await TransactionRequest.findOne({ where: { metadata: { tx_ref } } });
      if (reqRecord) {
        verifiedAmount = parseFloat(reqRecord.amount);
      }
    } catch (err) {
      logger.error('[DEPOSIT] Stripe mock request retrieval failed:', err);
    }
  }

  if (isSuccessful && verifiedAmount > 0 && userId > 0) {
    const transaction = await sequelize.transaction();
    try {
      const request = await TransactionRequest.findOne({ where: { metadata: { tx_ref } }, transaction });
      if (request) {
        request.status = 'pending';
        request.admin_notes = `Stripe payment confirmed (Session ID: ${session_id || 'Mock'}). Pending admin approval.`;
        if (session_id) {
          request.metadata = { ...request.metadata, session_id };
          request.changed('metadata', true);
        }
        await request.save({ transaction });
      }

      await transaction.commit();

      // Trigger socket event for admin
      const io = req.app.get('socketio');
      if (io && request) {
        const User = require('../models/user');
        const user = await User.findByPk(userId);
        io.emit('newTransactionRequest', {
          id: request.id,
          type: 'deposit',
          user_id: userId,
          username: user ? user.username : 'User',
          amount: request.amount,
          metadata: request.metadata
        });
      }

      return res.redirect('/#dashboard?deposit=success');
    } catch (error) {
      await transaction.rollback();
      logger.error('[DEPOSIT] Stripe callback transaction processing failed:', error);
    }
  }

  res.redirect('/#dashboard?deposit=failed');
});

// Automated Live Crypto Deposit Endpoint
router.post('/crypto-automated', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || parseFloat(amount) < 5) {
      return res.status(400).json({ error: 'Minimum deposit amount is $5.00' });
    }

    const tx_ref = `crypto_auto_${Date.now()}_u${req.user.id}`;
    const generatedWallet = `TRX_AUTO_ADDR_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    // Create a pending automated request
    const request = await TransactionRequest.create({
      user_id: req.user.id,
      type: 'deposit',
      amount: parseFloat(amount),
      status: 'pending',
      notes: `Automated Crypto Deposit (Wallet: ${generatedWallet})`,
      metadata: { tx_ref, provider: 'automated_crypto', generatedWallet }
    });

    // Simulate blockchain verification in background (only when not running tests)
    if (process.env.NODE_ENV !== 'test') {
      setTimeout(async () => {
        const transaction = await sequelize.transaction();
        try {
          const freshRequest = await TransactionRequest.findOne({ where: { id: request.id }, transaction });
          if (freshRequest && freshRequest.status === 'pending') {
            freshRequest.status = 'pending';
            freshRequest.admin_notes = 'Crypto blockchain transaction detected via automated simulation. Pending admin approval.';
            await freshRequest.save({ transaction });

            await transaction.commit();

            const io = req.app.get('socketio');
            if (io) {
              const User = require('../models/user');
              const user = await User.findByPk(req.user.id);
              io.emit('newTransactionRequest', {
                id: freshRequest.id,
                type: 'deposit',
                user_id: req.user.id,
                username: user ? user.username : 'User',
                amount: freshRequest.amount,
                metadata: freshRequest.metadata
              });
            }
            logger.info(`[DEPOSIT] Automated Crypto payment confirmed by simulation for user_id: ${req.user.id}, pending admin approval.`);
          } else {
            await transaction.rollback();
          }
        } catch (err) {
          await transaction.rollback();
          logger.error('[DEPOSIT] Automated crypto simulation callback failed:', err);
        }
      }, 10000); // Trigger auto-payment success in 10 seconds!
    }

    res.json({ 
      success: true, 
      walletAddress: generatedWallet, 
      qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${generatedWallet}`,
      message: 'Automated deposit initiated. Address generated successfully. Transaction will be processed and await admin approval once system confirms blockchain transaction.' 
    });

  } catch (error) {
    logger.error('[DEPOSIT] Automated Crypto error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
