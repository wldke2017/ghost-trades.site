const fetch = require('node-fetch');
const logger = require('./logger');
require('dotenv').config();

// DEFINITIVE SOLUTION: Use Brevo (Sendinblue) Web API v3
// This bypasses all SMTP blocks from cloud providers like Render
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Send an email using the Brevo Web API
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - HTML content
 */
async function sendEmail(to, subject, html) {
    if (!BREVO_API_KEY) {
        logger.warn(`[EMAIL] Brevo API Key not configured. Skipping email to: ${to}`);
        return false;
    }

    try {
        logger.info(`[EMAIL] Attempting to send email via Brevo Web API to: ${to}`);
        
        const response = await fetch(BREVO_API_URL, {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': BREVO_API_KEY,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: { 
                  name: 'SecureEscrow', 
                  email: process.env.SMTP_USER || 'luckymutisya83@gmail.com' 
                },
                to: [{ email: to }],
                subject: subject,
                htmlContent: html
            })
        });

        const data = await response.json();

        if (response.ok) {
            logger.info(`[EMAIL] Sent successfully via Brevo API. Message ID: ${data.messageId} → ${to}`);
            return true;
        } else {
            logger.error(`[EMAIL] Brevo API rejected the email:`, data);
            return false;
        }
    } catch (error) {
        logger.error(`[EMAIL] Brevo API request failed:`, {
            errorMessage: error.message,
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
