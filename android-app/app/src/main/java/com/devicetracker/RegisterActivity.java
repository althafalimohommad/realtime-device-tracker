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

public class RegisterActivity extends AppCompatActivity {

    private static final String TAG = "RegisterActivity";
    private static final String PREFS_NAME = "DeviceTracker";
    private static final String SERVER_URL = 
            "https://realtime-device-tracker-s9ua.onrender.com";

    private EditText etName, etEmail, etPassword, etConfirmPassword;
    private Button btnRegister;
    private TextView tvLogin, tvStatus;
    private ProgressBar progressBar;
    private OkHttpClient httpClient;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_register);

        // Initialize views
        etName = findViewById(R.id.etName);
        etEmail = findViewById(R.id.etEmail);
        etPassword = findViewById(R.id.etPassword);
        etConfirmPassword = findViewById(R.id.etConfirmPassword);
        btnRegister = findViewById(R.id.btnRegister);
        tvLogin = findViewById(R.id.tvLogin);
        tvStatus = findViewById(R.id.tvStatus);
        progressBar = findViewById(R.id.progressBar);

        httpClient = new OkHttpClient();

        btnRegister.setOnClickListener(v -> validateAndRegister());
        tvLogin.setOnClickListener(v -> {
            startActivity(new Intent(RegisterActivity.this, LoginActivity.class));
            finish();
        });
    }

    private void validateAndRegister() {
        String name = etName.getText().toString().trim();
        String email = etEmail.getText().toString().trim();
        String password = etPassword.getText().toString();
        String confirmPassword = etConfirmPassword.getText().toString();

        // Validation
        if (TextUtils.isEmpty(name)) {
            etName.setError("Name is required");
            etName.requestFocus();
            return;
        }

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

        if (password.length() < 6) {
            etPassword.setError("Password must be at least 6 characters");
            etPassword.requestFocus();
            return;
        }

        if (!password.equals(confirmPassword)) {
            etConfirmPassword.setError("Passwords do not match");
            etConfirmPassword.requestFocus();
            return;
        }

        // Call API
        registerUser(name, email, password);
    }

    private void registerUser(String name, String email, String password) {
        setLoading(true);

        try {
            JSONObject json = new JSONObject();
            json.put("name", name);
            json.put("email", email);
            json.put("password", password);

            RequestBody body = RequestBody.create(
                    json.toString(),
                    MediaType.get("application/json; charset=utf-8")
            );

            Request request = new Request.Builder()
                    .url(SERVER_URL + "/api/app/register")
                    .post(body)
                    .build();

            httpClient.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "Registration failed", e);
                    runOnUiThread(() -> {
                        setLoading(false);
                        showError("Network error: " + e.getMessage());
                    });
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    String responseBody = response.body().string();
                    Log.d(TAG, "Registration response: " + responseBody);

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

                                SharedPreferences prefs = 
                                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                                
                                // Store current timestamp as login time
                                long loginTimestamp = System.currentTimeMillis();
                                
                                // Calculate token expiry (7 days from registration)
                                long tokenExpiry = loginTimestamp + (7L * 24 * 60 * 60 * 1000);
                                
                                prefs.edit()
                                        .putString("jwt", token)
                                        .putString("userId", userId)
                                        .putString("userName", userName)
                                        .putString("userEmail", userEmail)
                                        .putString("authType", "email")
                                        .putLong("loginTimestamp", loginTimestamp)
                                        .putLong("tokenExpiry", tokenExpiry)
                                        .putLong("lastTokenRefresh", loginTimestamp)
                                        .apply();

                                Log.d(TAG, "✅ Registration successful, JWT saved");
                                Log.d(TAG, "Token expires at: " + new java.util.Date(tokenExpiry));
                                
                                // Schedule background token refresh worker
                                TokenRefreshWorker.schedule(RegisterActivity.this);
                                
                                Toast.makeText(RegisterActivity.this,
                                        "Registration successful!", Toast.LENGTH_SHORT).show();

                                // Navigate to main activity
                                navigateToMainActivity();
                            } else {
                                String message = jsonResponse.optString("message",
                                        "Registration failed");
                                setLoading(false);
                                showError(message);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error parsing response", e);
                            setLoading(false);
                            showError("Error: " + e.getMessage());
                        }
                    });
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "Error creating request", e);
            setLoading(false);
            showError("Error: " + e.getMessage());
        }
    }

    private void setLoading(boolean loading) {
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        btnRegister.setEnabled(!loading);
        btnRegister.setText(loading ? "Creating account..." : "Create Account");
        tvStatus.setVisibility(View.GONE);
    }

    private void showError(String message) {
        tvStatus.setText(message);
        tvStatus.setVisibility(View.VISIBLE);
        tvStatus.setTextColor(getResources().getColor(android.R.color.holo_red_dark));
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private void navigateToMainActivity() {
        Intent intent = new Intent(RegisterActivity.this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }
}
