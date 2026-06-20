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
  },
  active_loop_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Enable active escrow generator loop'
  },
  active_loop_target_pool: {
    type: DataTypes.INTEGER,
    defaultValue: 10,
    comment: 'Target pool size for active loop'
  },
  active_loop_min_pool: {
    type: DataTypes.INTEGER,
    defaultValue: 8,
    comment: 'Minimum pool size before spawning extra slots'
  },
  active_loop_claim_delay_min: {
    type: DataTypes.INTEGER,
    defaultValue: 8,
    comment: 'Minimum claim delay in seconds'
  },
  active_loop_claim_delay_max: {
    type: DataTypes.INTEGER,
    defaultValue: 18,
    comment: 'Maximum claim delay in seconds'
  },
  active_loop_hold_delay_min: {
    type: DataTypes.INTEGER,
    defaultValue: 90,
    comment: 'Minimum hold delay in seconds'
  },
  active_loop_hold_delay_max: {
    type: DataTypes.INTEGER,
    defaultValue: 180,
    comment: 'Maximum hold delay in seconds'
  },
  active_loop_cooldown_min: {
    type: DataTypes.INTEGER,
    defaultValue: 10,
    comment: 'Minimum cooldown delay in seconds'
  },
  active_loop_cooldown_max: {
    type: DataTypes.INTEGER,
    defaultValue: 25,
    comment: 'Maximum cooldown delay in seconds'
  }
}, {
  tableName: 'bot_configs',
  timestamps: true,
});

module.exports = BotConfig;
