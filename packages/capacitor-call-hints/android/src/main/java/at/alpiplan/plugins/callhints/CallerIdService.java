package at.alpiplan.plugins.callhints;

import android.net.Uri;
import android.os.Build;
import android.telecom.Call;
import android.telecom.CallScreeningService;
import android.telecom.PhoneAccount;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

/**
 * Bound by Android for every incoming and outgoing call while Alpiplan holds the
 * caller ID & spam role. Calls are never blocked; only the number is remembered on the device.
 */
@RequiresApi(api = Build.VERSION_CODES.Q)
public class CallerIdService extends CallScreeningService {

    @Override
    public void onScreenCall(@NonNull Call.Details details) {
        try {
            Uri handle = details.getHandle();
            if (handle != null && PhoneAccount.SCHEME_TEL.equals(handle.getScheme())) {
                CallHistory.record(this, handle.getSchemeSpecificPart());
            }
        } finally {
            // Incoming calls do not ring until we answer (or the 5 s timeout hits).
            if (details.getCallDirection() == Call.Details.DIRECTION_INCOMING) {
                respondToCall(details, new CallResponse.Builder().build());
            }
        }

        Runnable listener = CallHistory.onChange;
        if (listener != null) {
            listener.run();
        }
    }
}
