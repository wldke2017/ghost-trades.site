const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { authenticateToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { generateOTP, sendOTPEmail } = require('../utils/email');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// Configure multer for avatar uploads (sharing config logic for now, though better in middleware)
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit for avatars
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    }
});

// Update Profile
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const { mpesa_number, currency_preference, full_name, email, phone_number, country } = req.body;
        const user = await User.findByPk(req.user.id);

        if (!user) return res.status(404).json({ error: 'User not found' });

        if (mpesa_number !== undefined) user.mpesa_number = mpesa_number;
        if (currency_preference !== undefined) user.currency_preference = currency_preference;
        if (full_name !== undefined) user.full_name = full_name;
        if (email !== undefined) user.email = email;
        if (phone_number !== undefined) user.phone_number = phone_number;
        if (country !== undefined) user.country = country;

        await user.save();

        res.json({
            message: 'Profile updated successfully',
            user: {
                mpesa_number: user.mpesa_number,
                currency_preference: user.currency_preference,
                full_name: user.full_name,
                email: user.email,
                phone_number: user.phone_number,
                country: user.country
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Request Password Change OTP
router.post('/change-password/request', authenticateToken, authLimiter, async (req, res) => {
    try {
        const { currentPassword } = req.body;
        if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });

        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isValid = await user.validatePassword(currentPassword);
        if (!isValid) return res.status(401).json({ error: 'Incorrect current password' });
        if (!user.email) return res.status(400).json({ error: 'No email associated with account' });

        const otpCode = generateOTP();
        user.otp_code = otpCode;
        user.otp_expires_at = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();

        sendOTPEmail(user.email, user.full_name, otpCode, 'Password Change Verification');
        res.json({ message: 'OTP sent to your email', requires_otp: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verify OTP and Change Password
router.post('/change-password/verify', authenticateToken, authLimiter, async (req, res) => {
    try {
        const { currentPassword, newPassword, otp_code } = req.body;
        if (!currentPassword || !newPassword || !otp_code) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isValid = await user.validatePassword(currentPassword);
        if (!isValid) return res.status(401).json({ error: 'Incorrect current password' });

        if (user.otp_code !== otp_code || user.otp_expires_at < new Date()) {
            return res.status(400).json({ error: 'Invalid or expired OTP code' });
        }

        user.password = newPassword;
        user.otp_code = null;
        user.otp_expires_at = null;
        await user.save();

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upload Avatar
router.post('/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded' });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.avatar_path = req.file.filename;
        await user.save();

        res.json({
            message: 'Avatar uploaded successfully',
            avatar_path: user.avatar_path
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
