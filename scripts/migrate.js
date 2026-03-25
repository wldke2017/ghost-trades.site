/**
 * Database Migration Script
 *
 * This script handles database migrations in a production-safe manner.
 * It uses raw SQL ALTER TABLE ... ADD COLUMN IF NOT EXISTS to safely
 * add new columns without risk of data loss.
 */

const sequelize = require('../db');
// Load all models so Sequelize is aware of them
const User = require('../models/user');
const Wallet = require('../models/wallet');
const logger = require('../utils/logger');

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');

    // Test connection
    await sequelize.authenticate();
    logger.info('Database connection established');

    const qi = sequelize.getQueryInterface();

    // ── users table ──────────────────────────────────────────────────────────
    logger.info('Ensuring users table columns are up to date...');

    const addIfMissing = async (table, column, definition) => {
      try {
        await sequelize.query(
          `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${column} ${definition};`
        );
        logger.info(`Column ${table}.${column} ensured.`);
      } catch (err) {
        logger.warn(`Could not add column ${table}.${column}: ${err.message}`);
      }
    };

    await addIfMissing('users', 'is_verified',       'BOOLEAN NOT NULL DEFAULT FALSE');
    await addIfMissing('users', 'otp_code',          'VARCHAR(255)');
    await addIfMissing('users', 'otp_expires_at',    'TIMESTAMP WITH TIME ZONE');
    await addIfMissing('users', 'full_name',         'VARCHAR(255)');
    await addIfMissing('users', 'email',             'VARCHAR(255)');
    await addIfMissing('users', 'phone_number',      'VARCHAR(255)');
    await addIfMissing('users', 'country',           'VARCHAR(255)');
    await addIfMissing('users', 'avatar_path',       'VARCHAR(255)');
    await addIfMissing('users', 'mpesa_number',      'VARCHAR(255)');
    await addIfMissing('users', 'currency_preference', "VARCHAR(255) DEFAULT 'USD'");

    // Ensure status column has correct ENUM-like default (postgres TEXT column)
    // Only attempt if you know it is already a string column
    logger.info('Users table migration complete.');

    // ── Sync remaining tables (creates new tables, won't drop columns) ───────
    await sequelize.sync({ force: false, alter: false });
    logger.info('Sequelize sync complete (non-destructive).');

    logger.info('All migrations completed successfully.');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();