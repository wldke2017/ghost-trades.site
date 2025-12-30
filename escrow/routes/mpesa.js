const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { authenticateToken } = require('../middleware/auth');
const transactionLimiter = require('../middleware/rateLimiter').transactionLimiter;
const ActivityLog = require('../models/activityLog');
const TransactionRequest = require('../models/transactionRequest');
const Transaction = require('../models/transaction');
const { Op } = require('sequelize');
const Wallet = require('../models/wallet');
const sequelize = require('../db');

// M-Pesa Configuration
const MPESA_CONFIG = {
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    businessShortCode: process.env.MPESA_BUSINESS_SHORTCODE,
    passkey: process.env.MPESA_PASSKEY,
    callbackUrl: process.env.MPESA_CALLBACK_URL
};

// Fixed Exchange Rate (KES to USD)
const KES_TO_USD_RATE = 129;

// Helper Functions
async function getMpesaAccessToken() {
    // SECURITY: Do not log the full auth header in production
    const auth = Buffer.from(MPESA_CONFIG.consumerKey + ':' + MPESA_CONFIG.consumerSecret).toString('base64');

    try {
        const response = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            method: 'GET',
            headers: {
                'Authorization': 'Basic ' + auth,
                'Content-Type': 'application/json'
            }
        });

        const body = await response.json();
        if (!response.ok) {
            throw new Error(body.errorMessage || 'Failed to get access token');
        }
        return body.access_token;
    } catch (error) {
        console.error('Error getting M-Pesa access token:', error.message);
        throw error;
    }
}

function generateMpesaPassword() {
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

// Initiate STK Push
router.post('/stkpush', authenticateToken, transactionLimiter, async (req, res) => {
    try {
        const { amount, phoneNumber } = req.body;

        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Amount must be greater than 0' });
        }

        if (!phoneNumber || !/^254[0-9]{9}$/.test(phoneNumber)) {
            return res.status(400).json({ error: 'Invalid phone number format. Use 254XXXXXXXXX' });
        }

        const accessToken = await getMpesaAccessToken();
        const { password, timestamp } = generateMpesaPassword();

        const stkPushData = {
            BusinessShortCode: MPESA_CONFIG.businessShortCode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: Math.round(parseFloat(amount)),
            PartyA: phoneNumber,
            PartyB: MPESA_CONFIG.businessShortCode,
            PhoneNumber: phoneNumber,
            CallBackURL: MPESA_CONFIG.callbackUrl,
            AccountReference: `User${req.user.id}`,
            TransactionDesc: 'Wallet Deposit'
        };

        console.log('Initiating STK Push:', {
            amount: stkPushData.Amount,
            phone: phoneNumber
        });

        const response = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(stkPushData)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('M-Pesa STK Push error:', data);
            return res.status(response.status).json({
                error: 'M-Pesa payment initiation failed',
                details: data
            });
        }

        // Log activity
        if (data.CheckoutRequestID) {
            await ActivityLog.create({
                user_id: req.user.id,
                action: 'mpesa_stk_initiated',
                metadata: {
                    CheckoutRequestID: data.CheckoutRequestID,
                    amount: parseFloat(amount),
                    phoneNumber: phoneNumber,
                    merchantRequestId: data.MerchantRequestID
                }
            });
        }

        res.json({
            success: true,
            message: 'M-Pesa prompt sent to your phone. Please enter your PIN.',
            checkoutRequestId: data.CheckoutRequestID
        });

    } catch (error) {
        console.error('STK Push error:', error);
        res.status(500).json({ error: 'Failed to initiate M-Pesa payment: ' + error.message });
    }
});

