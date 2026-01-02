# Deployment Guide - Real-Time Device Tracker

This guide will help you deploy your device tracker app to production with a custom domain.

## 🚀 Recommended Platforms

### 1. **Render** (Recommended - Free Tier Available)
✅ Best for this project - Full WebSocket support
✅ Free SSL certificates
✅ Custom domain support
✅ Auto-deploys from GitHub

### 2. **Railway**
✅ Easy deployment
✅ WebSocket support
✅ Free trial credits
✅ Custom domains

### 3. **DigitalOcean App Platform**
✅ Reliable hosting
✅ $5/month minimum
✅ Full control

---

## 📦 Deploy to Render (Step-by-Step)

### Step 1: Prepare Your Repository
Your code is already on GitHub! ✅

### Step 2: Sign Up for Render
1. Go to https://render.com
2. Sign up with your GitHub account
3. Authorize Render to access your repositories

### Step 3: Create a New Web Service
1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repository: `althafalimohommad/realtime-device-tracker`
3. Configure settings:
   - **Name**: `device-tracker` (or your custom name)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Select **Free**

### Step 4: Add Environment Variables
In Render dashboard, add these environment variables:

```
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
SESSION_SECRET=your-random-secret-key-here
CALLBACK_URL=https://your-app-name.onrender.com/auth/google/callback
```

⚠️ **Important**: Update `CALLBACK_URL` with your actual Render URL!

### Step 5: Update Google OAuth Settings
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **Credentials**
3. Edit your OAuth 2.0 Client ID
4. Add to **Authorized redirect URIs**:
   ```
   https://your-app-name.onrender.com/auth/google/callback
   ```
5. Also add to **Authorized JavaScript origins**:
   ```
   https://your-app-name.onrender.com
   ```

### Step 6: Deploy!
1. Click **"Create Web Service"**
2. Render will automatically build and deploy
3. Wait 3-5 minutes for deployment
4. Your app will be live at: `https://your-app-name.onrender.com`

---

## 🌐 Custom Domain Setup

### On Render (Free SSL Included)

1. **Purchase a Domain**
   - Namecheap: https://www.namecheap.com
   - Google Domains: https://domains.google
   - GoDaddy: https://www.godaddy.com
   
2. **Add Domain to Render**
   - In Render dashboard → Your service → **Settings**
   - Scroll to **Custom Domain**
   - Click **"Add Custom Domain"**
   - Enter your domain: `tracker.yourdomain.com` or `yourdomain.com`

3. **Configure DNS Records**
   
   In your domain registrar's DNS settings, add:
   
   **For subdomain (e.g., tracker.yourdomain.com):**
   ```
   Type: CNAME
   Name: tracker
   Value: your-app-name.onrender.com
   ```
   
   **For root domain (e.g., yourdomain.com):**
   ```
   Type: A
   Name: @
   Value: [IP shown in Render dashboard]
   ```

4. **Wait for SSL Certificate**
   - Render automatically provisions SSL certificate
   - Takes 5-15 minutes
   - Your site will be accessible via HTTPS

5. **Update OAuth Callback**
   - Update Google OAuth redirect URI to:
   ```
   https://tracker.yourdomain.com/auth/google/callback
   ```

---

## 🚂 Deploy to Railway (Alternative)

### Quick Deploy
1. Go to https://railway.app
2. Click **"Start a New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose `althafalimohommad/realtime-device-tracker`
5. Add environment variables (same as above)
6. Deploy!

Your app will be at: `https://your-app.up.railway.app`

### Custom Domain on Railway
1. Go to project settings
2. Click **"Domains"**
3. Add your custom domain
4. Follow DNS configuration instructions
5. Railway provides free SSL

---

## 🔧 Environment Variables for Production

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
SESSION_SECRET=use-strong-random-string-min-32-chars
CALLBACK_URL=https://yourdomain.com/auth/google/callback
PORT=3000
```

**Generate secure session secret:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## ✅ Post-Deployment Checklist

- [ ] App is accessible via public URL
- [ ] Google OAuth login works
- [ ] Location tracking works on mobile
- [ ] Share links are accessible publicly
- [ ] SSL certificate is active (HTTPS)
- [ ] Custom domain configured (optional)
- [ ] Environment variables are set correctly
- [ ] WebSocket connections work (check browser console)

---

## 🐛 Troubleshooting

### OAuth Redirect Mismatch
**Error**: "redirect_uri_mismatch"
**Solution**: Make sure the callback URL in Google Cloud Console matches your deployed URL exactly.

### WebSocket Connection Failed
**Error**: "WebSocket connection to 'wss://...' failed"
**Solution**: Ensure your platform supports WebSocket. Render and Railway do by default.

### App Not Loading
**Solution**: 
1. Check Render/Railway logs for errors
2. Verify all environment variables are set
3. Make sure `PORT` is not hardcoded (use `process.env.PORT || 3000`)

### Share Links Don't Work
**Solution**: Update all localhost references in code to use the deployed domain.

---

## 💰 Cost Estimates

| Platform | Free Tier | Paid Plan | Custom Domain | SSL |
|----------|-----------|-----------|---------------|-----|
| **Render** | ✅ 750 hrs/month | $7/month | Free | Free |
| **Railway** | $5 trial credit | $5/month + usage | Free | Free |
| **Heroku** | ❌ Discontinued | $7/month | Free | Free |
| **DigitalOcean** | ❌ | $5/month | Free | Free |

---

## 🎯 Free Domain Options

If you don't want to buy a domain:

1. **Free Subdomains**:
   - Use Render's subdomain: `app-name.onrender.com`
   - Use Railway's subdomain: `app-name.up.railway.app`

2. **Free Domain Services**:
   - Freenom: Free .tk, .ml, .ga domains
   - eu.org: Free subdomain

---

## 📱 Mobile Access

Once deployed, users can access from any device:
- Desktop: `https://yourdomain.com`
- Mobile browser: `https://yourdomain.com`
- Share as PWA: Add to home screen

---

## 🔒 Security Tips

1. **Never commit .env file** ✅ Already in .gitignore
2. **Use strong SESSION_SECRET** - At least 32 random characters
3. **Enable HTTPS only** - Render/Railway do this automatically
4. **Restrict OAuth domains** - Only add your production domain
5. **Set secure cookie options** for production:
   ```javascript
   cookie: { 
     maxAge: 24 * 60 * 60 * 1000,
     secure: true,  // HTTPS only
     httpOnly: true,
     sameSite: 'lax'
   }
   ```

---

## 📞 Need Help?

- Render Docs: https://render.com/docs
- Railway Docs: https://docs.railway.app
- GitHub Issues: https://github.com/althafalimohommad/realtime-device-tracker/issues

---

**Ready to deploy? Start with Render - it's the easiest option!** 🚀
