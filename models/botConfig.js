const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const BotConfig = sequelize.define('BotConfig', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  claim_delay_min: {
    type: DataTypes.INTEGER,
    lowercase: false,
    defaultValue: 5,
    comment: 'Minimum delay before bot claim in seconds'
  },
  claim_delay_max: {
    type: DataTypes.INTEGER,
    defaultValue: 15,
    comment: 'Maximum delay before bot claim in seconds'
  },
  release_delay_min: {
    type: DataTypes.INTEGER,
    defaultValue: 15,
    comment: 'Minimum delay before bot release in seconds'
  },
  release_delay_max: {
    type: DataTypes.INTEGER,
    defaultValue: 20,
    comment: 'Maximum delay before bot release in seconds'
  },
  auto_claim_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Automatically claim newly created orders'
  },
  periodic_scan_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Periodically scan for random pending orders to claim'
  },
  scan_interval: {
    type: DataTypes.INTEGER,
    defaultValue: 5,
    comment: 'Scan interval in minutes'
  }
}, {
  tableName: 'bot_configs',
  timestamps: true,
});

module.exports = BotConfig;
