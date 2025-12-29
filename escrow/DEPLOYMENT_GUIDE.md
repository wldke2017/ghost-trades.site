# Deployment Guide

## Prerequisites

- Node.js v18 or higher
- PostgreSQL 12 or higher
- npm or yarn
- PM2 (for process management)

## Environment Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd escrow
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` and set all required variables:

```env
NODE_ENV=production
PORT=3000
JWT_SECRET=<generate-strong-32-char-secret>
DB_HOST=<your-db-host>
DB_NAME=escrow_production
DB_USER=<your-db-user>
DB_PASSWORD=<strong-db-password>
MPESA_CONSUMER_KEY=<your-key>
MPESA_CONSUMER_SECRET=<your-secret>
MPESA_BUSINESS_SHORTCODE=<your-shortcode>
MPESA_PASSKEY=<your-passkey>
MPESA_CALLBACK_URL=https://yourdomain.com/api/callback
ADMIN_DEFAULT_PASSWORD=<strong-admin-password>
```

### 3. Database Setup

Create the database:

```sql
CREATE DATABASE escrow_production;
```

Run migrations (the app will auto-sync on first run, but use migrations in production):

```bash
npm run db:migrate
```

### 4. Security Hardening

**Change Default Credentials:**
```bash
# After first deployment, immediately change admin password via UI or API
```

**Set Strong JWT Secret:**
```bash
# Generate a strong secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Configure CORS:**
```env
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

## Deployment Options

### Option 1: PM2 (Recommended)

Install PM2:
```bash
npm install -g pm2
```

Start the application:
```bash
pm2 start server.js --name escrow-api
pm2 save
pm2 startup
```

Monitor:
```bash
pm2 status
pm2 logs escrow-api
pm2 monit
```

### Option 2: Docker

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    depends_on:
      - db
  
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: escrow_production
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

Deploy:
```bash
docker-compose up -d
```

### Option 3: Cloud Platforms

#### Render.com

1. Create new Web Service
2. Connect repository
3. Set environment variables in dashboard
4. Deploy

#### Heroku

```bash
heroku create your-app-name
heroku addons:create heroku-postgresql:hobby-dev
heroku config:set JWT_SECRET=<your-secret>
# Set other env vars
git push heroku main
```

#### AWS (EC2)

1. Launch EC2 instance (Ubuntu 22.04)
2. Install Node.js and PostgreSQL
3. Clone repository
4. Set up nginx as reverse proxy
5. Configure SSL with Let's Encrypt
6. Use PM2 for process management

## Nginx Configuration

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## SSL Setup (Let's Encrypt)

```bash
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## Database Backups

### Automated Backups

Create backup script `/home/user/backup-db.sh`:

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/postgresql"
mkdir -p $BACKUP_DIR

pg_dump -U postgres escrow_production | gzip > $BACKUP_DIR/backup_$DATE.sql.gz

# Keep only last 7 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete
```

Add to crontab:
```bash
crontab -e
# Add: 0 2 * * * /home/user/backup-db.sh
```

## Monitoring

### Health Check Endpoint

```javascript
// Add to server.js
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});
```

### Logging

Logs are stored in `logs/` directory using Winston with daily rotation.

Monitor logs:
```bash
tail -f logs/combined.log
tail -f logs/error.log
```

## Performance Optimization

1. **Enable Gzip Compression** (already enabled via compression middleware)
2. **Use Connection Pooling** (configured in db.js)
3. **Add Redis for Caching** (optional)
4. **CDN for Static Assets** (optional)

## Troubleshooting

### Database Connection Issues
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -U postgres -h localhost -d escrow_production
```

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000
# Kill process
kill -9 <PID>
```

### Application Crashes
```bash
# Check PM2 logs
pm2 logs escrow-api --lines 100

# Restart application
pm2 restart escrow-api
```

## Post-Deployment Checklist

- [ ] All environment variables set correctly
- [ ] Database connection working
- [ ] Admin password changed from default
- [ ] SSL certificate installed and working
- [ ] Backups configured
- [ ] Monitoring set up
- [ ] Error logging working
- [ ] Health check endpoint accessible
- [ ] Rate limiting tested
- [ ] M-Pesa callbacks working
- [ ] WebSocket connections working
- [ ] CORS configured for production domain
- [ ] Security headers verified