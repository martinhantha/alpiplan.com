package at.alpiplan.plugins.widget;

final class WidgetConfig {
    /** Upcoming appointments window for API refresh from the widget. */
    static final int LOOKAHEAD_DAYS = 120;
    /** Max appointments stored and shown (chronological). */
    static final int MAX_APPOINTMENTS = 3;
    /** Fixed rows in the widget layout (extra items are omitted). */
    static final int VISIBLE_ROWS = 3;

    private WidgetConfig() {}
}
