package com.devicetracker;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

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

public class ApiClient {

    private static final String TAG = "ApiClient";
    private static final String BASE_URL =
            "https://devicetracker.tech";
    
    // Token valid for 7 days
    public static final long TOKEN_VALIDITY_MS = 7L * 24 * 60 * 60 * 1000; // 7 days
    
    // Refresh token when less than 2 days remain (start refreshing on day 5)
    // This gives a bigger window to handle battery optimization delays
    public static final long TOKEN_REFRESH_THRESHOLD_MS = 48 * 60 * 60 * 1000L; // 2 days in ms

    private final OkHttpClient client;
    private final SharedPreferences prefs;
    private final Context context;
    private final String userAgent;
    private boolean isRefreshingToken = false;

    public interface ApiCallback {
        void onSuccess(String response);
        void onError(String error);
    }
    
    public interface TokenRefreshCallback {
        void onRefreshed(String newToken);
        void onFailed(String error);
    }

    public ApiClient(Context context) {
        this.client = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build();

        Context appContext = context.getApplicationContext();
        this.context = appContext;
        this.prefs = appContext.getSharedPreferences("DeviceTracker", Context.MODE_PRIVATE);
        this.userAgent =
                Build.MANUFACTURER + " " + Build.MODEL + " Android " + Build.VERSION.RELEASE;
    }

    // ===============================
    // MAIN API: SEND LOCATION
    // ===============================

    public void sendLocationUpdate(
            double latitude,
            double longitude,
            float accuracy,
            ApiCallback callback
    ) {
        try {
            String jwt = prefs.getString("jwt", null);
            String userId = prefs.getString("userId", null);
            String deviceName = prefs.getString("deviceName", "Android Device");
            String fingerprint = prefs.getString("deviceFingerprint", "");

            // Debug logging
            Log.d(TAG, "Reading JWT from prefs: " + 
                    (jwt != null ? jwt.substring(0, Math.min(50, jwt.length())) + "..." : "NULL"));
            Log.d(TAG, "UserId from prefs: " + userId);

            if (jwt == null || userId == null) {
                Log.e(TAG, "JWT or userId missing");
                callback.onError("User not logged in");
                return;
            }

            // Validate JWT format (must have 3 parts separated by dots)
            String[] jwtParts = jwt.split("\\.");
            Log.d(TAG, "JWT parts count: " + jwtParts.length);
            
            if (!jwt.contains(".") || jwtParts.length != 3) {
                Log.e(TAG, "Invalid JWT format (parts=" + jwtParts.length + ") - clearing auth data");
                Log.e(TAG, "Invalid token value: " + jwt);
                prefs.edit()
                        .remove("jwt")
                        .remove("userId")
                        .remove("userName")
                        .remove("userEmail")
                        .apply();
                callback.onError("Invalid token - please re-login");
                return;
            }

            JSONObject json = new JSONObject();
            json.put("latitude", latitude);
            json.put("longitude", longitude);
            json.put("accuracy", accuracy);
            json.put("deviceName", deviceName);
            json.put("fingerprint", fingerprint);
            json.put("timestamp", System.currentTimeMillis());

            RequestBody body = RequestBody.create(
                    json.toString(),
                    MediaType.get("application/json; charset=utf-8")
            );

            Request request = new Request.Builder()
                    .url(BASE_URL + "/api/location-update-app")
                    .addHeader("Authorization", "Bearer " + jwt)
                    .addHeader("User-Agent", userAgent)
                    .post(body)
                    .build();

            client.newCall(request).enqueue(new Callback() {

                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "Network error", e);
                    callback.onError("Network error");
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    String resBody = response.body() != null
                            ? response.body().string()
                            : "";

                    if (response.isSuccessful()) {
                        Log.d(TAG, "Location sent successfully");
                        callback.onSuccess(resBody);
                    } else if (response.code() == 401) {
                        Log.w(TAG, "JWT expired or invalid - clearing auth data");

                        // Clear ALL auth data → force re-login
                        prefs.edit()
                                .remove("jwt")
                                .remove("userId")
                                .remove("userName")
                                .remove("userEmail")
                                .apply();

                        callback.onError("Authentication expired - please re-login");
                    } else {
                        Log.e(TAG, "Server error " + response.code() + ": " + resBody);
                        callback.onError("Server error: " + response.code());
                    }
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "Error sending location", e);
            callback.onError("Unexpected error");
        }
    }
    
    // ===============================
    // TOKEN REFRESH
    // ===============================
    
