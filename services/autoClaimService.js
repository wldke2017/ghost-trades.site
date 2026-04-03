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

        // --- Auto-Release Logic ---
        const releaseDelay = Math.floor(Math.random() * (20000 - 15000 + 1)) + 15000; // 15 to 20 seconds
        logger.info(`[AUTO-RELEASE] Scheduling automatic release for order #${orderId} in ${releaseDelay/1000}s`);

        setTimeout(async () => {
          try {
            // Verify order exists before attempting release
            const currentOrder = await Order.findByPk(orderId);
            if (!currentOrder || (currentOrder.status !== ORDER_STATUS.CLAIMED && currentOrder.status !== ORDER_STATUS.READY_FOR_RELEASE)) {
               logger.info(`[AUTO-RELEASE] Order #${orderId} is no longer in a valid state to be auto-released.`);
               return;
            }

            const completedResult = await orderService.completeOrder(orderId);

            if (io) {
              io.emit('orderCompleted', completedResult.order);
              
              // Emit wallet update for the bot/middleman
              io.emit('walletUpdated', {
                user_id: bot.id,
                available_balance: completedResult.middlemanWallet.available_balance,
                locked_balance: completedResult.middlemanWallet.locked_balance
              });

              // Emit wallet update for the admin/buyer
              io.emit('walletUpdated', {
                user_id: completedResult.order.buyer_id,
                available_balance: completedResult.buyerWallet.available_balance,
                locked_balance: completedResult.buyerWallet.locked_balance
              });
            }

            logger.info(`[AUTO-RELEASE] Order #${orderId} cleanly auto-completed and funds released.`);
          } catch (releaseErr) {
            logger.error(`[AUTO-RELEASE] Failed to auto-release order #${orderId}:`, releaseErr.message);
          }
        }, releaseDelay);

      } catch (error) {
        logger.error(`[AUTO-CLAIM] Failed to auto-claim order #${orderId}:`, error.message);
      }
    }, delay);
  }
};

module.exports = autoClaimService;
