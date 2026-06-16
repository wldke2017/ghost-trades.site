const Order = require('../models/order');
const User = require('../models/user');
const Wallet = require('../models/wallet');
const { ORDER_STATUS } = require('../config/constants');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────
const TARGET_POOL_SIZE = 10;   // keep ~10 orders CLAIMED at all times
const MIN_POOL_SIZE    = 8;    // never drop below 8 in-progress
const STAGGER_MS       = 3000; // ms between each initial spawn
const MONITOR_INTERVAL = 15000; // ms between pool-size health checks

// Phase timings (ms)
const CLAIM_DELAY_MIN   =  8000;
const CLAIM_DELAY_MAX   = 18000;
const HOLD_DELAY_MIN    = 90000;  // 1.5 min hold (keeps "In Progress" high)
const HOLD_DELAY_MAX    = 180000; // 3 min hold
const COOLDOWN_MIN      = 10000;  // 10s before spawning replacement
const COOLDOWN_MAX      = 25000;

// Diverse agent name pool
const AGENT_NAMES = [
  'David Kiprop',   'Sarah Jenkins',  'Michael Mwangi', 'Elena Rostova',
  'Charles Ochieng','Chloe Dupont',   'Yusuf Ali',      'Amanda Silva',
  'Kenji Tanaka',   'Amina Juma',     'Marcus Vance',   'Priya Patel',
  'Jonathan Adeyemi','Grace Wambui',  'Carlos Mendez',  'Fatima Al-Sayed',
  'John Kamau',     'Alice Miller',   'Hiroshi Tanaka', 'Sophie Dubois',
  'George Njoroge', 'Emma Watson',    'Lucas Rodriguez','Daniel Kimani',
  'Olga Ivanova',   'Tariq Mahmoud',  'Aiko Yamamoto',  'Felix Otieno',
  'Isabella Ferreira','Ahmed Hassan'
];

// ─────────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────────
let isRunning       = false;
let monitorTimer    = null;
let activeSlots     = 0;   // number of concurrent order-cycles running
let buyerIsAdmin    = true; // alternate roles across slots

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randAmount() {
  // $18.00 – $300.00, 2 decimal places
  return parseFloat((18 + Math.random() * 282).toFixed(2));
}
function randAgent() {
  return AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)];
}

/**
 * Emit a live global-stats update to all connected browsers so the
 * "In Progress" counter refreshes without a page reload.
 */
