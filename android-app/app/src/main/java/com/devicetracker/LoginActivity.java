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

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;

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
    private static final int RC_SIGN_IN = 9001;

    private static final String PREFS_NAME = "DeviceTracker";
    private static final String SERVER_URL =
            "https://realtime-device-tracker-s9ua.onrender.com";
    private static final String SERVER_CLIENT_ID =
            "31793728596-s6g87ot3785i62i48s7emh2nk3cbk6dv.apps.googleusercontent.com";

    private GoogleSignInClient googleSignInClient;
    private OkHttpClient httpClient;

    private EditText etEmail, etPassword;
    private Button btnLogin, btnGoogleSignIn;
    private TextView tvRegister, tvStatus;
    private ProgressBar progressBar;

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
        btnGoogleSignIn = findViewById(R.id.btnGoogleSignIn);
        tvRegister = findViewById(R.id.tvRegister);
        progressBar = findViewById(R.id.progressBar);
        tvStatus = findViewById(R.id.tvStatus);

        httpClient = new OkHttpClient();

        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(
                GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestIdToken(SERVER_CLIENT_ID) // WEB CLIENT ID
                .build();

        googleSignInClient = GoogleSignIn.getClient(this, gso);

        // Email/Password Login
        btnLogin.setOnClickListener(v -> validateAndLogin());
        
        // Google OAuth Login
        btnGoogleSignIn.setOnClickListener(v -> startGoogleLogin());
        
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
                                
                                // Save new auth data
                                prefs.edit()
                                        .putString("jwt", token)
                                        .putString("userId", userId)
                                        .putString("userName", userName)
                                        .putString("userEmail", userEmail)
                                        .putString("authType", "email")
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
    // GOOGLE LOGIN
    // ===============================

    private void startGoogleLogin() {
        setLoading(true, "Signing in with Google...");
        Intent signInIntent = googleSignInClient.getSignInIntent();
        startActivityForResult(signInIntent, RC_SIGN_IN);
    }

    @Override
    protected void onActivityResult(
            int requestCode,
            int resultCode,
            @Nullable Intent data
    ) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == RC_SIGN_IN) {
            Task<GoogleSignInAccount> task =
                    GoogleSignIn.getSignedInAccountFromIntent(data);
            try {
                GoogleSignInAccount account =
                        task.getResult(ApiException.class);
                sendTokenToBackend(account);
            } catch (ApiException e) {
                Log.e(TAG, "Google sign-in failed", e);
                setLoading(false, "");
                showError("Google sign-in failed");
            }
        }
    }

    // ===============================
    // BACKEND VERIFICATION
    // ===============================

    private void sendTokenToBackend(GoogleSignInAccount account) {

        if (account == null || account.getIdToken() == null) {
            setLoading(false, "");
            showError("Invalid Google account");
            return;
        }

        try {
            JSONObject json = new JSONObject();
            json.put("idToken", account.getIdToken());

            RequestBody body = RequestBody.create(
                    json.toString(),
                    MediaType.get("application/json; charset=utf-8")
            );

            Request request = new Request.Builder()
                    .url(SERVER_URL + "/api/verify-google-user")
                    .post(body)
                    .build();

            httpClient.newCall(request).enqueue(new Callback() {

                @Override
                public void onFailure(Call call, IOException e) {
                    runOnUiThread(() -> {
                        setLoading(false, "");
                        showError("Server connection failed");
                    });
                }

                @Override
                public void onResponse(Call call, Response response)
                        throws IOException {

                    if (!response.isSuccessful()) {
                        runOnUiThread(() -> {
                            setLoading(false, "");
                            showError("Authentication failed");
                        });
                        return;
                    }

                    try {
                        JSONObject res =
                                new JSONObject(response.body().string());

                        String jwt = res.getString("token");
                        String userId = res.getString("userId");
                        String name = res.getString("name");
                        String email = res.optString("email", "");

                        // Debug logging
                        Log.d(TAG, "Received JWT (first 50 chars): " + 
                                (jwt != null ? jwt.substring(0, Math.min(50, jwt.length())) : "NULL"));
                        Log.d(TAG, "JWT has dots: " + (jwt != null && jwt.contains(".")));
                        Log.d(TAG, "UserId: " + userId);

                        // Validate JWT format before saving
                        if (jwt == null || !jwt.contains(".") || jwt.split("\\.").length != 3) {
                            Log.e(TAG, "Invalid JWT received from server!");
                            runOnUiThread(() -> {
                                setLoading(false, "");
                                showError("Invalid token from server");
                            });
                            return;
                        }

                        // ✅ SAVE AUTH CORRECTLY
                        SharedPreferences prefs =
                                getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

                        // Clear old data first
                        prefs.edit().clear().apply();

                        // Save new auth data
                        prefs.edit()
                                .putString("jwt", jwt)
                                .putString("userId", userId)
                                .putString("userName", name)
                                .putString("userEmail", email)
                                .putString("authType", "google")
                                .apply();

                        // Verify save
                        String savedJwt = prefs.getString("jwt", "NOT_SAVED");
                        Log.d(TAG, "Saved JWT (first 50 chars): " + 
                                savedJwt.substring(0, Math.min(50, savedJwt.length())));

                        runOnUiThread(() -> {
                            setLoading(false, "");
                            navigateToMainActivity();
                        });

                    } catch (Exception e) {
                        Log.e(TAG, "Parsing error", e);
                        runOnUiThread(() -> {
                            setLoading(false, "");
                            showError("Invalid server response");
                        });
                    }
                }
            });

        } catch (Exception e) {
            setLoading(false, "");
            showError("Login failed");
        }
    }

    // ===============================
    // UI HELPERS
    // ===============================

    private void setLoading(boolean loading, String message) {
        btnLogin.setEnabled(!loading);
        btnGoogleSignIn.setEnabled(!loading);
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
