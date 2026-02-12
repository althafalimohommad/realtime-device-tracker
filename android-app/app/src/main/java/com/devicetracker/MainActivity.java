package com.devicetracker;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {
    
    private static final String TAG = "MainActivity";
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final String PREFS_NAME = "DeviceTracker";
    
    private TextView tvDeviceName, tvDeviceStatus, statusText, btnProfile;
    private EditText deviceNameInput;
    private Button registerButton, btnLogout;
    private View deviceCard, emptyState;
    private SharedPreferences prefs;
    private String userId;
    private String userName;
    private String userEmail;
    private String pendingDeviceName;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Get user info from SharedPreferences
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        userId = prefs.getString("userId", null);
        userName = prefs.getString("userName", null);
        userEmail = prefs.getString("userEmail", null);
        
        if (userId == null) {
            // Not logged in, go back to login
            Intent intent = new Intent(MainActivity.this, LoginActivity.class);
            startActivity(intent);
            finish();
            return;
        }
        
        setContentView(R.layout.activity_main);
        
        deviceCard = findViewById(R.id.deviceCard);
        emptyState = findViewById(R.id.emptyState);
        tvDeviceName = findViewById(R.id.tvDeviceName);
        tvDeviceStatus = findViewById(R.id.tvDeviceStatus);
        deviceNameInput = findViewById(R.id.deviceNameInput);
        registerButton = findViewById(R.id.registerButton);
        statusText = findViewById(R.id.statusText);
        btnLogout = findViewById(R.id.btnLogout);
        btnProfile = findViewById(R.id.btnProfile);
        
        updateUI();
        
        registerButton.setOnClickListener(v -> promptForDeviceName(false));
        btnLogout.setOnClickListener(v -> logout());
        deviceCard.setOnClickListener(v -> showDeviceOptions());
        btnProfile.setOnClickListener(v -> showProfileMenu());
        
        // Schedule background token refresh worker
        TokenRefreshWorker.schedule(this);
        
        // Create notification channel for expiry alerts
        TokenExpiryNotification.createNotificationChannel(this);
        
        // Check if we were opened from a notification to show profile
        if (getIntent().getBooleanExtra("showProfile", false)) {
            // Show profile menu after a short delay to let UI initialize
            new android.os.Handler().postDelayed(this::showProfileMenu, 500);
        }
    }
    
    @Override
    protected void onResume() {
        super.onResume();
        
        // Check and refresh token when app comes to foreground
        // This catches cases where app was in background for a long time
        TokenRefreshWorker.scheduleImmediateCheck(this);
        
        // Log token status for debugging
        ApiClient apiClient = new ApiClient(this);
        Log.d(TAG, "MainActivity resumed - " + apiClient.getTokenStatusInfo());
    }
    
    private void updateUI() {
        boolean isRegistered = prefs.getBoolean("isRegistered", false);
        String deviceName = prefs.getString("deviceName", "");
        String fingerprint = prefs.getString("deviceFingerprint", "");

        // Avatar initial
        String initial = (userName != null && !userName.isEmpty()) ? userName.substring(0, 1).toUpperCase() : "U";
        btnProfile.setText(initial);

        if (isRegistered) {
            deviceCard.setVisibility(View.VISIBLE);
            emptyState.setVisibility(View.GONE);
            registerButton.setVisibility(View.GONE);
            tvDeviceName.setText(deviceName);
            tvDeviceStatus.setText("This device");
            String fpShort = fingerprint != null ? fingerprint.substring(0, Math.min(10, fingerprint.length())) : "";
            statusText.setText("Tracking active · " + fpShort + "…");
        } else {
            deviceCard.setVisibility(View.GONE);
            emptyState.setVisibility(View.VISIBLE);
            registerButton.setVisibility(View.VISIBLE);
            statusText.setText("Not registered. Tap Register device to start tracking.");
        }
    }
    
    private void requestPermissionsAndRegister(String deviceName) {
        if (deviceName == null || deviceName.trim().isEmpty()) {
            Toast.makeText(this, "Please enter a device name", Toast.LENGTH_SHORT).show();
            return;
        }
        pendingDeviceName = deviceName;

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.ACCESS_FINE_LOCATION},
                    PERMISSION_REQUEST_CODE);
        } else {
            requestBackgroundLocationPermission(deviceName);
        }
    }
    
    private void requestBackgroundLocationPermission(String deviceName) {
        // For Android 10+ (API 29+), request background location permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    != PackageManager.PERMISSION_GRANTED) {
                
                new AlertDialog.Builder(this)
                        .setTitle("Background Location Required")
                        .setMessage("To track your device 24/7, we need permission to access location in the background.\n\n" +
                                "Please select 'Allow all the time' on the next screen.")
                        .setPositiveButton("Continue", (dialog, which) -> {
                            ActivityCompat.requestPermissions(MainActivity.this,
                                    new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION},
                                    PERMISSION_REQUEST_CODE + 1);
                        })
                        .setNegativeButton("Cancel", null)
                        .show();
            } else {
                registerDevice(deviceName);
            }
        } else {
            registerDevice(deviceName);
        }
    }
    
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                requestBackgroundLocationPermission(pendingDeviceName);
            } else {
                Toast.makeText(this, "Location permission is required", Toast.LENGTH_LONG).show();
            }
        } else if (requestCode == PERMISSION_REQUEST_CODE + 1) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                registerDevice(pendingDeviceName);
            } else {
                new AlertDialog.Builder(this)
                        .setTitle("Permission Required")
                        .setMessage("Background location permission is required for 24/7 tracking.\n\n" +
                                "Would you like to open app settings?")
                        .setPositiveButton("Open Settings", (dialog, which) -> {
                            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                            intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                            startActivity(intent);
                        })
                        .setNegativeButton("Cancel", null)
                        .show();
            }
        }
    }
    
    private void registerDevice(String deviceName) {
        // Generate device fingerprint
        String fingerprint = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);

        // Save registration
        SharedPreferences.Editor editor = prefs.edit();
        editor.putString("deviceName", deviceName);
        editor.putString("deviceFingerprint", fingerprint);
        editor.putBoolean("isRegistered", true);
        editor.apply();

        // Start/update location tracking service
        startTrackingService(deviceName, fingerprint);

        updateUI();
        Toast.makeText(this, "Device registered! Tracking started.", Toast.LENGTH_LONG).show();

        Log.d(TAG, "Device registered: " + deviceName + " (User: " + userId + ")");
    }

    private void startTrackingService(String deviceName, String fingerprint) {
        Intent serviceIntent = new Intent(this, LocationTrackingService.class);
        serviceIntent.putExtra("userId", userId);
        serviceIntent.putExtra("deviceName", deviceName);
        serviceIntent.putExtra("fingerprint", fingerprint);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }
    
    private void unregisterDevice() {
        new AlertDialog.Builder(this)
                .setTitle("Unregister Device")
                .setMessage("This will stop location tracking. Continue?")
                .setPositiveButton("Yes", (dialog, which) -> {
                    // Stop service
                    Intent serviceIntent = new Intent(MainActivity.this, LocationTrackingService.class);
                    stopService(serviceIntent);
                    
                    // Clear registration
                    SharedPreferences.Editor editor = prefs.edit();
                    editor.putBoolean("isRegistered", false);
                    editor.remove("deviceName");
                    editor.remove("deviceFingerprint");
                    editor.apply();
                    
                    updateUI();
                    Toast.makeText(MainActivity.this, "Device unregistered", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("No", null)
                .show();
    }

    private void showDeviceOptions() {
        boolean isRegistered = prefs.getBoolean("isRegistered", false);
        if (!isRegistered) {
            promptForDeviceName(false);
            return;
        }

        String[] options = {"Edit device name", "Unregister device"};
        new AlertDialog.Builder(this)
                .setTitle("This device")
                .setItems(options, (dialog, which) -> {
                    if (which == 0) {
                        promptForDeviceName(true);
                    } else if (which == 1) {
                        unregisterDevice();
                    }
                })
                .show();
    }

    private void promptForDeviceName(boolean isRename) {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("Device name");
        String current = prefs.getString("deviceName", "");
        if (isRename && current != null) input.setText(current);

        LinearLayout container = new LinearLayout(this);
        container.setPadding(32, 24, 32, 0);
        container.addView(input);

        String title = isRename ? "Edit device name" : "Register device";
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setView(container)
                .setPositiveButton(isRename ? "Save" : "Register", (d, w) -> {
                    String name = input.getText().toString().trim();
                    if (name.isEmpty()) {
                        Toast.makeText(this, "Please enter a device name", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    if (isRename) {
                        renameDevice(name);
                    } else {
                        requestPermissionsAndRegister(name);
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void renameDevice(String newName) {
        String fingerprint = prefs.getString("deviceFingerprint", Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID));
        SharedPreferences.Editor editor = prefs.edit();
        editor.putString("deviceName", newName);
        editor.putBoolean("isRegistered", true);
        editor.apply();

        startTrackingService(newName, fingerprint);
        updateUI();
        Toast.makeText(this, "Device name updated", Toast.LENGTH_SHORT).show();
    }

    private void showProfileMenu() {
        // Get token status for display
        ApiClient apiClient = new ApiClient(this);
        String tokenStatus = apiClient.getTokenStatusInfo();
        long tokenExpiry = prefs.getLong("tokenExpiry", 0);
        String expiryInfo = "";
        
        if (tokenExpiry > 0) {
            long hoursRemaining = (tokenExpiry - System.currentTimeMillis()) / (60 * 60 * 1000);
            long daysRemaining = hoursRemaining / 24;
            if (daysRemaining > 0) {
                expiryInfo = "\n\nSession expires in " + daysRemaining + " days";
            } else if (hoursRemaining > 0) {
                expiryInfo = "\n\n⚠️ Session expires in " + hoursRemaining + " hours!";
            } else {
                expiryInfo = "\n\n❌ Session expired!";
            }
        }
        
        String message = (userEmail != null ? userEmail : "") + expiryInfo;
        
        new AlertDialog.Builder(this)
                .setTitle(userName != null ? userName : "Profile")
                .setMessage(message)
                .setPositiveButton("Refresh Token", (dialog, which) -> refreshTokenManually())
                .setNeutralButton("Logout", (dialog, which) -> logout())
                .setNegativeButton("Close", null)
                .show();
    }
    
    /**
     * Manually refresh the JWT token
     */
    private void refreshTokenManually() {
        Toast.makeText(this, "Refreshing session...", Toast.LENGTH_SHORT).show();
        
        ApiClient apiClient = new ApiClient(this);
        apiClient.refreshToken(new ApiClient.TokenRefreshCallback() {
            @Override
            public void onRefreshed(String newToken) {
                runOnUiThread(() -> {
                    // Clear any expiry notification since we just refreshed
                    TokenExpiryNotification.clearNotification(MainActivity.this);
                    
                    long tokenExpiry = prefs.getLong("tokenExpiry", 0);
                    long daysRemaining = (tokenExpiry - System.currentTimeMillis()) / (24 * 60 * 60 * 1000);
                    
                    Toast.makeText(MainActivity.this, 
                            "✅ Session refreshed! Valid for " + daysRemaining + " days", 
                            Toast.LENGTH_LONG).show();
                });
            }
            
            @Override
            public void onFailed(String error) {
                runOnUiThread(() -> {
                    if (error.contains("expired") || error.contains("re-login")) {
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("Session Expired")
                                .setMessage("Your session has expired. Please login again.")
                                .setPositiveButton("Login", (dialog, which) -> {
                                    // Clear and go to login
                                    prefs.edit().clear().apply();
                                    Intent intent = new Intent(MainActivity.this, LoginActivity.class);
                                    startActivity(intent);
                                    finish();
                                })
                                .setCancelable(false)
                                .show();
                    } else {
                        Toast.makeText(MainActivity.this, 
                                "Refresh failed: " + error, Toast.LENGTH_LONG).show();
                    }
                });
            }
        });
    }
    
    private void logout() {
        new AlertDialog.Builder(this)
                .setTitle("Logout")
                .setMessage("This will unregister your device and sign you out. Continue?")
                .setPositiveButton("Yes", (dialog, which) -> {
                    // Stop service if running
                    Intent serviceIntent = new Intent(MainActivity.this, LocationTrackingService.class);
                    stopService(serviceIntent);
                    
                    // Cancel the token refresh worker
                    TokenRefreshWorker.cancel(MainActivity.this);
                    
                    // Clear any expiry notifications
                    TokenExpiryNotification.clearNotification(MainActivity.this);
                    
                    // Clear all preferences
                    SharedPreferences.Editor editor = prefs.edit();
                    editor.clear();
                    editor.apply();
                    
                    // Go back to login
                    Intent intent = new Intent(MainActivity.this, LoginActivity.class);
                    startActivity(intent);
                    finish();
                })
                .setNegativeButton("No", null)
                .show();
    }
}
