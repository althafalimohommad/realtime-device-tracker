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
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;

public class MainActivity extends AppCompatActivity {
    
    private static final String TAG = "MainActivity";
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final String PREFS_NAME = "DeviceTracker";
    
    private TextView tvWelcome, tvEmail, tvUserInfo, statusText;
    private EditText deviceNameInput;
    private Button registerButton, unregisterButton, btnLogout;
    private SharedPreferences prefs;
    private String userId;
    private String userName;
    private String userEmail;
    private GoogleSignInClient mGoogleSignInClient;
    
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
        
        // Configure Google Sign-In for logout
        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .build();
        mGoogleSignInClient = GoogleSignIn.getClient(this, gso);
        
        tvWelcome = findViewById(R.id.tvWelcome);
        tvEmail = findViewById(R.id.tvEmail);
        tvUserInfo = findViewById(R.id.tvUserInfo);
        deviceNameInput = findViewById(R.id.deviceNameInput);
        registerButton = findViewById(R.id.registerButton);
        unregisterButton = findViewById(R.id.unregisterButton);
        statusText = findViewById(R.id.statusText);
        btnLogout = findViewById(R.id.btnLogout);
        
        // Display user info
        tvWelcome.setText("Welcome, " + userName + "!");
        tvEmail.setText(userEmail);
        tvUserInfo.setText("User ID: " + userId);
        
        updateUI();
        
        registerButton.setOnClickListener(v -> requestPermissionsAndRegister());
        unregisterButton.setOnClickListener(v -> unregisterDevice());
        btnLogout.setOnClickListener(v -> logout());
    }
    
    private void updateUI() {
        boolean isRegistered = prefs.getBoolean("isRegistered", false);
        String deviceName = prefs.getString("deviceName", "");
        String fingerprint = prefs.getString("deviceFingerprint", "");
        
        if (isRegistered) {
            deviceNameInput.setEnabled(false);
            deviceNameInput.setText(deviceName);
            registerButton.setVisibility(View.GONE);
            unregisterButton.setVisibility(View.VISIBLE);
            
            statusText.setText("✅ Device Registered\n" +
                    "Name: " + deviceName + "\n" +
                    "Fingerprint: " + fingerprint.substring(0, Math.min(16, fingerprint.length())) + "...\n" +
                    "Status: Tracking location in background...");
            statusText.setTextColor(getResources().getColor(android.R.color.holo_green_dark));
        } else {
            deviceNameInput.setEnabled(true);
            deviceNameInput.setText("");
            deviceNameInput.setHint("Enter device name (e.g., My Phone)");
            registerButton.setVisibility(View.VISIBLE);
            unregisterButton.setVisibility(View.GONE);
            statusText.setText("⚠️ Device Not Registered\nRegister to start tracking");
            statusText.setTextColor(getResources().getColor(android.R.color.holo_orange_dark));
        }
    }
    
    private void requestPermissionsAndRegister() {
        String deviceName = deviceNameInput.getText().toString().trim();
        
        if (deviceName.isEmpty()) {
            Toast.makeText(this, "Please enter a device name", Toast.LENGTH_SHORT).show();
            return;
        }
        
        // Check if we have fine location permission
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
        
        String deviceName = deviceNameInput.getText().toString().trim();
        
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                requestBackgroundLocationPermission(deviceName);
            } else {
                Toast.makeText(this, "Location permission is required", Toast.LENGTH_LONG).show();
            }
        } else if (requestCode == PERMISSION_REQUEST_CODE + 1) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                registerDevice(deviceName);
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
        
        // Start location tracking service
        Intent serviceIntent = new Intent(this, LocationTrackingService.class);
        serviceIntent.putExtra("userId", userId);
        serviceIntent.putExtra("deviceName", deviceName);
        serviceIntent.putExtra("fingerprint", fingerprint);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
        
        updateUI();
        Toast.makeText(this, "Device registered! Tracking started.", Toast.LENGTH_LONG).show();
        
        Log.d(TAG, "Device registered: " + deviceName + " (User: " + userId + ")");
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
    
    private void logout() {
        new AlertDialog.Builder(this)
                .setTitle("Logout")
                .setMessage("This will unregister your device and sign you out. Continue?")
                .setPositiveButton("Yes", (dialog, which) -> {
                    // Stop service if running
                    Intent serviceIntent = new Intent(MainActivity.this, LocationTrackingService.class);
                    stopService(serviceIntent);
                    
                    // Sign out from Google
                    mGoogleSignInClient.signOut().addOnCompleteListener(this, task -> {
                        // Clear all preferences
                        SharedPreferences.Editor editor = prefs.edit();
                        editor.clear();
                        editor.apply();
                        
                        // Go back to login
                        Intent intent = new Intent(MainActivity.this, LoginActivity.class);
                        startActivity(intent);
                        finish();
                    });
                })
                .setNegativeButton("No", null)
                .show();
    }
}
