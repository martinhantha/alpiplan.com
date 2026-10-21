package at.alpiplan.plugins.widget;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.widget.RemoteViews;

final class WidgetTheme {
    private WidgetTheme() {}

    static boolean resolveDark(Context context) {
        if (WidgetStore.hasDarkModePreference(context)) {
            return WidgetStore.darkMode(context);
        }
        int nightMode = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return nightMode == Configuration.UI_MODE_NIGHT_YES;
    }

    static void apply(Context context, RemoteViews views) {
        boolean dark = resolveDark(context);
        views.setInt(R.id.widget_root, "setBackgroundResource", dark ? R.drawable.widget_background_dark : R.drawable.widget_background);
        views.setTextColor(R.id.widget_title, dark ? Color.parseColor("#F4F4F5") : Color.parseColor("#111827"));
        views.setTextColor(R.id.widget_empty, dark ? Color.parseColor("#A1A1AA") : Color.parseColor("#6B7280"));
        views.setInt(R.id.widget_refresh, "setBackgroundResource", dark ? R.drawable.widget_button_neutral_dark : R.drawable.widget_button_neutral);
        views.setTextColor(R.id.widget_refresh, dark ? Color.parseColor("#E4E4E7") : Color.parseColor("#374151"));

        int neutralBtn = dark ? R.drawable.widget_button_neutral_dark : R.drawable.widget_button_neutral;
        int successBtn = dark ? R.drawable.widget_button_success_dark : R.drawable.widget_button_success;
        int whatsappBtn = dark ? R.drawable.widget_button_whatsapp_dark : R.drawable.widget_button_whatsapp;
        int titleColor = dark ? Color.parseColor("#FAFAFA") : Color.parseColor("#111827");
        int timeColor = dark ? Color.parseColor("#A1A1AA") : Color.parseColor("#6B7280");
        int neutralText = dark ? Color.parseColor("#E4E4E7") : Color.parseColor("#374151");
        int successText = dark ? Color.parseColor("#86EFAC") : Color.parseColor("#166534");
        int whatsappText = dark ? Color.parseColor("#86EFAC") : Color.parseColor("#166534");

        for (WidgetRowIds ids : WidgetRowIds.ROWS) {
            views.setTextColor(ids.time, timeColor);
            views.setTextColor(ids.title, titleColor);
            views.setInt(ids.call, "setBackgroundResource", neutralBtn);
            views.setTextColor(ids.call, neutralText);
            views.setInt(ids.whatsapp, "setBackgroundResource", whatsappBtn);
            views.setTextColor(ids.whatsapp, whatsappText);
            views.setInt(ids.complete, "setBackgroundResource", successBtn);
            views.setTextColor(ids.complete, successText);
        }
    }
}
