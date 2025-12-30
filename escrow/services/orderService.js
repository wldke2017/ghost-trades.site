const sequelize = require('../db');
const Order = require('../models/order');
const User = require('../models/user');
const Wallet = require('../models/wallet');
const Transaction = require('../models/transaction');
const ActivityLog = require('../models/activityLog');
const { ORDER_STATUS, TRANSACTION_TYPES } = require('../config/constants');
const {
  NotFoundError,
  ValidationError,
  InsufficientFundsError,
  ConflictError
} = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Create a new order (Admin only)
 */
async function createOrder(buyerId, amount, description) {
  const transaction = await sequelize.transaction();

  try {
    // Validate amount
    if (!amount || parseFloat(amount) <= 0) {
      throw new ValidationError('Amount must be greater than 0');
    }

    const orderAmount = parseFloat(amount);

    // Get Admin's wallet to lock funds
    let adminWallet = await Wallet.findOne({
      where: { user_id: buyerId },
      transaction
    });

    // If admin has no wallet, create one
    if (!adminWallet) {
      adminWallet = await Wallet.create({
        user_id: buyerId,
        available_balance: 0,
        locked_balance: 0
      }, { transaction });
    }

    // Check balance
    if (parseFloat(adminWallet.available_balance) < orderAmount) {
      throw new InsufficientFundsError('Insufficient funds in wallet to create this order');
    }

    // Lock the funds
    const balanceBefore = parseFloat(adminWallet.available_balance);
    adminWallet.available_balance = balanceBefore - orderAmount;
    adminWallet.locked_balance = parseFloat(adminWallet.locked_balance) + orderAmount;
    await adminWallet.save({ transaction });

    // Create order
    const order = await Order.create({
      buyer_id: buyerId,
      amount: orderAmount,
      vault_amount: orderAmount,
      description,
      status: ORDER_STATUS.PENDING
    }, { transaction });

    // Record transaction
    await Transaction.create({
      user_id: buyerId,
      order_id: order.id,
      type: TRANSACTION_TYPES.ORDER_CREATED,
      amount: -orderAmount,
      balance_before: balanceBefore,
      balance_after: adminWallet.available_balance,
      description: `Created order #${order.id} - $${orderAmount.toFixed(2)} locked`
    }, { transaction });

    // Log activity
    await ActivityLog.create({
      user_id: buyerId,
      action: 'order_created',
      metadata: { order_id: order.id, amount: order.amount, description: order.description }
    }, { transaction });

    await transaction.commit();

    logger.info(`Order created: #${order.id} by user ${buyerId}`);

    return {
      order,
      wallet: {
        available_balance: adminWallet.available_balance,
        locked_balance: adminWallet.locked_balance
      }
    };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error creating order:', error);
    throw error;
  }
}

/**
 * Claim an order (Middleman only)
 */
async function claimOrder(middlemanId, orderId) {
  const transaction = await sequelize.transaction();

  try {
    const order = await Order.findByPk(orderId, { transaction });

    if (!order) {
      throw new NotFoundError('Order');
    }

    if (order.status !== ORDER_STATUS.PENDING) {
      throw new ConflictError('Order is not available for claiming');
    }

    const wallet = await Wallet.findOne({
      where: { user_id: middlemanId },
      transaction
    });

    if (!wallet) {
      throw new NotFoundError('Wallet');
    }

    const orderAmount = parseFloat(order.amount);

    if (parseFloat(wallet.available_balance) < orderAmount) {
      throw new InsufficientFundsError('Insufficient balance to secure this order');
    }

    // Store balance before for transaction record
    const balanceBefore = parseFloat(wallet.available_balance);

    // Lock collateral
    wallet.available_balance = balanceBefore - orderAmount;
    wallet.locked_balance = parseFloat(wallet.locked_balance) + orderAmount;

    order.status = ORDER_STATUS.CLAIMED;
    order.middleman_id = middlemanId;

    await wallet.save({ transaction });
    await order.save({ transaction });

    // Record transaction
    await Transaction.create({
      user_id: middlemanId,
      order_id: orderId,
      type: TRANSACTION_TYPES.ORDER_CLAIMED,
      amount: -orderAmount,
      balance_before: balanceBefore,
      balance_after: wallet.available_balance,
      description: `Claimed order #${orderId} - $${orderAmount.toFixed(2)} collateral locked`
    }, { transaction });

    // Log activity
    await ActivityLog.create({
      user_id: middlemanId,
      action: 'order_claimed',
      metadata: { order_id: orderId, amount: order.amount }
    }, { transaction });

    await transaction.commit();

    logger.info(`Order #${orderId} claimed by middleman ${middlemanId}`);

    return {
      message: 'Order secured. Your collateral is now locked.',
      order,
      wallet: {
        available_balance: wallet.available_balance,
        locked_balance: wallet.locked_balance
      }
    };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error claiming order:', error);
    throw error;
  }
}

