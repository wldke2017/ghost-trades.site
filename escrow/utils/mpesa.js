const axios = require('axios');

const MPESA_CONFIG = {
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    businessShortCode: process.env.MPESA_BUSINESS_SHORTCODE,
    passkey: process.env.MPESA_PASSKEY,
    callbackUrl: process.env.MPESA_CALLBACK_URL
};

// Get M-Pesa Access Token
async function getAccessToken() {
    const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');

    try {
        const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: {
                Authorization: `Basic ${auth}`
            }
        });
        return response.data.access_token;
    } catch (error) {
        console.error('M-Pesa Access Token Error:', error.response?.data || error.message);
        throw new Error('Failed to get M-Pesa access token');
    }
}

// Initiate STK Push
async function initiateSTKPush(phoneNumber, amount, accountReference = 'Escrow Order') {
    if (!MPESA_CONFIG.consumerKey || !MPESA_CONFIG.consumerSecret || !MPESA_CONFIG.passkey) {
        throw new Error('M-Pesa configuration missing');
    }

    // Format phone number (ensure 254...)
    let formattedPhone = phoneNumber.startsWith('0') ? '254' + phoneNumber.slice(1) : phoneNumber;
    if (formattedPhone.startsWith('+')) formattedPhone = formattedPhone.slice(1);

    const token = await getAccessToken();
    const date = new Date();
    const timestamp = date.getFullYear() +
        ("0" + (date.getMonth() + 1)).slice(-2) +
        ("0" + date.getDate()).slice(-2) +
        ("0" + date.getHours()).slice(-2) +
        ("0" + date.getMinutes()).slice(-2) +
        ("0" + date.getSeconds()).slice(-2);

    const password = Buffer.from(
        `${MPESA_CONFIG.businessShortCode}${MPESA_CONFIG.passkey}${timestamp}`
    ).toString('base64');

    const payload = {
        BusinessShortCode: MPESA_CONFIG.businessShortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.ceil(amount), // Amount must be integer
        PartyA: formattedPhone,
        PartyB: MPESA_CONFIG.businessShortCode,
        PhoneNumber: formattedPhone,
        CallBackURL: MPESA_CONFIG.callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: "Escrow Deposit"
    };

    try {
        const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', payload, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        return response.data;
    } catch (error) {
        console.error('STK Push Error:', error.response?.data || error.message);
        throw new Error('Failed to initiate M-Pesa payment');
    }
}

module.exports = { getAccessToken, initiateSTKPush };
