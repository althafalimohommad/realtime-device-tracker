# Device Tracker Android App

## Overview
Native Android app that tracks device location 24/7 and sends updates to your server.

## Features
- ✅ Background location tracking (even when app is closed)
- ✅ Works with screen locked
- ✅ Updates every 1 minute
- ✅ Foreground service (won't be killed by Android)
- ✅ Simple registration interface
- ✅ No map view (users view locations on website)

## Setup Instructions

### 1. Install Android Studio
Download from: https://developer.android.com/studio

### 2. Open Project
1. Open Android Studio
2. Click "Open an Existing Project"
3. Navigate to the `android-app` folder
4. Click "OK"

### 3. Build the App
1. Wait for Gradle sync to complete
2. Click **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
3. APK will be in: `app/build/outputs/apk/debug/app-debug.apk`

### 4. Install on Phone
**Option A: USB Cable**
1. Enable Developer Mode on Android:
   - Settings → About Phone → Tap "Build Number" 7 times
   - Settings → Developer Options → Enable "USB Debugging"
2. Connect phone to PC
3. In Android Studio, click the green "Run" button
4. Select your device

**Option B: APK File**
1. Copy `app-debug.apk` to your phone
2. Open file and install (allow "Install from Unknown Sources")

## How It Works

### Registration
1. Open app
2. Enter device name
3. Grant location permissions:
   - Allow Fine Location
   - Allow Background Location ("Allow all the time")
4. Click "Register Device"

### Background Tracking
- App runs as foreground service (notification visible)
- Sends location every 1 minute to server
- Works even when:
  - App is closed
  - Screen is locked
  - Phone restarts (auto-restarts service)

### Viewing Locations
- Users view all device locations on your website
- Website URL: https://realtime-device-tracker-s9ua.onrender.com/tracker

## API Integration
App sends location to: `POST /api/location-update-app`

Payload:
```json
{
  "latitude": 17.63564,
  "longitude": 78.48055,
  "accuracy": 15.5,
  "deviceName": "My Phone",
  "battery": 75,
  "charging": false,
  "timestamp": 1704380000000
}
```

## Backend Changes Needed
Add this endpoint to your `app.js`:

```javascript
app.post('/api/location-update-app', async function(req, res) {
    try {
        const { latitude, longitude, accuracy, deviceName, battery, charging } = req.body;
        const userAgent = req.headers['user-agent'];
        const userId = req.headers.authorization?.replace('Bearer ', '');
        
        // Update device location in database
        await updateDeviceLocation(userId, userAgent, {
            latitude,
            longitude,
            accuracy,
            battery,
            charging
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});
```

## Troubleshooting

### Location not updating?
- Check notification is showing
- Check location permissions are "Allow all the time"
- Check internet connection
- Check server logs

### App killed by system?
- Some manufacturers (Xiaomi, Huawei, Samsung) aggressively kill apps
- Disable battery optimization:
  - Settings → Battery → App Battery Usage → Device Tracker → "No restrictions"

### Permission denied?
- Uninstall and reinstall app
- Make sure to select "Allow all the time" for background location

## Next Steps
1. Build APK
2. Test on your device
3. Add backend endpoint
4. Deploy to Play Store (optional)
