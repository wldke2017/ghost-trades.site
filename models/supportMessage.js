const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const User = require('./user');
const SupportTicket = require('./supportTicket');

const SupportMessage = sequelize.define('SupportMessage', {
    ticket_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: SupportTicket,
            key: 'id'
        }
    },
    sender_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: 'id'
        }
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    attachment_path: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

SupportMessage.belongsTo(SupportTicket, { foreignKey: 'ticket_id' });
SupportTicket.hasMany(SupportMessage, { as: 'messages', foreignKey: 'ticket_id' });

SupportMessage.belongsTo(User, { as: 'sender', foreignKey: 'sender_id' });

module.exports = SupportMessage;
