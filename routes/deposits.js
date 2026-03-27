const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { initializePayment, verifyTransaction } = require('../utils/flutterwave');
const Wallet = require('../models/wallet');
const Transaction = require('../models/transaction');
const TransactionRequest = require('../models/transactionRequest');
const sequelize = require('../db');
const logger = require('../utils/logger');

// Initiate Card Deposit
router.post('/card-initiate', authenticateToken, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });

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
                const amount = verification.data.amount;

                const transaction = await sequelize.transaction();
                try {
                    // Update Wallet
                    let wallet = await Wallet.findOne({ where: { user_id: userId }, transaction });
                    if (!wallet) {
                        wallet = await Wallet.create({ user_id: userId, available_balance: 0, locked_balance: 0 }, { transaction });
                    }

                    const balanceBefore = parseFloat(wallet.available_balance);
                    wallet.available_balance = balanceBefore + amount;
                    await wallet.save({ transaction });

                    // Record Transaction
                    await Transaction.create({
                        user_id: userId,
                        type: 'DEPOSIT',
                        amount: amount,
                        balance_before: balanceBefore,
                        balance_after: wallet.available_balance,
                        description: `Card Deposit (FLW: ${transaction_id})`
                    }, { transaction });

                    // Update Request
                    const request = await TransactionRequest.findOne({ where: { metadata: { tx_ref } }, transaction });
                    if (request) {
                        request.status = 'approved';
                        request.admin_notes = 'Auto-approved via Flutterwave Callback';
                        await request.save({ transaction });
                    }

                    await transaction.commit();
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

module.exports = router;
