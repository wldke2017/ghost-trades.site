const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  role: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('active', 'disabled', 'blocked'),
    defaultValue: 'active',
    allowNull: false,
  },
  // Personal Information
  full_name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  phone_number: {
    type: DataTypes.STRING,
    allowNull: true
  },
  country: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // Settings & Profile Fields
  avatar_path: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  mpesa_number: {
    type: DataTypes.STRING, // Store as 254... string
    allowNull: true,
  },
  currency_preference: {
    type: DataTypes.ENUM('USD', 'KES'),
    defaultValue: 'USD',
    allowNull: false,
  },
}, {
  tableName: 'users',
  timestamps: true,
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    },
    afterCreate: async (user, options) => {
      const Wallet = require('./wallet');
      await Wallet.create({
        user_id: user.id,
        available_balance: 0.00,
        locked_balance: 0.00,
      }, { transaction: options.transaction });
    },
  },
});

// Instance method to validate password
User.prototype.validatePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

module.exports = User;