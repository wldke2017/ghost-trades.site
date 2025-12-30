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

    // Create admin user
    const admin = await User.findOrCreate({
      where: { username: 'Admin' },
      defaults: {
        username: 'Admin',
        password: process.env.ADMIN_DEFAULT_PASSWORD || 'Admin083',
        role: 'admin'
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
        role: 'middleman'
      }
    });

    if (middleman[1]) {
      logger.info('Test middleman created');
    } else {
      logger.info('Test middleman already exists');
    }

    // Create wallets with initial balance
    await Wallet.findOrCreate({
      where: { user_id: admin[0].id },
      defaults: {
        user_id: admin[0].id,
        available_balance: 1000,
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

    logger.info('Database seeding completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();