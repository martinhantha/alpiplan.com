package at.alpiplan.plugins.widget;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

final class WhatsAppIntents {
    private WhatsAppIntents() {}

    static void open(Context context, String phone, String app) {
        String digits = normalizeWhatsAppDigits(phone);
        if (digits.isEmpty()) {
            return;
        }
        String pkg = "business".equals(app) ? "com.whatsapp.w4b" : "com.whatsapp";
        Uri[] uris =
            new Uri[] {
                Uri.parse("whatsapp://send?phone=" + digits),
                Uri.parse("https://api.whatsapp.com/send?phone=" + digits),
                Uri.parse("https://wa.me/" + digits),
            };
        for (Uri uri : uris) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                intent.setPackage(pkg);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
                return;
            } catch (Exception ignored) {
                // Try next URI.
            }
        }
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.setPackage(pkg);
            send.putExtra("jid", digits + "@s.whatsapp.net");
            send.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(send);
        } catch (Exception ignored) {
            // WhatsApp not installed.
        }
    }

    private static String normalizeWhatsAppDigits(String phone) {
        if (phone == null) {
            return "";
        }
        String digits = phone.trim();
        if (digits.startsWith("00")) {
            digits = digits.substring(2);
        } else if (digits.startsWith("+")) {
            digits = digits.substring(1);
        }
        digits = digits.replaceAll("\\D", "");
        if (digits.startsWith("0") && digits.length() > 1) {
            digits = "43" + digits.substring(1);
        }
        return digits;
    }
}
