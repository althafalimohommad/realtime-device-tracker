# 🔧 Quick Setup: MongoDB Atlas (Required for Cloud Deployment)

## Problem Solved
Device registrations are now stored in **MongoDB Atlas** (cloud database) instead of local files. This ensures your registered devices persist across deployments and server restarts.

## ⚡ Quick Setup (5 minutes)

### 1. Create Free MongoDB Account
👉 Go to: https://www.mongodb.com/cloud/atlas/register
- Sign up (it's FREE forever!)
- Choose M0 FREE tier (512 MB)

### 2. Get Your Connection String
1. Create a cluster (takes 3-5 minutes)
2. Create database user with password
3. Whitelist all IPs: `0.0.0.0/0`
4. Get connection string:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/devicetracker
   ```

### 3. Add to Render
1. Go to your Render dashboard
2. Click your web service
3. Go to **Environment** tab
4. Add variable:
   - Key: `MONGODB_URI`
   - Value: (paste your connection string)
5. **Save** (Render will auto-redeploy)

### 4. Test It Works
After deployment, check logs in Render:
- ✅ Should see: `Connected to MongoDB Atlas`
- ❌ If you see: `Using local file storage` - check your connection string

## 📖 Detailed Guide
See [MONGODB_SETUP.md](./MONGODB_SETUP.md) for step-by-step instructions with screenshots.

## 🎯 What This Fixes
- ✅ Device registrations persist across deployments
- ✅ Register on mobile → Find from laptop (same account)
- ✅ No data loss on server restart
- ✅ Unlimited registered devices per user
- ✅ Fast cloud database (auto-backups included)

## 💰 Cost
**100% FREE** - MongoDB Atlas M0 tier is free forever and perfect for your app!

---

**Need help?** Check MONGODB_SETUP.md for detailed instructions.
