# Android Device Tracker App - Setup & Usage Guide

## Overview
This native Android app enables **24/7 background location tracking** for your devices. Unlike the web version that only tracks when the browser is open, this app continuously tracks location in the background using foreground services.

## Features
✅ **Google OAuth Authentication** - Secure login with your Google account  
✅ **24/7 Background Tracking** - Continuous location tracking even when app is closed  
✅ **Low Battery Impact** - Optimized to minimize battery usage  
✅ **Automatic Sync** - Location data syncs with the website in real-time  
✅ **Device Registration Display** - View your registered device details after login  
✅ **Secure Communication** - All data sent over HTTPS

## Requirements
- Android 7.0 (API 24) or higher
- Google account (same as used on the website)
- Location permissions (including background location)
- Internet connection

## Installation

### Option 1: Build from Source
1. Open the `android-app` folder in Android Studio
2. Sync Gradle files
3. Connect your Android device or emulator
4. Click **Run** (Shift+F10)

### Option 2: Install APK (Coming Soon)
Download the latest APK from the Releases page

## Setup Instructions

### Step 1: Create Account on Website FIRST
**⚠️ IMPORTANT:** You must create an account on the website before using the app!

1. Visit [https://realtime-device-tracker-s9ua.onrender.com](https://realtime-device-tracker-s9ua.onrender.com)
2. Click **"Continue with Google"**
3. Sign in with your Google account
4. Complete the website registration

### Step 2: Install the Android App
1. Install the app on your device
2. Open the app

### Step 3: Sign In to the App
1. The app will open to the **Login Screen**
2. Tap **"Sign in with Google"**
3. Select the **same Google account** you used on the website
4. Wait for authentication to complete

### Step 4: View Your Account Details
After successful login, you'll see:
- **Welcome Message** with your name
- **Email Address** 
- **User ID** (for reference)
- **Device Registration Section**

### Step 5: Register Your Device
1. Enter a **Device Name** (e.g., "My Phone", "John's Android")
2. Tap **"Register Device"**
3. Grant **Location Permission** when prompted
4. When asked for background location, select **"Allow all the time"**

### Step 6: Verify Tracking Status
After registration, you'll see:
```
✅ Device Registered
Name: My Phone
Fingerprint: a1b2c3d4e5f6...
Status: Tracking location in background...
```

### Step 7: View Location on Website
1. Go to the website: [https://realtime-device-tracker-s9ua.onrender.com](https://realtime-device-tracker-s9ua.onrender.com)
2. Login with the same Google account
3. Your Android device will appear on the map with real-time location updates

## How It Works

### Authentication Flow
1. **App Login** → Google OAuth → Server verification → User ID retrieved
2. **Server Check** → Verifies user exists in database (created via website)
3. **Session Storage** → User credentials securely stored on device
4. **Automatic Login** → App remembers you for future use

### Location Tracking Flow
1. **Registration** → Device fingerprint generated (unique ID)
2. **Service Start** → Foreground service starts tracking
3. **Location Updates** → Every 60 seconds, location sent to server
4. **Background Running** → Continues even when app closed
5. **Real-time Sync** → Location visible on website instantly

### Data Sent to Server
```json
{
  "latitude": 37.7749,
  "longitude": -122.4194,
  "accuracy": 10.5,
  "deviceName": "My Phone",
  "battery": 85,
  "charging": false,
  "timestamp": 1704412800000
}
```

## Permissions Required

### Location Permissions
- **ACCESS_FINE_LOCATION** - For precise GPS tracking
- **ACCESS_COARSE_LOCATION** - For network-based location
- **ACCESS_BACKGROUND_LOCATION** (Android 10+) - For tracking when app is closed

### Why Background Location?
Without "Allow all the time" permission, Android will stop location tracking when:
- Screen is locked
- App is closed
- Device is idle

**For 24/7 tracking, background location permission is mandatory!**

### Other Permissions
- **FOREGROUND_SERVICE** - Required for background tracking
- **INTERNET** - To send location data to server

## Usage

### Normal Operation
1. **Register Once** - After registration, tracking happens automatically
2. **Keep App Installed** - Don't uninstall the app
3. **Maintain Internet** - Location updates require internet connection
4. **Check Website** - View all your devices on the website

### Battery Optimization
The app is designed for efficiency:
- Updates every 60 seconds (not continuous)
- Uses GPS only when needed
- Foreground service prevents Android from killing it
- Minimal network usage (small JSON payloads)

### Unregister Device
1. Open the app
2. Tap **"Unregister Device"**
3. Confirm
4. Device will stop tracking and disappear from website

### Logout
1. Open the app
2. Scroll to bottom
3. Tap **"Logout"**
4. This will:
   - Stop location tracking
   - Unregister the device
   - Sign you out from Google
   - Clear all app data

## Troubleshooting

### "Please sign in on the website first"
**Problem:** App rejects login  
**Solution:** Create account on website first, then try app login

### Location Not Updating
1. Check internet connection
2. Verify background location permission granted
3. Ensure battery optimization disabled for the app:
   - Settings → Apps → Device Tracker → Battery → Unrestricted
4. Check if service is running (persistent notification should be visible)

### "Device Not Registered"
**Problem:** Status shows device not registered  
**Solution:** Enter device name and tap "Register Device"

### Google Sign-In Fails
1. Check internet connection
2. Make sure you're using the same Google account as the website
3. Try clearing app data:
   - Settings → Apps → Device Tracker → Storage → Clear Data
4. Reinstall the app

### Device Showing Offline on Website
**Possible Causes:**
- No internet connection
- App was force-stopped
- Battery optimization killed the service
- Background location permission revoked

**Solutions:**
- Open the app to restart the service
- Check permissions
- Disable battery optimization

## Technical Details

### Architecture
- **Language:** Java
- **Min SDK:** 24 (Android 7.0)
- **Target SDK:** 34 (Android 14)
- **Location API:** Google Play Services Location 21.0.1
- **HTTP Client:** OkHttp 4.11.0
- **Authentication:** Google Sign-In 20.7.0

### Background Service
- **Type:** Foreground Service
- **Priority:** PRIORITY_HIGH_ACCURACY
- **Update Interval:** 60 seconds
- **Restart Policy:** START_STICKY (auto-restart)

### Security
- ✅ HTTPS-only communication
- ✅ OAuth 2.0 authentication
- ✅ Secure token storage (SharedPreferences)
- ✅ Server-side user verification
- ✅ No sensitive data logged

### Server Endpoints Used
- `POST /api/verify-google-user` - Login verification
- `POST /api/location-update-app` - Location updates

## Privacy & Data

### Data Collected
- Location coordinates (latitude/longitude)
- Location accuracy
- Device name (user-provided)
- Device fingerprint (Android ID)
- Battery level
- Charging status
- Timestamp

### Data Usage
- Location displayed on website for authorized user only
- No third-party sharing
- Data stored in MongoDB (encrypted in transit)
- User can delete account anytime

### Data Retention
- Location data persists until user deletes device or account
- Account deletion removes all associated data

## FAQ

**Q: Can I track multiple devices?**  
A: Yes! Install the app on each device and register them with different names.

**Q: Will this drain my battery?**  
A: Minimal impact. The app updates every 60 seconds instead of continuous tracking.

**Q: Do I need the app open all the time?**  
A: No! That's the point. It tracks 24/7 in the background.

**Q: Can I use different Google accounts for app and website?**  
A: No. You must use the same Google account for both.

**Q: What happens if I uninstall the app?**  
A: Tracking stops. Device remains registered on website but shows as offline.

**Q: Can others see my location?**  
A: Only you can see your devices. Each user sees only their own devices.

**Q: Does this work without internet?**  
A: Location is tracked but won't sync to server until internet is restored.

## Support

### Issues
Report bugs on GitHub: [Issues Page](https://github.com/althafalimohommad/realtime-device-tracker/issues)

### Website
[https://realtime-device-tracker-s9ua.onrender.com](https://realtime-device-tracker-s9ua.onrender.com)

## Version History

### v1.1.0 (Current)
- ✅ Added Google OAuth authentication
- ✅ Added login screen
- ✅ Display user account details
- ✅ Show device registration information
- ✅ Logout functionality
- ✅ Server-side user verification

### v1.0.0
- ✅ Initial release
- ✅ Background location tracking
- ✅ Foreground service implementation
- ✅ Device registration

## License
This project is part of the Realtime Device Tracker system.

---

**Need help?** Contact support or check the main [README.md](../README.md) for more information.
