const sequelize = require('./db');
const User = require('./models/user');
const Wallet = require('./models/wallet');
const Order = require('./models/order');
const Transaction = require('./models/transaction');

async function claimOrder(middlemanId, orderId) {
  const transaction = await sequelize.transaction();

  try {
    const order = await Order.findByPk(orderId, { transaction });
    if (!order) {
      throw new Error('Order not found.');
    }
    if (order.status !== 'PENDING') {
      throw new Error('Order is not available for claiming.');
    }

    const wallet = await Wallet.findOne({ where: { user_id: middlemanId }, transaction });
    if (!wallet) {
      throw new Error('Wallet not found.');
    }

    const orderAmount = parseFloat(order.amount);
    if (parseFloat(wallet.available_balance) < orderAmount) {
      throw new Error('Insufficient balance to secure this order.');
    }

    // Store balance before for transaction record
    const balanceBefore = parseFloat(wallet.available_balance);

    // Move money to locked
    wallet.available_balance = balanceBefore - orderAmount;
    wallet.locked_balance = parseFloat(wallet.locked_balance) + orderAmount;

    order.status = 'CLAIMED';
    order.middleman_id = middlemanId;

    await wallet.save({ transaction });
    await order.save({ transaction });

    // Record transaction for middleman (collateral locked)
    await Transaction.create({
      user_id: middlemanId,
      order_id: orderId,
      type: 'ORDER_CLAIMED',
      amount: -orderAmount,
      balance_before: balanceBefore,
      balance_after: wallet.available_balance,
      description: `Claimed order #${orderId} - $${orderAmount.toFixed(2)} collateral locked`
    }, { transaction });

    await transaction.commit();
    return {
      message: 'Order secured. Your collateral is now locked.',
      order_id: orderId,
      collateral_locked: orderAmount
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function finalizeOrder(orderId, commissionRate = 0.05) {
  const transaction = await sequelize.transaction();

  try {
    const order = await Order.findByPk(orderId, { transaction });
    if (!order) {
      throw new Error('Order not found.');
    }
    if (order.status !== 'CLAIMED' && order.status !== 'READY_FOR_RELEASE') {
      throw new Error('Order is not in claimed or ready for release status.');
    }

    const middlemanWallet = await Wallet.findOne({ where: { user_id: order.middleman_id }, transaction });
    if (!middlemanWallet) {
      throw new Error('Middleman wallet not found.');
    }

    const buyerWallet = await Wallet.findOne({ where: { user_id: order.buyer_id }, transaction });
    if (!buyerWallet) {
      throw new Error('Buyer wallet not found. Cannot finalize order.');
    }

    // Calculate amounts
    const orderAmount = parseFloat(order.amount);
    const commission = orderAmount * commissionRate; // 5% commission for middleman

    // Store balances before for transaction records
    const buyerBalanceBefore = parseFloat(buyerWallet.available_balance || 0);
    const middlemanBalanceBefore = parseFloat(middlemanWallet.available_balance || 0);

    // ===== CORRECTED LOGIC =====
    // Buyer (Admin): Unlock their funds, return (orderAmount - commission)
    buyerWallet.locked_balance = parseFloat(buyerWallet.locked_balance || 0) - orderAmount;
    buyerWallet.available_balance = buyerBalanceBefore + (orderAmount - commission);

    // Middleman: Unlock Collateral + Receive Commission
    middlemanWallet.locked_balance = parseFloat(middlemanWallet.locked_balance || 0) - orderAmount;
    middlemanWallet.available_balance = middlemanBalanceBefore + orderAmount + commission;

    order.status = 'COMPLETED';

    await buyerWallet.save({ transaction });
    await middlemanWallet.save({ transaction });
    await order.save({ transaction });

    // Record transaction for Admin (order completed - commission paid)
    await Transaction.create({
      user_id: order.buyer_id,
      order_id: orderId,
      type: 'ORDER_COMPLETED',
      amount: orderAmount - commission,
      balance_before: buyerBalanceBefore,
      balance_after: buyerWallet.available_balance,
      description: `Order #${orderId} completed - received $${(orderAmount - commission).toFixed(2)} (paid $${commission.toFixed(2)} commission)`
    }, { transaction });

    // Also record commission paid separately for clarity
    await Transaction.create({
      user_id: order.buyer_id,
      order_id: orderId,
      type: 'COMMISSION_PAID',
      amount: -commission,
      balance_before: buyerBalanceBefore,
      balance_after: buyerWallet.available_balance,
      description: `Commission paid for order #${orderId} - $${commission.toFixed(2)}`
    }, { transaction });

    // Record transaction for Middleman (collateral unlocked + commission earned)
    await Transaction.create({
      user_id: order.middleman_id,
      order_id: orderId,
      type: 'ORDER_COMPLETED',
      amount: orderAmount,
      balance_before: middlemanBalanceBefore,
      balance_after: middlemanWallet.available_balance,
      description: `Order #${orderId} completed - collateral $${orderAmount.toFixed(2)} unlocked`
    }, { transaction });

    // Record commission earned separately
    await Transaction.create({
      user_id: order.middleman_id,
      order_id: orderId,
      type: 'COMMISSION_EARNED',
      amount: commission,
      balance_before: middlemanBalanceBefore + orderAmount,
      balance_after: middlemanWallet.available_balance,
      description: `Commission earned for order #${orderId} - $${commission.toFixed(2)} (5%)`
    }, { transaction });

    await transaction.commit();
    return {
      message: `Order completed! Middleman received collateral ($${orderAmount.toFixed(2)}) + commission ($${commission.toFixed(2)})`,
      amount: orderAmount,
      commission: commission,
      middleman_received: orderAmount + commission,
      buyer_returned: orderAmount - commission
    };
  } catch (error) {
    if (transaction) await transaction.rollback();
    throw error;
  }
}

async function disputeOrder(orderId) {
  const transaction = await sequelize.transaction();

  try {
    const order = await Order.findByPk(orderId, { transaction });
    if (!order) {
      throw new Error('Order not found.');
    }
    if (order.status !== 'CLAIMED') {
      throw new Error('Order is not in claimed status.');
    }

    const middlemanWallet = await Wallet.findOne({ where: { user_id: order.middleman_id }, transaction });
    if (!middlemanWallet) {
      throw new Error('Middleman wallet not found.');
    }

    // Slashing: remove the locked balance (forfeit the collateral)
    middlemanWallet.locked_balance = parseFloat(middlemanWallet.locked_balance) - parseFloat(order.amount);

    order.status = 'DISPUTED';

    await middlemanWallet.save({ transaction });
    await order.save({ transaction });

    await transaction.commit();
    return { message: 'Order disputed. Middleman\'s collateral has been slashed.' };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

module.exports = { claimOrder, finalizeOrder, disputeOrder };