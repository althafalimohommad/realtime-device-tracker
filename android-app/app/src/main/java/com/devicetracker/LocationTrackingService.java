package com.devicetracker;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.util.concurrent.TimeUnit;

public class LocationTrackingService extends Service {

    private static final String TAG = "LocationService";
    private static final String CHANNEL_ID = "LocationTrackingChannel";
    private static final int NOTIFICATION_ID = 1;
    private static final long UPDATE_INTERVAL = 30 * 1000; // 30 seconds
    
    // Broadcast action for session expiry - activities can listen for this
    public static final String ACTION_SESSION_EXPIRED = "com.devicetracker.SESSION_EXPIRED";

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private ApiClient apiClient;
    private SharedPreferences prefs;
    private Handler handler;

    private String jwt;
    private String userId;
    private String deviceName;
    
    // Flag to prevent restart after session expiry
    private boolean sessionExpired = false;

    // ===============================
    // SERVICE LIFECYCLE
    // ===============================

    @Override
    public void onCreate() {
        super.onCreate();

        prefs = getSharedPreferences("DeviceTracker", MODE_PRIVATE);
        handler = new Handler(Looper.getMainLooper());

        // 🔐 Load AUTH from persistent storage
        jwt = prefs.getString("jwt", null);
        userId = prefs.getString("userId", null);
        deviceName = prefs.getString("deviceName", "Unknown Device");

        if (jwt == null || userId == null) {
            Log.e(TAG, "JWT or userId missing. Stopping service.");
            stopSelf();
            return;
        }

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        apiClient = new ApiClient(this);

        createNotificationChannel();
        startForeground(
                NOTIFICATION_ID,
                buildNotification("Tracking location in background")
        );

        startLocationUpdates();
        scheduleWatchdog();
        scheduleTokenRefreshCheck();
        
        // Ensure WorkManager-based token refresh is also scheduled
        TokenRefreshWorker.schedule(this);
        
        Log.d(TAG, "LocationTrackingService started successfully");
        Log.d(TAG, "Token status: " + apiClient.getTokenStatusInfo());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // ⚠️ DO NOT rely on intent for auth
        if (intent != null) {
            String newDeviceName = intent.getStringExtra("deviceName");
            if (newDeviceName != null) {
                deviceName = newDeviceName;
                prefs.edit().putString("deviceName", deviceName).apply();
            }
        }
        return START_STICKY;
    }

