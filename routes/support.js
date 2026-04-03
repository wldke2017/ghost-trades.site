const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const SupportTicket = require('../models/supportTicket');
const SupportMessage = require('../models/supportMessage');
const User = require('../models/user');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../public/uploads/support');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

function generateFileName(base64str) {
    const matches = base64str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;
    
    let extension = 'jpg';
    if (matches[1].includes('png')) extension = 'png';
    else if (matches[1].includes('gif')) extension = 'gif';
    else if (matches[1].includes('webp')) extension = 'webp';

    const filename = `screenshot_${Date.now()}_${Math.floor(Math.random() * 10000)}.${extension}`;
    return { filename, buffer: Buffer.from(matches[2], 'base64') };
}

// Get all tickets for a user (or all tickets if admin)
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        const whereClause = req.user.role === 'admin' ? {} : { user_id: req.user.id };
        const tickets = await SupportTicket.findAll({
            where: whereClause,
            include: [{ model: User, as: 'user', attributes: ['id', 'username'] }],
            order: [['createdAt', 'DESC']]
        });
        res.json(tickets);
    } catch (error) {
        next(error);
    }
});

// Create a new support ticket
router.post('/', authenticateToken, async (req, res, next) => {
    try {
        const { subject, initial_message, image_base64 } = req.body;
        
        if (!subject) {
            return res.status(400).json({ error: 'Subject is required' });
        }

        const ticket = await SupportTicket.create({
            user_id: req.user.id,
            subject,
            status: 'open'
        });

        // Add the initial message if sent
        if (initial_message || image_base64) {
            let attachment_path = null;

            if (image_base64) {
                const fileData = generateFileName(image_base64);
                if (fileData) {
                    const filepath = path.join(uploadDir, fileData.filename);
                    fs.writeFileSync(filepath, fileData.buffer);
                    attachment_path = `/uploads/support/${fileData.filename}`;
                }
            }

            const message = await SupportMessage.create({
                ticket_id: ticket.id,
                sender_id: req.user.id,
                message: initial_message || '',
                attachment_path
            });
            
            // Notify admin
            const io = req.app.get('socketio');
            if (io) {
                // Fetch full ticket data
                const fullTicket = await SupportTicket.findByPk(ticket.id, {
                    include: [{ model: User, as: 'user', attributes: ['id', 'username'] }]
                });
                io.emit('support_ticket_created', { ticket: fullTicket, message });
            }
        }

        res.status(201).json(ticket);
    } catch (error) {
        next(error);
    }
});

// Get messages for a specific ticket
router.get('/:id/messages', authenticateToken, async (req, res, next) => {
    try {
        const ticket = await SupportTicket.findByPk(req.params.id, {
            include: [{ model: User, as: 'user', attributes: ['id', 'username'] }]
        });
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        // Authorization check
        if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const messages = await SupportMessage.findAll({
            where: { ticket_id: ticket.id },
            include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'role'] }],
            order: [['createdAt', 'ASC']]
        });

        res.json({ ticket, messages });
    } catch (error) {
        next(error);
    }
});

// Add a message to a ticket
router.post('/:id/messages', authenticateToken, async (req, res, next) => {
    try {
        const ticket = await SupportTicket.findByPk(req.params.id);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (ticket.status === 'closed') {
            return res.status(400).json({ error: 'Cannot reply to a closed ticket' });
        }

        const { message, image_base64 } = req.body;
        let attachment_path = null;

        if (image_base64) {
            const fileData = generateFileName(image_base64);
            if (fileData) {
                const filepath = path.join(uploadDir, fileData.filename);
                fs.writeFileSync(filepath, fileData.buffer);
                attachment_path = `/uploads/support/${fileData.filename}`;
            }
        }

        if (!message && !attachment_path) {
            return res.status(400).json({ error: 'Message or attachment is required' });
        }

        const newMsg = await SupportMessage.create({
            ticket_id: ticket.id,
            sender_id: req.user.id,
            message: message || '',
            attachment_path
        });

        const msgWithSender = await SupportMessage.findByPk(newMsg.id, {
            include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'role'] }]
        });

        const io = req.app.get('socketio');
        if (io) {
            io.to('ticket_' + ticket.id).emit('support_message', msgWithSender);
            if (req.user.role !== 'admin') {
                const fullTicket = await SupportTicket.findByPk(ticket.id, {
                    include: [{ model: User, as: 'user', attributes: ['id', 'username'] }]
                });
                io.emit('support_ticket_updated', fullTicket);
            }
        }

        res.status(201).json(msgWithSender);
    } catch (error) {
        next(error);
    }
});

// Close a ticket (Admin or Owner)
router.put('/:id/close', authenticateToken, async (req, res, next) => {
    try {
        const ticket = await SupportTicket.findByPk(req.params.id);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        ticket.status = 'closed';
        await ticket.save();

        const io = req.app.get('socketio');
        if (io) {
            io.to('ticket_' + ticket.id).emit('support_ticket_closed', ticket);
            const fullTicket = await SupportTicket.findByPk(ticket.id, {
                include: [{ model: User, as: 'user', attributes: ['id', 'username'] }]
            });
            io.emit('support_ticket_updated', fullTicket);
        }

        res.json(ticket);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