async function broadcastStats(io) {
  if (!io) return;
  try {
    const totalCreated = await Order.count();
    const totalPending = await Order.count({ where: { status: ORDER_STATUS.PENDING } });
    const totalClaimed = await Order.count({ where: { status: ORDER_STATUS.CLAIMED } });
    const totalSettled = await Order.count({ where: { status: ORDER_STATUS.COMPLETED } });
    const allCompleted = await Order.findAll({ where: { status: ORDER_STATUS.COMPLETED }, attributes: ['amount'] });
    const totalCommission = allCompleted.reduce((s, o) => s + parseFloat(o.amount) * 0.025, 0);

    io.emit('statsUpdated', {
      totalCreated,
      totalPending,
      totalClaimed,
      totalSettled,
      totalCommission: totalCommission.toFixed(2)
    });
  } catch (e) {
    logger.warn('[ACTIVE-LOOP] broadcastStats error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  Account seeding & balance management
// ─────────────────────────────────────────────────────────────
async function ensureRammyAccount() {
  const [rammyUser, created] = await User.findOrCreate({
    where: { username: 'Rammy' },
    defaults: {
      username: 'Rammy',
      password: 'RammySecurePassword123!',
      role: 'middleman',
      is_verified: true
    }
  });
  if (created) logger.info('[ACTIVE-LOOP] Rammy account seeded');

  const wallet = await Wallet.findOne({ where: { user_id: rammyUser.id } });
  if (!wallet) {
    await Wallet.create({ user_id: rammyUser.id, available_balance: 0, locked_balance: 0 });
    logger.info('[ACTIVE-LOOP] Wallet created for Rammy');
  }
  return rammyUser;
}

async function checkAndTopupBalances() {
  const TOPUP_TO    = 50000; // top up to $50k — supports large concurrent pools
  const TOPUP_BELOW =  5000; // trigger when < $5k available

  for (const username of ['Admin', 'Rammy']) {
    const user = await User.findOne({ where: { username } });
    if (!user) continue;

    let wallet = await Wallet.findOne({ where: { user_id: user.id } });
    if (!wallet) {
      wallet = await Wallet.create({ user_id: user.id, available_balance: TOPUP_TO, locked_balance: 0 });
      logger.info(`[ACTIVE-LOOP] Wallet created for ${username} at $${TOPUP_TO}`);
      continue;
    }

    if (parseFloat(wallet.available_balance) < TOPUP_BELOW) {
      wallet.available_balance = TOPUP_TO;
      await wallet.save();
      logger.info(`[ACTIVE-LOOP] ${username} wallet topped up to $${TOPUP_TO}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Single order cycle  (CREATE → CLAIM → HOLD → RELEASE)
// ─────────────────────────────────────────────────────────────
async function runOrderCycle(io, buyerId, middlemanId) {
  if (!isRunning) return;

  const orderService = require('./orderService');
  const agentName    = randAgent();
  const amount       = randAmount();
  const description  = `Secured Escrow Trade #${rand(1000, 99999)}`;

  let orderId = null;

  try {
    // ── Phase 1: CREATE ───────────────────────────────────────
    await checkAndTopupBalances();

    const createResult = await orderService.createOrder(buyerId, amount, description, io);
    orderId = createResult.order.id;

    if (io) {
      io.emit('orderCreated', { ...createResult.order.toJSON(), agentName });
      io.emit('walletUpdated', { user_id: buyerId, ...createResult.wallet });
    }

    logger.info(`[ACTIVE-LOOP] ✔ Created order #${orderId} ($${amount}) — agent: ${agentName}`);

    // ── Phase 2: CLAIM ────────────────────────────────────────
    await new Promise(r => setTimeout(r, rand(CLAIM_DELAY_MIN, CLAIM_DELAY_MAX)));
    if (!isRunning) return;

    const claimResult = await orderService.claimOrder(middlemanId, orderId);

    if (io) {
      io.emit('orderClaimed', { ...claimResult.order.toJSON(), agentName });
      io.emit('walletUpdated', { user_id: middlemanId, ...claimResult.wallet });
    }

    await broadcastStats(io); // live-update "In Progress" counter

    logger.info(`[ACTIVE-LOOP] ✔ Claimed  order #${orderId} — ${agentName}`);

    // ── Phase 3: HOLD (keep in CLAIMED so "In Progress" stays high) ──
    await new Promise(r => setTimeout(r, rand(HOLD_DELAY_MIN, HOLD_DELAY_MAX)));
    if (!isRunning) return;

    // ── Phase 4: RELEASE ──────────────────────────────────────
    const releaseResult = await orderService.completeOrder(orderId);

    if (io) {
      io.emit('orderCompleted', { ...releaseResult.order.toJSON(), agentName });
      io.emit('walletUpdated', { user_id: releaseResult.order.middleman_id, ...releaseResult.middlemanWallet });
      io.emit('walletUpdated', { user_id: releaseResult.order.buyer_id,     ...releaseResult.buyerWallet });
    }

    await broadcastStats(io);

    logger.info(`[ACTIVE-LOOP] ✔ Released order #${orderId} — ${agentName}`);

  } catch (err) {
    logger.error(`[ACTIVE-LOOP] Error in order cycle (order #${orderId || 'NEW'}):`, err.message);
  } finally {
    activeSlots--;

    // Spawn a replacement after a short cooldown so the pool self-replenishes
    if (isRunning) {
      const cooldown = rand(COOLDOWN_MIN, COOLDOWN_MAX);
      setTimeout(() => spawnSlot(io), cooldown);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Spawn one concurrent cycle slot (alternating buyer/middleman)
// ─────────────────────────────────────────────────────────────
async function spawnSlot(io) {
  if (!isRunning) return;

  try {
    const admin = await User.findOne({ where: { username: 'Admin' } });
    const rammy = await User.findOne({ where: { username: 'Rammy' } });
    if (!admin || !rammy) {
      logger.warn('[ACTIVE-LOOP] Admin or Rammy missing — cannot spawn slot');
      return;
    }

    const buyerId      = buyerIsAdmin ? admin.id : rammy.id;
    const middlemanId  = buyerIsAdmin ? rammy.id  : admin.id;
    buyerIsAdmin       = !buyerIsAdmin; // alternate each slot

    activeSlots++;
    runOrderCycle(io, buyerId, middlemanId); // fire-and-forget
  } catch (err) {
    logger.error('[ACTIVE-LOOP] spawnSlot error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  Pool health monitor — ensures we never drop below MIN_POOL_SIZE
// ─────────────────────────────────────────────────────────────
async function monitorPool(io) {
  if (!isRunning) return;

  try {
    // Count CLAIMED orders that actually belong to Admin/Rammy cycle
    const claimedCount = await Order.count({ where: { status: ORDER_STATUS.CLAIMED } });

    logger.info(`[ACTIVE-LOOP] Pool health: ${claimedCount} claimed, ${activeSlots} active slots`);

    // If below minimum, spawn extra slots immediately
    const deficit = MIN_POOL_SIZE - claimedCount;
    if (deficit > 0) {
      logger.info(`[ACTIVE-LOOP] Pool below minimum (${claimedCount} < ${MIN_POOL_SIZE}). Spawning ${deficit} extra slot(s).`);
      for (let i = 0; i < deficit; i++) {
        await new Promise(r => setTimeout(r, i * 1500)); // stagger by 1.5s each
        spawnSlot(io);
      }
    }

    await broadcastStats(io);
  } catch (err) {
    logger.error('[ACTIVE-LOOP] Monitor error:', err.message);
  }

  // Schedule next health check
  if (isRunning) {
    monitorTimer = setTimeout(() => monitorPool(io), MONITOR_INTERVAL);
  }
}

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────
module.exports = {
  async start(io) {
    if (isRunning) {
      logger.info('[ACTIVE-LOOP] Already running.');
      return;
    }
    isRunning = true;
    logger.info(`[ACTIVE-LOOP] Starting pool manager (target: ${TARGET_POOL_SIZE} concurrent orders)...`);

    try {
      await ensureRammyAccount();
      await checkAndTopupBalances();

      // Stagger the initial spawn of TARGET_POOL_SIZE slots so DB isn't hammered
      for (let i = 0; i < TARGET_POOL_SIZE; i++) {
        setTimeout(() => spawnSlot(io), i * STAGGER_MS);
      }

      // Start the pool health monitor after all slots have had time to settle
      const monitorStart = TARGET_POOL_SIZE * STAGGER_MS + 30000;
      setTimeout(() => monitorPool(io), monitorStart);

      logger.info(`[ACTIVE-LOOP] ${TARGET_POOL_SIZE} order slots spawned (staggered over ${TARGET_POOL_SIZE * STAGGER_MS / 1000}s). Monitor starts in ${monitorStart / 1000}s.`);
    } catch (err) {
      logger.error('[ACTIVE-LOOP] Initialization failed:', err.message);
    }
  },

  stop() {
    if (!isRunning) return;
    isRunning = false;
    if (monitorTimer) {
      clearTimeout(monitorTimer);
      monitorTimer = null;
    }
    activeSlots = 0;
    logger.info('[ACTIVE-LOOP] Pool manager stopped.');
  },

  // ── Test hooks ─────────────────────────────────────────────
  _ensureRammyAccount:     ensureRammyAccount,
  _checkAndTopupBalances:  checkAndTopupBalances,
  _broadcastStats:         broadcastStats,
  _runOrderCycle:          runOrderCycle,
  _getIsRunning:           () => isRunning,
  _setIsRunning:           (v) => { isRunning = v; },
  _getActiveSlots:         () => activeSlots,
  _setActiveSlots:         (v) => { activeSlots = v; },
  _getBuyerIsAdmin:        () => buyerIsAdmin,
  _setBuyerIsAdmin:        (v) => { buyerIsAdmin = v; }
};
