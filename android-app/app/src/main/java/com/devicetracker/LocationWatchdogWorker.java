package com.devicetracker;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class LocationWatchdogWorker extends Worker {

    private static final String TAG = "LocationWatchdog";

    public LocationWatchdogWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            Context ctx = getApplicationContext();
            SharedPreferences prefs = ctx.getSharedPreferences("DeviceTracker", Context.MODE_PRIVATE);
            
            // Check if user is still logged in
            String jwt = prefs.getString("jwt", null);
            String userId = prefs.getString("userId", null);
            
            if (jwt == null || userId == null) {
                Log.d(TAG, "User not logged in, skipping service restart");
                return Result.success();
            }
            
            // Also trigger a token refresh check via WorkManager
            TokenRefreshWorker.scheduleImmediateCheck(ctx);
            
            Intent intent = new Intent(ctx, LocationTrackingService.class);
            intent.setPackage(ctx.getPackageName());

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
            Log.d(TAG, "Ensured LocationTrackingService is running");
            return Result.success();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start service", e);
            return Result.retry();
        }
    }
}
