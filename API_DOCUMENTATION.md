# API Documentation

## Base URL
```
http://localhost:3000
```

## Authentication

All protected endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

## Error Responses

All errors follow this format:
```json
{
  "success": false,
  "error": "Error message",
  "details": {} // Optional, for validation errors
}
```

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request / Validation Error
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `429` - Too Many Requests
- `500` - Internal Server Error
- `502` - External Service Error

---

## Authentication Endpoints

### Register User
```http
POST /auth/register
```

**Request Body:**
```json
{
  "username": "string",
  "password": "string",
  "role": "middleman",
  "full_name": "string",
  "email": "string",
  "phone_number": "string",
  "country": "string"
}
```

**Response:**
```json
{
  "message": "User registered successfully",
  "token": "jwt_token",
  "user": {
    "id": 1,
    "username": "string",
    "role": "middleman"
  }
}
```

### Login
```http
POST /auth/login
```

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "jwt_token",
  "user": {
    "id": 1,
    "username": "string",
    "role": "admin"
  }
}
```

### Get Current User
```http
GET /auth/me
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": 1,
  "username": "string",
  "role": "admin",
  "full_name": "string",
  "email": "string",
  "phone_number": "string",
  "country": "string",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

---

## Wallet Endpoints

### Get My Wallet
```http
GET /wallets/me
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": 1,
  "user_id": 1,
  "available_balance": "1000.00",
  "locked_balance": "50.00",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Get Wallet by User ID
```http
GET /wallets/:user_id
Authorization: Bearer <token>
```

---

## Order Endpoints

### Create Order (Admin Only)
```http
POST /orders
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "amount": 100.00,
  "description": "Order description"
}
```

**Response:**
```json
{
  "id": 1,
  "buyer_id": 1,
  "amount": "100.00",
  "status": "PENDING",
  "description": "Order description",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### Get All Orders
```http
GET /orders
Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "id": 1,
    "amount": "100.00",
    "status": "PENDING",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

### Claim Order (Middleman Only)
```http
POST /orders/:id/claim
Authorization: Bearer <token>
```

**Response:**
```json
{
  "message": "Order secured. Your collateral is now locked.",
  "order_id": 1,
  "collateral_locked": 100
}
```

### Complete Order (Middleman)
```http
POST /orders/:id/complete
Authorization: Bearer <token>
```

**Response:**
```json
{
  "message": "Order marked as complete. Waiting for admin to release funds.",
  "order": {
    "id": 1,
    "status": "READY_FOR_RELEASE"
  }
}
```

### Release Order (Admin Only)
```http
POST /orders/:id/release
Authorization: Bearer <token>
```

**Response:**
```json
{
  "message": "Order completed. Commission of $5.00 paid.",
  "order": {
    "id": 1,
    "status": "COMPLETED"
  }
}
```

### Dispute Order
```http
POST /orders/:id/dispute
Authorization: Bearer <token>
```

**Response:**
```json
{
  "message": "Order marked as disputed. Admin will review.",
  "order": {
    "id": 1,
    "status": "DISPUTED"
  }
}
```

### Resolve Dispute (Admin Only)
```http
POST /orders/:id/resolve
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "winner": "middleman" // or "buyer"
}
```

---

## Transaction Request Endpoints

### Create Deposit Request
```http
POST /transaction-requests/deposit
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Request Body:**
```
amount: 100.00
notes: Optional notes
screenshot: File upload
```

### Create Withdrawal Request
```http
POST /transaction-requests/withdrawal
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "amount": 100.00,
  "phone": "254712345678",
  "notes": "Optional notes"
}
```

### Get My Transaction Requests
```http
GET /transaction-requests/my-requests
Authorization: Bearer <token>
```

---

## Admin Endpoints

### Get Master Overview
```http
GET /admin/overview
Authorization: Bearer <token> (Admin only)
```

**Query Parameters:**
- `ordersLimit` - Number of orders to return (default: 10)
- `ordersOffset` - Offset for pagination (default: 0)
- `status` - Filter by order status
- `search` - Search orders

**Response:**
```json
{
  "users": [],
  "orders": [],
  "totalOrders": 50,
  "ordersHasMore": true,
  "pendingRequests": 5
}
```

### Deposit Funds (Admin)
```http
POST /admin/wallets/:user_id/deposit
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "amount": 100.00
}
```

### Withdraw Funds (Admin)
```http
POST /admin/wallets/:user_id/withdraw
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "amount": 50.00
}
```

### Review Transaction Request (Admin)
```http
POST /admin/transaction-requests/:id/review
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "action": "approve", // or "reject"
  "admin_notes": "Optional notes"
}
```

### Get Activity Logs (Admin)
```http
GET /admin/activity-logs
Authorization: Bearer <token>
```

**Query Parameters:**
- `limit` - Number of logs (default: 100)
- `offset` - Offset for pagination (default: 0)

---

## M-Pesa Endpoints

### Initiate STK Push
```http
POST /api/stkpush
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "amount": 1000,
  "phoneNumber": "254712345678"
}
```

**Response:**
```json
{
  "CheckoutRequestID": "ws_CO_01012024000000",
  "MerchantRequestID": "12345",
  "ResponseCode": "0",
  "ResponseDescription": "Success"
}
```

---

## Rate Limits

- **General API**: 100 requests per 15 minutes
- **Authentication**: 5 requests per 15 minutes
- **Transactions**: 10 requests per 15 minutes
- **File Uploads**: 10 requests per hour

## Webhooks

### M-Pesa Callback
```http
POST /api/callback
```

This endpoint receives callbacks from M-Pesa. No authentication required.