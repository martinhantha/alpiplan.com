package at.alpiplan.plugins.callhints;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Numbers seen by {@link CallerIdService}, newest first. Stored only on the device. */
final class CallHistory {

    static final String PREFS = "alpiplan.callhints";
    private static final String KEY_HISTORY = "history";
    private static final int MAX_ENTRIES = 20;

    /** Set by the plugin while the app runs so the form can refresh right away. */
    static volatile Runnable onChange;

    private CallHistory() {}

    static String normalize(String raw) {
        return raw.replaceAll("[^+0-9]", "");
    }

    static synchronized void record(Context context, String number) {
        if (number == null) {
            return;
        }
        String raw = number.trim();
        String normalized = normalize(raw);
        if (normalized.isEmpty()) {
            return;
        }

        JSONArray previous = load(context);
        JSONArray next = new JSONArray();
        try {
            JSONObject entry = new JSONObject();
            entry.put("raw", raw);
            entry.put("at", System.currentTimeMillis());
            next.put(entry);
            for (int i = 0; i < previous.length() && next.length() < MAX_ENTRIES; i++) {
                JSONObject item = previous.optJSONObject(i);
                if (item != null && !normalized.equals(normalize(item.optString("raw")))) {
                    next.put(item);
                }
            }
        } catch (JSONException ignored) {
            return;
        }
        prefs(context).edit().putString(KEY_HISTORY, next.toString()).apply();
    }

    static synchronized JSONArray load(Context context) {
        String stored = prefs(context).getString(KEY_HISTORY, null);
        if (stored == null) {
            return new JSONArray();
        }
        try {
            return new JSONArray(stored);
        } catch (JSONException ignored) {
            return new JSONArray();
        }
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
