import { createError, readBody } from "h3";
import { restoreCookieSession } from "~/server/utils/auth-cookies";
import { prisma } from "~/server/utils/prisma";
import { loadUserWithMemberships, toAuthSession } from "~/server/utils/session";
import { throwValidation } from "~/server/utils/api-errors";

export default defineEventHandler(async (event) => {
  const session = await restoreCookieSession(event);
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: "Nicht angemeldet" });
  }

  const body = ((await readBody(event)) ?? {}) as {
    nextDayBriefingEnabled?: unknown;
    nextDayBriefingMinutes?: unknown;
    appointmentMovedAlertsEnabled?: unknown;
    appointmentReminderEnabled?: unknown;
  };
  const data: {
    nextDayBriefingEnabled?: boolean;
    nextDayBriefingMinutes?: number;
    appointmentMovedAlertsEnabled?: boolean;
    appointmentReminderEnabled?: boolean;
  } = {};
  if (body.appointmentReminderEnabled !== undefined) {
    if (typeof body.appointmentReminderEnabled !== "boolean") {
      throwValidation("Ungültiger Wert für die Terminerinnerung");
    }
    data.appointmentReminderEnabled = body.appointmentReminderEnabled;
  }
  if (body.appointmentMovedAlertsEnabled !== undefined) {
    if (typeof body.appointmentMovedAlertsEnabled !== "boolean") {
      throwValidation("Ungültiger Wert für die Verschiebe-Benachrichtigung");
    }
    data.appointmentMovedAlertsEnabled = body.appointmentMovedAlertsEnabled;
  }
  if (body.nextDayBriefingEnabled !== undefined) {
    if (typeof body.nextDayBriefingEnabled !== "boolean") {
      throwValidation("Ungültiger Wert für die Vortags-Info");
    }
    data.nextDayBriefingEnabled = body.nextDayBriefingEnabled;
  }
  if (body.nextDayBriefingMinutes !== undefined) {
    const minutes = body.nextDayBriefingMinutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
      throwValidation("Ungültige Uhrzeit für die Vortags-Info");
    }
    data.nextDayBriefingMinutes = minutes;
  }
  if (!Object.keys(data).length) {
    throwValidation("Keine Änderungen übermittelt");
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  });

  const user = await loadUserWithMemberships(session.user.id);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Nicht angemeldet" });
  }
  return toAuthSession(user);
});
