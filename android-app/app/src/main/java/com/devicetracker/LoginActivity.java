package com.devicetracker;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.Button;
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
    private static final String PREFS_NAME = "DeviceTrackerPrefs";
    private static final String SERVER_URL = "https://realtime-device-tracker-s9ua.onrender.com";
    
    private GoogleSignInClient mGoogleSignInClient;
    private Button btnSignIn;
    private ProgressBar progressBar;
    private TextView tvStatus;
    private OkHttpClient httpClient;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Check if already logged in
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String userId = prefs.getString("userId", null);
        String userName = prefs.getString("userName", null);
        
        if (userId != null && userName != null) {
            // Already logged in, go to MainActivity
            navigateToMainActivity(userId, userName);
            return;
        }
        
        setContentView(R.layout.activity_login);
        
        btnSignIn = findViewById(R.id.btnSignIn);
        progressBar = findViewById(R.id.progressBar);
        tvStatus = findViewById(R.id.tvStatus);
        
        httpClient = new OkHttpClient();
        
        // Configure Google Sign-In
        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestId()
                .requestProfile()
                .build();
        
        mGoogleSignInClient = GoogleSignIn.getClient(this, gso);
        
        btnSignIn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                signIn();
            }
        });
    }

    private void signIn() {
        Intent signInIntent = mGoogleSignInClient.getSignInIntent();
        startActivityForResult(signInIntent, RC_SIGN_IN);
        setLoading(true);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == RC_SIGN_IN) {
            Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
            try {
                GoogleSignInAccount account = task.getResult(ApiException.class);
                handleSignInResult(account);
            } catch (ApiException e) {
                Log.e(TAG, "Google sign in failed", e);
                setLoading(false);
                tvStatus.setText("Sign in failed: " + e.getMessage());
                Toast.makeText(this, "Sign in failed", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void handleSignInResult(GoogleSignInAccount account) {
        if (account != null) {
            String email = account.getEmail();
            String name = account.getDisplayName();
            String googleId = account.getId();
            
            Log.d(TAG, "Signed in: " + email);
            tvStatus.setText("Verifying with server...");
            
            // Verify with backend server
            verifyWithServer(email, name, googleId);
        } else {
            setLoading(false);
            tvStatus.setText("Sign in failed");
        }
    }

    private void verifyWithServer(String email, String name, String googleId) {
        try {
            JSONObject json = new JSONObject();
            json.put("email", email);
            json.put("name", name);
            json.put("googleId", googleId);
            
            RequestBody body = RequestBody.create(
                json.toString(),
                MediaType.parse("application/json; charset=utf-8")
            );
            
            Request request = new Request.Builder()
                    .url(SERVER_URL + "/api/verify-google-user")
                    .post(body)
                    .build();
            
            httpClient.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "Server verification failed", e);
                    runOnUiThread(() -> {
                        setLoading(false);
                        tvStatus.setText("Server connection failed");
                        Toast.makeText(LoginActivity.this, "Cannot connect to server", Toast.LENGTH_SHORT).show();
                    });
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    String responseBody = response.body().string();
                    
                    if (response.isSuccessful()) {
                        try {
                            JSONObject jsonResponse = new JSONObject(responseBody);
                            String userId = jsonResponse.getString("userId");
                            String userName = jsonResponse.getString("name");
                            
                            // Save user info
                            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                            SharedPreferences.Editor editor = prefs.edit();
                            editor.putString("userId", userId);
                            editor.putString("userName", userName);
                            editor.putString("userEmail", email);
                            editor.apply();
                            
                            Log.d(TAG, "User verified: " + userId);
                            
                            runOnUiThread(() -> {
                                setLoading(false);
                                tvStatus.setText("Login successful!");
                                navigateToMainActivity(userId, userName);
                            });
                            
                        } catch (Exception e) {
                            Log.e(TAG, "Error parsing response", e);
                            runOnUiThread(() -> {
                                setLoading(false);
                                tvStatus.setText("Server error");
                                Toast.makeText(LoginActivity.this, "Server error", Toast.LENGTH_SHORT).show();
                            });
                        }
                    } else {
                        Log.e(TAG, "Server returned error: " + responseBody);
                        runOnUiThread(() -> {
                            setLoading(false);
                            tvStatus.setText("Authentication failed");
                            Toast.makeText(LoginActivity.this, "Not authorized", Toast.LENGTH_SHORT).show();
                        });
                    }
                }
            });
            
        } catch (Exception e) {
            Log.e(TAG, "Error creating request", e);
            setLoading(false);
            tvStatus.setText("Error occurred");
        }
    }

    private void setLoading(boolean loading) {
        btnSignIn.setEnabled(!loading);
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
    }

    private void navigateToMainActivity(String userId, String userName) {
        Intent intent = new Intent(LoginActivity.this, MainActivity.class);
        intent.putExtra("userId", userId);
        intent.putExtra("userName", userName);
        startActivity(intent);
        finish();
    }
}
