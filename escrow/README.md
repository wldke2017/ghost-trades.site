# Liquidity-Based Escrow System

A production-ready, full-stack escrow application with liquidity-based collateral system, comprehensive security features, and M-Pesa integration.

## 🚀 Tech Stack
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL with Sequelize ORM
- **Frontend**: Vanilla JavaScript, HTML, CSS
- **Real-time**: Socket.io
- **Security**: JWT, Helmet, Rate Limiting
- **Testing**: Jest, Supertest
- **Payment**: M-Pesa STK Push Integration

## 📋 Quick Start

### 1. Prerequisites
- Node.js v18 or higher
- PostgreSQL 12 or higher
- npm or yarn

### 2. Database Setup
```bash
# Create database
createdb escrow_db

# Or using psql
psql -U postgres -c "CREATE DATABASE escrow_db;"
```

### 3. Environment Configuration
```bash
# Copy environment template
cp .env.example .env

# Edit .env and set your values
# IMPORTANT: Change JWT_SECRET, database credentials, and M-Pesa keys
```

### 4. Install Dependencies
```bash
npm install
```

### 5. Run Tests (Optional)
```bash
npm test
```

### 6. Start the Server
```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

The application will be available at `http://localhost:3000`

## 📚 Documentation

- **[API Documentation](./API_DOCUMENTATION.md)** - Complete API reference
- **[Security Policy](./SECURITY.md)** - Security best practices
- **[Deployment Guide](./DEPLOYMENT_GUIDE.md)** - Production deployment instructions

## 🧪 Testing

Run the test suite:
```bash
# Run all tests with coverage
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with verbose output
npm run test:verbose
```

## 🏗️ Project Structure

```
escrow/
├── config/              # Configuration files
│   └── constants.js     # Application constants
├── middleware/          # Express middleware
│   ├── auth.js         # Authentication & authorization
│   ├── errorHandler.js # Error handling
│   ├── validator.js    # Request validation
│   └── rateLimiter.js  # Rate limiting
├── models/             # Sequelize models
│   ├── user.js
│   ├── wallet.js
│   ├── order.js
│   └── transaction.js
├── routes/             # API routes (to be refactored)
├── services/           # Business logic layer
│   ├── orderService.js
│   └── walletService.js
├── tests/              # Test files
│   ├── setup.js
│   └── services/
├── utils/              # Utility functions
│   ├── errors.js       # Custom error classes
│   └── logger.js       # Winston logger
├── public/             # Frontend files
├── uploads/            # File uploads
├── server.js           # Application entry point
└── package.json
```

## 🎯 New Workflow: Admin-Centric Platform

This is now a **Private Gig Platform** where the Admin (Boss) manages all orders and workers (Middlemen) fulfill them.

### 👑 For Admin (The Boss)
- **Create Orders**: Post new escrow orders (only admins can create)
- **Manage Disputes**: Resolve disputed orders with "God-mode" buttons
  - Award Middleman: Unlock collateral + pay 5% commission
  - Award Buyer: Return collateral to middleman, no commission
- **Master Overview**: See all wallets and orders at a glance
  - View all user balances (available, locked, total)
  - Track all orders across all statuses
- **Analytics Dashboard**: Monitor platform performance
- **Real-time Updates**: Get notified of all platform activities

### 👷 For Middlemen (The Workers)
- **View Available Orders**: See orders posted by admin
- **Claim Orders**: Lock collateral to start working
- **Earn Commission**: Get 5% commission on successful completion
- **Track History**: View completed transactions

### 🔄 Escrow Flow
1. **Admin** posts an order with amount and description
2. **Middleman** claims order (locks collateral from their balance)
3. **Work Completion**: Admin releases funds
4. **Payment**: Middleman receives collateral back + 5% commission
5. **Dispute Resolution**: Admin decides winner
   - If Middleman wins: Gets collateral + commission
   - If Buyer wins: Gets collateral back, no commission

### 🔐 Protected Routes
- **Create Orders**: Admin only (middleware protected)
- **Resolve Disputes**: Admin only (middleware protected)
- **Master Overview**: Admin only (middleware protected)
- **Claim Orders**: Middlemen only (role-based validation)

## ✨ Latest Features Implemented

### 🎯 Core Features
✅ **Confirmation Dialogs**: Smart confirmation before critical actions (claim, create orders)  
✅ **Order Details Modal**: Beautiful modal showing complete order information  
✅ **CSV Export**: Download transaction history with one click  
✅ **WebSocket Real-time Updates**: Live updates when orders are created/claimed/completed  
✅ **Dark Mode Toggle**: Persistent dark/light theme with smooth transitions  
✅ **Advanced Filtering**: Filter orders by status, amount range, and search  
✅ **Search Functionality**: Search orders and transaction history  
✅ **Charts & Analytics**: Beautiful charts showing order distribution and volume trends  

### 🎨 UI/UX Enhancements
✅ **Modern Banking UI**: Complete redesign with Tailwind CSS  
✅ **Professional Design**: Gradient cards, smooth animations, and modern typography  
✅ **Toast Notifications**: User-friendly notifications instead of alerts  
✅ **Status Badges**: Color-coded status indicators for orders  
✅ **Empty States**: Better messaging when no data is available  
✅ **Responsive Design**: Mobile-friendly layout  
✅ **Icon System**: Professional Tabler Icons throughout the interface  
✅ **Data Persistence**: Changed from `force: true` to `alter: true`  
✅ **Error Handling**: Comprehensive error handling with user feedback  

## 🔌 API Endpoints

