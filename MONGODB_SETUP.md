# MongoDB Atlas Setup Guide

## Step 1: Create Free MongoDB Atlas Account

1. Go to https://www.mongodb.com/cloud/atlas/register
2. Sign up with your email or Google account
3. Choose the **FREE** M0 cluster (512 MB storage)

## Step 2: Create a Cluster

1. After signing in, click **"Build a Database"**
2. Choose **M0 FREE** tier
3. Select a cloud provider and region (choose closest to your users)
4. Name your cluster (e.g., "DeviceTracker")
5. Click **"Create"**

## Step 3: Create Database User

1. Click **"Database Access"** in left sidebar
2. Click **"Add New Database User"**
3. Choose **Password** authentication
4. Create a username (e.g., `devicetracker`)
5. Generate a strong password (save it!)
6. Set privileges to **"Read and write to any database"**
7. Click **"Add User"**

## Step 4: Whitelist IP Addresses

1. Click **"Network Access"** in left sidebar
2. Click **"Add IP Address"**
3. Click **"Allow Access from Anywhere"** (for deployment)
   - This adds `0.0.0.0/0` which allows connections from any IP
4. Click **"Confirm"**

## Step 5: Get Connection String

1. Click **"Database"** in left sidebar
2. Click **"Connect"** on your cluster
3. Choose **"Connect your application"**
4. Copy the connection string (looks like):
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
5. Replace `<username>` with your database username
6. Replace `<password>` with your database password

## Step 6: Add to Your Project

### Local Development (.env file):
```env
MONGODB_URI=mongodb+srv://devicetracker:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/devicetracker?retryWrites=true&w=majority
```

### Render Deployment:
1. Go to your Render dashboard
2. Select your web service
3. Go to **Environment** tab
4. Add new environment variable:
   - **Key**: `MONGODB_URI`
   - **Value**: Your full MongoDB connection string
5. Save changes
6. Render will automatically redeploy

## Testing the Connection

Your app will show on startup:
- ✅ `Connected to MongoDB Atlas` - Working!
- ⚠️ `Using local file storage` - Not connected (check your connection string)

## Troubleshooting

### Connection Issues:
1. Check username/password are correct
2. Verify IP whitelist includes `0.0.0.0/0`
3. Ensure database user has read/write permissions
4. Check connection string format is correct

### Security Best Practices:
- Never commit `.env` file to git
- Use different database users for dev/prod
- Regularly rotate passwords
- Monitor database access logs

## Free Tier Limits

MongoDB Atlas M0 (Free):
- ✅ 512 MB storage
- ✅ Shared RAM
- ✅ Good for 1000s of users
- ✅ Automatic backups
- ✅ 99.9% uptime SLA

Perfect for your device tracker! 🎉
