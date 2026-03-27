const fetch = require('node-fetch');
const logger = require('./logger');

const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const FLUTTERWAVE_API_URL = 'https://api.flutterwave.com/v3/payments';

/**
 * Initialize a Flutterwave payment
 * @param {Object} paymentData - { tx_ref, amount, currency, redirect_url, customer }
 */
async function initializePayment(paymentData) {
    if (!FLUTTERWAVE_SECRET_KEY) {
        logger.error('[FLW] Flutterwave Secret Key is not configured');
        throw new Error('Payment gateway not configured');
    }

    try {
        const response = await fetch(FLUTTERWAVE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(paymentData)
        });

        const data = await response.json();
        
        if (response.ok && data.status === 'success') {
            return data.data.link;
        } else {
            logger.error('[FLW] Initialization failed:', data);
            throw new Error(data.message || 'Payment initiation failed');
        }
    } catch (error) {
        logger.error('[FLW] Request error:', error);
        throw error;
    }
}

/**
 * Verify a Flutterwave transaction
 * @param {string} transactionId 
 */
async function verifyTransaction(transactionId) {
    try {
        const response = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        return data;
    } catch (error) {
        logger.error('[FLW] Verification error:', error);
        throw error;
    }
}

module.exports = {
    initializePayment,
    verifyTransaction
};
