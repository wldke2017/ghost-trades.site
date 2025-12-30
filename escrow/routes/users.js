const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { authenticateToken } = require('../middleware/auth');
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

// Change Password
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new passwords are required' });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isValid = await user.validatePassword(currentPassword);
        if (!isValid) {
            return res.status(401).json({ error: 'Incorrect current password' });
        }

        user.password = newPassword;
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
