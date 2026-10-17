import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { H3Event } from "h3";
import { getCookie, getRequestHeader, getRequestURL } from "h3";
import { PasswordTokenPurpose } from "@prisma/client";
import { prisma } from "~/server/utils/prisma";
import { sendTemplatedEmail } from "~/server/utils/mailer";
import { throwApiError, throwNotFound, throwValidation } from "~/server/utils/api-errors";
import { normalizeEmailLocale } from "~/server/email/render";
import type { EmailLocale } from "~/server/email/templates";

export const MIN_PASSWORD_LENGTH = 6;

const SELF_RESET_TTL_MIN = 60;
const ADMIN_RESET_TTL_MIN = 24 * 60;
const SETUP_TTL_MIN = 7 * 24 * 60;
/** a new self-service mail is only sent once per window, so the endpoint cannot be used to spam inboxes */
const SELF_RESET_THROTTLE_MS = 2 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function appBaseUrl(event: H3Event): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throwApiError(500, "VALIDATION_ERROR", "APP_URL ist nicht konfiguriert – Links können nicht erzeugt werden");
  }
  return getRequestURL(event).origin;
}

export function requestLocale(event: H3Event): EmailLocale {
  return normalizeEmailLocale(
    getCookie(event, "alpiplan.locale") || getRequestHeader(event, "accept-language"),
  );
}

function expiresInText(minutes: number, locale: EmailLocale): string {
  const days = minutes / (24 * 60);
  const hours = minutes / 60;
  const units = {
    de: { day: ["Tag", "Tage"], hour: ["Stunde", "Stunden"], minute: ["Minute", "Minuten"] },
    en: { day: ["day", "days"], hour: ["hour", "hours"], minute: ["minute", "minutes"] },
    it: { day: ["giorno", "giorni"], hour: ["ora", "ore"], minute: ["minuto", "minuti"] },
  }[locale];
  const [value, [one, many]] = Number.isInteger(days)
    ? [days, units.day]
    : Number.isInteger(hours)
      ? [hours, units.hour]
      : [minutes, units.minute];
  return `${value} ${value === 1 ? one : many}`;
}

async function createPasswordToken(params: {
  userId: string;
  purpose: PasswordTokenPurpose;
  ttlMinutes: number;
  createdByUserId?: string | null;
}): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordToken.deleteMany({ where: { userId: params.userId, usedAt: null } }),
    prisma.passwordToken.create({
      data: {
        userId: params.userId,
        purpose: params.purpose,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + params.ttlMinutes * 60 * 1000),
        createdByUserId: params.createdByUserId ?? null,
      },
    }),
  ]);
  return raw;
}

