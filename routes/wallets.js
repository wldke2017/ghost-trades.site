const express = require('express');
const router = express.Router();
const Wallet = require('../models/wallet');
const Transaction = require('../models/transaction');
const Order = require('../models/order');
const { authenticateToken } = require('../middleware/auth');

// Get current user's wallet
router.get('/me', authenticateToken, async (req, res) => {
    try {
        let wallet = await Wallet.findOne({ where: { user_id: req.user.id } });

        if (!wallet) {
            wallet = await Wallet.create({
                user_id: req.user.id,
                available_balance: 0,
                locked_balance: 0
            });
        }

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

// Get personal stats (Total deposited, total withdrawn, etc)
router.get('/stats/personal', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const totalDeposited = await Transaction.sum('amount', {
            where: { user_id: userId, type: 'DEPOSIT' }
        });

        const totalWithdrawn = await Transaction.sum('amount', {
            where: { user_id: userId, type: 'WITHDRAWAL' }
        });

        const ordersDone = await Order.count({
            where: { middleman_id: userId, status: 'COMPLETED' }
        });

        // Calculate real commission earned (Assuming 5% of completed orders)
        const completedOrders = await Order.findAll({
            where: { middleman_id: userId, status: 'COMPLETED' }
        });
        const totalEarned = completedOrders.reduce((sum, order) => sum + (parseFloat(order.amount) * 0.05), 0);

        res.json({
            totalDeposited: Math.abs(parseFloat(totalDeposited || 0)).toFixed(2),
            totalWithdrawn: Math.abs(parseFloat(totalWithdrawn || 0)).toFixed(2),
            ordersDone,
            totalEarned: totalEarned.toFixed(2)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get wallet by user_id (protected)
router.get('/:user_id', authenticateToken, async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ where: { user_id: req.params.user_id } });
        if (!wallet) {
            return res.status(404).json({ error: 'Wallet not found' });
        }

        res.json({
            id: wallet.id,
            user_id: wallet.user_id,
            available_balance: parseFloat(wallet.available_balance || 0).toFixed(2),
            locked_balance: parseFloat(wallet.locked_balance || 0).toFixed(2),
            createdAt: wallet.createdAt,
            updatedAt: wallet.updatedAt
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get transaction history
router.get('/history/all', authenticateToken, async (req, res) => {
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
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
