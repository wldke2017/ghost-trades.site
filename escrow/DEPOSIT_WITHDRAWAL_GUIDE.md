# 💰 Deposit & Withdrawal Request System Guide

## Overview

The escrow system now includes a **request-approval workflow** for deposits and withdrawals. Users submit requests with proof, and admin reviews and approves them.

---

## 🔄 How It Works

### For Users (Middlemen)

#### **Requesting a Deposit**

1. **Click "Deposit" button** on your wallet card
2. **Fill in the form**:
   - Enter amount (USD)
   - Upload payment screenshot (proof of payment)
   - Add optional notes (e.g., transaction ID, payment method)
3. **Submit request**
4. **Wait for admin approval**
5. **Receive notification** when approved/rejected
6. **Funds added** to your wallet automatically upon approval

#### **Requesting a Withdrawal**

1. **Click "Withdraw" button** on your wallet card
2. **Fill in the form**:
   - Enter amount (must have sufficient balance)
   - Add optional notes (e.g., bank details, withdrawal method)
3. **Submit request**
4. **Wait for admin approval**
5. **Receive notification** when approved/rejected
6. **Funds deducted** from your wallet automatically upon approval

#### **Viewing Your Requests**

1. **Click "My Requests" button** on your wallet card
2. **See all your requests** with:
   - Request type (Deposit/Withdrawal)
   - Amount
   - Status (Pending/Approved/Rejected)
   - Your notes
   - Admin response notes
   - Screenshot (for deposits)
   - Submission date

---

### For Admin

#### **Viewing Pending Requests**

1. **Login as Admin**
2. **Scroll to "Transaction Requests" section**
3. **See all pending requests** with:
   - User who submitted
   - Request type (Deposit/Withdrawal)
   - Amount
   - User notes
   - Payment screenshot (for deposits - click to view)
   - Submission date

#### **Approving a Request**

1. **Click "Approve" button** on the request
2. **Add optional admin notes** (e.g., "Payment verified", "Transaction ID: XYZ123")
3. **Confirm**
4. **System automatically**:
   - For deposits: Adds funds to user's wallet
   - For withdrawals: Deducts funds from user's wallet
   - Updates request status to "Approved"
   - Notifies user via WebSocket
   - Records admin who approved and timestamp

#### **Rejecting a Request**

1. **Click "Reject" button** on the request
2. **Add admin notes** explaining why (e.g., "Invalid screenshot", "Insufficient proof")
3. **Confirm**
4. **System automatically**:
   - Updates request status to "Rejected"
   - NO funds transferred
   - Notifies user via WebSocket
   - Records admin who rejected and timestamp

---

## 📸 Screenshot Requirements (Deposits Only)

### What to Upload

Users should upload a clear screenshot showing:
- Payment confirmation
- Transaction ID
- Amount sent
- Date and time
- Payment method used

### Accepted Formats

- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)
- WebP (.webp)

### File Size Limit

- Maximum: **5MB**

### Storage

- Screenshots are stored in `/uploads` folder
- Filename format: `deposit-{timestamp}-{random}.{ext}`
- Admin can view by clicking "View Payment Screenshot" link

---

## 🔔 Real-Time Notifications

### Users Receive Notifications When:

- ✅ Request is approved
- ❌ Request is rejected

### Admin Receives Notifications When:

- 📥 New deposit request submitted
- 📤 New withdrawal request submitted

---

## 💡 Example Workflows

### Scenario 1: User Deposits $500

1. **User**: Sends $500 via bank transfer
2. **User**: Takes screenshot of confirmation
3. **User**: Clicks "Deposit" → Fills form → Uploads screenshot → Submits
4. **System**: Creates pending request, notifies admin
5. **Admin**: Sees request → Views screenshot → Verifies payment
6. **Admin**: Clicks "Approve" → Adds note "Bank transfer verified"
7. **System**: Adds $500 to user's wallet, marks approved, notifies user
8. **User**: Sees notification → Balance updated to $500

### Scenario 2: User Withdraws $200

