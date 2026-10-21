package at.alpiplan.plugins.widget;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

final class WidgetUiBinder {
    private WidgetUiBinder() {}

    static void bindRows(Context context, RemoteViews views, int appWidgetId, JSONArray appointments) {
        int count = appointments.length();
        for (int index = 0; index < WidgetRowIds.ROWS.length; index++) {
            WidgetRowIds ids = WidgetRowIds.ROWS[index];
            if (index >= count) {
                views.setViewVisibility(ids.row, View.GONE);
                continue;
            }
            JSONObject item = appointments.optJSONObject(index);
            if (item == null) {
                views.setViewVisibility(ids.row, View.GONE);
                continue;
            }
            views.setViewVisibility(ids.row, View.VISIBLE);
            views.setTextViewText(ids.time, item.optString("timeLabel", ""));
            views.setTextViewText(ids.title, item.optString("title", "Termin"));

            String appointmentId = item.optString("id");
            String phone = item.optString("phone", "").trim();
            String status = item.optString("status", "");
            boolean canCall = !phone.isEmpty();
            boolean canComplete = !"completed".equals(status) && !"cancelled".equals(status);

            views.setViewVisibility(ids.call, canCall ? View.VISIBLE : View.GONE);
            views.setViewVisibility(ids.complete, canComplete ? View.VISIBLE : View.GONE);

            if (canCall) {
                views.setOnClickPendingIntent(
                    ids.call,
                    actionPendingIntent(context, appWidgetId, appointmentId, WidgetActionReceiver.ACTION_CALL, index * 2));
            }
            if (canComplete) {
                views.setOnClickPendingIntent(
                    ids.complete,
                    actionPendingIntent(context, appWidgetId, appointmentId, WidgetActionReceiver.ACTION_COMPLETE, index * 2 + 1));
            }
        }
    }

    private static PendingIntent actionPendingIntent(
        Context context, int appWidgetId, String appointmentId, String action, int requestCode) {
        Intent intent = new Intent(context, WidgetActionReceiver.class);
        intent.setAction(WidgetActionReceiver.ACTION_ITEM);
        intent.putExtra(WidgetActionReceiver.EXTRA_APPOINTMENT_ID, appointmentId);
        intent.putExtra(WidgetActionReceiver.EXTRA_ACTION, action);
        return PendingIntent.getBroadcast(
            context,
            appWidgetId * 100 + requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