// M-Pesa Callback
router.post('/callback', async (req, res) => {
    try {
        const callbackData = req.body;
        console.log('M-Pesa Callback received:', JSON.stringify(callbackData, null, 2));

        const { Body } = callbackData;
        if (!Body || !Body.stkCallback) {
            return res.status(400).json({ error: 'Invalid callback data' });
        }

        const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = Body.stkCallback;
        const io = req.app.get('socketio');

        // Find the log
        const initialLog = await ActivityLog.findOne({
            where: {
                action: 'mpesa_stk_initiated',
                metadata: { CheckoutRequestID: CheckoutRequestID }
            },
            order: [['createdAt', 'DESC']]
        });

        if (!initialLog) {
            console.error(`[M-Pesa Callback] No matching request found for CheckoutRequestID: ${CheckoutRequestID}`);
            return res.json({ ResultCode: 0, ResultDesc: 'Acknowledgement (No Match)' });
        }

        const userId = initialLog.user_id;

        if (ResultCode === 0) {
            // Success
            console.log(`[M-Pesa Callback] Payment SUCCESS for user ${userId}`);

            const amountItem = CallbackMetadata.Item.find(item => item.Name === 'Amount');
            const receiptItem = CallbackMetadata.Item.find(item => item.Name === 'MpesaReceiptNumber');
            const kesAmount = amountItem ? amountItem.Value : 0;
            const mpesaReceipt = receiptItem ? receiptItem.Value : 'N/A';
            const usdAmount = parseFloat((kesAmount / KES_TO_USD_RATE).toFixed(2));

            const transaction = await sequelize.transaction();
            try {
                let wallet = await Wallet.findOne({ where: { user_id: userId }, transaction });
                if (!wallet) {
                    wallet = await Wallet.create({ user_id: userId, available_balance: 0, locked_balance: 0 }, { transaction });
                }

                const balanceBefore = parseFloat(wallet.available_balance);
                wallet.available_balance = balanceBefore + usdAmount;
                await wallet.save({ transaction });

                // Record Transaction
                await Transaction.create({
                    user_id: userId,
                    type: 'DEPOSIT',
                    amount: usdAmount,
                    balance_before: balanceBefore,
                    balance_after: wallet.available_balance,
                    description: `M-Pesa Deposit (${mpesaReceipt}) - KES ${kesAmount}`
                }, { transaction });

                // Create TransactionRequest for history
                await TransactionRequest.create({
                    user_id: userId,
                    type: 'deposit',
                    amount: usdAmount,
                    status: 'approved',
                    notes: `M-Pesa Payment: ${mpesaReceipt}`,
                    admin_notes: 'Auto-approved via M-Pesa Callback',
                    reviewed_at: new Date(),
                    metadata: { mpesa_receipt: mpesaReceipt, kes_amount: kesAmount, checkout_id: CheckoutRequestID }
                }, { transaction });

                // Update Log
                initialLog.action = 'mpesa_payment_success';
                initialLog.metadata = { ...initialLog.metadata, mpesaReceipt, kesAmount, usdAmount };
                await initialLog.save({ transaction });

                await transaction.commit();

                // WebSocket Notification
                if (io) {
                    io.to(`user_${userId}`).emit('walletUpdated', {
                        available_balance: wallet.available_balance,
                        locked_balance: wallet.locked_balance,
                        message: `Your deposit of $${usdAmount} (KES ${kesAmount}) via M-Pesa was successful!`
                    });
                }
            } catch (err) {
                await transaction.rollback();
                console.error('[M-Pesa Callback] Transaction failed:', err);
            }
        } else {
            // Failure
            console.log(`[M-Pesa Callback] Payment FAILED for user ${userId}: ${ResultDesc}`);

            initialLog.action = 'mpesa_payment_failed';
            initialLog.metadata = { ...initialLog.metadata, resultDesc: ResultDesc, resultCode: ResultCode };
            await initialLog.save();

            if (io) {
                io.to(`user_${userId}`).emit('paymentFailed', {
                    message: `M-Pesa payment failed: ${ResultDesc}`,
                    details: ResultDesc
                });
            }
        }

        res.json({ ResultCode: 0, ResultDesc: 'Callback processed' });

    } catch (error) {
        console.error('M-Pesa callback processing error:', error);
        res.status(500).json({ error: 'Callback processing failed' });
    }
});

module.exports = router;
