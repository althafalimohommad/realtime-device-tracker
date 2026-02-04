package com.devicetracker;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.util.Patterns;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class ForgotPasswordActivity extends AppCompatActivity {

    private static final String TAG = "ForgotPassword";
    private static final String SERVER_URL =
            "https://realtime-device-tracker-s9ua.onrender.com";

    private OkHttpClient httpClient;

    // Step 1: Email input
    private LinearLayout layoutStep1;
    private EditText etEmailStep1;
    private Button btnSendCode;

    // Step 2: Verification code
    private LinearLayout layoutStep2;
    private TextView tvEmailSent;
    private EditText etVerificationCode;
    private Button btnVerifyCode;
    private TextView tvResendCode;

    // Step 3: New password
    private LinearLayout layoutStep3;
    private EditText etNewPassword, etConfirmPassword;
    private Button btnResetPassword;

    // Common
    private ProgressBar progressBar;
    private TextView tvStatus;
    private TextView tvBackToLogin;

    private String userEmail;
    private String resetToken;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_forgot_password);

        httpClient = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build();

        // Initialize views
        initViews();

        // Check if email was passed from login
        String passedEmail = getIntent().getStringExtra("email");
        if (passedEmail != null && !passedEmail.isEmpty()) {
            etEmailStep1.setText(passedEmail);
        }

        // Set up click listeners
        btnSendCode.setOnClickListener(v -> sendVerificationCode());
        btnVerifyCode.setOnClickListener(v -> verifyCode());
        btnResetPassword.setOnClickListener(v -> resetPassword());
        tvResendCode.setOnClickListener(v -> sendVerificationCode());
        tvBackToLogin.setOnClickListener(v -> {
            Intent intent = new Intent(ForgotPasswordActivity.this, LoginActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(intent);
            finish();
        });

        // Start with step 1
        showStep(1);
    }

    private void initViews() {
        // Step 1
        layoutStep1 = findViewById(R.id.layoutStep1);
        etEmailStep1 = findViewById(R.id.etEmailStep1);
        btnSendCode = findViewById(R.id.btnSendCode);

        // Step 2
        layoutStep2 = findViewById(R.id.layoutStep2);
        tvEmailSent = findViewById(R.id.tvEmailSent);
        etVerificationCode = findViewById(R.id.etVerificationCode);
        btnVerifyCode = findViewById(R.id.btnVerifyCode);
        tvResendCode = findViewById(R.id.tvResendCode);

        // Step 3
        layoutStep3 = findViewById(R.id.layoutStep3);
        etNewPassword = findViewById(R.id.etNewPassword);
        etConfirmPassword = findViewById(R.id.etConfirmPassword);
        btnResetPassword = findViewById(R.id.btnResetPassword);

        // Common
        progressBar = findViewById(R.id.progressBar);
        tvStatus = findViewById(R.id.tvStatus);
        tvBackToLogin = findViewById(R.id.tvBackToLogin);
    }

    private void showStep(int step) {
        layoutStep1.setVisibility(step == 1 ? View.VISIBLE : View.GONE);
        layoutStep2.setVisibility(step == 2 ? View.VISIBLE : View.GONE);
        layoutStep3.setVisibility(step == 3 ? View.VISIBLE : View.GONE);
    }

    // ===============================
    // STEP 1: Send Verification Code
    // ===============================

    private void sendVerificationCode() {
        String email = etEmailStep1.getText().toString().trim();

        if (TextUtils.isEmpty(email)) {
            etEmailStep1.setError("Email is required");
            etEmailStep1.requestFocus();
            return;
        }

        if (!Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            etEmailStep1.setError("Invalid email format");
            etEmailStep1.requestFocus();
            return;
        }

        userEmail = email;
        setLoading(true, "Sending verification code...");

        try {
            JSONObject json = new JSONObject();
            json.put("email", email);

            RequestBody body = RequestBody.create(
                    json.toString(),
                    MediaType.get("application/json; charset=utf-8")
            );

            Request request = new Request.Builder()
                    .url(SERVER_URL + "/api/forgot-password")
                    .post(body)
                    .build();

            httpClient.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "Network error", e);
                    runOnUiThread(() -> {
                        setLoading(false, "");
                        showError("Network error. Please check your connection.");
                    });
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    String responseBody = response.body() != null ? response.body().string() : "";
                    
                    runOnUiThread(() -> {
                        try {
                            JSONObject jsonResponse = new JSONObject(responseBody);
                            boolean success = jsonResponse.optBoolean("success", false);
                            String message = jsonResponse.optString("message", "");

                            setLoading(false, "");

                            if (success) {
                                Toast.makeText(ForgotPasswordActivity.this,
                                        "Verification code sent!", Toast.LENGTH_SHORT).show();
                                tvEmailSent.setText("We've sent a 6-digit code to\n" + userEmail + 
                                        "\n\n📧 Check your spam/junk folder if you don't see it!");
                                showStep(2);
                            } else {
                                showError(message);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Parse error", e);
                            setLoading(false, "");
                            showError("Something went wrong. Please try again.");
                        }
                    });
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "Error", e);
            setLoading(false, "");
            showError("Error: " + e.getMessage());
        }
    }

    // ===============================
    // STEP 2: Verify Code
    // ===============================

    private void verifyCode() {
        String code = etVerificationCode.getText().toString().trim();

        if (TextUtils.isEmpty(code)) {
            etVerificationCode.setError("Enter verification code");
            etVerificationCode.requestFocus();
            return;
        }

        if (code.length() != 6) {
            etVerificationCode.setError("Code must be 6 digits");
            etVerificationCode.requestFocus();
            return;
        }

        setLoading(true, "Verifying code...");

        try {
            JSONObject json = new JSONObject();
            json.put("email", userEmail);
            json.put("code", code);

            RequestBody body = RequestBody.create(
                    json.toString(),
                    MediaType.get("application/json; charset=utf-8")
            );

            Request request = new Request.Builder()
                    .url(SERVER_URL + "/api/verify-reset-code")
                    .post(body)
                    .build();

            httpClient.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "Network error", e);
                    runOnUiThread(() -> {
                        setLoading(false, "");
                        showError("Network error. Please check your connection.");
                    });
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    String responseBody = response.body() != null ? response.body().string() : "";
                    
                    runOnUiThread(() -> {
                        try {
                            JSONObject jsonResponse = new JSONObject(responseBody);
                            boolean success = jsonResponse.optBoolean("success", false);
                            String message = jsonResponse.optString("message", "");

                            setLoading(false, "");

                            if (success) {
                                resetToken = jsonResponse.optString("resetToken", "");
                                Toast.makeText(ForgotPasswordActivity.this,
                                        "Code verified!", Toast.LENGTH_SHORT).show();
                                showStep(3);
                            } else {
                                showError(message);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Parse error", e);
                            setLoading(false, "");
                            showError("Something went wrong. Please try again.");
                        }
                    });
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "Error", e);
            setLoading(false, "");
            showError("Error: " + e.getMessage());
        }
    }

    // ===============================
    // STEP 3: Reset Password
    // ===============================

    private void resetPassword() {
        String newPassword = etNewPassword.getText().toString();
        String confirmPassword = etConfirmPassword.getText().toString();

        if (TextUtils.isEmpty(newPassword)) {
            etNewPassword.setError("Password is required");
            etNewPassword.requestFocus();
            return;
        }

        if (newPassword.length() < 6) {
            etNewPassword.setError("Password must be at least 6 characters");
            etNewPassword.requestFocus();
            return;
        }

        if (!newPassword.equals(confirmPassword)) {
            etConfirmPassword.setError("Passwords do not match");
            etConfirmPassword.requestFocus();
            return;
        }

        setLoading(true, "Resetting password...");

        try {
            JSONObject json = new JSONObject();
            json.put("resetToken", resetToken);
            json.put("newPassword", newPassword);

            RequestBody body = RequestBody.create(
                    json.toString(),
                    MediaType.get("application/json; charset=utf-8")
            );

            Request request = new Request.Builder()
                    .url(SERVER_URL + "/api/reset-password")
                    .post(body)
                    .build();

            httpClient.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "Network error", e);
                    runOnUiThread(() -> {
                        setLoading(false, "");
                        showError("Network error. Please check your connection.");
                    });
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    String responseBody = response.body() != null ? response.body().string() : "";
                    
                    runOnUiThread(() -> {
                        try {
                            JSONObject jsonResponse = new JSONObject(responseBody);
                            boolean success = jsonResponse.optBoolean("success", false);
                            String message = jsonResponse.optString("message", "");

                            setLoading(false, "");

                            if (success) {
                                Toast.makeText(ForgotPasswordActivity.this,
                                        "Password reset successfully!", Toast.LENGTH_LONG).show();
                                
                                // Navigate to login
                                Intent intent = new Intent(ForgotPasswordActivity.this, LoginActivity.class);
                                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                                startActivity(intent);
                                finish();
                            } else {
                                showError(message);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Parse error", e);
                            setLoading(false, "");
                            showError("Something went wrong. Please try again.");
                        }
                    });
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "Error", e);
            setLoading(false, "");
            showError("Error: " + e.getMessage());
        }
    }

    // ===============================
    // UI HELPERS
    // ===============================

    private void setLoading(boolean loading, String message) {
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        tvStatus.setVisibility(loading ? View.VISIBLE : View.GONE);
        tvStatus.setText(message);

        btnSendCode.setEnabled(!loading);
        btnVerifyCode.setEnabled(!loading);
        btnResetPassword.setEnabled(!loading);
    }

    private void showError(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
