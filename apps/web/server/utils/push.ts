import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importPKCS8, SignJWT } from "jose";
import type { AppointmentLiveEvent } from "~/types/live-events";
import { prisma } from "~/server/utils/prisma";
import { getMonorepoRoot } from "~/server/utils/monorepo-root";
import { liveEventNotificationCopy, pushRecipientUserIds } from "~/utils/appointment-live-audience";

type CachedAccess = { token: string; expiresAt: number };
type FirebaseConfig = { projectId: string; clientEmail: string; privateKey: string };

const globalForFcm = globalThis as typeof globalThis & {
  alpiplanFcmAccess?: CachedAccess;
};

function parseServiceAccount(raw: string): FirebaseConfig | null {
  try {
    const parsed = JSON.parse(raw) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    const projectId = parsed.project_id?.trim();
    const clientEmail = parsed.client_email?.trim();
    const privateKey = parsed.private_key?.replace(/\\n/g, "\n").trim();
    if (!projectId || !clientEmail || !privateKey) return null;
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

function firebaseConfig(): FirebaseConfig | null {
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
  if (file) {
    try {
      const path = file.startsWith("/") ? file : resolve(getMonorepoRoot(), file);
      const fromFile = parseServiceAccount(readFileSync(path, "utf8"));
      if (fromFile) return fromFile;
      console.warn("[push] FIREBASE_SERVICE_ACCOUNT_FILE ist keine gültige Dienstkonto-JSON");
    } catch {
      console.warn("[push] FIREBASE_SERVICE_ACCOUNT_FILE konnte nicht gelesen werden");
    }
  }

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (inline) {
    const fromInline = parseServiceAccount(inline);
    if (fromInline) return fromInline;
    console.warn("[push] FIREBASE_SERVICE_ACCOUNT ist keine gültige Dienstkonto-JSON");
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    console.warn(
      "[push] FIREBASE_PRIVATE_KEY ist kein PEM-Schlüssel. In der heruntergeladenen Dienstkonto-JSON das Feld private_key verwenden (beginnt mit -----BEGIN PRIVATE KEY-----).",
    );
    return null;
  }
  return { projectId, clientEmail, privateKey };
}

export function isFirebasePushConfigured(): boolean {
  return firebaseConfig() !== null;
}

async function firebaseAccessToken(): Promise<string | null> {
  const config = firebaseConfig();
  if (!config) return null;
  const cached = globalForFcm.alpiplanFcmAccess;
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }
  try {
    const key = await importPKCS8(config.privateKey, "RS256");
    const assertion = await new SignJWT({
      iss: config.clientEmail,
      sub: config.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .setAudience("https://oauth2.googleapis.com/token")
      .sign(key);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) {
      console.warn("[push] Firebase access token failed", response.status);
      return null;
    }
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) return null;
    globalForFcm.alpiplanFcmAccess = {
      token: payload.access_token,
      expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
    };
    return payload.access_token;
  } catch (error) {
    console.warn("[push] Firebase access token error", error instanceof Error ? error.message : error);
    return null;
  }
}

async function sendFcmMessage(
  accessToken: string,
  projectId: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<"ok" | "gone" | "error"> {
  // Same id as the web layer's local notification, so iOS replaces instead of duplicating.
  const collapseId = data.appointmentId ? `${data.type}:${data.appointmentId}`.slice(0, 64) : undefined;
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data,
            android: {
              priority: "HIGH",
              notification: {
                channelId: "alpiplan_appointments",
                notificationCount: 1,
              },
            },
            apns: {
              headers: {
                "apns-priority": "10",
                ...(collapseId ? { "apns-collapse-id": collapseId } : {}),
              },
              payload: {
                aps: { sound: "default" },
              },
            },
          },
        }),
      },
    );
    if (response.ok) return "ok";
    const text = await response.text();
    if (response.status === 404 || /UNREGISTERED|NOT_FOUND/i.test(text)) return "gone";
    console.warn("[push] FCM send failed", response.status, text.slice(0, 300));
    return "error";
  } catch {
    return "error";
  }
}

export async function sendPushToUsers(input: {
  userIds: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}): Promise<{ sent: number }> {
  const config = firebaseConfig();
  if (!config) return { sent: 0 };
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (!userIds.length) return { sent: 0 };
  const rows = await prisma.devicePushToken.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, token: true },
  });
  if (!rows.length) {
    console.warn("[push] no registered device tokens for", userIds);
    return { sent: 0 };
  }
  const accessToken = await firebaseAccessToken();
  if (!accessToken) {
    console.warn("[push] could not get Firebase access token");
    return { sent: 0 };
  }
  const stale: string[] = [];
  const results = await Promise.all(
    rows.map(async (row) => {
      const result = await sendFcmMessage(
        accessToken,
        config.projectId,
        row.token,
        input.title,
        input.body,
        input.data,
      );
      if (result === "gone") stale.push(row.id);
      return result;
    }),
  );
  if (stale.length) {
    await prisma.devicePushToken.deleteMany({ where: { id: { in: stale } } });
  }
  return { sent: results.filter((result) => result === "ok").length };
}

export async function sendAppointmentPush(event: AppointmentLiveEvent): Promise<void> {
  const userIds = pushRecipientUserIds(event);
  if (!userIds.length) return;
  const copy = liveEventNotificationCopy(event);
  await sendPushToUsers({
    userIds,
    title: copy.title,
    body: copy.body,
    data: {
      type: event.type,
      appointmentId: event.appointmentId,
      tenantId: event.tenantId,
    },
  });
}
