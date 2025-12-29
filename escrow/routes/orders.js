const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// Get orders (available for claiming or by user)
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        const { status, limit, offset } = req.query;
        // If querying own orders, ensure filters are set, otherwise public orders
        const filters = {
            status: status || 'PENDING', // Default to pending if not specified
            limit: parseInt(limit) || 20,
            offset: parseInt(offset) || 0
        };

        const result = await orderService.getOrders(filters);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Get active orders for the current user (either as buyer or middleman)
router.get('/my-active', authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.id;

        // Fetch orders where user is buyer OR middleman, AND status is active-like
        // Using individual calls for simplicity or improved filter in service?
        // Let's use getOrders twice or improve getOrders. 
        // To keep it simple and safe given constraints, we'll fetch explicitly.
        // Ideally we want orders where (buyer_id = ID OR middleman_id = ID) AND status IN [...]
        // But our getOrders is AND based.
        // Let's just implement a specific logic here or rely on the frontend expectation.
        // Frontend expects a list of orders.

        // We can use a direct query here or expand service. 
        // Expanding service is cleaner but let's stick to what we have.
        // We will use Sequelize Op in service if needed, but for now let's just use raw query via model or specialized service method.
        // Actually, `getOrders` treats params as AND.
        // Let's add a specialized method or direct query.

        // Wait, I can just add a new method to orderService for `getActiveOrdersForUser` or similar if I could edit it again.
        // But I just finished editing it. 
        // I can do a direct findAll here using the model if I import it, OR I can fetch as buyer and fetch as middleman and merge.
        // Merging is safer without re-editing service.

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
        uniqueOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json(uniqueOrders);
    } catch (error) {
        next(error);
    }
});

// Get order details
router.get('/:id', authenticateToken, async (req, res, next) => {
    try {
        const order = await orderService.getOrderById(req.params.id);
        // Security check: ensure user is related to order or is admin
        // For public pending orders, anyone can view? Yes, to claim.
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

module.exports = router;
