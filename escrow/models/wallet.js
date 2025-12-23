const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const User = require('./user');

const Wallet = sequelize.define('Wallet', {
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
  available_balance: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
    get() {
      const value = this.getDataValue('available_balance');
      return value ? parseFloat(value) : 0.00;
    }
  },
  locked_balance: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
    get() {
      const value = this.getDataValue('locked_balance');
      return value ? parseFloat(value) : 0.00;
    }
  },
}, {
  tableName: 'wallets',
  timestamps: true,
});

Wallet.belongsTo(User, { foreignKey: 'user_id' });
User.hasOne(Wallet, { foreignKey: 'user_id' });

module.exports = Wallet;