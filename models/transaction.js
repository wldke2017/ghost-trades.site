const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const User = require('./user');
const Order = require('./order');

const Transaction = sequelize.define('Transaction', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    order_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'orders',
            key: 'id'
        }
    },
    type: {
        type: DataTypes.ENUM(
            'DEPOSIT',           // Admin deposits funds to user
            'WITHDRAWAL',        // Admin withdraws funds from user
            'ORDER_CREATED',     // Admin creates order (locks funds)
            'ORDER_CLAIMED',     // Middleman claims order (locks collateral)
            'ORDER_COMPLETED',   // Order completed (unlocks + commission)
            'ORDER_CANCELLED',   // Order cancelled (refunds)
            'COMMISSION_EARNED', // Middleman earns commission
            'COMMISSION_PAID',   // Admin pays commission
            'DISPUTE_REFUND',    // Funds returned after dispute
            'DISPUTE_FORFEIT'    // Collateral lost in dispute
        ),
        allowNull: false
    },
    amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        get() {
            const value = this.getDataValue('amount');
            return value === null ? null : parseFloat(value);
        }
    },
    balance_before: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        get() {
            const value = this.getDataValue('balance_before');
            return value === null ? null : parseFloat(value);
        }
    },
    balance_after: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        get() {
            const value = this.getDataValue('balance_after');
            return value === null ? null : parseFloat(value);
        }
    },
    description: {
        type: DataTypes.STRING(500),
        allowNull: true
    }
}, {
    tableName: 'transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
});

// Associations
Transaction.belongsTo(User, { foreignKey: 'user_id' });
Transaction.belongsTo(Order, { foreignKey: 'order_id' });
User.hasMany(Transaction, { foreignKey: 'user_id' });

module.exports = Transaction;
