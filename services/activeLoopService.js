const Order = require('../models/order');
const User = require('../models/user');
const Wallet = require('../models/wallet');
const { ORDER_STATUS } = require('../config/constants');
const logger = require('../utils/logger');

// List of claiming agent names (diverse set of local and global names)
const AGENT_NAMES = [
  'David Kiprop',
  'Sarah Jenkins',
  'Michael Mwangi',
  'Elena Rostova',
  'Charles Ochieng',
  'Chloe Dupont',
  'Yusuf Ali',
  'Amanda Silva',
  'Kenji Tanaka',
  'Amina Juma',
  'Marcus Vance',
  'Priya Patel',
  'Jonathan Vance',
  'Grace Wambui',
  'Carlos Mendez',
  'Fatima Al-Sayed',
  'John Kamau',
  'Alice Miller',
  'Hiroshi Tanaka',
  'Sophie Dubois',
  'George Njoroge',
  'Emma Watson',
  'Lucas Rodriguez',
  'Daniel Kimani',
  'Olga Ivanova',
  'Tariq Mahmoud'
];

let loopTimeout = null;
let currentPhase = 'CREATE'; // 'CREATE', 'CLAIM', 'RELEASE'
let currentOrderDetails = null; // { orderId, amount, buyerId, middlemanId, agentName }
let isRunning = false;

// We alternate roles:
// Circle 1: buyer = Admin, middleman = Rammy
// Circle 2: buyer = Rammy, middleman = Admin
let buyerIsAdmin = true;

/**
 * Ensures Rammy user exists and has a wallet
 */
async function ensureRammyAccount() {
  try {
    const [rammyUser, created] = await User.findOrCreate({
      where: { username: 'Rammy' },
      defaults: {
        username: 'Rammy',
        password: 'RammySecurePassword123!', // gets hashed by hook
        role: 'middleman', // standard middleman role
        is_verified: true
      }
    });

    if (created) {
      logger.info('[ACTIVE-LOOP] Rammy account seeded');
    }
    
    // Ensure wallet exists (should be created by hook, but check just in case)
    const wallet = await Wallet.findOne({ where: { user_id: rammyUser.id } });
    if (!wallet) {
      await Wallet.create({
        user_id: rammyUser.id,
        available_balance: 0.00,
        locked_balance: 0.00
      });
      logger.info('[ACTIVE-LOOP] Wallet created for Rammy');
    }
    return rammyUser;
  } catch (err) {
    logger.error('[ACTIVE-LOOP] Error ensuring Rammy account:', err);
    throw err;
  }
}

/**
 * Checks balance and tops up Admin and Rammy accounts if below threshold
 */
async function checkAndTopupBalances() {
  try {
    const admin = await User.findOne({ where: { username: 'Admin' } });
    const rammy = await User.findOne({ where: { username: 'Rammy' } });

    if (!admin) {
      logger.warn('[ACTIVE-LOOP] Admin user not found. Cannot topup Admin wallet.');
    } else {
      let adminWallet = await Wallet.findOne({ where: { user_id: admin.id } });
      if (!adminWallet) {
        adminWallet = await Wallet.create({
          user_id: admin.id,
          available_balance: 20000.00,
          locked_balance: 0.00
        });
      } else if (parseFloat(adminWallet.available_balance) < 2000.00) {
        adminWallet.available_balance = 20000.00;
        await adminWallet.save();
        logger.info(`[ACTIVE-LOOP] Admin wallet topped up to $20,000.00`);
      }
    }

    if (!rammy) {
      logger.warn('[ACTIVE-LOOP] Rammy user not found. Cannot topup Rammy wallet.');
    } else {
      let rammyWallet = await Wallet.findOne({ where: { user_id: rammy.id } });
      if (!rammyWallet) {
        rammyWallet = await Wallet.create({
          user_id: rammy.id,
          available_balance: 20000.00,
          locked_balance: 0.00
        });
      } else if (parseFloat(rammyWallet.available_balance) < 2000.00) {
        rammyWallet.available_balance = 20000.00;
        await rammyWallet.save();
        logger.info(`[ACTIVE-LOOP] Rammy wallet topped up to $20,000.00`);
      }
    }
  } catch (err) {
    logger.error('[ACTIVE-LOOP] Error checking/topping up wallets:', err);
  }
}

/**
 * Initiates the loop workflow step
 */
