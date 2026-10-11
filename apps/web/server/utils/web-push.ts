import webpush, { type PushSubscription } from "web-push";

type VapidConfig = { publicKey: string; privateKey: string; subject: string };

let appliedVapidKey = "";

function vapidConfig(): VapidConfig | null {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  // Apple rejects VAPID tokens without a contact subject.
  const subject = process.env.WEB_PUSH_SUBJECT?.trim() || "mailto:support@alpiplan.com";
  return { publicKey, privateKey, subject };
}

export function webPushPublicKey(): string | null {
  return vapidConfig()?.publicKey ?? null;
}

export function isWebPushConfigured(): boolean {
  return vapidConfig() !== null;
}

/** Parses the JSON stored as `DevicePushToken.token` for `platform = "web"`. */
export function parseWebPushSubscription(raw: string): PushSubscription | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PushSubscription>;
    const endpoint = typeof parsed.endpoint === "string" ? parsed.endpoint : "";
    const p256dh = parsed.keys?.p256dh;
    const auth = parsed.keys?.auth;
    if (!endpoint.startsWith("https://") || typeof p256dh !== "string" || typeof auth !== "string") return null;
    return { endpoint, keys: { p256dh, auth } };
  } catch {
    return null;
  }
}

/** Canonical form stored in the DB, so the same subscription always maps to the same unique token. */
export function normalizeWebPushToken(raw: string): string | null {
  const subscription = parseWebPushSubscription(raw);
  return subscription ? JSON.stringify(subscription) : null;
}

export async function sendWebPushMessage(
  rawSubscription: string,
  payload: { title: string; body: string; tag?: string; data: Record<string, string> },
): Promise<"ok" | "gone" | "error"> {
  const config = vapidConfig();
  if (!config) return "error";
  const subscription = parseWebPushSubscription(rawSubscription);
  if (!subscription) return "gone";
  if (appliedVapidKey !== config.publicKey) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    appliedVapidKey = config.publicKey;
  }
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 60 * 60,
      urgency: "high",
    });
    return "ok";
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) return "gone";
    console.warn("[push] web push failed", statusCode, (error as Error).message?.slice(0, 200));
    return "error";
  }
}
