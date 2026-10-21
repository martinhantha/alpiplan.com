package at.alpiplan.plugins.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.widget.RemoteViews;

/** Adapts fonts and visible rows to the launcher grid size (e.g. 3×2 vs 4×4). */
final class WidgetSizeProfile {
    final int visibleRows;
    final float headerTitleSp;
    final float refreshSp;
    final float emptySp;
    final float timeSp;
    final float rowTitleSp;
    final float buttonSp;
    final int rootPaddingDp;
    final boolean compactLabels;

    private WidgetSizeProfile(
        int visibleRows,
        float headerTitleSp,
        float refreshSp,
        float emptySp,
        float timeSp,
        float rowTitleSp,
        float buttonSp,
        int rootPaddingDp,
        boolean compactLabels) {
        this.visibleRows = visibleRows;
        this.headerTitleSp = headerTitleSp;
        this.refreshSp = refreshSp;
        this.emptySp = emptySp;
        this.timeSp = timeSp;
        this.rowTitleSp = rowTitleSp;
        this.buttonSp = buttonSp;
        this.rootPaddingDp = rootPaddingDp;
        this.compactLabels = compactLabels;
    }

    static WidgetSizeProfile forWidget(Context context, AppWidgetManager manager, int appWidgetId) {
        int widthDp = 250;
        int heightDp = 110;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            Bundle options = manager.getAppWidgetOptions(appWidgetId);
            if (options != null) {
                widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, widthDp);
                heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, heightDp);
            }
        }
        return fromDimensions(widthDp, heightDp);
    }

    static WidgetSizeProfile fromDimensions(int widthDp, int heightDp) {
        // 3×2 on One UI ≈ 180×110 dp — one appointment row, smaller type.
        if (heightDp <= 125 || (widthDp <= 200 && heightDp <= 150)) {
            return new WidgetSizeProfile(1, 12f, 10f, 11f, 9f, 11f, 9f, 6, true);
        }
        if (heightDp <= 195 || widthDp <= 220) {
            return new WidgetSizeProfile(2, 13f, 10f, 12f, 10f, 12f, 9f, 7, true);
        }
        return new WidgetSizeProfile(WidgetConfig.VISIBLE_ROWS, 14f, 11f, 13f, 11f, 13f, 10f, 8, false);
    }

    void applyTextSizes(RemoteViews views) {
        setSp(views, R.id.widget_title, headerTitleSp);
        setSp(views, R.id.widget_refresh, refreshSp);
        setSp(views, R.id.widget_empty, emptySp);
        for (WidgetRowIds ids : WidgetRowIds.ROWS) {
            setSp(views, ids.time, timeSp);
            setSp(views, ids.title, rowTitleSp);
            setSp(views, ids.call, buttonSp);
            setSp(views, ids.whatsapp, buttonSp);
            setSp(views, ids.complete, buttonSp);
        }
    }

    void applyRootPadding(Context context, RemoteViews views) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return;
        }
        float density = context.getResources().getDisplayMetrics().density;
        int pad = Math.round(rootPaddingDp * density);
        views.setViewPadding(R.id.widget_root, pad, pad, pad, pad);
    }

    private static void setSp(RemoteViews views, int viewId, float sizeSp) {
        views.setTextViewTextSize(viewId, TypedValue.COMPLEX_UNIT_SP, sizeSp);
    }
}
