const nodemailer = require('nodemailer');
const logger = require('./logger');
require('dotenv').config();

// Create transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: (process.env.SMTP_USER || '').trim(),
        pass: (process.env.SMTP_PASS || '').trim(),
    },
    // Force IPv4 as some hosting environments (like Render) have issues with IPv6 to Gmail
    family: 4, 
    // Add timeouts to prevent hanging in production
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 15000,
});

/**
 * Send an email using the configured transporter
 * @param {string} to - Recipient email string
 * @param {string} subject - Email subject
 * @param {string} html - HTML content of the email
 */
async function sendEmail(to, subject, html) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        logger.warn(`[EMAIL] SMTP credentials not configured. Skipping email to: ${to}`);
        return false;
    }

    try {
        const mailOptions = {
            from: `"SecureEscrow" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
        };

        logger.info(`[EMAIL] Attempting to send email to: ${to} (Subject: ${subject})`);
        const info = await transporter.sendMail(mailOptions);
        logger.info(`[EMAIL] Sent successfully: ${info.messageId} → ${to}`);
        return true;
    } catch (error) {
        logger.error(`[EMAIL] Failed to send email to: ${to}`, {
            errorCode: error.code,
            errorMessage: error.message,
            command: error.command,
            response: error.response,
            stack: error.stack
        });
        return false;
    }
}

/**
 * Generate a 6-digit random OTP
 */
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send an OTP email to a user
 */
async function sendOTPEmail(to, name, otpCode, purpose = 'Verification') {
    const subject = `Your SecureEscrow ${purpose} Code`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h2 style="color: #f97316; margin: 0; font-size: 24px;">SecureEscrow</h2>
            </div>
            
            <p style="color: #374151; font-size: 16px;">Hello ${name || 'User'},</p>
            
            <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
                We received a request for ${purpose.toLowerCase()} on your SecureEscrow account. 
                Please use the following 6-digit code to complete the process.
            </p>
            
            <div style="background-color: #fff7ed; border: 2px dashed #fdba74; border-radius: 12px; padding: 24px; text-align: center; margin: 30px 0;">
                <span style="font-size: 36px; font-weight: bold; color: #f97316; letter-spacing: 6px;">${otpCode}</span>
            </div>
            
            <p style="color: #6b7280; font-size: 14px;">
                This code will expire in <strong>15 minutes</strong>. If you did not request this, please ignore this email or contact support if you have concerns.
            </p>
            
            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            
            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
                &copy; ${new Date().getFullYear()} SecureEscrow. All rights reserved.
            </p>
        </div>
    `;

    return sendEmail(to, subject, html);
}

module.exports = {
    sendEmail,
    generateOTP,
    sendOTPEmail
};
