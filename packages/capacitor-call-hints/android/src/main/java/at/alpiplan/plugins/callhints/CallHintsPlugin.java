package at.alpiplan.plugins.callhints;

import android.Manifest;
import android.content.Context;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.provider.CallLog;
import android.telephony.TelephonyManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

@CapacitorPlugin(
    name = "CallHints",
    permissions = {
        @Permission(alias = "callLog", strings = { Manifest.permission.READ_CALL_LOG }),
        @Permission(alias = "phoneState", strings = { Manifest.permission.READ_PHONE_STATE })
    }
)
public class CallHintsPlugin extends Plugin {

    /** Ignore a stale "in call" marker if the hang-up broadcast was missed. */
    private static final long ACTIVE_CALL_MAX_AGE_MS = 4L * 60 * 60 * 1000;

    private CallStateReceiver liveReceiver;

    @Override
    public void load() {
        // The manifest receiver is not woken up for this broadcast on every Android version,
        // so also listen while the app process is alive.
        liveReceiver = new CallStateReceiver();
        ContextCompat.registerReceiver(
            getContext(),
            liveReceiver,
            new IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED),
            ContextCompat.RECEIVER_EXPORTED
        );
        CallStateReceiver.onChange = () -> notifyListeners("callStateChanged", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        CallStateReceiver.onChange = null;
        if (liveReceiver != null) {
            try {
                getContext().unregisterReceiver(liveReceiver);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered.
            }
            liveReceiver = null;
        }
    }

    @PluginMethod
    public void getRecentCallHints(PluginCall call) {
        if (
            getPermissionState("callLog") != PermissionState.GRANTED ||
            getPermissionState("phoneState") == PermissionState.PROMPT
        ) {
            requestPermissionForAliases(new String[] { "callLog", "phoneState" }, call, "callLogPermsCallback");
            return;
        }
        fetchHints(call);
    }

    @PermissionCallback
    private void callLogPermsCallback(PluginCall call) {
        if (getPermissionState("callLog") == PermissionState.GRANTED) {
            fetchHints(call);
        } else {
            call.reject("READ_CALL_LOG permission denied");
        }
    }

    private static String normalize(String raw) {
        return raw.replaceAll("[^+0-9]", "");
    }

    private JSObject activeCallHint(SimpleDateFormat iso) {
        if (getPermissionState("phoneState") != PermissionState.GRANTED) {
            return null;
        }
        SharedPreferences prefs = getContext().getSharedPreferences(CallStateReceiver.PREFS, Context.MODE_PRIVATE);
        String number = prefs.getString(CallStateReceiver.KEY_NUMBER, null);
        long since = prefs.getLong(CallStateReceiver.KEY_SINCE, 0);
        if (number == null || since == 0 || System.currentTimeMillis() - since > ACTIVE_CALL_MAX_AGE_MS) {
            return null;
        }
        TelephonyManager telephony = (TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
        try {
            if (telephony != null && telephony.getCallState() == TelephonyManager.CALL_STATE_IDLE) {
                return null;
            }
        } catch (SecurityException ignored) {
            // Fall back to the stored state.
        }
        String normalized = normalize(number);
        if (normalized.isEmpty()) {
            return null;
        }
        JSObject hint = new JSObject();
        hint.put("raw", number);
        if (normalized.startsWith("+")) {
            hint.put("e164", normalized);
        }
        hint.put("lastSeenAt", iso.format(new Date(since)));
        hint.put("confidence", 1.0);
        hint.put("active", true);
        return hint;
    }

    private void fetchHints(PluginCall call) {
        int limit = call.getInt("limit", 5);
        if (limit < 1) {
            limit = 1;
        }
        if (limit > 20) {
            limit = 20;
        }

        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));

        JSArray hints = new JSArray();
        String activeNormalized = null;
        JSObject active = activeCallHint(iso);
        if (active != null) {
            hints.put(active);
            activeNormalized = normalize(active.getString("raw"));
        }

        String[] projection = new String[] { CallLog.Calls.NUMBER, CallLog.Calls.DATE };

        try (
            Cursor cursor = getContext()
                .getContentResolver()
                .query(
                    CallLog.Calls.CONTENT_URI,
                    projection,
                    CallLog.Calls.NUMBER + " IS NOT NULL AND " + CallLog.Calls.NUMBER + " != ''",
                    null,
                    CallLog.Calls.DATE + " DESC"
                )
        ) {
            if (cursor != null) {
                int rank = 0;

                while (cursor.moveToNext() && hints.length() < limit) {
                    String number = cursor.getString(0);
                    if (number == null) {
                        continue;
                    }
                    String raw = number.trim();
                    String normalized = normalize(raw);
                    if (normalized.isEmpty() || normalized.equals(activeNormalized)) {
                        continue;
                    }

                    JSObject hint = new JSObject();
                    hint.put("raw", raw);
                    if (normalized.startsWith("+")) {
                        hint.put("e164", normalized);
                    }
                    hint.put("lastSeenAt", iso.format(new Date(cursor.getLong(1))));
                    hint.put("confidence", Math.max(0.4, 1.0 - rank * 0.1));
                    hints.put(hint);
                    rank++;
                }
            }
        } catch (Exception exception) {
            call.reject("Failed to read call hints", exception);
            return;
        }

        JSObject result = new JSObject();
        result.put("hints", hints);
        call.resolve(result);
    }
}
