package com.devicetracker;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Background worker that refreshes JWT tokens before they expire.
 * 
 * Token Strategy:
 * - Token valid for 7 days from login/refresh
 * - Refresh happens when less than 2 days remain (starting on day 5)
 * - Worker runs every 6 hours to ensure timely refresh even with battery optimization
 * - Also proactively refreshes after 4 days since last refresh
 * - User stays logged in seamlessly without interruption
 * 
 * Android Battery Optimization Note:
 * - Some OEMs may delay WorkManager; we use multiple triggers
 * - App open, boot completed, and service restart all trigger checks
 */
public class TokenRefreshWorker extends Worker {

    private static final String TAG = "TokenRefreshWorker";
    private static final String WORK_NAME = "token_refresh_work";
    
    // Run every 6 hours for more aggressive refresh attempts
    private static final long WORK_INTERVAL_HOURS = 6;
    
    // Refresh when less than 2 days (48 hours) remains - gives bigger window
    private static final long REFRESH_THRESHOLD_MS = 48 * 60 * 60 * 1000L;

    public TokenRefreshWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Log.d(TAG, "TokenRefreshWorker started");
        
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences("DeviceTracker", Context.MODE_PRIVATE);
        
        // Check if user is logged in
        String jwt = prefs.getString("jwt", null);
        String userId = prefs.getString("userId", null);
        
        if (jwt == null || userId == null) {
            Log.d(TAG, "No user logged in, skipping token refresh");
            return Result.success();
        }
        
        // Get stored timestamps
        long tokenExpiry = prefs.getLong("tokenExpiry", 0);
        long loginTimestamp = prefs.getLong("loginTimestamp", 0);
        long lastRefreshTime = prefs.getLong("lastTokenRefresh", 0);
        long now = System.currentTimeMillis();
        
        // If no expiry stored, calculate from login timestamp (legacy support)
        if (tokenExpiry == 0 && loginTimestamp > 0) {
            tokenExpiry = loginTimestamp + (7L * 24 * 60 * 60 * 1000);
            prefs.edit().putLong("tokenExpiry", tokenExpiry).apply();
            Log.d(TAG, "Calculated tokenExpiry from loginTimestamp");
        }
        
        // If still no valid expiry, assume token is valid and set expiry for 7 days from now
        if (tokenExpiry == 0) {
            tokenExpiry = now + (7L * 24 * 60 * 60 * 1000);
            prefs.edit()
                    .putLong("tokenExpiry", tokenExpiry)
                    .putLong("loginTimestamp", now)
                    .apply();
            Log.d(TAG, "No token expiry found, setting default");
        }
        
        long timeUntilExpiry = tokenExpiry - now;
        long hoursRemaining = timeUntilExpiry / (60 * 60 * 1000);
        
        Log.d(TAG, "Token status: " + hoursRemaining + " hours remaining");
        Log.d(TAG, "Token expires at: " + new java.util.Date(tokenExpiry));
        
        // Check if token is already expired
        if (timeUntilExpiry <= 0) {
            Log.w(TAG, "Token already expired, user needs to re-login");
            // Show expired notification
            TokenExpiryNotification.checkAndShowNotification(context);
            // Don't clear auth here - let the API call fail and handle it properly
            return Result.success();
        }
        
        // Check if token needs refresh (less than 2 days remaining)
        if (timeUntilExpiry < REFRESH_THRESHOLD_MS) {
            Log.d(TAG, "Token expiring in " + hoursRemaining + " hours, refreshing now...");
            
            // If less than 24 hours remaining, also show a notification warning
            // This ensures user sees the warning even if refresh fails
            if (hoursRemaining <= 24) {
                TokenExpiryNotification.checkAndShowNotification(context);
            }
            
            return performTokenRefresh(context, prefs);
        }
        
        // Also check if we haven't refreshed in more than 4 days (proactive refresh)
        long timeSinceLastRefresh = now - lastRefreshTime;
        long daysSinceRefresh = timeSinceLastRefresh / (24 * 60 * 60 * 1000);
        
