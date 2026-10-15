package at.alpiplan.plugins.callhints;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.telephony.TelephonyManager;

/**
 * Remembers the number of the call that is ringing or in progress. The call log only gets the
 * entry after hang-up, so this is the only way to suggest the number during the call.
 * The number never leaves the device.
 */
public class CallStateReceiver extends BroadcastReceiver {

    static final String PREFS = "alpiplan.callhints";
    static final String KEY_NUMBER = "activeNumber";
    static final String KEY_STATE = "activeState";
    static final String KEY_SINCE = "activeSince";

    /** Set by the plugin while the app runs so the form can refresh right away. */
    static volatile Runnable onChange;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) {
            return;
        }
        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        if (state == null) {
            return;
        }
        // Android sends the broadcast twice; only the copy for READ_CALL_LOG holders carries the number.
        @SuppressWarnings("deprecation")
        String number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
            editor.remove(KEY_NUMBER).remove(KEY_STATE).remove(KEY_SINCE);
        } else {
            editor.putString(KEY_STATE, state);
            if (!prefs.contains(KEY_SINCE)) {
                editor.putLong(KEY_SINCE, System.currentTimeMillis());
            }
            if (number != null && !number.trim().isEmpty()) {
                editor.putString(KEY_NUMBER, number.trim());
            }
        }
        editor.apply();

        Runnable listener = onChange;
        if (listener != null) {
            listener.run();
        }
    }
}