/**
 * Complete order (Release funds with commission)
 */
async function completeOrder(orderId, commissionRate = 0.05) {
  const transaction = await sequelize.transaction();

  try {
    const order = await Order.findByPk(orderId, { transaction });

    if (!order) {
      throw new NotFoundError('Order');
    }

    if (order.status !== ORDER_STATUS.CLAIMED && order.status !== ORDER_STATUS.READY_FOR_RELEASE) {
      throw new ConflictError('Order is not in claimed or ready for release status');
    }

    const middlemanWallet = await Wallet.findOne({
      where: { user_id: order.middleman_id },
      transaction
    });

    const buyerWallet = await Wallet.findOne({
      where: { user_id: order.buyer_id },
      transaction
    });

    if (!middlemanWallet) {
      throw new NotFoundError('Middleman wallet');
    }

    if (!buyerWallet) {
      throw new NotFoundError('Buyer wallet');
    }

    // Calculate amounts
    const orderAmount = parseFloat(order.amount);
    const commission = orderAmount * commissionRate;

    // Store balances
    const buyerBalanceBefore = parseFloat(buyerWallet.available_balance || 0);
    const middlemanBalanceBefore = parseFloat(middlemanWallet.available_balance || 0);

    // Buyer: Unlock funds, return (orderAmount - commission)
    buyerWallet.locked_balance = parseFloat(buyerWallet.locked_balance || 0) - orderAmount;
    buyerWallet.available_balance = buyerBalanceBefore + (orderAmount - commission);

    // Middleman: Unlock collateral + Receive commission
    middlemanWallet.locked_balance = parseFloat(middlemanWallet.locked_balance || 0) - orderAmount;
    middlemanWallet.available_balance = middlemanBalanceBefore + orderAmount + commission;

    order.status = ORDER_STATUS.COMPLETED;

    await buyerWallet.save({ transaction });
    await middlemanWallet.save({ transaction });
    await order.save({ transaction });

    // Record transactions
    await Transaction.create({
      user_id: order.buyer_id,
      order_id: orderId,
      type: TRANSACTION_TYPES.ORDER_COMPLETED,
      amount: -(orderAmount - commission),
      balance_before: buyerBalanceBefore,
      balance_after: buyerWallet.available_balance,
      description: `Order #${orderId} completed - paid ${(orderAmount - commission).toFixed(2)} (${commission.toFixed(2)} commission)`
    }, { transaction });

    await Transaction.create({
      user_id: order.middleman_id,
      order_id: orderId,
      type: TRANSACTION_TYPES.ORDER_COMPLETED,
      amount: orderAmount + commission,
      balance_before: middlemanBalanceBefore,
      balance_after: middlemanWallet.available_balance,
      description: `Order #${orderId} completed - received collateral ${orderAmount.toFixed(2)} + commission ${commission.toFixed(2)}`
    }, { transaction });

    // Log activity
    await ActivityLog.create({
      user_id: order.middleman_id,
      action: 'order_completed',
      metadata: { order_id: orderId, amount: orderAmount, commission }
    }, { transaction });

    await transaction.commit();

    logger.info(`Order #${orderId} completed with commission ${commission}`);

    return {
      message: `Order completed. Commission of $${commission.toFixed(2)} paid.`,
      order,
      commission,
      buyerWallet: {
        available_balance: buyerWallet.available_balance,
        locked_balance: buyerWallet.locked_balance
      },
      middlemanWallet: {
        available_balance: middlemanWallet.available_balance,
        locked_balance: middlemanWallet.locked_balance
      }
    };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error completing order:', error);
    throw error;
  }
}

/**
 * Dispute an order
 */
async function disputeOrder(orderId) {
  const transaction = await sequelize.transaction();

  try {
    const order = await Order.findByPk(orderId, { transaction });

    if (!order) {
      throw new NotFoundError('Order');
    }

    if (order.status !== ORDER_STATUS.CLAIMED && order.status !== ORDER_STATUS.READY_FOR_RELEASE) {
      throw new ConflictError('Only claimed or ready orders can be disputed');
    }

    order.status = ORDER_STATUS.DISPUTED;
    await order.save({ transaction });

    await ActivityLog.create({
      user_id: order.buyer_id,
      action: 'order_disputed',
      metadata: { order_id: orderId }
    }, { transaction });

    await transaction.commit();

    logger.info(`Order #${orderId} disputed`);

    return {
      message: 'Order marked as disputed. Admin will review.',
      order
    };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error disputing order:', error);
    throw error;
  }
}

