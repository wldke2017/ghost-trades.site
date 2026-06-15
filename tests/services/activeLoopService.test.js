const activeLoopService = require('../../services/activeLoopService');
const orderService = require('../../services/orderService');
const sequelize = require('../../db');
const User = require('../../models/user');
const Wallet = require('../../models/wallet');
const Order = require('../../models/order');

// Mock orderService methods to isolate loop logic
jest.mock('../../services/orderService', () => ({
  createOrder: jest.fn(),
  claimOrder: jest.fn(),
  completeOrder: jest.fn()
}));

describe('Active Loop Service', () => {
  let admin, rammy;

  beforeAll(async () => {
    // Sync database (if database is connected)
    try {
      await sequelize.sync({ force: true });
    } catch (e) {
      // Ignore connection errors if database is not running in sandbox
    }

    // Seed test Admin user manually if sync worked
    try {
      admin = await User.create({
        username: 'Admin',
        password: 'AdminPassword123!',
        role: 'admin',
        is_verified: true
      });
    } catch (e) {
      // Mocked fallback for sandbox environments where DB is not running
      admin = { id: 1, username: 'Admin' };
    }
  });

  afterAll(async () => {
    try {
      await sequelize.close();
    } catch (e) {
      // Ignore
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset service state
    activeLoopService._setIsRunning(false);
    activeLoopService._setCurrentPhase('CREATE');
    activeLoopService._setCurrentOrderDetails(null);
    activeLoopService._setBuyerIsAdmin(true);
  });

  afterEach(() => {
    activeLoopService.stop();
    jest.restoreAllMocks();
  });

  describe('ensureRammyAccount', () => {
    it('should create the Rammy account if it does not exist', async () => {
      // Mock the findOrCreate and findOne calls if database is not connected
      const userFindOrCreateSpy = jest.spyOn(User, 'findOrCreate').mockResolvedValue([
        { id: 2, username: 'Rammy', role: 'middleman' },
        true
      ]);
      const walletFindOneSpy = jest.spyOn(Wallet, 'findOne').mockResolvedValue(null);
      const walletCreateSpy = jest.spyOn(Wallet, 'create').mockResolvedValue({ user_id: 2 });

      const rammyUser = await activeLoopService._ensureRammyAccount();

      expect(rammyUser.username).toBe('Rammy');
      expect(userFindOrCreateSpy).toHaveBeenCalled();
      expect(walletFindOneSpy).toHaveBeenCalled();
      expect(walletCreateSpy).toHaveBeenCalled();

      userFindOrCreateSpy.mockRestore();
      walletFindOneSpy.mockRestore();
      walletCreateSpy.mockRestore();
    });
  });

  describe('checkAndTopupBalances', () => {
    it('should top up wallet balances if they fall below $2,000.00', async () => {
      const userFindOneSpy = jest.spyOn(User, 'findOne').mockImplementation(({ where }) => {
        if (where.username === 'Admin') return Promise.resolve({ id: 1, username: 'Admin' });
        if (where.username === 'Rammy') return Promise.resolve({ id: 2, username: 'Rammy' });
        return Promise.resolve(null);
      });

      const mockAdminWallet = { user_id: 1, available_balance: '1500.00', save: jest.fn() };
      const mockRammyWallet = { user_id: 2, available_balance: '20000.00', save: jest.fn() };

      const walletFindOneSpy = jest.spyOn(Wallet, 'findOne').mockImplementation(({ where }) => {
        if (where.user_id === 1) return Promise.resolve(mockAdminWallet);
        if (where.user_id === 2) return Promise.resolve(mockRammyWallet);
        return Promise.resolve(null);
      });

      await activeLoopService._checkAndTopupBalances();

      expect(mockAdminWallet.available_balance).toBe(20000.00);
      expect(mockAdminWallet.save).toHaveBeenCalled();
      expect(mockRammyWallet.save).not.toHaveBeenCalled(); // Rammy is already at 20000

      userFindOneSpy.mockRestore();
      walletFindOneSpy.mockRestore();
    });
  });

  describe('runLoopStep - CREATE phase', () => {
    it('should create an order using Admin (buyer) and transition to CLAIM phase', async () => {
      activeLoopService._setIsRunning(true);
      activeLoopService._setCurrentPhase('CREATE');

      const userFindOneSpy = jest.spyOn(User, 'findOne').mockImplementation(({ where }) => {
        if (where.username === 'Admin') return Promise.resolve({ id: 1, username: 'Admin' });
        if (where.username === 'Rammy') return Promise.resolve({ id: 2, username: 'Rammy' });
        return Promise.resolve(null);
      });

      const mockWallet = { available_balance: '20000.00', locked_balance: '0.00' };
      const walletFindOneSpy = jest.spyOn(Wallet, 'findOne').mockResolvedValue(mockWallet);

      const mockOrder = {
        id: 123,
        amount: '150.00',
        toJSON: () => ({ id: 123, amount: '150.00' })
      };
      orderService.createOrder.mockResolvedValue({
        order: mockOrder,
        wallet: { available_balance: 19850, locked_balance: 150 }
      });

      const mockIo = { emit: jest.fn() };

      // Mock setTimeout to capture the callback but NOT execute it (prevents cascade)
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn(() => 999);

      await activeLoopService._runLoopStep(mockIo);

      expect(orderService.createOrder).toHaveBeenCalledWith(1, expect.any(Number), expect.any(String), mockIo);
      
      const lastCallAmount = orderService.createOrder.mock.calls[0][1];
      expect(lastCallAmount).toBeGreaterThanOrEqual(18.00);

      // After CREATE, phase transitions to CLAIM and setTimeout is called to schedule next step
      expect(global.setTimeout).toHaveBeenCalled();
      expect(activeLoopService._getCurrentPhase()).toBe('CLAIM');
      expect(activeLoopService._getCurrentOrderDetails()).toBeDefined();
      expect(activeLoopService._getCurrentOrderDetails().orderId).toBe(123);
      expect(mockIo.emit).toHaveBeenCalledWith('orderCreated', expect.objectContaining({
        id: 123,
        agentName: expect.any(String)
      }));

      // Cleanup
      global.setTimeout = originalSetTimeout;
      userFindOneSpy.mockRestore();
      walletFindOneSpy.mockRestore();
    });
  });

  describe('runLoopStep - CLAIM phase', () => {
    it('should claim the order using Rammy (middleman) and transition to RELEASE phase', async () => {
      activeLoopService._setIsRunning(true);
      activeLoopService._setCurrentPhase('CLAIM');
      activeLoopService._setCurrentOrderDetails({
        orderId: 123,
        amount: 150.00,
        buyerId: 1,
        middlemanId: 2,
        agentName: 'Sarah Jenkins'
      });

      const userFindOneSpy = jest.spyOn(User, 'findOne').mockImplementation(({ where }) => {
        if (where.username === 'Admin') return Promise.resolve({ id: 1, username: 'Admin' });
        if (where.username === 'Rammy') return Promise.resolve({ id: 2, username: 'Rammy' });
        return Promise.resolve(null);
      });

      const mockOrder = {
        id: 123,
        amount: '150.00',
        toJSON: () => ({ id: 123, amount: '150.00' })
      };
      orderService.claimOrder.mockResolvedValue({
        order: mockOrder,
        wallet: { available_balance: 19850, locked_balance: 150 }
      });

      const mockIo = { emit: jest.fn() };

      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn(() => 999);

      await activeLoopService._runLoopStep(mockIo);

      expect(orderService.claimOrder).toHaveBeenCalledWith(2, 123);
      expect(global.setTimeout).toHaveBeenCalled();
      expect(activeLoopService._getCurrentPhase()).toBe('RELEASE');
      expect(mockIo.emit).toHaveBeenCalledWith('orderClaimed', expect.objectContaining({
        id: 123,
        agentName: 'Sarah Jenkins'
      }));

      global.setTimeout = originalSetTimeout;
      userFindOneSpy.mockRestore();
    });
  });

  describe('runLoopStep - RELEASE phase', () => {
    it('should complete the order, swap roles, reset details, and transition to CREATE phase', async () => {
      activeLoopService._setIsRunning(true);
      activeLoopService._setCurrentPhase('RELEASE');
      activeLoopService._setBuyerIsAdmin(true);
      activeLoopService._setCurrentOrderDetails({
        orderId: 123,
        amount: 150.00,
        buyerId: 1,
        middlemanId: 2,
        agentName: 'Sarah Jenkins'
      });

      const userFindOneSpy = jest.spyOn(User, 'findOne').mockImplementation(({ where }) => {
        if (where.username === 'Admin') return Promise.resolve({ id: 1, username: 'Admin' });
        if (where.username === 'Rammy') return Promise.resolve({ id: 2, username: 'Rammy' });
        return Promise.resolve(null);
      });

      const mockOrder = {
        id: 123,
        buyer_id: 1,
        middleman_id: 2,
        amount: '150.00',
        toJSON: () => ({ id: 123, buyer_id: 1, middleman_id: 2, amount: '150.00' })
      };
      orderService.completeOrder.mockResolvedValue({
        order: mockOrder,
        buyerWallet: { available_balance: 19850, locked_balance: 0 },
        middlemanWallet: { available_balance: 20150, locked_balance: 0 }
      });

      const mockIo = { emit: jest.fn() };

      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn(() => 999);

      await activeLoopService._runLoopStep(mockIo);

      expect(orderService.completeOrder).toHaveBeenCalledWith(123);
      expect(global.setTimeout).toHaveBeenCalled();
      expect(activeLoopService._getCurrentPhase()).toBe('CREATE');
      expect(activeLoopService._getCurrentOrderDetails()).toBeNull();
      expect(activeLoopService._getBuyerIsAdmin()).toBe(false); // Roles swapped
      expect(mockIo.emit).toHaveBeenCalledWith('orderCompleted', expect.objectContaining({
        id: 123,
        agentName: 'Sarah Jenkins'
      }));

      global.setTimeout = originalSetTimeout;
      userFindOneSpy.mockRestore();
    });
  });
});
