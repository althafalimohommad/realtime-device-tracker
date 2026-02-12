package com.devicetracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {
            Log.d(TAG, "Boot completed, checking user login status");
            
            // Check if user is logged in
            SharedPreferences prefs = context.getSharedPreferences("DeviceTracker", Context.MODE_PRIVATE);
            String jwt = prefs.getString("jwt", null);
            String userId = prefs.getString("userId", null);
            
            if (jwt == null || userId == null) {
                Log.d(TAG, "User not logged in, skipping service start");
                return;
            }
            
            // Schedule token refresh worker to check and refresh token if needed
            Log.d(TAG, "Scheduling token refresh check after boot");
            TokenRefreshWorker.schedule(context);
            TokenRefreshWorker.scheduleImmediateCheck(context);
            
            // Start location tracking service
            Log.d(TAG, "Starting LocationTrackingService");
            Intent svc = new Intent(context, LocationTrackingService.class);
            svc.setPackage(context.getPackageName());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        }
    }
}
