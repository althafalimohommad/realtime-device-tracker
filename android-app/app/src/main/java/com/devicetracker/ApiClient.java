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
    
    private final OkHttpClient client;
    private final SharedPreferences prefs;
    private final String userAgent;
    private final GoogleSignInClient googleClient;
    private final Context appContext;
    private static final String SERVER_CLIENT_ID = " 31793728596-s6g87ot3785i62i48s7emh2nk3cbk6dv.apps.googleusercontent.com"; // TODO set from Google Cloud OAuth client (Web)
    
    public interface ApiCallback {
        void onSuccess(String response);
        void onError(String error);
    }
    
    public ApiClient(Context context) {
        this.client = new OkHttpClient();
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
    
    public void sendLocationUpdate(double latitude, double longitude, float accuracy, ApiCallback callback) {
        try {
            String userId = prefs.getString("userId", "");
            String deviceName = prefs.getString("deviceName", "Android Device");
            String deviceFingerprint = prefs.getString("deviceFingerprint", "");
            String idToken = prefs.getString("idToken", "");
            
            Log.d(TAG, "Attempting to send location - userId: '" + userId + "', deviceName: '" + deviceName + "', fp: '" + deviceFingerprint + "'");
            
            if (idToken.isEmpty()) {
                refreshIdToken();
                idToken = prefs.getString("idToken", "");
                if (idToken.isEmpty()) {
                    callback.onError("User not logged in");
                    return;
                }
            }
            
            // Create JSON payload
            JSONObject json = new JSONObject();
            json.put("latitude", latitude);
            json.put("longitude", longitude);
            json.put("accuracy", accuracy);
            json.put("deviceName", deviceName);
            json.put("fingerprint", deviceFingerprint);
            json.put("timestamp", System.currentTimeMillis());
            
            // Get battery info
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
                .addHeader("Authorization", "Bearer " + idToken)
                .post(body)
                .build();
            
            client.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "Network error", e);
                    callback.onError(e.getMessage());
                }
                
                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    String responseBody = response.body().string();
                    
                    if (response.isSuccessful()) {
                        callback.onSuccess(responseBody);
                    } else {
                        callback.onError("Server error: " + response.code());
                    }
                }
            });
            
        } catch (Exception e) {
            Log.e(TAG, "Error creating request", e);
            callback.onError(e.getMessage());
        }
    }
    
    private int getBatteryLevel() {
        // Simplified battery level - you can enhance this
        return 50;
    }
    
    private boolean isCharging() {
        // Simplified charging status - you can enhance this
        return false;
    }

    private void refreshIdToken() {
        try {
            GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(appContext);
            if (account != null && account.getIdToken() != null) {
                prefs.edit().putString("idToken", account.getIdToken()).apply();
                return;
            }

            googleClient.silentSignIn().addOnSuccessListener(acct -> {
                if (acct != null && acct.getIdToken() != null) {
                    prefs.edit().putString("idToken", acct.getIdToken()).apply();
                }
            }).addOnFailureListener(err -> Log.w(TAG, "Silent sign-in failed", err));
        } catch (Exception e) {
            Log.w(TAG, "Unable to refresh ID token", e);
        }
    }
}