1. **User**: Has $500 in wallet
2. **User**: Clicks "Withdraw" → Enters $200 → Adds bank details in notes
3. **System**: Creates pending request, notifies admin
4. **Admin**: Sees request → Reviews bank details
5. **Admin**: Processes bank transfer → Clicks "Approve"
6. **System**: Deducts $200 from wallet, marks approved, notifies user
7. **User**: Sees notification → Balance updated to $300

### Scenario 3: Invalid Deposit Request

1. **User**: Uploads blurry/fake screenshot
2. **User**: Submits deposit request for $1000
3. **Admin**: Reviews screenshot → Identifies issue
4. **Admin**: Clicks "Reject" → Adds note "Screenshot unclear, please resubmit"
5. **System**: Marks rejected, NO funds added, notifies user
6. **User**: Sees rejection → Can submit new request with better proof

---

## 🎯 Best Practices

### For Users:

1. **Clear Screenshots**: Ensure payment proof is readable
2. **Accurate Amounts**: Double-check amount matches payment
3. **Add Details**: Include transaction IDs, payment methods in notes
4. **Check Balance**: Ensure sufficient balance before withdrawal requests
5. **Be Patient**: Wait for admin review (usually within 24 hours)

### For Admin:

1. **Verify Proof**: Always check deposit screenshots carefully
2. **Add Notes**: Explain approval/rejection reasons
3. **Process Quickly**: Review requests promptly to maintain trust
4. **Document**: Keep records of transaction IDs in admin notes
5. **Communicate**: Use admin notes to guide users on corrections

---

## 🔒 Security Features

- **JWT Authentication**: All requests require valid login
- **File Validation**: Only images allowed, max 5MB
- **Balance Checks**: Withdrawals verify sufficient funds
- **Transaction Safety**: Database transactions ensure consistency
- **Audit Trail**: All requests logged with timestamps and reviewers
- **Role-Based Access**: Only admin can approve/reject

---

## 📊 Request Statuses

| Status | Description | User Action | Admin Action |
|--------|-------------|-------------|--------------|
| **Pending** | Awaiting admin review | Wait | Review & Approve/Reject |
| **Approved** | Admin approved, funds transferred | None needed | Completed |
| **Rejected** | Admin rejected, no funds transferred | Can resubmit | Completed |

---

## 🚀 Quick Start

### As User:

1. Login to your account
2. Go to wallet section
3. Click "Deposit" or "Withdraw"
4. Fill form and submit
5. Click "My Requests" to track status

### As Admin:

1. Login as Admin
2. Scroll to "Transaction Requests" section
3. Review pending requests
4. Click "Approve" or "Reject"
5. Add admin notes
6. Confirm action

---

## ⚠️ Important Notes

1. **Deposits Require Screenshots**: Cannot submit deposit without proof
2. **Withdrawals Check Balance**: Must have sufficient available balance
3. **One-Time Review**: Once approved/rejected, cannot be changed
4. **Real-Time Updates**: Both parties notified instantly via WebSocket
5. **Admin Notes Visible**: Users can see admin's response notes
6. **No Auto-Approval**: All requests require manual admin review

---

## 🔧 Technical Details

### Database Schema

```sql
CREATE TABLE transaction_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  type ENUM('deposit', 'withdrawal'),
  amount DECIMAL(10, 2),
  status ENUM('pending', 'approved', 'rejected'),
  screenshot_path VARCHAR(255),
  notes TEXT,
  admin_notes TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### API Endpoints

- `POST /transaction-requests/deposit` - Submit deposit request
- `POST /transaction-requests/withdrawal` - Submit withdrawal request
- `GET /transaction-requests/my-requests` - Get user's requests
- `GET /admin/transaction-requests` - Get all requests (admin)
- `POST /admin/transaction-requests/:id/review` - Approve/reject (admin)

### WebSocket Events

- `newTransactionRequest` - New request submitted
- `transactionRequestReviewed` - Request approved/rejected

---

## 📞 Support

For questions:
- Check main README.md
- Review ADMIN_POWERS_GUIDE.md
- Review FEATURES_GUIDE.md

---

**Remember**: This system ensures transparency and security by requiring admin approval for all fund movements! 💪