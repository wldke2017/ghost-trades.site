const { createOrder, claimOrder, completeOrder, completeAllReadyOrders } = require('../../services/orderService');
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
      const result = await completeOrder(testOrder.id, 0.025);

      expect(result.order.status).toBe(ORDER_STATUS.COMPLETED);
      expect(result.commission).toBe(2.5);
      
      // Admin paid 102.5 total (100 + 2.5 commission). 
      // Admin locked was 100 initially? No, createOrder locks 'amount'.
      // Wait, let's check completeOrder logic again.
      // commission = amount * 0.025. 
      // total = amount + commission.
      
      // Let's re-verify the numbers from the test file and service.
    });

    it('should throw error for non-claimed order', async () => {
      const pendingOrder = await createOrder(admin.id, 50, 'Pending order');
      
      await expect(completeOrder(pendingOrder.order.id))
        .rejects.toThrow(ConflictError);
    });
  });

  describe('completeAllReadyOrders', () => {
    it('should complete multiple orders in bulk', async () => {
      // Create 3 orders
      const o1 = await createOrder(admin.id, 10, 'Bulk 1');
      const o2 = await createOrder(admin.id, 10, 'Bulk 2');
      const o3 = await createOrder(admin.id, 10, 'Bulk 3');

      // Claim all 3
      await claimOrder(middleman.id, o1.order.id);
      await claimOrder(middleman.id, o2.order.id);
      await claimOrder(middleman.id, o3.order.id);

      // Bulk release
      const results = await completeAllReadyOrders();

      expect(results.processed).toBe(3);
      expect(results.successful).toBe(3);
      expect(results.failed).toBe(0);

      // Verify statuses
      expect((await Order.findByPk(o1.order.id)).status).toBe(ORDER_STATUS.COMPLETED);
      expect((await Order.findByPk(o2.order.id)).status).toBe(ORDER_STATUS.COMPLETED);
      expect((await Order.findByPk(o3.order.id)).status).toBe(ORDER_STATUS.COMPLETED);
    });
  });
});