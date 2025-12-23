const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const User = require('./user');

const TransactionRequest = sequelize.define('TransactionRequest', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
      key: 'id',
    },
  },
  type: {
    type: DataTypes.ENUM('deposit', 'withdrawal'),
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected'),
    defaultValue: 'pending',
  },
  screenshot_path: {
    type: DataTypes.STRING,
    allowNull: true, // Only for deposits
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  admin_notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  reviewed_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: User,
      key: 'id',
    },
  },
  reviewed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
}, {
  tableName: 'transaction_requests',
  timestamps: true,
});

TransactionRequest.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
TransactionRequest.belongsTo(User, { foreignKey: 'reviewed_by', as: 'reviewer' });

module.exports = TransactionRequest;