### Users
- `POST /users` - Create new user
- `GET /wallets/:user_id` - Get user wallet

### Orders
- `GET /orders` - Get all orders
- `POST /orders` - Create new order **(Admin only)**
- `POST /orders/:id/claim` - Claim order (Middleman only)
- `POST /orders/:id/release` - Release funds **(Admin only)**
- `POST /orders/:id/dispute` - Dispute order
- `POST /orders/:id/resolve` - Resolve dispute **(Admin only)**

### Admin
- `GET /admin/overview` - Get master overview **(Admin only)**
  - Returns all users with wallet balances
  - Returns all orders with full details

## 👥 Default Users
- **User 1**: Admin (Boss) - Can create orders, resolve disputes, view master overview
- **User 2**: Middleman (Worker) - Can claim orders and earn commissions

Both start with $1000.00 initial balance.

## 🎯 Feature Highlights

### 📊 Analytics Dashboard
- **Statistics Cards**: Total orders, completed, pending, and commission earned
- **Pie Chart**: Order status distribution (Pending, Claimed, Completed, Disputed)
- **Line Chart**: 7-day transaction volume trends
- **Real-time Updates**: Charts update automatically with new data
- **Dark Mode Support**: Charts adapt to theme changes

### 🔍 Advanced Search & Filtering
- **Order Search**: Search by order ID or description
- **Status Filter**: Filter by PENDING, CLAIMED, COMPLETED, DISPUTED
- **Amount Range Filter**: Filter by price ranges ($0-100, $100-500, etc.)
- **History Search**: Search transaction history
- **Real-time Filtering**: Instant results as you type

### 💬 Smart Dialogs
- **Confirmation Dialogs**: 
  - Confirm before claiming orders
  - Confirm before creating orders
  - Prevent accidental actions
- **Order Details Modal**:
  - Complete order information
  - Status badges
  - Commission calculation
  - Creation and update timestamps
  - Quick claim action

### 🌐 Real-time Features (WebSocket)
- **Live Order Updates**: See new orders instantly
- **Claim Notifications**: Get notified when orders are claimed
- **Completion Alerts**: Know when orders are completed
- **Connection Status**: Visual feedback for connection state
- **Auto-reconnect**: Automatic reconnection on disconnect

### 🌙 Dark Mode
- **Toggle Switch**: Easy dark/light mode switching in header
- **Persistent**: Remembers your preference
- **Smooth Transitions**: Elegant theme transitions
- **Complete Coverage**: All components support dark mode
- **Chart Adaptation**: Charts automatically adjust colors

### 📥 Export Functionality
- **CSV Export**: Download transaction history
- **Formatted Data**: Order ID, Amount, Commission, Status, Date
- **Timestamped Files**: Files named with current date
- **One-click Download**: Simple export button
- **Error Handling**: Alerts if no data to export

### 🎨 UI Components
- **Gradient Cards**: Beautiful wallet balance cards
- **Status Badges**: Color-coded order status
- **Toast Notifications**: Non-intrusive messages
- **Loading States**: Smooth transitions
- **Empty States**: Helpful messages
- **Hover Effects**: Interactive elements
- **Icon System**: Tabler Icons throughout

## 🛠️ Technical Stack

### Frontend
- **Framework**: Vanilla JavaScript (no framework overhead)
- **CSS**: Tailwind CSS v3 (via CDN)
- **Icons**: Tabler Icons (icon font)
- **Charts**: Chart.js v4
- **WebSocket**: Socket.io Client
- **Fonts**: Inter (Google Fonts)

### Backend
- **Runtime**: Node.js v18+
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Sequelize
- **WebSocket**: Socket.io Server
- **Security**: Helmet, CORS, Rate Limiting
- **Validation**: Joi
- **Logging**: Winston

### Security Features
- **Authentication**: JWT with bcrypt password hashing
- **Authorization**: Role-based access control
- **Input Validation**: Joi schema validation
- **Rate Limiting**: Express-rate-limit
- **Security Headers**: Helmet.js
- **CORS**: Configurable origins
- **Error Handling**: Centralized error middleware

### Features
- **Dark Mode**: CSS classes + localStorage
- **CSV Export**: Blob API
- **Modals**: Pure CSS + JavaScript
- **Charts**: Chart.js with responsive design
- **Real-time**: Socket.io for live updates
- **Logging**: Winston with file rotation

## 📝 Technical Notes
- Each user automatically gets a wallet with $0 initial balance
- Commission rate is configurable (default 5%)
- Collateral must match order amount to claim
- UI built with Tailwind CSS via CDN (no build step required)
- Icons from Tabler Icons library (icon font)
- Inter font for modern typography
- WebSocket connection for real-time updates
- Charts update automatically on theme change
- Dark mode preference stored in localStorage
- All sensitive data stored in environment variables
- Comprehensive logging with Winston
- Input validation on all endpoints
- Rate limiting on authentication and transactions

## 🔒 Security

### Important Security Notes
1. **Change default admin password** immediately (Admin/Admin083)
2. **Set strong JWT_SECRET** in `.env` file (minimum 32 characters)
3. **Use HTTPS** in production
4. **Configure CORS** for your domain
5. **Enable rate limiting** (already configured)
6. **Regular security audits** with `npm audit`

See `SECURITY.md` for complete security guidelines.

## 📚 Documentation

- **Installation Guide**: `INSTALLATION_GUIDE.md`
- **Implementation Report**: `IMPLEMENTATION_REPORT.md`
- **Security Policy**: `SECURITY.md`
- **Quick Start**: `START_HERE.md`
- **API Documentation**: Coming soon