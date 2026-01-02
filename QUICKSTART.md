# 🚀 Quick Deploy Guide

## Get Your App Online in 5 Minutes!

### Option 1: Deploy to Render (Easiest - Free)

1. **Go to Render**
   - Visit: https://render.com
   - Click "Get Started for Free"
   - Sign up with GitHub

2. **Create New Web Service**
   - Click "New +" → "Web Service"
   - Select "Connect Repository"
   - Choose: `althafalimohommad/realtime-device-tracker`

3. **Configure**
   - Name: `device-tracker` (or your choice)
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: **Free**

4. **Add Environment Variables**
   Click "Advanced" and add:
   ```
   GOOGLE_CLIENT_ID = [Your Google Client ID]
   GOOGLE_CLIENT_SECRET = [Your Google Secret]
   SESSION_SECRET = [Random 32 character string]
   CALLBACK_URL = https://device-tracker.onrender.com/auth/google/callback
   ```

5. **Update Google OAuth**
   - Go to: https://console.cloud.google.com
   - APIs & Services → Credentials
   - Add redirect URI: `https://device-tracker.onrender.com/auth/google/callback`

6. **Deploy!**
   - Click "Create Web Service"
   - Wait 3 minutes
   - Visit: `https://device-tracker.onrender.com` ✨

---

### Option 2: Deploy to Railway (Fast)

1. Visit: https://railway.app
2. Click "Deploy from GitHub repo"
3. Select your repository
4. Add same environment variables as above
5. Done! Live at: `https://your-app.up.railway.app`

---

## 🌐 Add Custom Domain (e.g., tracker.mydomain.com)

### Step 1: Buy a Domain
- Namecheap: ~$10/year
- Google Domains: ~$12/year
- Or use free subdomain from Render

### Step 2: In Render Dashboard
1. Go to your service → Settings
2. Scroll to "Custom Domain"
3. Click "Add Custom Domain"
4. Enter: `tracker.yourdomain.com`

### Step 3: Configure DNS
In your domain registrar (Namecheap, etc.):
```
Type: CNAME
Name: tracker
Value: device-tracker.onrender.com
```

### Step 4: Wait 5-15 minutes
- SSL certificate auto-provisions
- Your app is live at: `https://tracker.yourdomain.com` 🎉

### Step 5: Update Google OAuth
Add to redirect URIs:
```
https://tracker.yourdomain.com/auth/google/callback
```

---

## ✅ Done! Share Your Links

Your deployment URLs:
- **Render Free**: `https://device-tracker.onrender.com`
- **Custom Domain**: `https://tracker.yourdomain.com`

Share with anyone - they can:
- Login with Google
- Track their devices
- Share location with generated links

---

## 🆘 Need Help?

See detailed guide: [DEPLOYMENT.md](DEPLOYMENT.md)

Common issues:
- **OAuth error?** Check redirect URI matches deployed URL
- **App sleeping?** Render free tier sleeps after inactivity (normal)
- **WebSocket errors?** Render supports WebSockets by default

---

**Quick Deploy Link**: https://render.com/deploy

Happy deploying! 🚀
