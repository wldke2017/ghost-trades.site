const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: (process.env.SMTP_USER || '').trim(),
        pass: (process.env.SMTP_PASS || '').trim(),
    },
});

/**
 * Send an email using the configured transporter
 * @param {string} to - Recipient email string
 * @param {string} subject - Email subject
 * @param {string} html - HTML content of the email
 */
async function sendEmail(to, subject, html) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn('SMTP credentials not configured. Email not sent to:', to);
        console.warn('Email Subject:', subject);
        console.warn('Email HTML:', html);
        return false;
    }

    try {
        const mailOptions = {
            from: `"SecureEscrow" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('[EMAIL] Sent successfully:', info.messageId, '→', to);
        return true;
    } catch (error) {
        console.error('[EMAIL] Failed to send to:', to);
        console.error('[EMAIL] Error code:', error.code);
        console.error('[EMAIL] Error message:', error.message);
        console.error('[EMAIL] Response:', error.response || 'none');
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
