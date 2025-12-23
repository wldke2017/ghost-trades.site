# Ghost Trades & SecureEscrow Monorepo

Multi-app platform hosting both Ghost Trades (binary options trading) and SecureEscrow (liquidity banking) applications.

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start the server
npm start

# Development mode with auto-reload
npm run dev
```

Visit:
- **Landing Page**: http://localhost:3000
- **Ghost Trades**: http://localhost:3000/ghost-trades
- **SecureEscrow**: http://localhost:3000/escrow

### Environment Setup

1. Copy `.env.example` to `.env`
2. Update the M-Pesa callback URL with your production domain
3. Configure database credentials

## 📁 Project Structure

```
ghost-trades-monorepo/
├── landing/              # Landing page for app selection
├── ghost-trades/         # Ghost Trades binary options app
├── escrow/              # SecureEscrow liquidity banking app
├── server.js            # Unified server entry point
├── package.json         # Root dependencies
└── render.yaml          # Deployment configuration
```

## 🌐 Deployment

### Deploy to Render

1. Push to GitHub
2. Connect your repository to Render
3. Render will automatically detect `render.yaml`
4. Configure environment variables in Render dashboard
5. Deploy!

Your app will be available at: `https://your-app-name.onrender.com`

## 🔧 Features

### Ghost Trades
- AI-powered trading bots
- Hedging strategies
- Real-time market analysis
- Binary options trading

### SecureEscrow
- Liquidity banking platform
- M-Pesa integration
- Secure escrow services
- Real-time transactions

## 📝 License

ISC
