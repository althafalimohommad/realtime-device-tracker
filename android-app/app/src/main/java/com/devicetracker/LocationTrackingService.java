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
    private static final long UPDATE_INTERVAL = 3 * 60 * 1000; // 3 minutes

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private ApiClient apiClient;
    private SharedPreferences prefs;
    private Handler handler;

    private String jwt;
    private String userId;
    private String deviceName;

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
        Log.d(TAG, "LocationTrackingService started successfully");
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
                    NotificationManager.IMPORTANCE_LOW
            );
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
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID, buildNotification(text));
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
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
