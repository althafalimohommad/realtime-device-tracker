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

    private static final String PREFS_NAME = "DeviceTracker";
    private static final String SERVER_URL =
            "https://realtime-device-tracker-s9ua.onrender.com";
    private static final String SERVER_CLIENT_ID =
            "31793728596-s6g87ot3785i62i48s7emh2nk3cbk6dv.apps.googleusercontent.com";

    private GoogleSignInClient googleSignInClient;
    private OkHttpClient httpClient;

    private Button btnSignIn;
    private ProgressBar progressBar;
    private TextView tvStatus;

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

        btnSignIn = findViewById(R.id.btnSignIn);
        progressBar = findViewById(R.id.progressBar);
        tvStatus = findViewById(R.id.tvStatus);

        httpClient = new OkHttpClient();

        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(
                GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestIdToken(SERVER_CLIENT_ID) // WEB CLIENT ID
                .build();

        googleSignInClient = GoogleSignIn.getClient(this, gso);

        btnSignIn.setOnClickListener(v -> startGoogleLogin());
    }

    // ===============================
    // GOOGLE LOGIN
    // ===============================

    private void startGoogleLogin() {
        setLoading(true);
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
                setLoading(false);
                showError("Google sign-in failed");
            }
        }
    }

    // ===============================
    // BACKEND VERIFICATION
    // ===============================

    private void sendTokenToBackend(GoogleSignInAccount account) {

        if (account == null || account.getIdToken() == null) {
            setLoading(false);
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
                        setLoading(false);
                        showError("Server connection failed");
                    });
                }

                @Override
                public void onResponse(Call call, Response response)
                        throws IOException {

                    if (!response.isSuccessful()) {
                        runOnUiThread(() -> {
                            setLoading(false);
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

                        // ✅ SAVE AUTH CORRECTLY
                        SharedPreferences prefs =
                                getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

                        prefs.edit()
                                .putString("jwt", jwt)
                                .putString("userId", userId)
                                .putString("userName", name)
                                .putString("userEmail", email)
                                .apply();

                        runOnUiThread(() -> {
                            setLoading(false);
                            navigateToMainActivity();
                        });

                    } catch (Exception e) {
                        Log.e(TAG, "Parsing error", e);
                        runOnUiThread(() -> {
                            setLoading(false);
                            showError("Invalid server response");
                        });
                    }
                }
            });

        } catch (Exception e) {
            setLoading(false);
            showError("Login failed");
        }
    }

    // ===============================
    // UI HELPERS
    // ===============================

    private void setLoading(boolean loading) {
        btnSignIn.setEnabled(!loading);
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
    }

    private void showError(String message) {
        tvStatus.setText(message);
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void navigateToMainActivity() {
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }
}
