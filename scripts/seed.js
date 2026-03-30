/**
 * Database Seeding Script
 * 
 * Seeds the database with initial data for development/testing
 */

const sequelize = require('../db');
const User = require('../models/user');
const Wallet = require('../models/wallet');
const logger = require('../utils/logger');

async function seedDatabase() {
  try {
    logger.info('Starting database seeding...');
    await sequelize.sync({ alter: true });

    // Create admin user
    const admin = await User.findOrCreate({
      where: { username: 'Admin' },
      defaults: {
        username: 'Admin',
        password: process.env.ADMIN_DEFAULT_PASSWORD || 'Admin083',
        role: 'admin',
        is_verified: true
      }
    });

    if (admin[1]) {
      logger.info('Admin user created');
    } else {
      logger.info('Admin user already exists');
    }

    // Create test middleman
    const middleman = await User.findOrCreate({
      where: { username: 'middleman1' },
      defaults: {
        username: 'middleman1',
        password: 'middleman123',
        role: 'middleman',
        is_verified: true
      }
    });

    if (middleman[1]) {
      logger.info('Test middleman created');
    } else {
      logger.info('Test middleman already exists');
    }

    // Create System Bot
    const systemBot = await User.findOrCreate({
      where: { username: 'SystemBot' },
      defaults: {
        username: 'SystemBot',
        password: 'bot_password_secure_123',
        role: 'middleman',
        is_verified: true,
        is_bot: true
      }
    });

    if (systemBot[1]) {
      logger.info('System Bot created');
    } else {
      logger.info('System Bot already exists');
    }

    // Create wallets with initial balance
    await Wallet.findOrCreate({
      where: { user_id: admin[0].id },
      defaults: {
        user_id: admin[0].id,
        available_balance: 10000,
        locked_balance: 0
      }
    });

    await Wallet.findOrCreate({
      where: { user_id: middleman[0].id },
      defaults: {
        user_id: middleman[0].id,
        available_balance: 500,
        locked_balance: 0
      }
    });

    await Wallet.findOrCreate({
      where: { user_id: systemBot[0].id },
      defaults: {
        user_id: systemBot[0].id,
        available_balance: 1000000, // Large balance for auto-claiming
        locked_balance: 0
      }
    });

    logger.info('Database seeding completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();