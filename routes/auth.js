const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const Wallet = require('../models/wallet');
const sequelize = require('../db');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const { authLimiter } = require('../middleware/rateLimiter');

// Register new user
router.post('/register', authLimiter, validate('register'), async (req, res) => {
    let authTransaction;
    try {
        const { username, password, role, full_name, email, phone_number, country } = req.body;
        authTransaction = await sequelize.transaction();

        // Prevent registration as admin
        if (role === 'admin') {
            return res.status(403).json({ error: 'Cannot register as admin. Only middleman accounts can be created.' });
        }

        if (!role || role !== 'middleman') {
            return res.status(400).json({ error: 'Invalid role. Only "middleman" role is allowed for registration.' });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            if (authTransaction) await authTransaction.rollback();
            return res.status(400).json({ error: 'Username already exists' });
        }

        const newUser = await User.create({
            username,
            password,
            role,
            full_name,
            email,
            phone_number,
            country
        }, { transaction: authTransaction });

        await authTransaction.commit();

        // Generate JWT token
        const token = jwt.sign(
            { id: newUser.id, username: newUser.username, role: newUser.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: {
                id: newUser.id,
                username: newUser.username,
                role: newUser.role
            }
        });
    } catch (error) {
        if (authTransaction) await authTransaction.rollback();
        res.status(500).json({ error: error.message });
    }
});

// Login user
router.post('/login', authLimiter, validate('login'), async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ where: { username } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Account is disabled or blocked' });
        }

        const isValidPassword = await user.validatePassword(password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

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
        res.status(500).json({ error: error.message });
    }
});

// Get current user info (protected)
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: ['id', 'username', 'role', 'createdAt', 'avatar_path', 'mpesa_number', 'currency_preference', 'full_name', 'email', 'phone_number', 'country']
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
