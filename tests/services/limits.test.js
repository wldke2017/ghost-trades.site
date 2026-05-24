/* eslint-env jest */
const express = require('express');
const request = require('supertest');

// Mock rateLimiters
jest.mock('../../middleware/rateLimiter', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  transactionLimiter: (req, res, next) => next(),
  uploadLimiter: (req, res, next) => next()
}));

// Mock authentication middleware
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { id: 1, username: 'test_user', role: 'middleman', email: 'test@example.com' };
    next();
  },
  isAdmin: (req, res, next) => {
    req.user = { id: 2, username: 'admin_user', role: 'admin' };
    next();
  }
}));

// Mock flutterwave at the top-level so it is loaded by routes correctly
jest.mock('../../utils/flutterwave', () => ({
  initializePayment: jest.fn().mockResolvedValue('http://mocklink'),
  verifyTransaction: jest.fn()
}));

const User = require('../../models/user');
const TransactionRequest = require('../../models/transactionRequest');
const Wallet = require('../../models/wallet');

// Import routers after mocks are defined
const usersRoutes = require('../../routes/users');
const transactionRequestsRoutes = require('../../routes/transactionRequests');
const depositsRoutes = require('../../routes/deposits');
const mpesaRoutes = require('../../routes/mpesa');

describe('Limits and Security Validation Tests', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    
    // Set socketio dummy on app
    app.set('socketio', { emit: jest.fn() });

    // Mount routers
    app.use('/users', usersRoutes);
    app.use('/transaction-requests', transactionRequestsRoutes);
    app.use('/deposits', depositsRoutes);
    app.use('/mpesa', mpesaRoutes);
  });

  describe('PUT /users/profile - Email Edit Locking', () => {
    it('should ignore email updates and preserve the original email address', async () => {
      const mockUser = {
        id: 1,
        email: 'original@example.com',
        full_name: 'Original Name',
        save: jest.fn().mockResolvedValue(true)
      };
      
      jest.spyOn(User, 'findByPk').mockResolvedValue(mockUser);

      const response = await request(app)
        .put('/users/profile')
        .send({
          email: 'new_email@example.com',
          full_name: 'New Name'
        });

      expect(response.status).toBe(200);
      expect(response.body.user.full_name).toBe('New Name');
      // The returned user email must remain original since update is ignored
      expect(response.body.user.email).toBe('original@example.com');
      expect(mockUser.full_name).toBe('New Name');
      expect(mockUser.email).toBe('original@example.com'); // Assert no modification
    });
  });

  describe('POST /transaction-requests/deposit - Min Deposit Validation', () => {
    it('should allow deposit request >= $5.00 USD', async () => {
      jest.spyOn(TransactionRequest, 'create').mockResolvedValue({
        id: 1,
        amount: 5.00,
        status: 'pending'
      });

      const response = await request(app)
        .post('/transaction-requests/deposit')
        .send({
          amount: 5.00,
          notes: 'Test USD Deposit',
          metadata: { currency: 'USD' }
        });

      expect(response.status).toBe(201);
      expect(response.body.message).toContain('submitted successfully');
    });

    it('should reject deposit request < $5.00 USD', async () => {
      const response = await request(app)
        .post('/transaction-requests/deposit')
        .send({
          amount: 4.99,
          notes: 'Test USD Deposit Too Low',
          metadata: { currency: 'USD' }
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Minimum deposit amount is $5.00');
    });

    it('should allow Agent/Mpesa deposit >= 645 KES', async () => {
      jest.spyOn(TransactionRequest, 'create').mockResolvedValue({
        id: 2,
        amount: 645,
        status: 'pending'
      });

      const response = await request(app)
        .post('/transaction-requests/deposit')
        .send({
          amount: 645,
          notes: 'Test KES Deposit',
          metadata: { currency: 'KES' }
        });

      expect(response.status).toBe(201);
    });

    it('should reject Agent/Mpesa deposit < 645 KES', async () => {
      const response = await request(app)
        .post('/transaction-requests/deposit')
        .send({
          amount: 644,
          notes: 'Test KES Deposit Too Low',
          metadata: { currency: 'KES' }
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Minimum deposit amount is 645 KES');
    });
  });

  describe('POST /transaction-requests/withdrawal - Min Withdrawal Validation', () => {
    it('should allow withdrawal request >= $7.00 USD when funds are sufficient', async () => {
      jest.spyOn(User, 'findByPk').mockResolvedValue({ id: 1, is_verified: true });
      jest.spyOn(Wallet, 'findOne').mockResolvedValue({ available_balance: 10.00 });
      jest.spyOn(TransactionRequest, 'create').mockResolvedValue({ id: 3, amount: 7.00 });

      const response = await request(app)
        .post('/transaction-requests/withdrawal')
        .send({
          amount: 7.00,
          phone: '254712345678',
          notes: 'Valid withdrawal'
        });

      expect(response.status).toBe(201);
    });

    it('should reject withdrawal request < $7.00 USD', async () => {
      const response = await request(app)
        .post('/transaction-requests/withdrawal')
        .send({
          amount: 6.99,
          phone: '254712345678',
          notes: 'Invalid withdrawal amount'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Minimum withdrawal amount is $7.00');
    });
  });

  describe('POST /deposits/card-initiate - Card Deposit Min Validation', () => {
    it('should allow card deposit initiation >= $5.00 USD', async () => {
      jest.spyOn(TransactionRequest, 'create').mockResolvedValue({ id: 4, amount: 5.00 });

      const response = await request(app)
        .post('/deposits/card-initiate')
        .send({ amount: 5.00 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.link).toBe('http://mocklink');
    });

    it('should reject card deposit initiation < $5.00 USD', async () => {
      const response = await request(app)
        .post('/deposits/card-initiate')
        .send({ amount: 4.99 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Minimum deposit amount is $5.00');
    });
  });

  describe('POST /mpesa/stkpush - M-Pesa STK Push Min Validation', () => {
    it('should reject STK push initiation < 645 KES', async () => {
      const response = await request(app)
        .post('/mpesa/stkpush')
        .send({
          amount: 644,
          phoneNumber: '254712345678'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Minimum deposit amount is 645 KES');
    });
  });

  describe('POST /transaction-requests/withdrawal - Global Payout Validations', () => {
    it('should allow bank transfer withdrawal request with valid bank details', async () => {
      jest.spyOn(User, 'findByPk').mockResolvedValue({ id: 1, is_verified: true });
      jest.spyOn(Wallet, 'findOne').mockResolvedValue({ available_balance: 100.00 });
      jest.spyOn(TransactionRequest, 'create').mockResolvedValue({ id: 5, amount: 50.00 });

      const response = await request(app)
        .post('/transaction-requests/withdrawal')
        .send({
          amount: 50.00,
          method: 'bank_transfer',
          bank_name: 'Chase Bank',
          account_name: 'John Doe',
          account_number: '1234567890',
          swift_code: 'CHASUS33'
        });

      expect(response.status).toBe(201);
    });

    it('should reject bank transfer withdrawal if bank details are missing', async () => {
      const response = await request(app)
        .post('/transaction-requests/withdrawal')
        .send({
          amount: 50.00,
          method: 'bank_transfer',
          bank_name: '',
          account_name: 'John Doe'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Bank Name, Account Name, and Account/IBAN number are required');
    });

    it('should allow USDT crypto withdrawal with address and network details', async () => {
      jest.spyOn(User, 'findByPk').mockResolvedValue({ id: 1, is_verified: true });
      jest.spyOn(Wallet, 'findOne').mockResolvedValue({ available_balance: 100.00 });
      jest.spyOn(TransactionRequest, 'create').mockResolvedValue({ id: 6, amount: 20.00 });

      const response = await request(app)
        .post('/transaction-requests/withdrawal')
        .send({
          amount: 20.00,
          method: 'crypto',
          crypto_address: 'TY1234567890',
          crypto_network: 'TRC20'
        });

      expect(response.status).toBe(201);
    });

    it('should allow PayPal withdrawal with email details', async () => {
      jest.spyOn(User, 'findByPk').mockResolvedValue({ id: 1, is_verified: true });
      jest.spyOn(Wallet, 'findOne').mockResolvedValue({ available_balance: 100.00 });
      jest.spyOn(TransactionRequest, 'create').mockResolvedValue({ id: 7, amount: 15.00 });

      const response = await request(app)
        .post('/transaction-requests/withdrawal')
        .send({
          amount: 15.00,
          method: 'paypal',
          paypal_email: 'test@paypal.com'
        });

      expect(response.status).toBe(201);
    });
  });

  describe('POST /deposits/stripe-initiate & /crypto-automated', () => {
    it('should initiate Stripe mock sandbox if Stripe keys are not configured', async () => {
      jest.spyOn(TransactionRequest, 'create').mockResolvedValue({ id: 8, amount: 25.00 });

      const response = await request(app)
        .post('/deposits/stripe-initiate')
        .send({ amount: 25.00 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.link).toContain('stripe-sandbox.html');
    });

    it('should return live wallet address and QR code for automated crypto deposits', async () => {
      jest.spyOn(TransactionRequest, 'create').mockResolvedValue({ id: 9, amount: 10.00 });

      const response = await request(app)
        .post('/deposits/crypto-automated')
        .send({ amount: 10.00 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.walletAddress).toContain('TRX_AUTO_ADDR_');
      expect(response.body.qrCode).toContain('create-qr-code');
    });
  });
});
