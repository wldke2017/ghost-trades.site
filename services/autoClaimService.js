const Order = require('../models/order');
const User = require('../models/user');
const BotConfig = require('../models/botConfig');
const { ORDER_STATUS } = require('../config/constants');
const logger = require('../utils/logger');
const { Op } = require('sequelize');
const sequelize = require('../db');

let scanTimer = null;

/**
 * Service to handle automatic claiming of orders by bot accounts
 */
const autoClaimService = {
  /**
   * Triggers an auto-claim for a specific order after a natural delay
   */
  async trigger(orderId, io) {
    try {
      const config = await BotConfig.findOne();
      if (!config || !config.auto_claim_enabled) {
        logger.info(`[AUTO-CLAIM] Auto-claim is disabled or config missing. Skipping Order #${orderId}`);
        return;
      }

      // Import orderService here to avoid circular dependency
      const orderService = require('./orderService');

      const delayMin = (config.claim_delay_min || 5) * 1000;
      const delayMax = (config.claim_delay_max || 15) * 1000;
      const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
      
      logger.info(`[AUTO-CLAIM] Order #${orderId} scheduled for claim in ${delay/1000}s`);

      setTimeout(async () => {
        try {
          const order = await Order.findByPk(orderId);
          if (!order || order.status !== ORDER_STATUS.PENDING) {
            logger.info(`[AUTO-CLAIM] Order #${orderId} is no longer pending. Skipping.`);
            return;
          }

          const bot = await User.findOne({ 
            where: { is_bot: true, status: 'active', role: 'middleman' } 
          });

          if (!bot) {
            logger.warn('[AUTO-CLAIM] No active bot users found.');
            return;
          }

          logger.info(`[AUTO-CLAIM] Bot ${bot.username} attempting to claim order #${orderId}`);
          
          const result = await orderService.claimOrder(bot.id, orderId);

          if (io) {
            io.emit('orderClaimed', result.order);
            io.emit('walletUpdated', {
              user_id: bot.id,
              available_balance: result.wallet.available_balance,
              locked_balance: result.wallet.locked_balance
            });
          }

          // --- Auto-Release Logic ---
          const relMin = (config.release_delay_min || 15) * 1000;
          const relMax = (config.release_delay_max || 20) * 1000;
          const releaseDelay = Math.floor(Math.random() * (relMax - relMin + 1)) + relMin;
          
          logger.info(`[AUTO-RELEASE] Scheduling automatic release for order #${orderId} in ${releaseDelay/1000}s`);

          setTimeout(async () => {
            try {
              const currentOrder = await Order.findByPk(orderId);
              if (!currentOrder || (currentOrder.status !== ORDER_STATUS.CLAIMED && currentOrder.status !== ORDER_STATUS.READY_FOR_RELEASE)) {
                 return;
              }

              const completedResult = await orderService.completeOrder(orderId);

              if (io) {
                io.emit('orderCompleted', completedResult.order);
                io.emit('walletUpdated', {
                  user_id: bot.id,
                  available_balance: completedResult.middlemanWallet.available_balance,
                  locked_balance: completedResult.middlemanWallet.locked_balance
                });
                io.emit('walletUpdated', {
                  user_id: completedResult.order.buyer_id,
                  available_balance: completedResult.buyerWallet.available_balance,
                  locked_balance: completedResult.buyerWallet.locked_balance
                });
              }
              logger.info(`[AUTO-RELEASE] Order #${orderId} auto-completed.`);
            } catch (releaseErr) {
              logger.error(`[AUTO-RELEASE] Failed for #${orderId}:`, releaseErr.message);
            }
          }, releaseDelay);

        } catch (error) {
          logger.error(`[AUTO-CLAIM] Failed for #${orderId}:`, error.message);
        }
      }, delay);
    } catch (err) {
      logger.error('[AUTO-CLAIM] Trigger error:', err.message);
    }
  },

  /**
   * Updates configuration and restarts workers if necessary
   */
  async updateConfig(config, io) {
    logger.info('[AUTO-CLAIM] Configuration updated. Restarting scanner if needed.');
    this.startPeriodicScan(io);
  },

  /**
   * Periodically scans for PENDING orders to claim at random
   */
  async startPeriodicScan(io) {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }

    try {
      const config = await BotConfig.findOne();
      if (!config || !config.periodic_scan_enabled) {
        logger.info('[AUTO-CLAIM] Periodic scan is disabled.');
        return;
      }

      const intervalMs = (config.scan_interval || 5) * 60 * 1000;
      logger.info(`[AUTO-CLAIM] Starting periodic scanner (Interval: ${config.scan_interval}m)`);

      scanTimer = setInterval(async () => {
        try {
          // Find a random pending order
          const randomOrder = await Order.findOne({
            where: { status: ORDER_STATUS.PENDING },
            order: sequelize.random()
          });

          if (randomOrder) {
            logger.info(`[AUTO-CLAIM] Scanner found random pending order #${randomOrder.id}. Triggering claim.`);
            this.trigger(randomOrder.id, io);
          }
        } catch (err) {
          logger.error('[AUTO-CLAIM] Scanner error:', err.message);
        }
      }, intervalMs);
    } catch (err) {
      logger.error('[AUTO-CLAIM] Failed to start scanner:', err.message);
    }
  }
};

module.exports = autoClaimService;
