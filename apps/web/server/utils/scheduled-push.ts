import { AppointmentStatus, Prisma } from "@prisma/client";
import { prisma } from "~/server/utils/prisma";
import { sendPushToUsers, isPushConfigured } from "~/server/utils/push";
import { assignedTeachersFromAppointment } from "~/utils/appointment-live-audience";
import { resolveAppointmentDisplayName } from "~/utils/appointment-contact";
import {
  addCalendarDays,
  BUSINESS_TIME_ZONE,
  dateKey,
  minutesOfDay,
  REMINDER_LEAD_MS,
  tzParts,
  zonedLocalDate,
} from "~/utils/rome-time";

const globalForSched = globalThis as typeof globalThis & {
  alpiplanScheduledPushRunning?: boolean;
};

const reminderAppointmentSelect = {
  id: true,
  tenantId: true,
  startsAt: true,
  teacherId: true,
  appointmentContactText: true,
  customer: { select: { displayName: true } },
  lessonType: { select: { name: true } },
  teacher: { select: { id: true, displayName: true } },
  teachers: {
    select: {
      teacherId: true,
      teacher: { select: { id: true, displayName: true } },
    },
  },
} as const;

function briefingTitle(appointment: {
  customer?: { displayName?: string | null } | null;
  appointmentContactText?: string | null;
  lessonType?: { name?: string | null } | null;
}): string {
  return (
    appointment.customer?.displayName ||
    appointment.appointmentContactText ||
    appointment.lessonType?.name ||
    "Termin"
  );
}

function formatWhen(startsAt: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(startsAt);
}

function formatClock(startsAt: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(startsAt);
}

async function unclaimReminder(appointmentId: string): Promise<void> {
  await prisma.appointment.updateMany({
    where: { id: appointmentId },
    data: { reminderPushSentAt: null },
  });
}

async function teacherUserIds(appointment: {
  teacherId?: string | null;
  teacher?: { id?: string | null } | null;
  teachers?: Array<{
    teacherId?: string | null;
    teacher?: { id?: string | null } | null;
  }> | null;
}): Promise<string[]> {
  const assigned = assignedTeachersFromAppointment(appointment);
  const ids = assigned.map((item) => item.id);
  if (!ids.length) return [];
  const profiles = await prisma.teacherProfile.findMany({
    where: {
      id: { in: ids },
      deletedAt: null,
      membership: { deletedAt: null },
    },
    select: {
      membership: {
        select: {
          userId: true,
          user: { select: { deletedAt: true, disabledAt: true } },
        },
      },
    },
  });
  return [
    ...new Set(
      profiles
        .map((profile) => profile.membership)
        .filter((membership) => membership?.user && !membership.user.deletedAt && !membership.user.disabledAt)
        .map((membership) => membership!.userId),
    ),
  ];
}

async function sendDueReminders(now: Date): Promise<void> {
  const due = await prisma.appointment.findMany({
    where: {
      deletedAt: null,
      reminderPushSentAt: null,
      status: { in: [AppointmentStatus.draft, AppointmentStatus.confirmed] },
      startsAt: {
        gt: now,
        lte: new Date(now.getTime() + REMINDER_LEAD_MS),
      },
    },
    select: reminderAppointmentSelect,
    orderBy: { startsAt: "asc" },
    take: 50,
  });

  for (const appointment of due) {
    const claimed = await prisma.appointment.updateMany({
      where: { id: appointment.id, reminderPushSentAt: null, deletedAt: null },
      data: { reminderPushSentAt: now },
    });
    if (!claimed.count) continue;

    try {
      const userIds = await teacherUserIds(appointment);
      if (!userIds.length) {
        await unclaimReminder(appointment.id);
        continue;
      }
      const title = resolveAppointmentDisplayName(appointment);
      const minutes = Math.max(
        1,
        Math.round((appointment.startsAt.getTime() - now.getTime()) / 60_000),
      );
      const result = await sendPushToUsers({
        userIds,
        title: "Terminerinnerung",
        body: `${title} · in ${minutes} Min · ${formatWhen(appointment.startsAt)}`,
        data: {
          type: "appointment.reminder",
          appointmentId: appointment.id,
          tenantId: appointment.tenantId,
        },
      });
      if (!result.sent) {
        await unclaimReminder(appointment.id);
        console.warn("[push] reminder not delivered", appointment.id, userIds);
      }
    } catch (error) {
      await unclaimReminder(appointment.id);
      console.warn("[push] reminder failed", appointment.id, error);
    }
  }
}

async function unclaimDraftReminder(appointmentId: string): Promise<void> {
  await prisma.appointment.updateMany({
    where: { id: appointmentId },
    data: { draftReminderSentAt: null },
  });
}

