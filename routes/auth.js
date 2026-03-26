const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const User = require('../models/user');
const Wallet = require('../models/wallet');
const sequelize = require('../db');
const logger = require('../utils/logger');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const { authLimiter } = require('../middleware/rateLimiter');
const { generateOTP, sendOTPEmail } = require('../utils/email');

// Register new user
router.post('/register', authLimiter, validate('register'), async (req, res, next) => {
    let authTransaction;
    try {
        const { username, password, role, full_name, email, phone_number, country } = req.body;
        authTransaction = await sequelize.transaction();

        // Prevent registration as admin
        if (role === 'admin') {
            if (authTransaction) await authTransaction.rollback();
            return res.status(403).json({ error: 'Cannot register as admin. Only middleman accounts can be created.' });
        }

        if (!role || role !== 'middleman') {
            if (authTransaction) await authTransaction.rollback();
            return res.status(400).json({ error: 'Invalid role. Only "middleman" role is allowed for registration.' });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            if (authTransaction) await authTransaction.rollback();
            return res.status(400).json({ error: 'Username already exists' });
        }

        const otpCode = generateOTP();
        const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

        logger.info(`[AUTH] Attempting to register user: ${username} (${email})`);
        const newUser = await User.create({
            username,
            password,
            role,
            full_name,
            email,
            phone_number,
            country,
            otp_code: otpCode,
            otp_expires_at: otpExpiresAt,
            is_verified: false
        }, { transaction: authTransaction });

        await authTransaction.commit();
        logger.info(`[AUTH] User created successfully: ${username}. Triggering OTP email.`);

        const emailSent = await sendOTPEmail(email, full_name, otpCode, 'Registration Verification');
        if (!emailSent) {
            logger.error(`[AUTH] Failed to send registration OTP email to: ${email}`);
        } else {
            logger.info(`[AUTH] Registration OTP email sent successfully to: ${email}`);
        }

        res.status(201).json({
            message: 'User registered. Please verify your email.',
            requires_verification: true,
            email: newUser.email
        });
    } catch (error) {
        if (authTransaction) await authTransaction.rollback();
        next(error);
    }
});

// Login user
router.post('/login', authLimiter, validate('login'), async (req, res, next) => {
    try {
        const { username, password } = req.body;
        // Find user by username or email
        const user = await User.findOne({ 
            where: { 
                [Op.or]: [
                    { username },
                    { email: username }
                ]
            } 
        });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Account is disabled or blocked' });
        }

        const isValidPassword = await user.validatePassword(password);
        if (!isValidPassword) {
            logger.warn(`[AUTH] Login failed: Invalid password for user ${username}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Admins are exempt from OTP verification block (prevents lockout of existing admin accounts)
        if (!user.is_verified && user.role !== 'admin') {
            logger.info(`[AUTH] Login blocked: User ${username} is not verified. Redirecting to OTP.`);
            return res.status(403).json({ 
                error: 'Please verify your email address to log in.', 
                requires_verification: true, 
                email: user.email 
            });
        }

        logger.info(`[AUTH] Login successful for user: ${username} (Role: ${user.role})`);

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get current user info (protected)
router.get('/me', authenticateToken, async (req, res, next) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: ['id', 'username', 'role', 'createdAt', 'avatar_path', 'mpesa_number', 'currency_preference', 'full_name', 'email', 'phone_number', 'country']
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        next(error);
    }
});

// Verify OTP
router.post('/verify-otp', authLimiter, async (req, res, next) => {
    try {
        const { email, otp_code } = req.body;
        if (!email || !otp_code) return res.status(400).json({ error: 'Email and OTP code are required' });

        const user = await User.findOne({ where: { email } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.otp_code !== otp_code || user.otp_expires_at < new Date()) {
            return res.status(400).json({ error: 'Invalid or expired OTP code' });
        }

        user.is_verified = true;
        user.otp_code = null;
        user.otp_expires_at = null;
        await user.save();

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Email verified successfully',
            token,
            user: { id: user.id, username: user.username, role: user.role }
        });
    } catch (error) {
        next(error);
    }
});

// Resend OTP
router.post('/resend-otp', authLimiter, async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await User.findOne({ where: { email } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.is_verified) return res.status(400).json({ error: 'User is already verified' });

        logger.info(`[AUTH] Resending OTP to: ${email}`);
        const otpCode = generateOTP();
        user.otp_code = otpCode;
        user.otp_expires_at = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();

        const emailSent = await sendOTPEmail(user.email, user.full_name, otpCode, 'Registration Verification');
        if (emailSent) {
            logger.info(`[AUTH] Resend OTP email sent successfully to: ${email}`);
            res.json({ message: 'OTP resent successfully. Check your email.' });
        } else {
            logger.error(`[AUTH] Failed to resend OTP email to: ${email}`);
            res.status(500).json({ error: 'Failed to send verification email. Please contact support.' });
        }
    } catch (error) {
        next(error);
    }
});

// Diagnostic route to test SMTP settings directly
router.post('/test-email', async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Target email is required' });
        
        logger.info(`[DIAGNOSTIC] Manual SMTP test triggered for: ${email}`);
        const success = await sendOTPEmail(email, 'Diagnostic User', '123456', 'SMTP Connection Test');
        
        if (success) {
            res.json({ message: 'Test email accepted by SMTP server. Check your inbox/spam.' });
        } else {
            res.status(500).json({ error: 'SMTP server rejected the email. Check logs for details.' });
        }
    } catch (error) {
        next(error);
    }
});

module.exports = router;
