const Order = require('../models/order');
const User = require('../models/user');
const { ORDER_STATUS } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Service to handle automatic claiming of orders by bot accounts
 */
const autoClaimService = {
  /**
   * Triggers an auto-claim for a specific order after a natural delay
   * @param {number} orderId - The ID of the order to claim
   * @param {object} io - Socket.io instance for emiting updates
   */
  async trigger(orderId, io) {
    // Import orderService here to avoid circular dependency
    const orderService = require('./orderService');

    const delay = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
    logger.info(`[AUTO-CLAIM] Order #${orderId} scheduled for claim in ${delay/1000}s`);

    setTimeout(async () => {
      try {
        const order = await Order.findByPk(orderId);
        if (!order || order.status !== ORDER_STATUS.PENDING) {
          logger.info(`[AUTO-CLAIM] Order #${orderId} is no longer pending. Skipping.`);
          return;
        }

        // Find an active bot user
        const bot = await User.findOne({ 
          where: { is_bot: true, status: 'active', role: 'middleman' } 
        });

        if (!bot) {
          logger.warn('[AUTO-CLAIM] No active bot users found in database.');
          return;
        }

        logger.info(`[AUTO-CLAIM] Bot ${bot.username} (ID: ${bot.id}) attempting to claim order #${orderId}`);
        
        const result = await orderService.claimOrder(bot.id, orderId);

        if (io) {
          io.emit('orderClaimed', result.order);
          io.emit('walletUpdated', {
            user_id: bot.id,
            available_balance: result.wallet.available_balance,
            locked_balance: result.wallet.locked_balance
          });
        }

        logger.info(`[AUTO-CLAIM] Order #${orderId} successfully claimed by bot.`);
      } catch (error) {
        logger.error(`[AUTO-CLAIM] Failed to auto-claim order #${orderId}:`, error.message);
      }
    }, delay);
  }
};

module.exports = autoClaimService;
