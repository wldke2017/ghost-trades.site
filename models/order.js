const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const User = require('./user');

const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  buyer_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
      key: 'id',
    },
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  vault_amount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'CLAIMED', 'COMPLETED', 'READY_FOR_RELEASE', 'DISPUTED', 'CANCELLED'),
    defaultValue: 'PENDING',
  },
  middleman_id: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id',
    },
  },
  description: {
    type: DataTypes.TEXT,
  },
}, {
  tableName: 'orders',
  timestamps: true,
});

Order.belongsTo(User, { as: 'buyer', foreignKey: 'buyer_id' });
Order.belongsTo(User, { as: 'middleman', foreignKey: 'middleman_id' });
User.hasMany(Order, { as: 'buyerOrders', foreignKey: 'buyer_id' });
User.hasMany(Order, { as: 'middlemanOrders', foreignKey: 'middleman_id' });

module.exports = Order;