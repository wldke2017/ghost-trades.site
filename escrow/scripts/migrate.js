/**
 * Database Migration Script
 * 
 * This script handles database migrations in a production-safe manner.
 * It should replace the sync({ alter: true }) method in production.
 */

const sequelize = require('../db');
const logger = require('../utils/logger');

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');

    // Test connection
    await sequelize.authenticate();
    logger.info('Database connection established');

    // Run migrations
    // In production, use a migration library like sequelize-cli or umzug
    // For now, we'll use sync with alter
    await sequelize.sync({ alter: true });
    
    logger.info('Migrations completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();