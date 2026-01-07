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
            "https://realtime-device-tracker-s9ua.onrender.com";

    private final OkHttpClient client;
    private final SharedPreferences prefs;
    private final String userAgent;

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

        Context appContext = context.getApplicationContext();
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

            if (jwt == null || userId == null) {
                Log.e(TAG, "JWT or userId missing");
                callback.onError("User not logged in");
                return;
            }

            // Validate JWT format (must have 3 parts separated by dots)
            if (!jwt.contains(".") || jwt.split("\\.").length != 3) {
                Log.e(TAG, "Invalid JWT format - clearing auth data");
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
}
