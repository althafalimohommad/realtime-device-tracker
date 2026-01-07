package com.devicetracker;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;

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
    private static final String BASE_URL = "https://realtime-device-tracker-s9ua.onrender.com";
    
    // Token refresh threshold: refresh if less than 1 day remaining
    private static final long TOKEN_REFRESH_THRESHOLD = 24 * 60 * 60 * 1000; // 1 day in ms
    
    private final OkHttpClient client;
    private final SharedPreferences prefs;
    private final String userAgent;
    private final GoogleSignInClient googleClient;
    private final Context appContext;
    // Web client ID from Google Cloud
    private static final String SERVER_CLIENT_ID = "31793728596-s6g87ot3785i62i48s7emh2nk3cbk6dv.apps.googleusercontent.com";
    
    public interface ApiCallback {
        void onSuccess(String response);
        void onError(String error);
    }
    
    public ApiClient(Context context) {
        this.client = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build();
        this.appContext = context.getApplicationContext();
        this.prefs = appContext.getSharedPreferences("DeviceTracker", Context.MODE_PRIVATE);
        this.userAgent = Build.MANUFACTURER + " " + Build.MODEL + " Android " + Build.VERSION.RELEASE;
        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestId()
                .requestProfile()
                .requestIdToken(SERVER_CLIENT_ID)
                .build();
        this.googleClient = GoogleSignIn.getClient(appContext, gso);
    }
    
    /**
     * Get the best available authentication token.
     * Priority: Backend JWT > Google ID Token
     * Returns null if no valid token is available.
     */
    private String getAuthToken() {
        // First, try to use the backend JWT (long-lived, 7 days)
        String backendToken = prefs.getString("authToken", "");
        long tokenExpiry = prefs.getLong("tokenExpiry", 0);
        
        if (!backendToken.isEmpty() && tokenExpiry > System.currentTimeMillis()) {
            Log.d(TAG, "Using backend JWT token (expires in " + 
                    ((tokenExpiry - System.currentTimeMillis()) / 1000 / 60) + " minutes)");
            
            // Check if token needs refresh (less than 1 day remaining)
            if (tokenExpiry - System.currentTimeMillis() < TOKEN_REFRESH_THRESHOLD) {
                refreshBackendToken(backendToken);
            }
            
            return backendToken;
        }
        
        // Fallback: try Google ID token (short-lived, ~1 hour)
        String googleIdToken = prefs.getString("idToken", "");
        if (!googleIdToken.isEmpty()) {
            Log.d(TAG, "Using Google ID token (may be expired)");
            // Try to refresh Google ID token
            refreshGoogleIdToken();
            googleIdToken = prefs.getString("idToken", "");
            if (!googleIdToken.isEmpty()) {
                return googleIdToken;
            }
        }
        
        Log.w(TAG, "No valid authentication token available");
        return null;
    }
    
    /**
     * Refresh the backend JWT token before it expires.
     */
    private void refreshBackendToken(String currentToken) {
        try {
            Request request = new Request.Builder()
                    .url(BASE_URL + "/api/refresh-token")
                    .addHeader("Authorization", "Bearer " + currentToken)
                    .post(RequestBody.create("{}", MediaType.get("application/json")))
                    .build();
            
            client.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.w(TAG, "Failed to refresh backend token", e);
                }
                
                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    if (response.isSuccessful()) {
                        try {
                            String body = response.body().string();
                            JSONObject json = new JSONObject(body);
                            String newToken = json.getString("token");
                            long newExpiry = json.getLong("tokenExpiry");
                            
                            prefs.edit()
                                    .putString("authToken", newToken)
                                    .putLong("tokenExpiry", newExpiry)
                                    .apply();
                            
                            Log.d(TAG, "Backend token refreshed successfully");
                        } catch (Exception e) {
                            Log.w(TAG, "Error parsing token refresh response", e);
                        }
                    } else {
                        Log.w(TAG, "Token refresh failed: " + response.code());
                    }
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "Error refreshing backend token", e);
        }
    }
    
    /**
     * Attempt to refresh Google ID token using silent sign-in.
     */
    private void refreshGoogleIdToken() {
        try {
            GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(appContext);
            if (account != null && account.getIdToken() != null) {
                prefs.edit().putString("idToken", account.getIdToken()).apply();
                Log.d(TAG, "Google ID token retrieved from cached account");
                return;
            }
            
            // Try silent sign-in (async, may not complete in time for current request)
            googleClient.silentSignIn().addOnSuccessListener(acct -> {
                if (acct != null && acct.getIdToken() != null) {
                    prefs.edit().putString("idToken", acct.getIdToken()).apply();
                    Log.d(TAG, "Google ID token refreshed via silent sign-in");
                }
            }).addOnFailureListener(err -> Log.w(TAG, "Silent sign-in failed", err));
        } catch (Exception e) {
            Log.w(TAG, "Unable to refresh Google ID token", e);
        }
    }
    
    public void sendLocationUpdate(double latitude, double longitude, float accuracy, ApiCallback callback) {
        try {
            String userId = prefs.getString("userId", "");
            String deviceName = prefs.getString("deviceName", "Android Device");
            String deviceFingerprint = prefs.getString("deviceFingerprint", "");
            
            Log.d(TAG, "Preparing location update - userId: '" + userId + "', deviceName: '" + deviceName + "'");
            
            // Get authentication token
            String authToken = getAuthToken();
            if (authToken == null || authToken.isEmpty()) {
                Log.e(TAG, "No valid authentication token - user needs to re-login");
                callback.onError("User not logged in");
                return;
            }
            
            // Create JSON payload
            JSONObject json = new JSONObject();
            json.put("latitude", latitude);
            json.put("longitude", longitude);
            json.put("accuracy", accuracy);
            json.put("deviceName", deviceName);
            json.put("fingerprint", deviceFingerprint);
            json.put("timestamp", System.currentTimeMillis());
            json.put("battery", getBatteryLevel());
            json.put("charging", isCharging());
            
            RequestBody body = RequestBody.create(
                json.toString(),
                MediaType.get("application/json; charset=utf-8")
            );
            
            Request request = new Request.Builder()
                .url(BASE_URL + "/api/location-update-app")
                .addHeader("User-Agent", userAgent)
                .addHeader("X-Device-Fingerprint", deviceFingerprint)
                .addHeader("Authorization", "Bearer " + authToken)
                .post(body)
                .build();
            
            client.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "Network error sending location", e);
                    callback.onError(e.getMessage());
                }
                
                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    String responseBody = response.body().string();
                    
                    if (response.isSuccessful()) {
                        Log.d(TAG, "Location sent successfully: " + responseBody);
                        callback.onSuccess(responseBody);
                    } else if (response.code() == 401) {
                        // Token expired or invalid - clear tokens and notify
                        Log.w(TAG, "Authentication failed (401) - clearing tokens");
                        prefs.edit()
                                .remove("authToken")
                                .remove("tokenExpiry")
                                .remove("idToken")
                                .apply();
                        callback.onError("Authentication expired - please re-login");
                    } else {
                        Log.e(TAG, "Server error: " + response.code() + " - " + responseBody);
                        callback.onError("Server error: " + response.code());
                    }
                }
            });
            
        } catch (Exception e) {
            Log.e(TAG, "Error creating location request", e);
            callback.onError(e.getMessage());
        }
    }
    
    private int getBatteryLevel() {
        try {
            android.content.Intent batteryIntent = appContext.registerReceiver(null,
                    new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
            if (batteryIntent != null) {
                int level = batteryIntent.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryIntent.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
                if (level >= 0 && scale > 0) {
                    return (int) ((level / (float) scale) * 100);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error getting battery level", e);
        }
        return -1;
    }
    
    private boolean isCharging() {
        try {
            android.content.Intent batteryIntent = appContext.registerReceiver(null,
                    new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
            if (batteryIntent != null) {
                int status = batteryIntent.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
                return status == android.os.BatteryManager.BATTERY_STATUS_CHARGING ||
                        status == android.os.BatteryManager.BATTERY_STATUS_FULL;
            }
        } catch (Exception e) {
            Log.w(TAG, "Error getting charging status", e);
        }
        return false;
    }
}
