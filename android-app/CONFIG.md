# Android App Configuration

## Update these values in ApiClient.java before building

### Server URL
Change this line in `ApiClient.java`:
```java
private static final String BASE_URL = "https://realtime-device-tracker-s9ua.onrender.com";
```

### Getting User ID
The app needs the user's Google ID to authenticate. Users can get it from:
1. Go to website: https://realtime-device-tracker-s9ua.onrender.com/tracker
2. Open browser console (F12)
3. Type: `localStorage.getItem('userId')` or check `/api/user` response
4. Save this ID in the app's SharedPreferences after first login

## Planned Feature: QR Code Login
Instead of manual user ID, we'll add:
1. Website generates QR code with userId
2. App scans QR code
3. Auto-saves userId for tracking

This will be added in the next update.
