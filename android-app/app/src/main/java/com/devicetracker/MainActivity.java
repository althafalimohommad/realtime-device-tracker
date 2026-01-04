package com.devicetracker;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
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

public class MainActivity extends AppCompatActivity {
    
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private EditText deviceNameInput;
    private Button registerButton, unregisterButton;
    private TextView statusText;
    private SharedPreferences prefs;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        
        prefs = getSharedPreferences("DeviceTracker", MODE_PRIVATE);
        
        deviceNameInput = findViewById(R.id.deviceNameInput);
        registerButton = findViewById(R.id.registerButton);
        unregisterButton = findViewById(R.id.unregisterButton);
        statusText = findViewById(R.id.statusText);
        
        updateUI();
        
        registerButton.setOnClickListener(v -> requestPermissionsAndRegister());
        unregisterButton.setOnClickListener(v -> unregisterDevice());
    }
    
    private void updateUI() {
        boolean isRegistered = prefs.getBoolean("isRegistered", false);
        String deviceName = prefs.getString("deviceName", "");
        
        if (isRegistered) {
            deviceNameInput.setEnabled(false);
            deviceNameInput.setText(deviceName);
            registerButton.setVisibility(View.GONE);
            unregisterButton.setVisibility(View.VISIBLE);
            statusText.setText("✅ Device Registered\nTracking location in background...");
            statusText.setTextColor(getResources().getColor(android.R.color.holo_green_dark));
        } else {
            deviceNameInput.setEnabled(true);
            deviceNameInput.setText("");
            registerButton.setVisibility(View.VISIBLE);
            unregisterButton.setVisibility(View.GONE);
            statusText.setText("Register this device to start tracking");
            statusText.setTextColor(getResources().getColor(android.R.color.darker_gray));
        }
    }
    
    private void requestPermissionsAndRegister() {
        String deviceName = deviceNameInput.getText().toString().trim();
        
        if (deviceName.isEmpty()) {
            Toast.makeText(this, "Please enter device name", Toast.LENGTH_SHORT).show();
            return;
        }
        
        // Check if permissions are granted
        if (hasLocationPermissions()) {
            registerDevice(deviceName);
        } else {
            // Request permissions
            requestLocationPermissions();
        }
    }
    
    private boolean hasLocationPermissions() {
        boolean fineLocation = ContextCompat.checkSelfPermission(this, 
            Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarseLocation = ContextCompat.checkSelfPermission(this, 
            Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            boolean backgroundLocation = ContextCompat.checkSelfPermission(this, 
                Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
            return fineLocation && coarseLocation && backgroundLocation;
        }
        
        return fineLocation && coarseLocation;
    }
    
    private void requestLocationPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10+ requires background location permission
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
                // First request foreground location
                ActivityCompat.requestPermissions(this, new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                }, PERMISSION_REQUEST_CODE);
            } else {
                // Then request background location
                new AlertDialog.Builder(this)
                    .setTitle("Background Location Required")
                    .setMessage("To track your device 24/7, please select 'Allow all the time' in the next screen.")
                    .setPositiveButton("Continue", (dialog, which) -> {
                        ActivityCompat.requestPermissions(MainActivity.this, new String[]{
                            Manifest.permission.ACCESS_BACKGROUND_LOCATION
                        }, PERMISSION_REQUEST_CODE);
                    })
                    .show();
            }
        } else {
            ActivityCompat.requestPermissions(this, new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }, PERMISSION_REQUEST_CODE);
        }
    }
    
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, 
                                          @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (hasLocationPermissions()) {
                String deviceName = deviceNameInput.getText().toString().trim();
                if (!deviceName.isEmpty()) {
                    registerDevice(deviceName);
                }
            } else {
                Toast.makeText(this, "Location permissions required for tracking", 
                    Toast.LENGTH_LONG).show();
            }
        }
    }
    
    private void registerDevice(String deviceName) {
        // Save registration
        prefs.edit()
            .putBoolean("isRegistered", true)
            .putString("deviceName", deviceName)
            .putLong("registrationTime", System.currentTimeMillis())
            .apply();
        
        // Start location tracking service
        Intent serviceIntent = new Intent(this, LocationTrackingService.class);
        serviceIntent.putExtra("deviceName", deviceName);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
        
        Toast.makeText(this, "Device registered! Tracking started...", Toast.LENGTH_LONG).show();
        updateUI();
    }
    
    private void unregisterDevice() {
        new AlertDialog.Builder(this)
            .setTitle("Unregister Device")
            .setMessage("This will stop location tracking. Continue?")
            .setPositiveButton("Yes", (dialog, which) -> {
                // Stop service
                Intent serviceIntent = new Intent(this, LocationTrackingService.class);
                stopService(serviceIntent);
                
                // Clear registration
                prefs.edit().clear().apply();
                
                Toast.makeText(this, "Device unregistered", Toast.LENGTH_SHORT).show();
                updateUI();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }
}
