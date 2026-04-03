const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const User = require('./user');

const SupportTicket = sequelize.define('SupportTicket', {
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: 'id'
        }
    },
    subject: {
        type: DataTypes.STRING,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('open', 'closed'),
        defaultValue: 'open'
    }
});

// Relationships
SupportTicket.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
User.hasMany(SupportTicket, { foreignKey: 'user_id' });

module.exports = SupportTicket;
