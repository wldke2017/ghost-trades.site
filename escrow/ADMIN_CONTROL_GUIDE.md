# Admin Control System - Complete Guide

## Overview
The admin has **full control** over the entire escrow platform. All admin actions are immediately reflected on user dashboards through real-time WebSocket synchronization.

## Admin Capabilities

### 1. User Management
**Location**: Admin Dashboard → User Management Section

#### View All Users
- See all registered users with their roles and balances
- View available balance, locked balance, and total balance
- Monitor user account status (active/disabled/blocked)

#### Manage User Balances
- **Deposit Funds**: Add money to any user's wallet
  - Click "Deposit" button next to user
  - Enter amount
  - Funds are added immediately to available balance
  - User sees update in real-time on their dashboard

- **Withdraw Funds**: Remove money from any user's wallet
  - Click "Withdraw" button next to user
  - Enter amount (must not exceed available balance)
  - Funds are deducted immediately
  - User sees update in real-time on their dashboard

#### Control User Access
- **Disable User**: Temporarily disable user account
- **Block User**: Permanently block user access
- **Activate User**: Re-enable disabled/blocked accounts
- **Delete User**: Permanently remove user from system

### 2. Order Management
**Location**: Admin Dashboard → God-Mode Orders Section

#### Create Orders
- Admin creates escrow orders as the buyer
- Set order amount and description
- Order appears immediately to all middlemen
- Orders start in PENDING status

#### Monitor Orders
View all orders with complete details:
- Order ID and amount
- Current status (PENDING/CLAIMED/READY_FOR_RELEASE/COMPLETED/DISPUTED/CANCELLED)
- Buyer and middleman information
- Creation and update timestamps

#### Release Orders
When middleman completes work:
1. Middleman marks order as complete → Status: READY_FOR_RELEASE
2. Admin reviews and clicks "Release"
3. System:
   - Unlocks middleman's collateral
   - Adds 5% commission to middleman's available balance
   - Updates order status to COMPLETED
   - Both admin and middleman see updates immediately

#### Cancel Orders
- Cancel any order at any time (except COMPLETED)
- If order was CLAIMED, collateral is returned to middleman
- Order status changes to CANCELLED
- Updates reflect immediately on all dashboards

### 3. Dispute Resolution
**Location**: Admin Dashboard → Disputed Orders Section

When an order is disputed:

#### Award to Middleman
- Middleman receives collateral back + 5% commission
- Order status: COMPLETED
- Middleman balance updates immediately

#### Award to Buyer
- Middleman receives collateral back (no commission)
- Order status: CANCELLED
- Middleman balance updates immediately

### 4. Transaction Request Management
**Location**: Admin Dashboard → Transaction Requests Section

#### Review Deposit Requests
- Users upload payment screenshot
- Admin reviews screenshot and details
- Approve: Funds added to user wallet immediately
- Reject: Request denied, no balance change

#### Review Withdrawal Requests
- Users request to withdraw funds
- Admin reviews request
- Approve: Funds deducted from user wallet immediately
- Reject: Request denied, no balance change

### 5. System Monitoring

#### Dashboard Statistics
- Total users count
- Active orders count
- Pending transaction requests
- Total system balance

#### Activity Logs
- View all system actions with timestamps
- Track who did what and when
- Monitor user activities
- Audit trail for compliance

#### System Health
- Total liquidity in system
- Total escrowed funds
- Projected commission from active orders
- Active orders count

## Real-time Synchronization

### How It Works
All admin actions trigger WebSocket events that update user dashboards immediately:

```
Admin Action → Database Update → WebSocket Event → User Dashboard Update
```

### Events Emitted
1. **walletUpdated**: When balance changes (deposit/withdraw/order completion)
2. **orderCreated**: When admin creates new order
3. **orderClaimed**: When middleman claims order
4. **orderCompleted**: When admin releases order
5. **orderCancelled**: When admin cancels order
6. **transactionRequestReviewed**: When admin approves/rejects transaction

### What Users See Immediately
- ✅ Balance changes (available and locked)
- ✅ New orders available to claim
- ✅ Order status updates
- ✅ Transaction request approvals/rejections
- ✅ Earnings and commission updates

## Admin Dashboard Access

### Login
- Username: `Admin`
- Password: `Admin083`
- Access URL: `/admin.html`

### Security
- Only users with `role: 'admin'` can access admin dashboard
- Non-admin users are automatically redirected
- All admin actions are logged in activity trail
- JWT authentication required for all API calls

## Testing Admin Features

### Manual Testing
1. Login as admin at `/admin.html`
2. Open user dashboard in another browser/tab
3. Perform admin actions (deposit/withdraw/create order)
4. Observe real-time updates on user dashboard

### Automated Testing
```bash
# Test all admin features
node test_admin_features.js

# Test WebSocket synchronization
node test_websocket_sync.js
```

## Common Workflows

### Workflow 1: Process Deposit Request
1. User submits deposit request with screenshot
2. Admin sees notification in Transaction Requests
3. Admin clicks "View Payment Screenshot"
4. Admin clicks "Approve" or "Reject"
5. If approved, funds appear in user's available balance immediately
6. User receives notification and sees updated balance

### Workflow 2: Complete an Order
1. Admin creates order (amount + description)
2. Middleman claims order (collateral locked)
3. Middleman completes work and marks as complete
4. Admin sees order in READY_FOR_RELEASE status
5. Admin clicks "Release"
6. Middleman receives collateral + 5% commission
7. Both see updates immediately

### Workflow 3: Handle Dispute
1. Buyer or admin disputes an order
2. Order appears in Disputed Orders section
3. Admin reviews situation
4. Admin clicks "Award Middleman" or "Refund Buyer"
5. Funds distributed accordingly
6. Order marked as COMPLETED or CANCELLED
7. All parties see updates immediately

## Best Practices

1. **Always verify payment screenshots** before approving deposits
2. **Review order details** before releasing funds
3. **Document dispute resolutions** using admin notes
4. **Monitor activity logs** regularly for suspicious activity
5. **Keep system liquidity healthy** by managing deposits/withdrawals
6. **Respond to transaction requests promptly** for better user experience

## Support

For issues or questions:
- Check `ADMIN_FIXES_SUMMARY.md` for recent fixes
- Review `VERIFICATION_REPORT.md` for system status
- Check server logs in `logs/` directory
- Run test scripts to verify functionality