        if (lastRefreshTime > 0 && daysSinceRefresh >= 4) {
            Log.d(TAG, "Proactive refresh: " + daysSinceRefresh + " days since last refresh");
            return performTokenRefresh(context, prefs);
        }
        
        Log.d(TAG, "Token still valid, no refresh needed");
        return Result.success();
    }
    
    /**
     * Perform the actual token refresh call
     */
    private Result performTokenRefresh(Context context, SharedPreferences prefs) {
        ApiClient apiClient = new ApiClient(context);
        
        // Use CountDownLatch to wait for async callback
        CountDownLatch latch = new CountDownLatch(1);
        AtomicBoolean success = new AtomicBoolean(false);
        
        apiClient.refreshToken(new ApiClient.TokenRefreshCallback() {
            @Override
            public void onRefreshed(String newToken) {
                Log.d(TAG, "✅ Token refreshed successfully in background worker");
                
                // Update refresh timestamp
                long now = System.currentTimeMillis();
                prefs.edit()
                        .putLong("lastTokenRefresh", now)
                        .apply();
                
                // Clear any expiry notification since we just refreshed
                TokenExpiryNotification.clearNotification(context);
                
                success.set(true);
                latch.countDown();
            }
            
            @Override
            public void onFailed(String error) {
                Log.e(TAG, "Token refresh failed: " + error);
                
                if (error.contains("expired") || error.contains("re-login") || 
                    error.contains("Invalid") || error.contains("401")) {
                    // Token is invalid, but don't force logout from worker
                    // Let the next API call handle the logout flow properly
                    Log.w(TAG, "Token appears to be expired/invalid");
                }
                
                success.set(false);
                latch.countDown();
            }
        });
        
        try {
            // Wait up to 30 seconds for refresh to complete
            boolean completed = latch.await(30, TimeUnit.SECONDS);
            
            if (!completed) {
                Log.w(TAG, "Token refresh timed out");
                return Result.retry();
            }
            
            if (success.get()) {
                return Result.success();
            } else {
                // Retry later - WorkManager will handle backoff
                return Result.retry();
            }
        } catch (InterruptedException e) {
            Log.e(TAG, "Token refresh interrupted", e);
            Thread.currentThread().interrupt();
            return Result.retry();
        }
    }
    
    /**
     * Schedule the periodic token refresh worker.
     * Should be called on app startup and after login.
     */
    public static void schedule(Context context) {
        Log.d(TAG, "Scheduling TokenRefreshWorker");
        
        // Minimal constraints to maximize execution chances
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresBatteryNotLow(false) // Run even on low battery
                .setRequiresCharging(false)
                .build();
        
        // Run every 6 hours for more frequent checks
        PeriodicWorkRequest workRequest = new PeriodicWorkRequest.Builder(
                TokenRefreshWorker.class,
                WORK_INTERVAL_HOURS, TimeUnit.HOURS
        )
                .setConstraints(constraints)
                .setInitialDelay(30, TimeUnit.MINUTES) // Start sooner
                .build();
        
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                workRequest
        );
        
        Log.d(TAG, "TokenRefreshWorker scheduled (every " + WORK_INTERVAL_HOURS + " hours)");
    }
    
    /**
     * Schedule an immediate token refresh check.
     * Useful after login or when app comes to foreground.
     */
    public static void scheduleImmediateCheck(Context context) {
        Log.d(TAG, "Scheduling immediate token check");
        
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        
        androidx.work.OneTimeWorkRequest workRequest = 
                new androidx.work.OneTimeWorkRequest.Builder(TokenRefreshWorker.class)
                        .setConstraints(constraints)
                        .setInitialDelay(5, TimeUnit.SECONDS)
                        .build();
        
        WorkManager.getInstance(context).enqueue(workRequest);
    }
    
    /**
     * Cancel all scheduled token refresh work.
     * Call this when user logs out.
     */
    public static void cancel(Context context) {
        Log.d(TAG, "Cancelling TokenRefreshWorker");
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }
}
