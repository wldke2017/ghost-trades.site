# Installation Guide - Security & Performance Improvements

## Prerequisites
- Node.js v18+ installed
- PostgreSQL database running
- PowerShell execution policy configured

## Step 1: Fix PowerShell Execution Policy (Windows)

If you get "running scripts is disabled" error, run PowerShell as Administrator:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Then restart your terminal.

## Step 2: Install New Dependencies

```bash
npm install helmet express-rate-limit joi winston winston-daily-rotate-file cors compression --save
```

Or install dev dependencies:

```bash
npm install eslint prettier jest supertest nodemon --save-dev
```

## Step 3: Configure Environment Variables

1. Copy `.env.example` to `.env`:
```bash
copy .env.example .env
```

2. Edit `.env` file and update these critical values:
```env
# IMPORTANT: Change these values!
JWT_SECRET=your-very-long-random-secret-key-minimum-32-characters
DB_PASSWORD=your-secure-database-password
NODE_ENV=development
```

## Step 4: Verify Installation

Check if all new files are created:
- ✅ `utils/logger.js`
- ✅ `middleware/errorHandler.js`
- ✅ `middleware/validator.js`
- ✅ `middleware/rateLimiter.js`
- ✅ `.env.example`
- ✅ `.eslintrc.json`
- ✅ `.prettierrc`
- ✅ `logs/` directory

## Step 5: Test the Application

1. Start the server:
```bash
node server.js
```

2. You should see:
```
Database connection established successfully.
Database synced
Server running on port 3000
WebSocket server is ready
Environment: development
```

## Step 6: Verify Security Features

### Test Rate Limiting
Try logging in 6 times with wrong password - should get rate limited.

### Test Input Validation
Try creating an order with negative amount - should get validation error.

### Test Logging
Check `logs/combined.log` and `logs/error.log` files are created.

## Common Issues

### Issue: "Cannot find module 'helmet'"
**Solution:** Run `npm install` to install all dependencies

### Issue: "JWT_SECRET must be at least 32 characters"
**Solution:** Update `.env` file with a longer JWT_SECRET

### Issue: "Unable to connect to database"
**Solution:** 
1. Make sure PostgreSQL is running
2. Check database credentials in `.env`
3. Verify database exists: `CREATE DATABASE escrow_project;`

### Issue: PowerShell script execution disabled
**Solution:** Run as Administrator:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Manual Installation (if npm fails)

If npm install doesn't work due to PowerShell restrictions, you can:

1. Use Command Prompt instead of PowerShell
2. Or use Git Bash
3. Or manually enable scripts in PowerShell (see above)

## Verification Checklist

After installation, verify:
- [ ] Server starts without errors
- [ ] Can login as Admin
- [ ] Can create orders
- [ ] Rate limiting works (try 6 failed logins)
- [ ] Validation works (try invalid inputs)
- [ ] Logs are being created in `logs/` folder
- [ ] Environment variables are loaded

## Next Steps

1. **Change Admin Password**
   - Login as Admin/Admin083
   - Change to a strong password

2. **Review Security Settings**
   - Check `.env` file
   - Verify JWT_SECRET is strong
   - Review CORS settings

3. **Test All Features**
   - User registration
   - Order creation
   - Claiming orders
   - Dispute resolution
   - Transaction requests

## Production Deployment

Before deploying to production:

1. Set `NODE_ENV=production` in `.env`
2. Use strong passwords and secrets
3. Enable HTTPS
4. Configure proper CORS origins
5. Set up database backups
6. Configure monitoring

See `DEPLOYMENT_GUIDE.md` for detailed production setup.

---

**Need Help?** Check `IMPLEMENTATION_REPORT.md` for complete details.