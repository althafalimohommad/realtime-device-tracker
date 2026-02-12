package com.devicetracker;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Helper class to show token expiry notifications to users.
 * Warns users when their session is about to expire so they can refresh it.
 */
public class TokenExpiryNotification {

    private static final String TAG = "TokenExpiryNotification";
    private static final String CHANNEL_ID = "token_expiry_channel";
    private static final int NOTIFICATION_ID = 2001;
    
    // Show notification when less than 24 hours remain
    private static final long NOTIFICATION_THRESHOLD_MS = 24 * 60 * 60 * 1000L;
    
    // Don't show notification more than once per 12 hours
    private static final long NOTIFICATION_COOLDOWN_MS = 12 * 60 * 60 * 1000L;

    /**
     * Create the notification channel (required for Android 8.0+)
     */
    public static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Session Expiry Alerts",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Alerts you when your login session is about to expire");
            channel.enableVibration(true);
            channel.setShowBadge(true);
            
            NotificationManager notificationManager = 
                    context.getSystemService(NotificationManager.class);
            notificationManager.createNotificationChannel(channel);
        }
    }

    /**
     * Check if we should show expiry notification and show it if needed
     */
    public static void checkAndShowNotification(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("DeviceTracker", Context.MODE_PRIVATE);
        
        // Check if user is logged in
        String jwt = prefs.getString("jwt", null);
        if (jwt == null) {
            Log.d(TAG, "No user logged in, skipping notification");
            return;
        }
        
        // Get token expiry
        long tokenExpiry = prefs.getLong("tokenExpiry", 0);
        if (tokenExpiry == 0) {
            Log.d(TAG, "No token expiry set, skipping notification");
            return;
        }
        
        long now = System.currentTimeMillis();
        long timeUntilExpiry = tokenExpiry - now;
        long hoursRemaining = timeUntilExpiry / (60 * 60 * 1000);
        
        // Check if we're in the warning window (less than 24 hours remaining)
        if (timeUntilExpiry <= 0) {
            // Token already expired
            showExpiredNotification(context);
            return;
        }
        
        if (timeUntilExpiry > NOTIFICATION_THRESHOLD_MS) {
            // More than 24 hours remaining, no notification needed
            Log.d(TAG, "Token has " + hoursRemaining + " hours remaining, no notification needed");
            return;
        }
        
        // Check cooldown - don't spam notifications
        long lastNotificationTime = prefs.getLong("lastExpiryNotification", 0);
        if (now - lastNotificationTime < NOTIFICATION_COOLDOWN_MS) {
            Log.d(TAG, "Notification cooldown active, skipping");
            return;
        }
        
        // Show the warning notification
        showExpiryWarningNotification(context, hoursRemaining);
        
        // Save notification time
        prefs.edit().putLong("lastExpiryNotification", now).apply();
    }

    /**
     * Show notification warning that token expires soon
     */
    private static void showExpiryWarningNotification(Context context, long hoursRemaining) {
        Log.d(TAG, "Showing expiry warning notification: " + hoursRemaining + " hours remaining");
        
        createNotificationChannel(context);
        
        // Intent to open MainActivity when notification is tapped
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("showProfile", true);
        
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 0, intent, 
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        String timeText;
        if (hoursRemaining <= 1) {
            timeText = "less than 1 hour";
        } else if (hoursRemaining < 24) {
            timeText = hoursRemaining + " hours";
        } else {
            timeText = "tomorrow";
        }
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("🔐 Session Expires " + (hoursRemaining <= 24 ? "Soon" : "Tomorrow"))
                .setContentText("Your session expires in " + timeText + ". Tap to refresh.")
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText("For your security and to protect your device tracking, " +
                                "your session expires in " + timeText + ".\n\n" +
                                "To continue tracking your device, please open the app " +
                                "and tap your profile icon → 'Refresh Token'."))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setVibrate(new long[]{0, 250, 250, 250});
        
        try {
            NotificationManagerCompat notificationManager = NotificationManagerCompat.from(context);
            notificationManager.notify(NOTIFICATION_ID, builder.build());
            Log.d(TAG, "Expiry warning notification shown");
        } catch (SecurityException e) {
            Log.e(TAG, "No notification permission", e);
        }
    }

    /**
     * Show notification that token has expired
     */
    private static void showExpiredNotification(Context context) {
        Log.d(TAG, "Showing expired notification");
        
        createNotificationChannel(context);
        
        Intent intent = new Intent(context, LoginActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 0, intent, 
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("❌ Session Expired")
                .setContentText("Please login again to continue tracking your device.")
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText("Your session has expired. Device tracking has stopped.\n\n" +
                                "Please login again to continue protecting your device."))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true);
        
        try {
            NotificationManagerCompat notificationManager = NotificationManagerCompat.from(context);
            notificationManager.notify(NOTIFICATION_ID, builder.build());
            Log.d(TAG, "Expired notification shown");
        } catch (SecurityException e) {
            Log.e(TAG, "No notification permission", e);
        }
    }

    /**
     * Clear any expiry notifications (call after successful refresh)
     */
    public static void clearNotification(Context context) {
        NotificationManagerCompat notificationManager = NotificationManagerCompat.from(context);
        notificationManager.cancel(NOTIFICATION_ID);
        
        // Also reset the cooldown
        SharedPreferences prefs = context.getSharedPreferences("DeviceTracker", Context.MODE_PRIVATE);
        prefs.edit().remove("lastExpiryNotification").apply();
    }
}
