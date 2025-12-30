# 🚀 How to Start the Escrow System

## Quick Start

### Option 1: Using the Batch File (Easiest)
1. Double-click `start-server.bat`
2. A command window will open showing the server is running
3. Open your browser and go to: http://localhost:3000
4. **Keep the command window open** while using the application

### Option 2: Using Command Line
1. Open PowerShell or Command Prompt
2. Navigate to the project folder:
   ```
   cd C:\Users\User\OneDrive\Desktop\Escrow
   ```
3. Start the server:
   ```
   node server.js
   ```
4. Open your browser and go to: http://localhost:3000

## 🔐 Login Credentials

### Admin Account (Developer Only)
- **Username**: `Admin`
- **Password**: `Admin083`

### Test Middleman Account
- **Username**: `middleman1`
- **Password**: `middleman123`

### Create New Middleman Account
- Click the "Register" tab
- Enter your desired username and password
- New accounts are automatically created as Middleman role

## ⚠️ Important Notes

1. **Server Must Be Running**: The server must be running for the application to work
2. **Don't Close the Server Window**: Keep the command window open while using the app
3. **Database**: Make sure PostgreSQL is running with the database `escrow_project`
4. **Port 3000**: Make sure no other application is using port 3000

## 🛑 How to Stop the Server

- Press `Ctrl + C` in the command window where the server is running
- Or simply close the command window

## 🔧 Troubleshooting

### "Port 3000 already in use"
If you see this error:
1. Open Task Manager (Ctrl + Shift + Esc)
2. Find any `node.exe` processes
3. End those processes
4. Try starting the server again

### "Cannot connect to database"
Make sure PostgreSQL is running and the database exists:
```sql
CREATE DATABASE escrow_project;
```

### Login not working
1. Make sure the server is running (check the command window)
2. Check browser console for errors (F12)
3. Try refreshing the page

## 📝 What's Fixed

✅ Fixed syntax error in server.js (duplicate variable declaration)
✅ Admin credentials updated to Admin/Admin083
✅ Registration restricted to middleman role only
✅ Admin has full control over all orders
✅ Added cancel order functionality for admin
✅ Enhanced UI with admin-specific actions

## 🎯 Next Steps

Once logged in as Admin, you can:
- Create new escrow orders
- View all orders in the system
- Cancel any order
- Complete any claimed order
- Resolve disputes
- View master overview of all users and wallets

Enjoy using the Escrow System! 🎉