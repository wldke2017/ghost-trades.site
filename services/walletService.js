const sequelize = require('../db');
const Wallet = require('../models/wallet');
const Transaction = require('../models/transaction');
const TransactionRequest = require('../models/transactionRequest');
const ActivityLog = require('../models/activityLog');
const { TRANSACTION_TYPES, REQUEST_STATUS } = require('../config/constants');
const { NotFoundError, InsufficientFundsError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Get user wallet with balance details
 */
async function getUserWallet(userId) {
  let wallet = await Wallet.findOne({ where: { user_id: userId } });

  // Create wallet if it doesn't exist
  if (!wallet) {
    wallet = await Wallet.create({
      user_id: userId,
      available_balance: 0,
      locked_balance: 0
    });
    logger.info(`Wallet created for user ${userId}`);
  }

  return {
    id: wallet.id,
    user_id: wallet.user_id,
    available_balance: parseFloat(wallet.available_balance || 0).toFixed(2),
    locked_balance: parseFloat(wallet.locked_balance || 0).toFixed(2),
    total_balance: (parseFloat(wallet.available_balance || 0) + parseFloat(wallet.locked_balance || 0)).toFixed(2),
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt
  };
}

/**
 * Deposit funds to wallet (Admin operation)
 */
async function depositFunds(userId, amount, adminId, notes = null) {
  const transaction = await sequelize.transaction();

  try {
    if (!amount || parseFloat(amount) <= 0) {
      throw new ValidationError('Amount must be greater than 0');
    }

    let wallet = await Wallet.findOne({ where: { user_id: userId }, transaction });

    if (!wallet) {
      wallet = await Wallet.create({
        user_id: userId,
        available_balance: 0,
        locked_balance: 0
      }, { transaction });
    }

    const balanceBefore = parseFloat(wallet.available_balance);
    const depositAmount = parseFloat(amount);
    wallet.available_balance = balanceBefore + depositAmount;
    await wallet.save({ transaction });

    // Record transaction
    await Transaction.create({
      user_id: userId,
      type: TRANSACTION_TYPES.DEPOSIT,
      amount: depositAmount,
      balance_before: balanceBefore,
      balance_after: wallet.available_balance,
      description: `Manual admin deposit - ${depositAmount.toFixed(2)}`
    }, { transaction });

    // Create transaction request record for history
    await TransactionRequest.create({
      user_id: userId,
      type: 'deposit',
      amount: depositAmount,
      status: REQUEST_STATUS.APPROVED,
      admin_notes: notes || 'Manual Admin Deposit',
      reviewed_by: adminId,
      reviewed_at: new Date()
    }, { transaction });

    // Log activity
    await ActivityLog.create({
      user_id: adminId,
      action: 'wallet_deposit',
      metadata: {
        target_user_id: userId,
        amount: depositAmount,
        new_balance: wallet.available_balance
      }
    }, { transaction });

    // Auto-check for welcome bonus eligibility
    await checkAndApplyWelcomeBonus(userId, depositAmount, transaction);

    // Reload the wallet model to reflect the newly updated balance
    await wallet.reload({ transaction });

    await transaction.commit();

    logger.info(`Deposit of ${depositAmount} to user ${userId} by admin ${adminId}`);

    return {
      message: `Successfully deposited $${depositAmount.toFixed(2)}`,
      wallet: {
        user_id: wallet.user_id,
        available_balance: parseFloat(wallet.available_balance).toFixed(2),
        locked_balance: parseFloat(wallet.locked_balance).toFixed(2)
      }
    };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error depositing funds:', error);
    throw error;
  }
}

/**
 * Withdraw funds from wallet (Admin operation)
 */
async function withdrawFunds(userId, amount, adminId, notes = null) {
  const transaction = await sequelize.transaction();

  try {
    if (!amount || parseFloat(amount) <= 0) {
      throw new ValidationError('Amount must be greater than 0');
    }

    const wallet = await Wallet.findOne({ where: { user_id: userId }, transaction });

    if (!wallet) {
      throw new NotFoundError('Wallet');
    }

    const withdrawAmount = parseFloat(amount);

    if (parseFloat(wallet.available_balance) < withdrawAmount) {
      throw new InsufficientFundsError('Insufficient available balance');
    }

    const balanceBefore = parseFloat(wallet.available_balance);
    wallet.available_balance = balanceBefore - withdrawAmount;
    await wallet.save({ transaction });

    // Record transaction
    await Transaction.create({
      user_id: userId,
      type: TRANSACTION_TYPES.WITHDRAWAL,
      amount: -withdrawAmount,
      balance_before: balanceBefore,
      balance_after: wallet.available_balance,
      description: `Manual admin withdrawal - ${withdrawAmount.toFixed(2)}`
    }, { transaction });

    // Create transaction request record for history
    await TransactionRequest.create({
      user_id: userId,
      type: 'withdrawal',
      amount: withdrawAmount,
      status: REQUEST_STATUS.APPROVED,
      admin_notes: notes || 'Manual Admin Withdrawal',
      reviewed_by: adminId,
      reviewed_at: new Date()
    }, { transaction });

    // Log activity
    await ActivityLog.create({
      user_id: adminId,
      action: 'wallet_withdraw',
      metadata: {
        target_user_id: userId,
        amount: withdrawAmount,
        new_balance: wallet.available_balance
      }
    }, { transaction });

    await transaction.commit();

    logger.info(`Withdrawal of ${withdrawAmount} from user ${userId} by admin ${adminId}`);

    return {
      message: `Successfully withdrew $${withdrawAmount.toFixed(2)}`,
      wallet: {
        user_id: wallet.user_id,
        available_balance: parseFloat(wallet.available_balance).toFixed(2),
        locked_balance: parseFloat(wallet.locked_balance).toFixed(2)
      }
    };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error withdrawing funds:', error);
    throw error;
  }
}

/**
 * Get transaction history for a user
 */
async function getTransactionHistory(userId, options = {}) {
  const { type, limit = 50, offset = 0 } = options;

  const whereClause = { user_id: userId };
  if (type && type !== 'all') {
    whereClause.type = type;
  }

  const transactions = await Transaction.findAll({
    where: whereClause,
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  const count = await Transaction.count({ where: whereClause });

  return {
    transactions,
    total: count,
    hasMore: offset + transactions.length < count
  };
}

/**
 * Automatically check and apply Welcome Bonus ($3 for first deposit >= $7)
 */
async function checkAndApplyWelcomeBonus(userId, depositAmount, transaction = null) {
  try {
    // Count successful deposits for this user
    const depositCount = await Transaction.count({
      where: { 
        user_id: userId, 
        type: TRANSACTION_TYPES.DEPOSIT 
      },
      transaction
    });

    // Award bonus ONLY if this is the VERY FIRST deposit and threshold is met ($7)
    if (depositCount === 1 && parseFloat(depositAmount) >= 7) {
      const wallet = await Wallet.findOne({ where: { user_id: userId }, transaction });
      if (!wallet) return false;

      const bonusAmount = 3.00;
      const balanceBefore = parseFloat(wallet.available_balance);
      
      wallet.available_balance = balanceBefore + bonusAmount;
      await wallet.save({ transaction });

      // Record bonus transaction
      await Transaction.create({
        user_id: userId,
        type: TRANSACTION_TYPES.WELCOME_BONUS,
        amount: bonusAmount,
        balance_before: balanceBefore,
        balance_after: wallet.available_balance,
        description: `Welcome Bonus ($${bonusAmount.toFixed(2)}) for first deposit of $${parseFloat(depositAmount).toFixed(2)}`
      }, { transaction });

      // Log activity
      await ActivityLog.create({
        user_id: userId,
        action: 'welcome_bonus_awarded',
        metadata: { 
          deposit_amount: depositAmount, 
          bonus_amount: bonusAmount,
          at: new Date()
        }
      }, { transaction });

      logger.info(`[BONUS] Welcome bonus of $${bonusAmount} awarded to user ${userId}`);
      return true;
    }
  } catch (err) {
    logger.error(`[BONUS] Error checking welcome bonus for user ${userId}:`, err);
  }
  return false;
}

/**
 * Automatically check and apply Email Verification Bonus ($2 for verifying email)
 */
async function checkAndApplyVerificationBonus(userId, transaction = null) {
  try {
    // Check if verification bonus has already been awarded to this user
    const existingBonus = await Transaction.findOne({
      where: {
        user_id: userId,
        type: TRANSACTION_TYPES.VERIFICATION_BONUS
      },
      transaction
    });

    // If already awarded, do nothing
    if (existingBonus) return false;

    const wallet = await Wallet.findOne({ where: { user_id: userId }, transaction });
    if (!wallet) return false;

    const bonusAmount = 2.00;
    const balanceBefore = parseFloat(wallet.available_balance);
    
    wallet.available_balance = balanceBefore + bonusAmount;
    await wallet.save({ transaction });

    // Record bonus transaction
    await Transaction.create({
      user_id: userId,
      type: TRANSACTION_TYPES.VERIFICATION_BONUS,
      amount: bonusAmount,
      balance_before: balanceBefore,
      balance_after: wallet.available_balance,
      description: `Email Verification Bonus ($${bonusAmount.toFixed(2)})`
    }, { transaction });

    // Log activity
    await ActivityLog.create({
      user_id: userId,
      action: 'verification_bonus_awarded',
      metadata: {
        bonus_amount: bonusAmount,
        at: new Date()
      }
    }, { transaction });

    logger.info(`[BONUS] Email verification bonus of $${bonusAmount} awarded to user ${userId}`);
    return true;
  } catch (err) {
    logger.error(`[BONUS] Error checking verification bonus for user ${userId}:`, err);
  }
  return false;
}

module.exports = {
  getUserWallet,
  depositFunds,
  withdrawFunds,
  getTransactionHistory,
  checkAndApplyWelcomeBonus,
  checkAndApplyVerificationBonus
};