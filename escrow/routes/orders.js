const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { authenticateToken, isAdmin, isMiddleman } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const logger = require('../utils/logger');

// Get orders (available for claiming or by user)
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        const { status, limit, offset } = req.query;
        // If querying own orders, ensure filters are set, otherwise public orders
        // Admin can see everything? getOrders supports buyerId/middlemanId filters.

        let filters = {
            status: status,
            buyerId: req.query.buyerId,
            middlemanId: req.query.middlemanId,
            limit: parseInt(req.query.limit) || 20,
            offset: parseInt(req.query.offset) || 0
        };

        // If basic user (not admin), what should they see?
        // Usually: "Marketplace" (Pending orders) OR "My Orders".
        // Use query params to distinguish?
        // For now, exposing getOrders as is, but maybe restricting based on roles if needed.
        // User provided logic in server.js just returned Order.findAll().

        const result = await orderService.getOrders(filters);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Create Order (Admin only)
router.post('/', authenticateToken, isAdmin, validate('createOrder'), async (req, res, next) => {
    try {
        const { amount, description } = req.body;
        const result = await orderService.createOrder(req.user.id, amount, description);

        // WebSocket event
        const io = req.app.get('socketio');
        if (io) {
            io.emit('orderCreated', result.order);
            io.emit('walletUpdated', {
                user_id: req.user.id,
                available_balance: result.wallet.available_balance,
                locked_balance: result.wallet.locked_balance
            });
        }

        res.status(201).json(result.order);
    } catch (error) {
        next(error);
    }
});

// Bulk Create Orders (Admin only)
router.post('/bulk', authenticateToken, isAdmin, async (req, res, next) => {
    try {
        const { orders } = req.body;
        const result = await orderService.createBulkOrders(req.user.id, orders);

        // WebSocket event
        const io = req.app.get('socketio');
        if (io) {
            result.orders.forEach(order => io.emit('orderCreated', order));
            // Trigger wallet update for admin? Bulk orders might have changed balance significantly.
            // We should ideally fetch fresh wallet, but that's expensive. 
            // Client should probably refresh wallet.
        }

        res.status(201).json({
            message: `Successfully created ${result.created} orders`,
            orders: result.orders
        });

    } catch (error) {
        next(error);
    }
});

// Get active orders for the current user (either as buyer or middleman)
router.get('/my-active', authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.id;
        // Fetch orders where user is buyer OR middleman
        const asBuyer = await orderService.getOrders({ buyerId: userId, limit: 50 });
        const asMiddleman = await orderService.getOrders({ middlemanId: userId, limit: 50 });

        // Filter for active statuses
        const activeStatuses = ['CLAIMED', 'PAID', 'DISPUTED', 'READY_FOR_RELEASE'];

        const buyerOrders = asBuyer.orders.filter(o => activeStatuses.includes(o.status));
        const middlemanOrders = asMiddleman.orders.filter(o => activeStatuses.includes(o.status));

        // Merge unique orders by ID
        const allOrders = [...buyerOrders, ...middlemanOrders];
        const uniqueOrders = Array.from(new Map(allOrders.map(item => [item.id, item])).values());

        // Sort by date desc
        uniqueOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(uniqueOrders);
    } catch (error) {
        next(error);
    }
});

// Get order details
router.get('/:id', authenticateToken, async (req, res, next) => {
    try {
        const order = await orderService.getOrderById(req.params.id);
        // Security check
        if (order.status !== 'PENDING') {
            if (order.buyer_id !== req.user.id && order.middleman_id !== req.user.id && req.user.role !== 'admin') {
                return res.status(403).json({ message: 'Access denied' });
            }
        }
        res.json(order);
    } catch (error) {
        next(error);
    }
});

