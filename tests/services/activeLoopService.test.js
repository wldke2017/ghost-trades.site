const activeLoopService = require('../../services/activeLoopService');
const orderService = require('../../services/orderService');
const sequelize = require('../../db');
const User = require('../../models/user');
const Wallet = require('../../models/wallet');
const Order = require('../../models/order');
const { ORDER_STATUS } = require('../../config/constants');

// Mock orderService to isolate loop logic from DB
jest.mock('../../services/orderService', () => ({
  createOrder: jest.fn(),
  claimOrder: jest.fn(),
  completeOrder: jest.fn()
}));

describe('Active Loop Service (Pool Manager)', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    activeLoopService._setIsRunning(false);
    activeLoopService._setActiveSlots(0);
    activeLoopService._setBuyerIsAdmin(true);
  });

  afterEach(() => {
    activeLoopService.stop();
    jest.restoreAllMocks();
  });

  // ── ensureRammyAccount ────────────────────────────────────────────
  describe('ensureRammyAccount', () => {
    it('should create the Rammy account and wallet if not existing', async () => {
      const findOrCreateSpy = jest.spyOn(User, 'findOrCreate').mockResolvedValue([
        { id: 2, username: 'Rammy', role: 'middleman' }, true
      ]);
      const walletFindSpy = jest.spyOn(Wallet, 'findOne').mockResolvedValue(null);
      const walletCreateSpy = jest.spyOn(Wallet, 'create').mockResolvedValue({ user_id: 2 });

      const user = await activeLoopService._ensureRammyAccount();

      expect(user.username).toBe('Rammy');
      expect(findOrCreateSpy).toHaveBeenCalled();
      expect(walletCreateSpy).toHaveBeenCalled();
    });

    it('should not recreate wallet if it already exists', async () => {
      jest.spyOn(User, 'findOrCreate').mockResolvedValue([
        { id: 2, username: 'Rammy' }, false
      ]);
      jest.spyOn(Wallet, 'findOne').mockResolvedValue({ user_id: 2, available_balance: '5000.00' });
      const walletCreateSpy = jest.spyOn(Wallet, 'create').mockResolvedValue({});

      await activeLoopService._ensureRammyAccount();

      expect(walletCreateSpy).not.toHaveBeenCalled();
    });
  });

  // ── checkAndTopupBalances ─────────────────────────────────────────
  describe('checkAndTopupBalances', () => {
    it('should top up Admin wallet when below $5,000', async () => {
      jest.spyOn(User, 'findOne').mockImplementation(({ where }) => {
        if (where.username === 'Admin') return Promise.resolve({ id: 1, username: 'Admin' });
        if (where.username === 'Rammy') return Promise.resolve({ id: 2, username: 'Rammy' });
        return Promise.resolve(null);
      });
      const adminWallet = { user_id: 1, available_balance: '1200.00', save: jest.fn() };
      const rammyWallet = { user_id: 2, available_balance: '25000.00', save: jest.fn() };
      jest.spyOn(Wallet, 'findOne').mockImplementation(({ where }) => {
        if (where.user_id === 1) return Promise.resolve(adminWallet);
        if (where.user_id === 2) return Promise.resolve(rammyWallet);
        return Promise.resolve(null);
      });

      await activeLoopService._checkAndTopupBalances();

      expect(adminWallet.available_balance).toBe(50000);
      expect(adminWallet.save).toHaveBeenCalled();
      expect(rammyWallet.save).not.toHaveBeenCalled();
    });

    it('should not top up wallets already above threshold', async () => {
      jest.spyOn(User, 'findOne').mockImplementation(({ where }) => {
        if (where.username === 'Admin') return Promise.resolve({ id: 1 });
        if (where.username === 'Rammy') return Promise.resolve({ id: 2 });
        return Promise.resolve(null);
      });
      const adminWallet = { user_id: 1, available_balance: '20000.00', save: jest.fn() };
      const rammyWallet = { user_id: 2, available_balance: '15000.00', save: jest.fn() };
      jest.spyOn(Wallet, 'findOne').mockImplementation(({ where }) => {
        if (where.user_id === 1) return Promise.resolve(adminWallet);
        if (where.user_id === 2) return Promise.resolve(rammyWallet);
        return Promise.resolve(null);
      });

      await activeLoopService._checkAndTopupBalances();

      expect(adminWallet.save).not.toHaveBeenCalled();
      expect(rammyWallet.save).not.toHaveBeenCalled();
    });
  });

  // ── runOrderCycle ─────────────────────────────────────────────────
  describe('runOrderCycle', () => {
    it('should execute CREATE → CLAIM → HOLD → RELEASE and decrement activeSlots', async () => {
      activeLoopService._setIsRunning(true);
      activeLoopService._setActiveSlots(1);

      jest.spyOn(User, 'findOne').mockImplementation(({ where }) => {
        if (where.username === 'Admin') return Promise.resolve({ id: 1 });
        if (where.username === 'Rammy') return Promise.resolve({ id: 2 });
        return Promise.resolve(null);
      });
      jest.spyOn(Wallet, 'findOne').mockResolvedValue({ available_balance: '50000.00', save: jest.fn() });

      const mockOrder = { id: 42, amount: '120.00', buyer_id: 1, middleman_id: 2, toJSON: () => ({ id: 42, amount: '120.00', buyer_id: 1, middleman_id: 2 }) };

      orderService.createOrder.mockResolvedValue({ order: mockOrder, wallet: { available_balance: 49880, locked_balance: 120 } });
      orderService.claimOrder.mockResolvedValue({ order: mockOrder, wallet: { available_balance: 49880, locked_balance: 120 } });
      orderService.completeOrder.mockResolvedValue({
        order: mockOrder,
        buyerWallet: { available_balance: 49997, locked_balance: 0 },
        middlemanWallet: { available_balance: 49997, locked_balance: 0 }
      });

      jest.spyOn(Order, 'count').mockResolvedValue(10);
      jest.spyOn(Order, 'findAll').mockResolvedValue([]);

      // Override setTimeout globally so all delays fire in 0ms (avoids fake timer issues with async/await)
      const origSetTimeout = global.setTimeout;
      global.setTimeout = (fn, _delay) => origSetTimeout(fn, 0);

      const mockIo = { emit: jest.fn() };
      await activeLoopService._runOrderCycle(mockIo, 1, 2);

      global.setTimeout = origSetTimeout;

      expect(orderService.createOrder).toHaveBeenCalledWith(1, expect.any(Number), expect.any(String), mockIo);
      expect(orderService.createOrder.mock.calls[0][1]).toBeGreaterThanOrEqual(18);
      expect(orderService.claimOrder).toHaveBeenCalledWith(2, 42);
      expect(orderService.completeOrder).toHaveBeenCalledWith(42);
      expect(activeLoopService._getActiveSlots()).toBe(0);
      expect(mockIo.emit).toHaveBeenCalledWith('orderCreated',  expect.objectContaining({ id: 42, agentName: expect.any(String) }));
      expect(mockIo.emit).toHaveBeenCalledWith('orderClaimed',  expect.objectContaining({ id: 42, agentName: expect.any(String) }));
      expect(mockIo.emit).toHaveBeenCalledWith('orderCompleted',expect.objectContaining({ id: 42 }));
    }, 15000); // extended timeout since delays become 0ms real async calls

    it('should never create an order below $18.00', async () => {
      activeLoopService._setIsRunning(true);
      activeLoopService._setActiveSlots(1);

      jest.spyOn(User, 'findOne').mockImplementation(({ where }) => {
        if (where.username === 'Admin') return Promise.resolve({ id: 1 });
        if (where.username === 'Rammy') return Promise.resolve({ id: 2 });
        return Promise.resolve(null);
      });
      jest.spyOn(Wallet, 'findOne').mockResolvedValue({ available_balance: '50000.00', save: jest.fn() });
      jest.spyOn(Order, 'count').mockResolvedValue(8);
      jest.spyOn(Order, 'findAll').mockResolvedValue([]);

      const capturedAmounts = [];
      orderService.createOrder.mockImplementation((buyerId, amount) => {
        capturedAmounts.push(amount);
        return Promise.reject(new Error('stop after capture'));
      });

      jest.useFakeTimers();
      const cyclePromise = activeLoopService._runOrderCycle({ emit: jest.fn() }, 1, 2);
      jest.runAllTimers();
      await cyclePromise;

      capturedAmounts.forEach(amt => {
        expect(amt).toBeGreaterThanOrEqual(18.0);
        expect(amt).toBeLessThanOrEqual(300.0);
      });

      jest.useRealTimers();
    });
  });

  // ── broadcastStats ────────────────────────────────────────────────
  describe('broadcastStats', () => {
    it('should emit statsUpdated with correct counts', async () => {
      jest.spyOn(Order, 'count')
        .mockResolvedValueOnce(500)  // totalCreated
        .mockResolvedValueOnce(10)   // totalPending
        .mockResolvedValueOnce(8)    // totalClaimed
        .mockResolvedValueOnce(482); // totalSettled
      jest.spyOn(Order, 'findAll').mockResolvedValue([
        { amount: '100.00' }, { amount: '200.00' }
      ]);

      const mockIo = { emit: jest.fn() };
      await activeLoopService._broadcastStats(mockIo);

      expect(mockIo.emit).toHaveBeenCalledWith('statsUpdated', {
        totalCreated: 500,
        totalPending: 10,
        totalClaimed: 8,
        totalSettled: 482,
        totalCommission: expect.any(String)
      });
    });
  });
});