    private void scheduleWatchdog() {
        PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(
            LocationWatchdogWorker.class,
            15, TimeUnit.MINUTES
        ).build();

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "location_watchdog",
            ExistingPeriodicWorkPolicy.UPDATE,
            work
        );
    }
    
    /**
     * Schedule periodic token refresh checks (every 4 hours while service is running)
     * This is a backup to the WorkManager-based TokenRefreshWorker
     */
    private void scheduleTokenRefreshCheck() {
        final long CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
        
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (sessionExpired) return;
                
                Log.d(TAG, "Periodic token check - " + apiClient.getTokenStatusInfo());
                checkAndRefreshToken();
                handler.postDelayed(this, CHECK_INTERVAL);
            }
        }, CHECK_INTERVAL);
        
        // Also check immediately on startup
        handler.postDelayed(this::checkAndRefreshToken, 5000);
    }
    
    /**
     * Check if token needs refresh and refresh it proactively
     */
    private void checkAndRefreshToken() {
        if (apiClient == null || sessionExpired) return;
        
        // Log current token status
        Log.d(TAG, "Token check: " + apiClient.getTokenStatusInfo());
        
        // Check if token is about to expire (less than 2 days remaining)
        if (apiClient.shouldRefreshToken()) {
            Log.d(TAG, "Token expiring soon, refreshing...");
            updateNotification("Refreshing authentication...");
            
            apiClient.refreshToken(new ApiClient.TokenRefreshCallback() {
                @Override
                public void onRefreshed(String newToken) {
                    Log.d(TAG, "✅ Token refreshed successfully in background");
                    jwt = newToken;
                    updateNotification("Tracking active ✓");
                }
                
                @Override
                public void onFailed(String error) {
                    Log.e(TAG, "Token refresh failed: " + error);
                    if (error.contains("expired") || error.contains("re-login")) {
                        handleSessionExpiry();
                    } else {
                        // Network error - will retry on next check
                        updateNotification("Auth refresh pending...");
                    }
                }
            });
        } else if (apiClient.isTokenExpired()) {
            Log.w(TAG, "Token already expired");
            handleSessionExpiry();
        }
    }

    // ===============================
    // LOCATION HANDLING
    // ===============================

    private void startLocationUpdates() {

        LocationRequest request = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                UPDATE_INTERVAL
        )
                .setMinUpdateIntervalMillis(UPDATE_INTERVAL)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null) return;

                for (Location location : result.getLocations()) {
                    if (location != null) {
                        handleLocation(location);
                    }
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(
                    request,
                    locationCallback,
                    Looper.getMainLooper()
            );
            Log.d(TAG, "Location updates started");
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission missing", e);
            stopSelf();
        }
    }

    private void handleLocation(Location location) {

        double lat = location.getLatitude();
        double lng = location.getLongitude();
        float accuracy = location.getAccuracy();

        Log.d(TAG, "Location: " + lat + ", " + lng);

        updateNotification("Lat: " + lat + ", Lng: " + lng);

        apiClient.sendLocationUpdate(lat, lng, accuracy, new ApiClient.ApiCallback() {
            @Override
            public void onSuccess(String response) {
                Log.d(TAG, "Location sent successfully");
                updateNotification("Last update sent ✓");
            }

            @Override
            public void onError(String error) {
                Log.e(TAG, "Send failed: " + error);

                if (error != null && error.toLowerCase().contains("unauthorized")) {
                    updateNotification("Session expired. Please login again.");
                    handler.postDelayed(() -> stopSelf(), 5000);
                    return;
                }

                // retry after 30 seconds
                handler.postDelayed(() ->
                        apiClient.sendLocationUpdate(lat, lng, accuracy, this),
                        30_000
                );
            }
        });
    }

    // ===============================
    // NOTIFICATION
    // ===============================

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Device Tracker",
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Location tracking in background");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Device Tracker Active")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setAutoCancel(false)
                .setShowWhen(true)
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID, buildNotification(text));
    }
    
    /**
     * Handle session expiry: clear auth data, notify user, broadcast event, and stop service
     */
    private void handleSessionExpiry() {
        Log.w(TAG, "Session expired - clearing auth and stopping service");
        
        // Set flag to prevent restart in onDestroy/onTaskRemoved
        sessionExpired = true;
        
        // Stop location updates immediately to prevent further API calls
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
            locationCallback = null;
        }
        
        // Clear all auth data
        prefs.edit()
                .remove("jwt")
                .remove("userId")
                .remove("userName")
                .remove("userEmail")
                .putBoolean("isRegistered", false)
                .apply();
        
        // Update notification to inform user
        updateNotification("Session expired. Tap to login again.");
        
        // Broadcast session expiry event - MainActivity will handle redirect
        Intent broadcastIntent = new Intent(ACTION_SESSION_EXPIRED);
        broadcastIntent.setPackage(getPackageName());
        sendBroadcast(broadcastIntent);
        
        // Stop the service after a short delay to allow notification to show
        handler.postDelayed(() -> stopSelf(), 3000);
    }

    // ===============================
    // TASK REMOVAL HANDLING
    // ===============================

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Log.d(TAG, "App removed from recents. Scheduling restart");

        // Schedule a one-shot restart in a few seconds to survive clear-all
        Intent restartIntent = new Intent(getApplicationContext(), LocationTrackingService.class);
        restartIntent.setPackage(getPackageName());

        PendingIntent pi = PendingIntent.getService(
                this,
                101,
                restartIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        AlarmManager alarmManager = (AlarmManager) getSystemService(ALARM_SERVICE);
        long triggerAt = System.currentTimeMillis() + 5_000; // 5 seconds

        if (alarmManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        }
    }

    // ===============================
    // CLEANUP
    // ===============================

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        Log.d(TAG, "LocationTrackingService stopped");

        // Schedule restart to recover from kills
        Intent restartIntent = new Intent(getApplicationContext(), LocationTrackingService.class);
        restartIntent.setPackage(getPackageName());

        PendingIntent pi = PendingIntent.getService(
                this,
                102,
                restartIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        AlarmManager alarmManager = (AlarmManager) getSystemService(ALARM_SERVICE);
        long triggerAt = System.currentTimeMillis() + 5_000; // 5 seconds

        if (alarmManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
