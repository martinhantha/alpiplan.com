package at.alpiplan.plugins.callhints;

import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Phone suggestions from calls seen while Alpiplan is the caller ID & spam app
 * (RoleManager.ROLE_CALL_SCREENING). Needs no call log or phone state permission.
 */
@CapacitorPlugin(name = "CallHints")
public class CallHintsPlugin extends Plugin {

    /** Only treat the newest call as "in progress" if it started recently. */
    private static final long ACTIVE_CALL_MAX_AGE_MS = 4L * 60 * 60 * 1000;
    /** The system stops showing the role dialog after repeated declines, so stop auto-asking after one. */
    private static final String KEY_ROLE_DECLINED = "roleDeclined";

    @Override
    public void load() {
        CallHistory.onChange = () -> notifyListeners("callStateChanged", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        CallHistory.onChange = null;
    }

    private RoleManager roleManager() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return null;
        }
        RoleManager manager = getContext().getSystemService(RoleManager.class);
        if (manager == null || !manager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
            return null;
        }
        return manager;
    }

    private boolean roleHeld() {
        RoleManager manager = roleManager();
        return manager != null && manager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING);
    }

    private JSObject permissionStatus() {
        String state;
        if (roleHeld()) {
            state = PermissionState.GRANTED.toString();
        } else if (roleManager() == null || CallHistory.prefs(getContext()).getBoolean(KEY_ROLE_DECLINED, false)) {
            state = PermissionState.DENIED.toString();
        } else {
            state = PermissionState.PROMPT.toString();
        }
        JSObject result = new JSObject();
        result.put("callerId", state);
        return result;
    }

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionStatus());
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        RoleManager manager = roleManager();
        if (manager == null || roleHeld()) {
            call.resolve(permissionStatus());
            return;
        }
        Intent intent = manager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING);
        startActivityForResult(call, intent, "callerIdRoleResult");
    }

    @ActivityCallback
    private void callerIdRoleResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        CallHistory.prefs(getContext()).edit().putBoolean(KEY_ROLE_DECLINED, !roleHeld()).apply();
        call.resolve(permissionStatus());
    }

    @PluginMethod
    public void openCallerIdSettings(PluginCall call) {
        Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception exception) {
            call.reject("Default app settings unavailable", exception);
        }
    }

    private boolean callInProgress() {
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) {
            return false;
        }
        int mode = audio.getMode();
        return mode == AudioManager.MODE_RINGTONE || mode == AudioManager.MODE_IN_CALL;
    }

    @PluginMethod
    public void getRecentCallHints(PluginCall call) {
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
        if (roleHeld()) {
            JSONArray history = CallHistory.load(getContext());
            boolean inCall = callInProgress();
            long now = System.currentTimeMillis();
            for (int i = 0; i < history.length() && hints.length() < limit; i++) {
                JSONObject entry = history.optJSONObject(i);
                if (entry == null) {
                    continue;
                }
                String raw = entry.optString("raw");
                String normalized = CallHistory.normalize(raw);
                if (normalized.isEmpty()) {
                    continue;
                }
                long at = entry.optLong("at");
                boolean active = i == 0 && inCall && now - at < ACTIVE_CALL_MAX_AGE_MS;

                JSObject hint = new JSObject();
                hint.put("raw", raw);
                if (normalized.startsWith("+")) {
                    hint.put("e164", normalized);
                }
                hint.put("lastSeenAt", iso.format(new Date(at)));
                hint.put("confidence", active ? 1.0 : Math.max(0.4, 1.0 - hints.length() * 0.1));
                if (active) {
                    hint.put("active", true);
                }
                hints.put(hint);
            }
        }

        JSObject result = new JSObject();
        result.put("hints", hints);
        call.resolve(result);
    }
}