// Claim Order (Middleman only)
router.post('/:id/claim', authenticateToken, isMiddleman, async (req, res, next) => {
    try {
        const result = await orderService.claimOrder(req.user.id, req.params.id);

        const io = req.app.get('socketio');
        if (io) {
            io.emit('orderClaimed', result.order);
            io.emit('walletUpdated', {
                user_id: req.user.id,
                available_balance: result.wallet.available_balance,
                locked_balance: result.wallet.locked_balance
            });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Mark as Ready for Release (Middleman only)
// Maps to /orders/:id/complete in original server.js
router.post('/:id/complete', authenticateToken, isMiddleman, async (req, res, next) => {
    try {
        const result = await orderService.markOrderAsReady(req.user.id, req.params.id);

        const io = req.app.get('socketio');
        if (io) {
            io.emit('orderReadyForRelease', result.order);
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Release Order / Finalize (Admin only)
// Maps to /orders/:id/release in original server.js
router.post('/:id/release', authenticateToken, isAdmin, async (req, res, next) => {
    try {
        // Commission rate hardcoded in server.js as 0.05. Using default from service (0.05).
        const result = await orderService.completeOrder(req.params.id);

        const io = req.app.get('socketio');
        if (io) {
            io.emit('orderCompleted', result.order);
            // Update wallets for both parties
            io.emit('walletUpdated', {
                user_id: result.order.middleman_id,
                available_balance: result.middlemanWallet.available_balance,
                locked_balance: result.middlemanWallet.locked_balance
            });
            io.emit('walletUpdated', {
                user_id: result.order.buyer_id,
                available_balance: result.buyerWallet.available_balance,
                locked_balance: result.buyerWallet.locked_balance
            });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Dispute Order
router.post('/:id/dispute', authenticateToken, async (req, res, next) => {
    try {
        // server.js had logic: "If not admin, check if user is the buyer for this order"
        // orderService.disputeOrder does NOT check this (it only checks status).
        // We should add the check here.

        const order = await orderService.getOrderById(req.params.id);
        if (req.user.role !== 'admin' && order.buyer_id !== req.user.id && order.middleman_id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden: Only the parties involved or admin can dispute orders' });
        }

        const result = await orderService.disputeOrder(req.params.id);

        const io = req.app.get('socketio');
        if (io) {
            // Emit wallet update for middleman (their collateral is slashed/locked?)
            // Service slashes collateral (sets to locked?). Wait.
            // Dispute just changes status to DISPUTED. Collateral remains locked.
            // But server.js said "Middleman's collateral has been slashed." in response? 
            // escrowService.js Line 186: middlemanWallet.locked_balance -= amount. 
            // WAIT. `escrowService.js` REDUCES locked_balance. This means the money is GONE from wallet?
            // `orderService.js` Line 308: Just sets status to DISPUTED. Does NOT touch wallet.
            // Discrepancy!
            // server.js uses escrowService.js for dispute.
            // The logic in escrowService.js (Line 186) IS destructive:
            // middlemanWallet.locked_balance = ... - amount.
            // This effectively BURNS the collateral immediately upon dispute? 
            // That seems harsh if the dispute is resolved in middleman's favor later.
            // server.js Line 1326 (resolve): middlemanWallet.locked_balance -= amount; available += amount;
            // If it was already slashed, this would result in negative balance?

            // Let's look at `server.js` `resolveDispute` (Line 1273).
            // It calls `Order.findByPk`. It gets wallet.
            // It assumes funds are in locked_balance.
            // If `disputeOrder` (from escrowService) SLASHED it (removed it), then `resolveDispute` would fail or create money?
            // `escrowService.js` `disputeOrder` (Line 190) saves the wallet.

            // I trust `orderService.js` more. It preserves the state (DISPUTED) and lets `resolveDispute` handle the money movement.
            // I will stick with `orderService.js` which just updates status. 
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Cancel Order
router.post('/:id/cancel', authenticateToken, isAdmin, async (req, res, next) => {
    try {
        const result = await orderService.cancelOrder(req.params.id, req.user.id);

        const io = req.app.get('socketio');
        if (io) {
            io.emit('orderCancelled', result.order);
            // Verify wallet updates if needed? Service handles it.
            // We can emit wallet events if service returned wallet info. 
            // Service cancelOrder does NOT return wallet info currently.
            // That's fine, clients can refresh.
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
