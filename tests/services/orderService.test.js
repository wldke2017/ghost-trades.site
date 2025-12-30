const { createOrder, claimOrder, completeOrder } = require('../../services/orderService');
const sequelize = require('../../db');
const User = require('../../models/user');
const Wallet = require('../../models/wallet');
const Order = require('../../models/order');
const { ORDER_STATUS } = require('../../config/constants');
const { InsufficientFundsError, NotFoundError, ConflictError } = require('../../utils/errors');

describe('Order Service', () => {
  let admin, middleman;

  beforeAll(async () => {
    // Sync database
    await sequelize.sync({ force: true });

    // Create test users
    admin = await User.create({
      username: 'test_admin',
      password: 'password123',
      role: 'admin'
    });

    middleman = await User.create({
      username: 'test_middleman',
      password: 'password123',
      role: 'middleman'
    });

    // Create wallets
    await Wallet.create({
      user_id: admin.id,
      available_balance: 1000,
      locked_balance: 0
    });

    await Wallet.create({
      user_id: middleman.id,
      available_balance: 500,
      locked_balance: 0
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('createOrder', () => {
    it('should create an order successfully', async () => {
      const result = await createOrder(admin.id, 100, 'Test order');

      expect(result.order).toBeDefined();
      expect(result.order.amount).toBe('100.00');
      expect(result.order.status).toBe(ORDER_STATUS.PENDING);
      expect(result.wallet.available_balance).toBe('900.00');
      expect(result.wallet.locked_balance).toBe('100.00');
    });

    it('should throw error for insufficient funds', async () => {
      await expect(createOrder(admin.id, 2000, 'Too expensive'))
        .rejects.toThrow(InsufficientFundsError);
    });

    it('should throw error for invalid amount', async () => {
      await expect(createOrder(admin.id, -10, 'Invalid'))
        .rejects.toThrow('Amount must be greater than 0');
    });
  });

  describe('claimOrder', () => {
    let testOrder;

    beforeEach(async () => {
      const result = await createOrder(admin.id, 50, 'Order to claim');
      testOrder = result.order;
    });

    it('should claim an order successfully', async () => {
      const result = await claimOrder(middleman.id, testOrder.id);

      expect(result.order.status).toBe(ORDER_STATUS.CLAIMED);
      expect(result.order.middleman_id).toBe(middleman.id);
      expect(result.wallet.locked_balance).toBe('50.00');
    });

    it('should throw error for non-existent order', async () => {
      await expect(claimOrder(middleman.id, 99999))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw error for insufficient funds', async () => {
      const bigOrder = await createOrder(admin.id, 600, 'Too big');
      
      await expect(claimOrder(middleman.id, bigOrder.order.id))
        .rejects.toThrow(InsufficientFundsError);
    });

    it('should throw error for already claimed order', async () => {
      await claimOrder(middleman.id, testOrder.id);
      
      await expect(claimOrder(middleman.id, testOrder.id))
        .rejects.toThrow(ConflictError);
    });
  });

  describe('completeOrder', () => {
    let testOrder;

    beforeEach(async () => {
      const created = await createOrder(admin.id, 100, 'Order to complete');
      await claimOrder(middleman.id, created.order.id);
      testOrder = await Order.findByPk(created.order.id);
    });

    it('should complete an order with commission', async () => {
      const result = await completeOrder(testOrder.id, 0.05);

      expect(result.order.status).toBe(ORDER_STATUS.COMPLETED);
      expect(result.commission).toBe(5);
      
      // Middleman gets collateral (100) + commission (5) = 105
      // Middleman locked was 100, so available should increase by 105
      expect(parseFloat(result.middlemanWallet.available_balance)).toBeCloseTo(505, 2);
      
      // Buyer locked was 100, should get back 95 (100 - 5 commission)
      expect(parseFloat(result.buyerWallet.available_balance)).toBeCloseTo(795, 2);
    });

    it('should throw error for non-claimed order', async () => {
      const pendingOrder = await createOrder(admin.id, 50, 'Pending order');
      
      await expect(completeOrder(pendingOrder.order.id))
        .rejects.toThrow(ConflictError);
    });
  });
});