/**
 * Resolve a disputed order (Admin only)
 */
async function resolveDispute(orderId, winner) {
  const transaction = await sequelize.transaction();

  try {
    const order = await Order.findByPk(orderId, { transaction });

    if (!order) {
      throw new NotFoundError('Order');
    }

    if (order.status !== ORDER_STATUS.DISPUTED) {
      throw new ConflictError('Only disputed orders can be resolved');
    }

    if (!order.middleman_id) {
      throw new ValidationError('Order has no middleman assigned');
    }

    const orderAmount = parseFloat(order.amount);
    const commissionRate = parseFloat(process.env.COMMISSION_RATE || 0.05);
    const commission = orderAmount * commissionRate;

    // Get wallets
    const buyerWallet = await Wallet.findOne({
      where: { user_id: order.buyer_id },
      transaction
    });

    const middlemanWallet = await Wallet.findOne({
      where: { user_id: order.middleman_id },
      transaction
    });

    if (!buyerWallet || !middlemanWallet) {
      throw new NotFoundError('Wallet');
    }

    if (winner === 'middleman') {
      // Award middleman: Return collateral + commission from buyer's locked funds
      const middlemanBalanceBefore = parseFloat(middlemanWallet.available_balance);
      const buyerBalanceBefore = parseFloat(buyerWallet.available_balance);

      // Unlock and return middleman's collateral + commission
      middlemanWallet.locked_balance = parseFloat(middlemanWallet.locked_balance) - orderAmount;
      middlemanWallet.available_balance = middlemanBalanceBefore + orderAmount + commission;

      // Deduct commission from buyer's locked funds
      buyerWallet.locked_balance = parseFloat(buyerWallet.locked_balance) - orderAmount;
      buyerWallet.available_balance = buyerBalanceBefore - commission;

      await middlemanWallet.save({ transaction });
      await buyerWallet.save({ transaction });

      // Record transactions
      await Transaction.create({
        user_id: order.middleman_id,
        order_id: orderId,
        type: TRANSACTION_TYPES.ORDER_COMPLETED,
        amount: orderAmount + commission,
        balance_before: middlemanBalanceBefore,
        balance_after: middlemanWallet.available_balance,
        description: `Dispute resolved in favor of middleman - Order #${orderId} - Collateral ${orderAmount.toFixed(2)} + Commission ${commission.toFixed(2)}`
      }, { transaction });

      await Transaction.create({
        user_id: order.buyer_id,
        order_id: orderId,
        type: TRANSACTION_TYPES.COMMISSION_PAID,
        amount: -commission,
        balance_before: buyerBalanceBefore,
        balance_after: buyerWallet.available_balance,
        description: `Dispute resolved - Commission paid to middleman for Order #${orderId}`
      }, { transaction });

    } else if (winner === 'buyer') {
      // Award buyer: Return buyer's locked funds, middleman forfeits collateral
      const middlemanBalanceBefore = parseFloat(middlemanWallet.available_balance);
      const buyerBalanceBefore = parseFloat(buyerWallet.available_balance);

      // Forfeit middleman's collateral (remove from locked, don't return to available)
      middlemanWallet.locked_balance = parseFloat(middlemanWallet.locked_balance) - orderAmount;

      // Return buyer's locked funds
      buyerWallet.locked_balance = parseFloat(buyerWallet.locked_balance) - orderAmount;
      buyerWallet.available_balance = buyerBalanceBefore + orderAmount;

      await middlemanWallet.save({ transaction });
      await buyerWallet.save({ transaction });

      // Record transactions
      await Transaction.create({
        user_id: order.middleman_id,
        order_id: orderId,
        type: TRANSACTION_TYPES.DISPUTE_FORFEIT,
        amount: -orderAmount,
        balance_before: middlemanBalanceBefore,
        balance_after: middlemanWallet.available_balance,
        description: `Dispute resolved in favor of buyer - Collateral ${orderAmount.toFixed(2)} forfeited for Order #${orderId}`
      }, { transaction });

      await Transaction.create({
        user_id: order.buyer_id,
        order_id: orderId,
        type: TRANSACTION_TYPES.DISPUTE_REFUND,
        amount: orderAmount,
        balance_before: buyerBalanceBefore,
        balance_after: buyerWallet.available_balance,
        description: `Dispute resolved - Funds ${orderAmount.toFixed(2)} refunded for Order #${orderId}`
      }, { transaction });

    } else {
      throw new ValidationError('Winner must be either "middleman" or "buyer"');
    }

    // Update order status
    order.status = ORDER_STATUS.COMPLETED;
    await order.save({ transaction });

    // Log activity
    await ActivityLog.create({
      user_id: order.buyer_id,
      action: 'dispute_resolved',
      metadata: { order_id: orderId, winner }
    }, { transaction });

    await transaction.commit();

    logger.info(`Dispute resolved for order #${orderId} in favor of ${winner}`);

    return {
      message: `Dispute resolved in favor of ${winner}`,
      order,
      buyerWallet: {
        available_balance: buyerWallet.available_balance,
        locked_balance: buyerWallet.locked_balance
      },
      middlemanWallet: {
        available_balance: middlemanWallet.available_balance,
        locked_balance: middlemanWallet.locked_balance
      }
    };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error resolving dispute:', error);
    throw error;
  }
}

