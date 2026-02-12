package com.devicetracker;

import android.app.Application;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * Application class for Device Tracker.
 * Initializes background workers and performs startup tasks.
 */
public class DeviceTrackerApp extends Application {

    private static final String TAG = "DeviceTrackerApp";

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "DeviceTrackerApp initialized");
        
        // Check if user is logged in
        SharedPreferences prefs = getSharedPreferences("DeviceTracker", MODE_PRIVATE);
        String jwt = prefs.getString("jwt", null);
        String userId = prefs.getString("userId", null);
        
        if (jwt != null && userId != null) {
            Log.d(TAG, "User is logged in, scheduling token refresh worker");
            
            // Schedule the periodic token refresh worker
            TokenRefreshWorker.schedule(this);
            
            // Also run an immediate check to handle any missed refreshes
            // (e.g., if app was closed for several days)
            TokenRefreshWorker.scheduleImmediateCheck(this);
            
            // Log token status for debugging
            long tokenExpiry = prefs.getLong("tokenExpiry", 0);
            if (tokenExpiry > 0) {
                long hoursRemaining = (tokenExpiry - System.currentTimeMillis()) / (60 * 60 * 1000);
                Log.d(TAG, "Token expires in " + hoursRemaining + " hours");
            }
        } else {
            Log.d(TAG, "No user logged in");
        }
    }
}
