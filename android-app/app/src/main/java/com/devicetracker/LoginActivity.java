package com.devicetracker;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.util.Patterns;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.io.IOException;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class LoginActivity extends AppCompatActivity {

    private static final String TAG = "LoginActivity";

    private static final String PREFS_NAME = "DeviceTracker";
    private static final String SERVER_URL =
            "https://realtime-device-tracker-s9ua.onrender.com";

    private OkHttpClient httpClient;

    private EditText etEmail, etPassword;
    private Button btnLogin;
    private TextView tvRegister, tvStatus, tvForgotPassword;
    private ProgressBar progressBar;
    
    // Track wrong password attempts
    private int wrongPasswordAttempts = 0;

    // ===============================
    // ACTIVITY LIFECYCLE
    // ===============================

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        // 🔐 If already logged in, skip login
        if (prefs.getString("jwt", null) != null &&
            prefs.getString("userId", null) != null) {
            navigateToMainActivity();
            return;
        }

        setContentView(R.layout.activity_login);

        // Initialize views
        etEmail = findViewById(R.id.etEmail);
        etPassword = findViewById(R.id.etPassword);
        btnLogin = findViewById(R.id.btnLogin);
        tvRegister = findViewById(R.id.tvRegister);
        tvForgotPassword = findViewById(R.id.tvForgotPassword);
        progressBar = findViewById(R.id.progressBar);
        tvStatus = findViewById(R.id.tvStatus);

        httpClient = new OkHttpClient();

        // Email/Password Login
        btnLogin.setOnClickListener(v -> validateAndLogin());
        
        // Forgot Password - hidden initially, shown after wrong password
        if (tvForgotPassword != null) {
            tvForgotPassword.setVisibility(View.GONE);
            tvForgotPassword.setOnClickListener(v -> {
                String email = etEmail.getText().toString().trim();
                Intent intent = new Intent(LoginActivity.this, ForgotPasswordActivity.class);
                if (!email.isEmpty()) {
                    intent.putExtra("email", email);
                }
                startActivity(intent);
            });
        }
        
        // Navigate to Register
        tvRegister.setOnClickListener(v -> {
            startActivity(new Intent(LoginActivity.this, RegisterActivity.class));
        });
    }

    // ===============================
    // EMAIL/PASSWORD LOGIN
    // ===============================

    private void validateAndLogin() {
        String email = etEmail.getText().toString().trim();
        String password = etPassword.getText().toString();

        // Validation
        if (TextUtils.isEmpty(email)) {
            etEmail.setError("Email is required");
            etEmail.requestFocus();
            return;
        }

        if (!Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            etEmail.setError("Invalid email format");
            etEmail.requestFocus();
            return;
        }

        if (TextUtils.isEmpty(password)) {
            etPassword.setError("Password is required");
            etPassword.requestFocus();
            return;
        }

        // Call API
        loginWithEmailPassword(email, password);
    }

    private void loginWithEmailPassword(String email, String password) {
        setLoading(true, "Signing in...");

        try {
            JSONObject json = new JSONObject();
            json.put("email", email);
            json.put("password", password);

            RequestBody body = RequestBody.create(
                    json.toString(),
                    MediaType.get("application/json; charset=utf-8")
            );

            Request request = new Request.Builder()
                    .url(SERVER_URL + "/api/app/login")
                    .post(body)
                    .build();

            httpClient.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "Login failed", e);
                    runOnUiThread(() -> {
                        setLoading(false, "");
                        showError("Network error: " + e.getMessage());
                    });
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    String responseBody = response.body().string();
                    Log.d(TAG, "Login response: " + responseBody);

                    runOnUiThread(() -> {
                        try {
                            JSONObject jsonResponse = new JSONObject(responseBody);
                            boolean success = jsonResponse.getBoolean("success");

                            if (success) {
                                // Save user data
                                String userId = jsonResponse.getString("userId");
                                String userName = jsonResponse.getString("name");
                                String userEmail = jsonResponse.getString("email");
                                String token = jsonResponse.getString("token");

                                // Validate JWT format
                                if (token == null || !token.contains(".") || 
                                    token.split("\\.").length != 3) {
                                    Log.e(TAG, "Invalid JWT received from server!");
                                    setLoading(false, "");
                                    showError("Invalid token from server");
                                    return;
                                }

                                SharedPreferences prefs = 
                                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                                
                                // Clear old data
                                prefs.edit().clear().apply();
                                
                                // Calculate token expiry (7 days from now)
                                long tokenExpiry = System.currentTimeMillis() + (7L * 24 * 60 * 60 * 1000);
                                
                                // Save new auth data
                                prefs.edit()
                                        .putString("jwt", token)
                                        .putString("userId", userId)
                                        .putString("userName", userName)
                                        .putString("userEmail", userEmail)
                                        .putString("authType", "email")
                                        .putLong("tokenExpiry", tokenExpiry)
                                        .apply();

                                Log.d(TAG, "✅ Login successful, JWT saved");
                                
                                setLoading(false, "");
                                Toast.makeText(LoginActivity.this,
                                        "Login successful!", Toast.LENGTH_SHORT).show();

                                // Navigate to main activity
                                navigateToMainActivity();
                            } else {
                                String message = jsonResponse.optString("message",
                                        "Login failed");
                                setLoading(false, "");
                                
                                // Check if it's a wrong password error
                                if (message.toLowerCase().contains("invalid") || 
                                    message.toLowerCase().contains("password")) {
                                    wrongPasswordAttempts++;
                                    if (wrongPasswordAttempts >= 1 && tvForgotPassword != null) {
                                        tvForgotPassword.setVisibility(View.VISIBLE);
                                    }
                                }
                                
                                showError(message);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error parsing response", e);
                            setLoading(false, "");
                            showError("Error: " + e.getMessage());
                        }
                    });
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "Error creating request", e);
            setLoading(false, "");
            showError("Error: " + e.getMessage());
        }
    }

    // ===============================
    // UI HELPERS
    // ===============================

    private void setLoading(boolean loading, String message) {
        btnLogin.setEnabled(!loading);
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        if (loading && !message.isEmpty()) {
            tvStatus.setText(message);
            tvStatus.setVisibility(View.VISIBLE);
        } else {
            tvStatus.setVisibility(View.GONE);
        }
    }

    private void showError(String message) {
        tvStatus.setText(message);
        tvStatus.setVisibility(View.VISIBLE);
        tvStatus.setTextColor(getResources().getColor(android.R.color.holo_red_dark));
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private void navigateToMainActivity() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }
}