async function sendDueDraftReminders(now: Date): Promise<void> {
  const due = await prisma.appointment.findMany({
    where: {
      deletedAt: null,
      status: AppointmentStatus.draft,
      draftReminderSentAt: null,
      draftReminderAt: { lte: now },
    },
    select: {
      ...reminderAppointmentSelect,
      createdByUserId: true,
      draftReminderText: true,
    },
    orderBy: { draftReminderAt: "asc" },
    take: 50,
  });

  for (const appointment of due) {
    const claimed = await prisma.appointment.updateMany({
      where: { id: appointment.id, draftReminderSentAt: null, deletedAt: null, status: AppointmentStatus.draft },
      data: { draftReminderSentAt: now },
    });
    if (!claimed.count) continue;

    try {
      const userIds = [
        ...new Set([...(appointment.createdByUserId ? [appointment.createdByUserId] : []), ...(await teacherUserIds(appointment))]),
      ];
      if (!userIds.length) continue;
      const title = resolveAppointmentDisplayName(appointment);
      const result = await sendPushToUsers({
        userIds,
        title: "Entwurf: Erinnerung",
        body: [appointment.draftReminderText, `${title} · ${formatWhen(appointment.startsAt)}`]
          .filter(Boolean)
          .join(" · "),
        data: {
          type: "appointment.draft_reminder",
          appointmentId: appointment.id,
          tenantId: appointment.tenantId,
        },
      });
      if (!result.sent) {
        console.warn("[push] draft reminder not delivered", appointment.id, userIds);
      }
    } catch (error) {
      await unclaimDraftReminder(appointment.id);
      console.warn("[push] draft reminder failed", appointment.id, error);
    }
  }
}

async function sendDueBriefings(now: Date): Promise<void> {
  const nowMinutes = minutesOfDay(now);
  const today = tzParts(now);
  const tomorrow = addCalendarDays(today, 1);
  const forDateKey = dateKey(tomorrow);
  const from = zonedLocalDate(tomorrow, 0, 0);
  const to = zonedLocalDate(addCalendarDays(tomorrow, 1), 0, 0);

  const teachers = await prisma.teacherProfile.findMany({
    where: {
      deletedAt: null,
      membership: {
        deletedAt: null,
        user: {
          deletedAt: null,
          disabledAt: null,
          nextDayBriefingEnabled: true,
          nextDayBriefingMinutes: { lte: nowMinutes },
        },
      },
    },
    select: {
      id: true,
      tenantId: true,
      membership: { select: { userId: true } },
    },
  });
  if (!teachers.length) return;

  const appointments = await prisma.appointment.findMany({
    where: {
      deletedAt: null,
      tenantId: { in: [...new Set(teachers.map((teacher) => teacher.tenantId))] },
      status: { in: [AppointmentStatus.draft, AppointmentStatus.confirmed] },
      startsAt: { gte: from, lt: to },
    },
    select: {
      id: true,
      tenantId: true,
      startsAt: true,
      teacherId: true,
      appointmentContactText: true,
      customer: { select: { displayName: true } },
      lessonType: { select: { name: true } },
      teacher: { select: { id: true } },
      teachers: { select: { teacherId: true, teacher: { select: { id: true } } } },
    },
  });

  const itemsByTeacher = new Map<string, Array<{ startsAt: Date; title: string }>>();
  for (const appointment of appointments) {
    const title = briefingTitle(appointment);
    for (const assigned of assignedTeachersFromAppointment(appointment)) {
      const key = `${appointment.tenantId}:${assigned.id}`;
      const list = itemsByTeacher.get(key) ?? [];
      list.push({ startsAt: appointment.startsAt, title });
      itemsByTeacher.set(key, list);
    }
  }

  for (const teacher of teachers) {
    const userId = teacher.membership?.userId;
    if (!userId) continue;
    const items = itemsByTeacher.get(`${teacher.tenantId}:${teacher.id}`) ?? [];
    if (!items.length) continue;

    try {
      await prisma.nextDayBriefingPush.create({
        data: { userId, tenantId: teacher.tenantId, dateKey: forDateKey },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }

    items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const times = items.map((item) => `${formatClock(item.startsAt)} ${item.title}`).join(", ");
    try {
      const result = await sendPushToUsers({
        userIds: [userId],
        title: "Termine morgen",
        body: `${items.length} ${items.length === 1 ? "Termin" : "Termine"} · ${times}`,
        data: {
          type: "appointment.briefing",
          tenantId: teacher.tenantId,
          dateKey: forDateKey,
        },
      });
      if (!result.sent) {
        await prisma.nextDayBriefingPush.deleteMany({
          where: { userId, tenantId: teacher.tenantId, dateKey: forDateKey },
        });
        console.warn("[push] briefing not delivered", userId, teacher.tenantId);
      }
    } catch (error) {
      await prisma.nextDayBriefingPush.deleteMany({
        where: { userId, tenantId: teacher.tenantId, dateKey: forDateKey },
      });
      console.warn("[push] briefing failed", userId, teacher.tenantId, error);
    }
  }
}

async function autoCompleteOverdueAppointments(now: Date): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null, autoCompleteAppointments: true },
    select: { id: true, autoCompleteAfterMinutes: true },
  });
  for (const tenant of tenants) {
    const cutoff = new Date(now.getTime() - Math.max(0, tenant.autoCompleteAfterMinutes) * 60_000);
    await prisma.appointment.updateMany({
      where: {
        tenantId: tenant.id,
        deletedAt: null,
        status: { in: [AppointmentStatus.draft, AppointmentStatus.confirmed] },
        endsAt: { lte: cutoff },
      },
      data: { status: AppointmentStatus.completed },
    });
  }
}

export async function runScheduledPushTick(now = new Date()): Promise<void> {
  if (globalForSched.alpiplanScheduledPushRunning) return;
  globalForSched.alpiplanScheduledPushRunning = true;
  try {
    await autoCompleteOverdueAppointments(now);
    if (isPushConfigured()) {
      await sendDueReminders(now);
      await sendDueDraftReminders(now);
      await sendDueBriefings(now);
    }
  } catch (error) {
    console.warn("[push] scheduled tick failed", error);
  } finally {
    globalForSched.alpiplanScheduledPushRunning = false;
  }
}
