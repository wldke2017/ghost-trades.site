const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Wallet = require('../models/wallet');
const Order = require('../models/order');
const Transaction = require('../models/transaction');
const TransactionRequest = require('../models/transactionRequest');
const ActivityLog = require('../models/activityLog');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const { Op } = require('sequelize');
const sequelize = require('../db');

// Master Overview
router.get('/overview', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { ordersLimit = 10, ordersOffset = 0, status, search } = req.query;

        const users = await User.findAll({
            include: [{ model: Wallet, required: false }]
        });

        const ordersWhere = {};
        if (status && status !== 'ALL') ordersWhere.status = status;

        const searchInclude = [
            { model: User, as: 'buyer', attributes: ['id', 'username', 'role'] },
            { model: User, as: 'middleman', attributes: ['id', 'username', 'role'] }
        ];

        if (search && search.trim() !== '') {
            const searchTerm = `%${search.trim().toLowerCase()}%`;
            ordersWhere[Op.or] = [
                { id: { [Op.cast]: 'char', [Op.iLike]: searchTerm } },
                { description: { [Op.iLike]: searchTerm } },
                { '$buyer.username$': { [Op.iLike]: searchTerm } },
                { '$middleman.username$': { [Op.iLike]: searchTerm } }
            ];
        }

        const orders = await Order.findAll({
            where: ordersWhere,
            include: searchInclude,
            order: [['createdAt', 'DESC']],
            limit: parseInt(ordersLimit) || 10,
            offset: parseInt(ordersOffset) || 0,
            subQuery: false
        });

        const totalOrders = await Order.count({
            where: ordersWhere,
            include: (search && search.trim() !== '') ? searchInclude : [],
            distinct: true
        });

        const pendingRequests = await TransactionRequest.count({ where: { status: 'pending' } });

        res.json({
            users: users.map(u => {
                const available = u.Wallet ? parseFloat(u.Wallet.available_balance || 0) : 0;
                const locked = u.Wallet ? parseFloat(u.Wallet.locked_balance || 0) : 0;
                return {
                    id: u.id,
                    username: u.username,
                    role: u.role,
                    status: u.status,
                    available_balance: available.toFixed(2),
                    locked_balance: locked.toFixed(2),
                    total_balance: (available + locked).toFixed(2)
                };
            }),
            orders: orders,
            totalOrders: totalOrders,
            ordersHasMore: (parseInt(ordersOffset) || 0) + orders.length < totalOrders,
            pendingRequests: pendingRequests
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manual Wallet Management
router.post('/wallets/:user_id/deposit', authenticateToken, isAdmin, validate('walletTransaction'), async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { amount } = req.body;
        const userId = req.params.user_id;

        let wallet = await Wallet.findOne({ where: { user_id: userId }, transaction });
        if (!wallet) wallet = await Wallet.create({ user_id: userId, available_balance: 0, locked_balance: 0 }, { transaction });

        const balanceBefore = parseFloat(wallet.available_balance);
        wallet.available_balance = balanceBefore + parseFloat(amount);
        await wallet.save({ transaction });

        await Transaction.create({
            user_id: userId,
            type: 'DEPOSIT',
            amount: parseFloat(amount),
            balance_before: balanceBefore,
            balance_after: wallet.available_balance,
            description: 'Manual admin deposit'
        }, { transaction });

        await transaction.commit();

        const io = req.app.get('socketio');
        if (io) io.emit('walletUpdated', { user_id: userId, available_balance: wallet.available_balance });

        res.json({ message: 'Deposit successful', wallet });
    } catch (error) {
        if (transaction) await transaction.rollback();
        res.status(500).json({ error: error.message });
    }
});

// User Management
router.patch('/users/:id/status', authenticateToken, isAdmin, validate('updateUserStatus'), async (req, res) => {
    try {
        const { status } = req.body;
        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot modify self' });

        user.status = status;
        await user.save();
        res.json({ message: `User status updated to ${status}`, user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
