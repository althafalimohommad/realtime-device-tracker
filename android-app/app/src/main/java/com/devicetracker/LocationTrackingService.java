package com.devicetracker;

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

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

public class LocationTrackingService extends Service {
    
    private static final String TAG = "LocationService";
    private static final String CHANNEL_ID = "LocationTrackingChannel";
    private static final int NOTIFICATION_ID = 1;
    private static final long UPDATE_INTERVAL = 60000; // 1 minute
    
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private ApiClient apiClient;
    private SharedPreferences prefs;
    private Handler handler;
    private String deviceName;
    
    @Override
    public void onCreate() {
        super.onCreate();
        
        prefs = getSharedPreferences("DeviceTracker", MODE_PRIVATE);
        deviceName = prefs.getString("deviceName", "Unknown Device");
        
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        apiClient = new ApiClient(this);
        handler = new Handler(Looper.getMainLooper());
        
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, getNotification("Starting location tracking..."));
        
        // Don't start location updates here - wait for onStartCommand to save userId first
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String name = intent.getStringExtra("deviceName");
            String userId = intent.getStringExtra("userId");
            String fingerprint = intent.getStringExtra("fingerprint");
            
            // Check for backend JWT token (preferred) or Google ID token (fallback)
            String authToken = prefs.getString("authToken", "");
            long tokenExpiry = prefs.getLong("tokenExpiry", 0);
            String idToken = prefs.getString("idToken", "");
            
            Log.d(TAG, "onStartCommand - deviceName: " + name + ", userId: " + userId);
            
            // Check if we have any valid authentication
            boolean hasValidAuth = (!authToken.isEmpty() && tokenExpiry > System.currentTimeMillis()) || !idToken.isEmpty();
            
            if (!hasValidAuth) {
                Log.e(TAG, "No valid authentication token; stopping service to avoid unauthenticated updates");
                stopSelf();
                return START_NOT_STICKY;
            }
            
            if (name != null) {
                deviceName = name;
                // Save to SharedPreferences so ApiClient can access userId
                SharedPreferences.Editor editor = prefs.edit();
                editor.putString("deviceName", deviceName);
                if (userId != null) {
                    editor.putString("userId", userId);
                }
                if (fingerprint != null) {
                    editor.putString("deviceFingerprint", fingerprint);
                }
                editor.commit(); // Use commit() to ensure it's saved immediately
                
                Log.d(TAG, "Saved to SharedPreferences - userId: " + prefs.getString("userId", "NOT_FOUND"));
                
                // Now start location updates after userId is saved
                startLocationUpdates();
            }
        }
        
        return START_STICKY; // Service will restart if killed
    }
    
    private void startLocationUpdates() {
        LocationRequest locationRequest = new LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY, UPDATE_INTERVAL)
            .setMinUpdateIntervalMillis(UPDATE_INTERVAL)
            .setMaxUpdateDelayMillis(UPDATE_INTERVAL * 2)
            .build();
        
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) {
                    return;
                }
                
                for (Location location : locationResult.getLocations()) {
                    if (location != null) {
                        handleLocationUpdate(location);
                    }
                }
            }
        };
        
        try {
            fusedLocationClient.requestLocationUpdates(locationRequest,
                locationCallback, Looper.getMainLooper());
            
            Log.d(TAG, "Location updates started");
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission denied", e);
            stopSelf();
        }
    }
    
    private void handleLocationUpdate(Location location) {
        double latitude = location.getLatitude();
        double longitude = location.getLongitude();
        float accuracy = location.getAccuracy();
        
        Log.d(TAG, String.format("Location update: %.6f, %.6f (accuracy: %.1fm)", 
            latitude, longitude, accuracy));
        
        // Update notification
        updateNotification(String.format("Tracking: %.6f, %.6f", latitude, longitude));
        
        // Send to server
        apiClient.sendLocationUpdate(latitude, longitude, accuracy, new ApiClient.ApiCallback() {
            @Override
            public void onSuccess(String response) {
                Log.d(TAG, "Location sent to server successfully");
                updateNotification(String.format("Last update: %.6f, %.6f ✓", latitude, longitude));
            }
            
            @Override
            public void onError(String error) {
                if (error != null && (error.contains("not logged in") || error.contains("Authentication expired"))) {
                    Log.e(TAG, "Authentication failed; stopping service - user needs to re-login");
                    updateNotification("Authentication expired - please re-login");
                    // Don't stop immediately, give user a chance to see the notification
                    handler.postDelayed(() -> stopSelf(), 5000);
                    return;
                }
                Log.e(TAG, "Failed to send location: " + error);
                updateNotification("Location update failed - retrying...");
                // Retry after 30 seconds
                handler.postDelayed(() -> {
                    apiClient.sendLocationUpdate(latitude, longitude, accuracy, this);
                }, 30000);
            }
        });
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Location Tracking",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Continuous location tracking for device finder");
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }
    
    private Notification getNotification(String content) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0,
            notificationIntent, PendingIntent.FLAG_IMMUTABLE);
        
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Device Tracker Active")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build();
    }
    
    private void updateNotification(String content) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID, getNotification(content));
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        
        Log.d(TAG, "Location tracking service stopped");
    }
    
    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
