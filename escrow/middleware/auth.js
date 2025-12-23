const jwt = require('jsonwebtoken');
require('dotenv').config();

// Validate JWT_SECRET exists and is strong enough
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('ERROR: JWT_SECRET must be at least 32 characters long!');
  console.error('Please set a strong JWT_SECRET in your .env file');
  process.exit(1);
}

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// Middleware to check if user is Admin
const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access Denied: Admins Only' });
  }
  next();
};

// Middleware to check if user is Middleman
const isMiddleman = (req, res, next) => {
  if (!req.user || req.user.role !== 'middleman') {
    return res.status(403).json({ error: 'Access Denied: Middlemen Only' });
  }
  next();
};

module.exports = { authenticateToken, isAdmin, isMiddleman, JWT_SECRET };