function actionUrl(event: H3Event, rawToken: string): string {
  return `${appBaseUrl(event)}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

/** Self-service "Passwort vergessen". Never reveals whether the address exists. */
export async function requestPasswordReset(event: H3Event, emailInput: unknown): Promise<void> {
  const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    throwValidation("Gültige E-Mail ist erforderlich", { field: "email" });
  }

  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null, disabledAt: null },
    select: { id: true, email: true, name: true },
  });
  if (!user) return;

  const recent = await prisma.passwordToken.findFirst({
    where: {
      userId: user.id,
      usedAt: null,
      createdAt: { gt: new Date(Date.now() - SELF_RESET_THROTTLE_MS) },
    },
    select: { id: true },
  });
  if (recent) return;

  const locale = requestLocale(event);
  const raw = await createPasswordToken({
    userId: user.id,
    purpose: PasswordTokenPurpose.reset,
    ttlMinutes: SELF_RESET_TTL_MIN,
  });
  try {
    await sendTemplatedEmail({
      to: user.email,
      template: "password-reset",
      locale,
      vars: {
        name: user.name?.trim() || user.email,
        actionUrl: actionUrl(event, raw),
        expiresInText: expiresInText(SELF_RESET_TTL_MIN, locale),
      },
    });
  } catch (error) {
    console.error("[mail] Passwort-Reset-Mail fehlgeschlagen", error);
  }
}

export interface PasswordLinkResult {
  purpose: PasswordTokenPurpose;
  delivered: boolean;
  /** only outside production and without SMTP, so the link can be tested locally */
  actionUrl?: string;
}

/**
 * Admin-triggered link: "setup" (invite) when the user has no password yet, otherwise "reset".
 * Caller is responsible for the permission check on the target user.
 */
export async function sendPasswordLink(
  event: H3Event,
  params: { userId: string; actor: { id: string; name: string | null; email: string; isSuperadmin: boolean }; tenantName?: string | null },
): Promise<PasswordLinkResult> {
  const user = await prisma.user.findFirst({
    where: { id: params.userId, deletedAt: null },
    select: { id: true, email: true, name: true, passwordHash: true, disabledAt: true, isSuperadmin: true },
  });
  if (!user) {
    throwNotFound("Benutzer nicht gefunden", { userId: params.userId });
  }
  if (user.disabledAt) {
    throwValidation("Benutzer ist gesperrt – bitte zuerst entsperren");
  }
  if (user.isSuperadmin && !params.actor.isSuperadmin) {
    throwApiError(403, "FORBIDDEN", "Für Superadmins kann kein Passwort-Link versendet werden");
  }

  const purpose = user.passwordHash ? PasswordTokenPurpose.reset : PasswordTokenPurpose.setup;
  const ttl = purpose === PasswordTokenPurpose.setup ? SETUP_TTL_MIN : ADMIN_RESET_TTL_MIN;
  const locale = requestLocale(event);
  const raw = await createPasswordToken({
    userId: user.id,
    purpose,
    ttlMinutes: ttl,
    createdByUserId: params.actor.id,
  });
  const url = actionUrl(event, raw);
  const common = {
    name: user.name?.trim() || user.email,
    actionUrl: url,
    expiresInText: expiresInText(ttl, locale),
  };

  let delivered: boolean;
  try {
    delivered =
      purpose === PasswordTokenPurpose.setup
        ? await sendTemplatedEmail({
            to: user.email,
            template: "password-setup",
            locale,
            vars: {
              ...common,
              email: user.email,
              inviterName: params.actor.name?.trim() || params.actor.email,
              tenantName: params.tenantName?.trim() || "Alpiplan",
            },
          })
        : await sendTemplatedEmail({ to: user.email, template: "password-reset", locale, vars: common });
  } catch (error) {
    console.error("[mail] Passwort-Link-Mail fehlgeschlagen", error);
    throwApiError(502, "VALIDATION_ERROR", "E-Mail konnte nicht versendet werden – bitte SMTP-Einstellungen prüfen");
  }

  const exposeLink = !delivered && process.env.NODE_ENV !== "production";
  return { purpose, delivered, ...(exposeLink ? { actionUrl: url } : {}) };
}

async function findValidToken(rawToken: unknown) {
  if (typeof rawToken !== "string" || rawToken.length < 20) return null;
  const token = await prisma.passwordToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      purpose: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { id: true, email: true, deletedAt: true, disabledAt: true } },
    },
  });
  if (!token || token.usedAt || token.expiresAt.getTime() <= Date.now()) return null;
  if (token.user.deletedAt || token.user.disabledAt) return null;
  return token;
}

export async function inspectPasswordToken(rawToken: unknown) {
  const token = await findValidToken(rawToken);
  if (!token) return { valid: false as const };
  return { valid: true as const, purpose: token.purpose, email: token.user.email };
}

/** Sets the new password and invalidates all open links of that user. Returns the user id. */
export async function consumePasswordToken(rawToken: unknown, passwordInput: unknown): Promise<string> {
  const password = typeof passwordInput === "string" ? passwordInput : "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    throwValidation(`Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben`, { field: "password" });
  }
  const token = await findValidToken(rawToken);
  if (!token) {
    throwApiError(400, "VALIDATION_ERROR", "Der Link ist ungültig oder abgelaufen", { field: "token" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throwApiError(400, "VALIDATION_ERROR", "Der Link wurde bereits verwendet", { field: "token" });
    }
    await tx.user.update({ where: { id: token.user.id }, data: { passwordHash } });
    await tx.passwordToken.deleteMany({ where: { userId: token.user.id, usedAt: null } });
  });
  return token.user.id;
}