async function runLoopStep(io) {
  if (!isRunning) return;

  // Import orderService inside step to avoid circular dependency issues at boot
  const orderService = require('./orderService');

  try {
    const admin = await User.findOne({ where: { username: 'Admin' } });
    const rammy = await User.findOne({ where: { username: 'Rammy' } });

    if (!admin || !rammy) {
      logger.warn('[ACTIVE-LOOP] Admin or Rammy account missing. Rescheduling step.');
      loopTimeout = setTimeout(() => runLoopStep(io), 15000);
      return;
    }

    if (currentPhase === 'CREATE') {
      // Step 1: Check and top up balances
      await checkAndTopupBalances();

      // Determine buyer and middleman for this cycle
      const buyerId = buyerIsAdmin ? admin.id : rammy.id;
      const middlemanId = buyerIsAdmin ? rammy.id : admin.id;

      // Random order amount >= $18
      const amount = parseFloat((18.00 + Math.random() * 282.00).toFixed(2));
      const description = `Automated Escrow Trade #${Math.floor(1000 + Math.random() * 9000)}`;

      logger.info(`[ACTIVE-LOOP] Creating order: buyerId=${buyerId}, amount=${amount}`);

      const result = await orderService.createOrder(buyerId, amount, description, io);
      const order = result.order;

      // Select a random agent name for the claim phase
      const agentName = AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)];

      currentOrderDetails = {
        orderId: order.id,
        amount: amount,
        buyerId: buyerId,
        middlemanId: middlemanId,
        agentName: agentName
      };

      if (io) {
        const orderForEmit = { ...order.toJSON(), agentName };
        io.emit('orderCreated', orderForEmit);
        io.emit('walletUpdated', {
          user_id: buyerId,
          available_balance: result.wallet.available_balance,
          locked_balance: result.wallet.locked_balance
        });
      }

      currentPhase = 'CLAIM';
      // Wait 8-15 seconds before claiming
      const claimDelay = Math.floor(8000 + Math.random() * 7000);
      logger.info(`[ACTIVE-LOOP] Order #${order.id} created. Next: CLAIM in ${claimDelay/1000}s`);
      loopTimeout = setTimeout(() => runLoopStep(io), claimDelay);

    } else if (currentPhase === 'CLAIM') {
      if (!currentOrderDetails) {
        currentPhase = 'CREATE';
        loopTimeout = setTimeout(() => runLoopStep(io), 5000);
        return;
      }

      const { orderId, middlemanId, agentName } = currentOrderDetails;
      logger.info(`[ACTIVE-LOOP] Claiming order #${orderId} using middlemanId=${middlemanId}`);

      const result = await orderService.claimOrder(middlemanId, orderId);
      const order = result.order;

      if (io) {
        const orderForEmit = { ...order.toJSON(), agentName };
        io.emit('orderClaimed', orderForEmit);
        io.emit('walletUpdated', {
          user_id: middlemanId,
          available_balance: result.wallet.available_balance,
          locked_balance: result.wallet.locked_balance
        });
      }

      currentPhase = 'RELEASE';
      // Wait 15-30 seconds before releasing
      const releaseDelay = Math.floor(15000 + Math.random() * 15000);
      logger.info(`[ACTIVE-LOOP] Order #${orderId} claimed. Next: RELEASE in ${releaseDelay/1000}s`);
      loopTimeout = setTimeout(() => runLoopStep(io), releaseDelay);

    } else if (currentPhase === 'RELEASE') {
      if (!currentOrderDetails) {
        currentPhase = 'CREATE';
        loopTimeout = setTimeout(() => runLoopStep(io), 5000);
        return;
      }

      const { orderId, agentName } = currentOrderDetails;
      logger.info(`[ACTIVE-LOOP] Completing/releasing order #${orderId}`);

      const result = await orderService.completeOrder(orderId);
      const order = result.order;

      if (io) {
        const orderForEmit = { ...order.toJSON(), agentName };
        io.emit('orderCompleted', orderForEmit);
        io.emit('walletUpdated', {
          user_id: order.middleman_id,
          available_balance: result.middlemanWallet.available_balance,
          locked_balance: result.middlemanWallet.locked_balance
        });
        io.emit('walletUpdated', {
          user_id: order.buyer_id,
          available_balance: result.buyerWallet.available_balance,
          locked_balance: result.buyerWallet.locked_balance
        });
      }

      // Cycle completed! Reset state, swap roles, prepare for next creation
      currentPhase = 'CREATE';
      currentOrderDetails = null;
      buyerIsAdmin = !buyerIsAdmin; // Swap roles

      // Wait 45-90 seconds before starting the next circle
      const nextCycleDelay = Math.floor(45000 + Math.random() * 45000);
      logger.info(`[ACTIVE-LOOP] Circle completed. Next circle starts in ${nextCycleDelay/1000}s`);
      loopTimeout = setTimeout(() => runLoopStep(io), nextCycleDelay);
    }

  } catch (err) {
    logger.error('[ACTIVE-LOOP] Error in loop step:', err);
    // On error, reset to CREATE phase, swap roles (or retry) and schedule next attempt in 15 seconds
    currentPhase = 'CREATE';
    currentOrderDetails = null;
    buyerIsAdmin = !buyerIsAdmin;
    loopTimeout = setTimeout(() => runLoopStep(io), 15000);
  }
}

module.exports = {
  async start(io) {
    if (isRunning) {
      logger.info('[ACTIVE-LOOP] Loop is already running.');
      return;
    }

    isRunning = true;
    logger.info('[ACTIVE-LOOP] Initializing Active Escrow Loop service...');

    try {
      await ensureRammyAccount();
      await checkAndTopupBalances();
      
      // Start loop execution
      runLoopStep(io);
    } catch (err) {
      logger.error('[ACTIVE-LOOP] Initialization failed:', err);
    }
  },

  stop() {
    if (!isRunning) return;
    isRunning = false;
    if (loopTimeout) {
      clearTimeout(loopTimeout);
      loopTimeout = null;
    }
    logger.info('[ACTIVE-LOOP] Loop service stopped.');
  },

  // Exported for unit testing only
  _ensureRammyAccount: ensureRammyAccount,
  _checkAndTopupBalances: checkAndTopupBalances,
  _runLoopStep: runLoopStep,
  _getIsRunning: () => isRunning,
  _setIsRunning: (val) => { isRunning = val; },
  _setBuyerIsAdmin: (val) => { buyerIsAdmin = val; },
  _getBuyerIsAdmin: () => buyerIsAdmin,
  _getCurrentPhase: () => currentPhase,
  _setCurrentPhase: (val) => { currentPhase = val; },
  _getCurrentOrderDetails: () => currentOrderDetails,
  _setCurrentOrderDetails: (val) => { currentOrderDetails = val; }
};