    /**
     * Check if token needs refresh (less than 1 day remaining)
     * Token is valid for 7 days, refresh on day 6 (when < 24 hours remain)
     */
    public boolean shouldRefreshToken() {
        long tokenExpiry = prefs.getLong("tokenExpiry", 0);
        long loginTimestamp = prefs.getLong("loginTimestamp", 0);
        
        // If no expiry stored but we have login timestamp, calculate it
        if (tokenExpiry == 0 && loginTimestamp > 0) {
            tokenExpiry = loginTimestamp + TOKEN_VALIDITY_MS;
            prefs.edit().putLong("tokenExpiry", tokenExpiry).apply();
        }
        
        if (tokenExpiry == 0) return false;
        
        long now = System.currentTimeMillis();
        long timeRemaining = tokenExpiry - now;
        boolean shouldRefresh = timeRemaining > 0 && timeRemaining < TOKEN_REFRESH_THRESHOLD_MS;
        
        if (shouldRefresh) {
            Log.d(TAG, "Token expires in " + (timeRemaining / 3600000) + " hours - needs refresh");
        }
        return shouldRefresh;
    }
    
    /**
     * Check if token is expired
     */
    public boolean isTokenExpired() {
        long tokenExpiry = prefs.getLong("tokenExpiry", 0);
        long loginTimestamp = prefs.getLong("loginTimestamp", 0);
        
        // If no expiry but we have login timestamp, calculate it
        if (tokenExpiry == 0 && loginTimestamp > 0) {
            tokenExpiry = loginTimestamp + TOKEN_VALIDITY_MS;
        }
        
        return tokenExpiry > 0 && System.currentTimeMillis() >= tokenExpiry;
    }
    
    /**
     * Get token status info for debugging
     */
    public String getTokenStatusInfo() {
        long tokenExpiry = prefs.getLong("tokenExpiry", 0);
        long loginTimestamp = prefs.getLong("loginTimestamp", 0);
        long lastRefresh = prefs.getLong("lastTokenRefresh", 0);
        long now = System.currentTimeMillis();
        
        if (tokenExpiry == 0) return "No token expiry set";
        
        long hoursRemaining = (tokenExpiry - now) / (60 * 60 * 1000);
        long daysSinceLogin = loginTimestamp > 0 ? (now - loginTimestamp) / (24 * 60 * 60 * 1000) : -1;
        long hoursSinceRefresh = lastRefresh > 0 ? (now - lastRefresh) / (60 * 60 * 1000) : -1;
        
        return String.format("Hours remaining: %d, Days since login: %d, Hours since refresh: %d",
                hoursRemaining, daysSinceLogin, hoursSinceRefresh);
    }
    
    /**
     * Refresh the JWT token before it expires
     */
    public void refreshToken(TokenRefreshCallback callback) {
        if (isRefreshingToken) {
            Log.d(TAG, "Token refresh already in progress");
            return;
        }
        
        String jwt = prefs.getString("jwt", null);
        if (jwt == null) {
            callback.onFailed("No token to refresh");
            return;
        }
        
        isRefreshingToken = true;
        Log.d(TAG, "Refreshing token...");
        
        Request request = new Request.Builder()
                .url(BASE_URL + "/api/refresh-token")
                .addHeader("Authorization", "Bearer " + jwt)
                .addHeader("User-Agent", userAgent)
                .post(RequestBody.create("", MediaType.get("application/json")))
                .build();
        
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                isRefreshingToken = false;
                Log.e(TAG, "Token refresh network error", e);
                callback.onFailed("Network error during token refresh");
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                isRefreshingToken = false;
                String resBody = response.body() != null ? response.body().string() : "";
                
                if (response.isSuccessful()) {
                    try {
                        JSONObject json = new JSONObject(resBody);
                        if (json.optBoolean("success", false)) {
                            String newToken = json.getString("token");
                            long newExpiry = json.optLong("tokenExpiry", 
                                    System.currentTimeMillis() + 7 * 24 * 60 * 60 * 1000);
                            
                            // Save new token with updated timestamps
                            long now = System.currentTimeMillis();
                            prefs.edit()
                                    .putString("jwt", newToken)
                                    .putLong("tokenExpiry", newExpiry)
                                    .putLong("lastTokenRefresh", now)
                                    .apply();
                            
                            Log.d(TAG, "✅ Token refreshed successfully, valid until: " + 
                                    new java.util.Date(newExpiry));
                            callback.onRefreshed(newToken);
                        } else {
                            callback.onFailed(json.optString("message", "Refresh failed"));
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error parsing refresh response", e);
                        callback.onFailed("Invalid server response");
                    }
                } else if (response.code() == 401) {
                    Log.w(TAG, "Token refresh failed - token already expired");
                    callback.onFailed("Token expired - please re-login");
                } else {
                    Log.e(TAG, "Token refresh error: " + response.code());
                    callback.onFailed("Server error: " + response.code());
                }
            }
        });
    }
}
