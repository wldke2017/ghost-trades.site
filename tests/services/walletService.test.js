/* eslint-env jest */
const { checkAndApplyWelcomeBonus, checkAndApplyVerificationBonus } = require('../../services/walletService');
const Wallet = require('../../models/wallet');
const Transaction = require('../../models/transaction');
const ActivityLog = require('../../models/activityLog');
const { TRANSACTION_TYPES } = require('../../config/constants');

// Mock all Sequelize models
jest.mock('../../models/wallet');
jest.mock('../../models/transaction');
jest.mock('../../models/activityLog');

describe('Wallet Service Bonuses Unit Tests', () => {
  const userId = 123;
  let mockTransaction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction = {}; // Mock transaction object
  });

  describe('checkAndApplyWelcomeBonus', () => {
    it('should award welcome bonus when it is the first deposit and amount is >= $7.00', async () => {
      // Mock Transaction.count to return 1 (representing the current deposit transaction is already created)
      Transaction.count.mockResolvedValue(1);

      // Mock Wallet.findOne to find the user's wallet
      const mockWallet = {
        user_id: userId,
        available_balance: 5.00,
        save: jest.fn().mockResolvedValue(true)
      };
      Wallet.findOne.mockResolvedValue(mockWallet);

      // Mock Transaction.create and ActivityLog.create
      Transaction.create.mockResolvedValue({});
      ActivityLog.create.mockResolvedValue({});

      const result = await checkAndApplyWelcomeBonus(userId, 7.00, mockTransaction);

      // Assertions
      expect(result).toBe(true);
      expect(mockWallet.available_balance).toBe(8.00); // 5 + 3 welcome bonus
      expect(mockWallet.save).toHaveBeenCalledWith({ transaction: mockTransaction });
      expect(Transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          type: TRANSACTION_TYPES.WELCOME_BONUS,
          amount: 3.00,
          balance_before: 5.00,
          balance_after: 8.00
        }),
        { transaction: mockTransaction }
      );
      expect(ActivityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          action: 'welcome_bonus_awarded'
        }),
        { transaction: mockTransaction }
      );
    });

    it('should NOT award welcome bonus when deposit amount is < $7.00', async () => {
      Transaction.count.mockResolvedValue(1);

      const result = await checkAndApplyWelcomeBonus(userId, 6.99, mockTransaction);

      expect(result).toBe(false);
      expect(Wallet.findOne).not.toHaveBeenCalled();
      expect(Transaction.create).not.toHaveBeenCalled();
    });

    it('should NOT award welcome bonus when it is not the first deposit', async () => {
      // e.g. second deposit
      Transaction.count.mockResolvedValue(2);

      const result = await checkAndApplyWelcomeBonus(userId, 10.00, mockTransaction);

      expect(result).toBe(false);
      expect(Wallet.findOne).not.toHaveBeenCalled();
      expect(Transaction.create).not.toHaveBeenCalled();
    });
  });

  describe('checkAndApplyVerificationBonus', () => {
    it('should award verification bonus when it has not been awarded yet', async () => {
      // Mock Transaction.findOne to return null (no existing bonus)
      Transaction.findOne.mockResolvedValue(null);

      // Mock Wallet.findOne to find the user's wallet
      const mockWallet = {
        user_id: userId,
        available_balance: 10.00,
        save: jest.fn().mockResolvedValue(true)
      };
      Wallet.findOne.mockResolvedValue(mockWallet);

      // Mock Transaction.create and ActivityLog.create
      Transaction.create.mockResolvedValue({});
      ActivityLog.create.mockResolvedValue({});

      const result = await checkAndApplyVerificationBonus(userId, mockTransaction);

      // Assertions
      expect(result).toBe(true);
      expect(mockWallet.available_balance).toBe(12.00); // 10 + 2 verification bonus
      expect(mockWallet.save).toHaveBeenCalledWith({ transaction: mockTransaction });
      expect(Transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          type: TRANSACTION_TYPES.VERIFICATION_BONUS,
          amount: 2.00,
          balance_before: 10.00,
          balance_after: 12.00
        }),
        { transaction: mockTransaction }
      );
      expect(ActivityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          action: 'verification_bonus_awarded'
        }),
        { transaction: mockTransaction }
      );
    });

    it('should NOT award verification bonus when already awarded', async () => {
      // Mock Transaction.findOne to return existing transaction (already awarded)
      Transaction.findOne.mockResolvedValue({ id: 1 });

      const result = await checkAndApplyVerificationBonus(userId, mockTransaction);

      expect(result).toBe(false);
      expect(Wallet.findOne).not.toHaveBeenCalled();
      expect(Transaction.create).not.toHaveBeenCalled();
    });
  });
});