/**
 * Cancel an order
 */
async function cancelOrder(orderId, cancelledBy) {
  const transaction = await sequelize.transaction();

  try {
    const order = await Order.findByPk(orderId, { transaction });

    if (!order) {
      throw new NotFoundError('Order');
    }

    if (order.status === ORDER_STATUS.COMPLETED) {
      throw new ConflictError('Cannot cancel completed orders');
    }

    // Return collateral if order was claimed
    if ((order.status === ORDER_STATUS.CLAIMED || order.status === ORDER_STATUS.READY_FOR_RELEASE) && order.middleman_id) {
      const middlemanWallet = await Wallet.findOne({
        where: { user_id: order.middleman_id },
        transaction
      });

      if (middlemanWallet) {
        const middlemanBalanceBefore = parseFloat(middlemanWallet.available_balance);
        middlemanWallet.available_balance = middlemanBalanceBefore + parseFloat(order.amount);
        middlemanWallet.locked_balance = parseFloat(middlemanWallet.locked_balance) - parseFloat(order.amount);
        await middlemanWallet.save({ transaction });

        await Transaction.create({
          user_id: order.middleman_id,
          order_id: orderId,
          type: TRANSACTION_TYPES.ORDER_CANCELLED,
          amount: parseFloat(order.amount),
          balance_before: middlemanBalanceBefore,
          balance_after: middlemanWallet.available_balance,
          description: `Order #${orderId} cancelled - collateral ${order.amount.toFixed(2)} returned`
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
      buyerWallet.available_balance = buyerBalanceBefore + parseFloat(order.amount);
      buyerWallet.locked_balance = parseFloat(buyerWallet.locked_balance) - parseFloat(order.amount);
      await buyerWallet.save({ transaction });

      await Transaction.create({
        user_id: order.buyer_id,
        order_id: orderId,
        type: TRANSACTION_TYPES.ORDER_CANCELLED,
        amount: parseFloat(order.amount),
        balance_before: buyerBalanceBefore,
        balance_after: buyerWallet.available_balance,
        description: `Order #${orderId} cancelled - funds ${order.amount.toFixed(2)} returned`
      }, { transaction });
    }

    order.status = ORDER_STATUS.CANCELLED;
    await order.save({ transaction });

    await ActivityLog.create({
      user_id: cancelledBy,
      action: 'order_cancelled',
      metadata: { order_id: orderId }
    }, { transaction });

    await transaction.commit();

    logger.info(`Order #${orderId} cancelled by user ${cancelledBy}`);

    return {
      message: 'Order cancelled successfully',
      order
    };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error cancelling order:', error);
    throw error;
  }
}


/**
 * Get orders with pagination and filtering
 */
async function getOrders({ status, buyerId, middlemanId, limit = 20, offset = 0 }) {
  try {
    const where = {};
    if (status) where.status = status;
    if (buyerId) where.buyer_id = buyerId;
    if (middlemanId) where.middleman_id = middlemanId;

    const { count, rows } = await Order.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']], // Fixed: Sequelize uses camelCase by default
      include: [
        { model: User, as: 'buyer', attributes: ['id', 'username'] },
        { model: User, as: 'middleman', attributes: ['id', 'username'] }
      ]
    });

    return {
      total: count,
      orders: rows,
      totalPages: Math.ceil(count / limit),
      currentPage: Math.floor(offset / limit) + 1
    };
  } catch (error) {
    logger.error('Error fetching orders:', error);
    // Console log for immediate visibility in terminal if logger is silent
    console.error('CRITICAL ORDER FETCH ERROR:', error);
    throw error;
  }
}

/**
 * Get a single order by ID
 */
async function getOrderById(orderId) {
  try {
    const order = await Order.findByPk(orderId, {
      include: [
        { model: User, as: 'buyer', attributes: ['id', 'username', 'email'] },
        { model: User, as: 'middleman', attributes: ['id', 'username', 'email'] }
      ]
    });

    if (!order) {
      throw new NotFoundError('Order');
    }

    return order;
  } catch (error) {
    logger.error(`Error fetching order #${orderId}:`, error);
    throw error;
  }
}

/**
 * Mark order as ready for release (Middleman)
 */
async function markOrderAsReady(middlemanId, orderId) {
  try {
    const order = await Order.findByPk(orderId);
    if (!order) throw new NotFoundError('Order');

    if (order.middleman_id !== middlemanId) {
      throw new ConflictError('You can only complete orders you claimed');
    }

    if (order.status !== ORDER_STATUS.CLAIMED) {
      throw new ConflictError('Order must be in CLAIMED status');
    }

    order.status = ORDER_STATUS.READY_FOR_RELEASE;
    await order.save();

    await ActivityLog.create({
      user_id: middlemanId,
      action: 'order_completed_work',
      metadata: { order_id: orderId }
    });

    logger.info(`Order #${orderId} marked as ready by middleman ${middlemanId}`);

    return { message: 'Order marked as complete. Waiting for admin to release funds.', order };
  } catch (error) {
    logger.error('Error marking order as ready:', error);
    throw error;
  }
}

/**
 * Create bulk orders (Admin only)
 */
async function createBulkOrders(adminId, ordersData) {
  const transaction = await sequelize.transaction();
  try {
    if (!Array.isArray(ordersData) || ordersData.length === 0) {
      throw new ValidationError('Invalid orders data');
    }

    if (ordersData.length > 50) {
      throw new ValidationError('Bulk limit exceeded (max 50)');
    }

    const createdOrders = [];
    let totalAmount = 0;

    // Optional: Check total balance first for efficiency
    // But locking per order is safer for concurrency? 
    // The server.js implementation locked funds per order in a loop (lines 522+ not shown fully but likely)
    // Actually the server.js implementation (Line 2605) did NOT lock funds! It just created orders.
    // Line 983 (single create) locked funds. Line 2605 (bulk) did NOT. 
    // This is a BUG in createBulkOrders in server.js! It allowed creating orders without locking funds!
    // I will fix this by locking funds.

    // Get Admin Wallet
    let adminWallet = await Wallet.findOne({ where: { user_id: adminId }, transaction });
    if (!adminWallet) {
      adminWallet = await Wallet.create({ user_id: adminId, available_balance: 0, locked_balance: 0 }, { transaction });
    }

    for (const data of ordersData) {
      const amount = parseFloat(data.amount);
      if (amount <= 0) continue;

      if (parseFloat(adminWallet.available_balance) < amount) {
        throw new InsufficientFundsError(`Insufficient funds for bulk order of ${amount}`);
      }

      // Lock funds
      adminWallet.available_balance = parseFloat(adminWallet.available_balance) - amount;
      adminWallet.locked_balance = parseFloat(adminWallet.locked_balance) + amount;
      await adminWallet.save({ transaction });
      totalAmount += amount;

      const order = await Order.create({
        amount: amount,
        status: ORDER_STATUS.PENDING,
        buyer_id: adminId,
        vault_amount: amount,
        description: data.description || 'Bulk Order'
      }, { transaction });

      createdOrders.push(order);

      await Transaction.create({
        user_id: adminId,
        order_id: order.id,
        type: TRANSACTION_TYPES.ORDER_CREATED,
        amount: -amount,
        balance_before: parseFloat(adminWallet.available_balance) + amount,
        balance_after: parseFloat(adminWallet.available_balance), // approximated for batch
        description: `Bulk order #${order.id} - locked`
      }, { transaction });
    }

    await ActivityLog.create({
      user_id: adminId,
      action: 'bulk_orders_created',
      metadata: { count: createdOrders.length, total_amount: totalAmount }
    }, { transaction });

    await transaction.commit();

    logger.info(`Bulk orders created: ${createdOrders.length}`);
    return { created: createdOrders.length, orders: createdOrders };

  } catch (error) {
    if (transaction) await transaction.rollback();
    logger.error('Error creating bulk orders:', error);
    throw error;
  }
}

module.exports = {
  createOrder,
  claimOrder,
  completeOrder,
  disputeOrder,
  resolveDispute,
  cancelOrder,
  getOrders,
  getOrderById,
  markOrderAsReady,
  createBulkOrders
};