package com.devicetracker;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class LocationWatchdogWorker extends Worker {

    public LocationWatchdogWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            Context ctx = getApplicationContext();
            Intent intent = new Intent(ctx, LocationTrackingService.class);
            intent.setPackage(ctx.getPackageName());

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
            Log.d("LocationWatchdog", "Ensured LocationTrackingService is running");
            return Result.success();
        } catch (Exception e) {
            Log.e("LocationWatchdog", "Failed to start service", e);
            return Result.retry();
        }
    }
}
