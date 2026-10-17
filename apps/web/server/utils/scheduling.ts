import {
  AppointmentStatus,
  AvailabilityExceptionType,
  AvailabilityRuleKind,
  CustomerSource,
  type Prisma,
} from "@prisma/client";
import { prisma } from "~/server/utils/prisma";
import {
  throwConflict,
  throwNotFound,
  throwValidation,
  throwVersionConflict,
} from "~/server/utils/api-errors";
import { assertUuid } from "~/server/utils/authz";
import { ensureTeacherProfilesForTenant } from "~/server/utils/members";

const BUSINESS_TIME_ZONE = "Europe/Rome";
const activeAppointmentStatuses = [
  AppointmentStatus.draft,
  AppointmentStatus.confirmed,
  AppointmentStatus.completed,
];

const appointmentSelect = {
  id: true,
  tenantId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  lessonTypeId: true,
  teacherId: true,
  resourceId: true,
  customerId: true,
  appointmentContactText: true,
  appointmentPhoneRaw: true,
  appointmentPhoneE164: true,
  unstructuredNote: true,
  draftReminderAt: true,
  draftReminderText: true,
  parseSnapshot: true,
  version: true,
  createdAt: true,
  createdByUserId: true,
  updatedAt: true,
  lessonType: { select: { id: true, name: true, defaultDurationMin: true, color: true } },
  teacher: { select: { id: true, displayName: true, color: true } },
  teachers: {
    select: {
      teacherId: true,
      teacher: { select: { id: true, displayName: true, color: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  resource: { select: { id: true, name: true, capacity: true } },
  customer: {
    select: {
      id: true,
      displayName: true,
      customerSource: true,
      phones: {
        where: { deletedAt: null },
        select: { e164: true, raw: true, isPrimary: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
  },
} satisfies Prisma.AppointmentSelect;

const customerSelect = {
  id: true,
  tenantId: true,
  displayName: true,
  customerSource: true,
  notes: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  phones: {
    where: { deletedAt: null },
    select: { id: true, e164: true, raw: true, isPrimary: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.CustomerSelect;

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseRequiredDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || !value.trim()) {
    throwValidation(`${field} ist erforderlich`, { field });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throwValidation(`${field} ist kein gültiges Datum`, { field });
  }
  return date;
}

function parseOptionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseRequiredDate(value, field);
}

function parseDateOnly(value: unknown, field: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throwValidation(`${field} muss im Format YYYY-MM-DD sein`, { field });
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throwValidation(`${field} ist kein gültiges Datum`, { field });
  }
  return date;
}

function dateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ensureRange(startsAt: Date, endsAt: Date): void {
  if (endsAt <= startsAt) {
    throwValidation("Ende muss nach dem Start liegen", {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
  }
}

function normalizeStatus(value: unknown): AppointmentStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !Object.values(AppointmentStatus).includes(value as AppointmentStatus)) {
    throwValidation("Terminstatus ist ungültig", { field: "status" });
  }
  return value as AppointmentStatus;
}

function normalizeCustomerSource(value: unknown): CustomerSource {
  if (value === undefined || value === null || value === "") {
    return CustomerSource.manual;
  }
  if (typeof value !== "string" || !Object.values(CustomerSource).includes(value as CustomerSource)) {
    throwValidation("Kundenquelle ist ungültig", { field: "customerSource" });
  }
  return value as CustomerSource;
}

function normalizeExceptionType(value: unknown): AvailabilityExceptionType {
  if (typeof value !== "string" || !Object.values(AvailabilityExceptionType).includes(value as AvailabilityExceptionType)) {
    throwValidation("Ausnahmetyp ist ungültig", { field: "type" });
  }
  return value as AvailabilityExceptionType;
}

function normalizeOptionalUuid(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throwValidation(`${field} ist ungültig`, { field });
  }
  return assertUuid(value, field);
}

function normalizeRequiredUuid(value: string | undefined, field: string): string {
  return assertUuid(value, field);
}

function parseIfMatch(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throwValidation("If-Match muss eine gültige Versionsnummer sein", { header: "If-Match" });
  }
  return parsed;
}

function compareTimes(left: string, right: string): number {
  return left.localeCompare(right);
}

function ruleCoversWeekday(rule: { weekday: number; weekdays?: number[] }, weekday: number): boolean {
  const days = rule.weekdays?.length ? rule.weekdays : [rule.weekday];
  return days.includes(weekday);
}

function appointmentHitsUnavailable(
  rules: AvailabilityMatchRule[],
  start: { date: string; time: string; weekday: number },
  end: { date: string; time: string },
): boolean {
  if (start.date !== end.date) return false;
  return rules.some((rule) => {
    if (rule.kind !== AvailabilityRuleKind.unavailable) return false;
    if (!ruleCoversWeekday(rule, start.weekday)) return false;
    if (rule.allDay) return true;
    return compareTimes(start.time, rule.endTime) < 0 && compareTimes(end.time, rule.startTime) > 0;
  });
}

function appointmentFitsAvailable(
  rules: AvailabilityMatchRule[],
  start: { date: string; time: string; weekday: number },
  end: { date: string; time: string },
): boolean {
  const available = rules.filter((rule) => rule.kind !== AvailabilityRuleKind.unavailable);
  if (!available.length) return true;
  if (start.date !== end.date) return false;
  return available.some(
    (rule) =>
      ruleCoversWeekday(rule, start.weekday) &&
      (rule.allDay ||
        (compareTimes(start.time, rule.startTime) >= 0 && compareTimes(end.time, rule.endTime) <= 0)),
  );
}

type ExceptionMatch = {
  type: AvailabilityExceptionType;
  startsOn: Date;
  endsOn: Date;
  startTime: string | null;
  endTime: string | null;
};

const blockingExceptionTypes: AvailabilityExceptionType[] = [
  AvailabilityExceptionType.vacation,
  AvailabilityExceptionType.sick,
  AvailabilityExceptionType.block,
];

function exceptionsForDay(exceptions: ExceptionMatch[], date: string): ExceptionMatch[] {
  return exceptions.filter(
    (exception) => date >= dateOnlyString(exception.startsOn) && date <= dateOnlyString(exception.endsOn),
  );
}

function findBlockingException(
  exceptions: ExceptionMatch[],
  start: { date: string; time: string },
  end: { date: string; time: string },
): ExceptionMatch | undefined {
  return exceptionsForDay(exceptions, start.date).find((exception) => {
    if (!blockingExceptionTypes.includes(exception.type)) return false;
    if (!exception.startTime || !exception.endTime) return true;
    const endsLater = end.date > start.date;
    return (
      compareTimes(start.time, exception.endTime) < 0 &&
      (endsLater || compareTimes(end.time, exception.startTime) > 0)
    );
  });
}

function normalizeTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    throwValidation(`${field} muss im Format HH:mm sein`, { field });
  }
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) {
    throwValidation(`${field} ist keine gültige Uhrzeit`, { field });
  }
  return value;
}

function toAppointmentDto(row: Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>) {
  const teachers = row.teachers.map((link) => link.teacher);
  return {
    ...row,
    teachers,
    teacher: row.teacher ?? teachers[0] ?? null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    draftReminderAt: row.draftReminderAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resolveDraftReminder(
  status: AppointmentStatus,
  body: Record<string, unknown>,
  existing?: { draftReminderAt: Date | null; draftReminderText: string | null },
): { draftReminderAt: Date | null; draftReminderText: string | null } {
  if (status !== AppointmentStatus.draft) {
    return { draftReminderAt: null, draftReminderText: null };
  }
  const at = hasOwn(body, "draftReminderAt")
    ? body.draftReminderAt === null || body.draftReminderAt === ""
      ? null
      : parseRequiredDate(body.draftReminderAt, "draftReminderAt")
    : (existing?.draftReminderAt ?? null);
  if (!at) {
    return { draftReminderAt: null, draftReminderText: null };
  }
  const text = hasOwn(body, "draftReminderText")
    ? optionalTrimmedString(body.draftReminderText)
    : (existing?.draftReminderText ?? null);
  return { draftReminderAt: at, draftReminderText: text };
}

function assignedTeacherIdsFromRow(row: {
  teacherId: string | null;
  teachers: { teacherId: string }[];
}): string[] {
  const ids = row.teachers.map((link) => link.teacherId);
  if (row.teacherId && !ids.includes(row.teacherId)) ids.unshift(row.teacherId);
  return ids;
}

function parseTeacherIds(body: Record<string, unknown>): string[] | undefined {
  if (hasOwn(body, "teacherIds")) {
    if (!Array.isArray(body.teacherIds)) {
      throwValidation("teacherIds muss eine Liste sein", { field: "teacherIds" });
    }
    const ids: string[] = [];
    for (const value of body.teacherIds as unknown[]) {
      if (typeof value !== "string" || !value.trim()) continue;
      const id = assertUuid(value, "teacherIds");
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }
  if (hasOwn(body, "teacherId")) {
    const id = normalizeOptionalUuid(body.teacherId, "teacherId");
    return id ? [id] : [];
  }
  return undefined;
}

function toCustomerDto(row: Prisma.CustomerGetPayload<{ select: typeof customerSelect }>) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const availabilityRuleSelect = {
  id: true,
  tenantId: true,
  teacherId: true,
  weekday: true,
  weekdays: true,
  startTime: true,
  endTime: true,
  kind: true,
  allDay: true,
  locationId: true,
  activityTags: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
} as const;

type AvailabilityMatchRule = {
  weekday: number;
  weekdays: number[];
  startTime: string;
  endTime: string;
  kind: AvailabilityRuleKind;
  allDay: boolean;
  priority?: number;
};

function toRuleDto(row: {
  id: string;
  tenantId: string;
  teacherId: string;
  weekday: number;
  weekdays: number[];
  startTime: string;
  endTime: string;
  kind: AvailabilityRuleKind;
  allDay: boolean;
  locationId: string | null;
  activityTags: Prisma.JsonValue | null;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  const weekdays = [...new Set(row.weekdays.length ? row.weekdays : [row.weekday])].sort((a, b) => a - b);
  return {
    ...row,
    weekdays,
    weekday: weekdays[0] ?? row.weekday,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toExceptionDto(row: {
  id: string;
  tenantId: string;
  teacherId: string;
  type: AvailabilityExceptionType;
  startsOn: Date;
  endsOn: Date;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    startsOn: dateOnlyString(row.startsOn),
    endsOn: dateOnlyString(row.endsOn),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireTeacher(tenantId: string, teacherId: string): Promise<void> {
  const teacher = await prisma.teacherProfile.findFirst({
    where: { id: teacherId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!teacher) {
    throwNotFound("Lehrer nicht gefunden", { teacherId });
  }
}

async function requireResource(tenantId: string, resourceId: string): Promise<{ capacity: number }> {
  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, tenantId, deletedAt: null },
    select: { capacity: true },
  });
  if (!resource) {
    throwNotFound("Ressource nicht gefunden", { resourceId });
  }
  return resource;
}

async function tenantResourcesEnabled(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { resourcesEnabled: true },
  });
  return tenant?.resourcesEnabled ?? true;
}

async function requireLessonType(tenantId: string, lessonTypeId: string): Promise<void> {
  const lessonType = await prisma.lessonType.findFirst({
    where: { id: lessonTypeId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!lessonType) {
    throwNotFound("Terminart nicht gefunden", { lessonTypeId });
  }
}

async function requireCustomer(tenantId: string, customerId: string): Promise<void> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) {
    throwNotFound("Kunde nicht gefunden", { customerId });
  }
}

function getBusinessParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[byType.get("weekday") ?? ""];
  if (weekday === undefined) {
    throwValidation("Geschäftsdatum konnte nicht berechnet werden");
  }

  return {
    date: `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`,
    time: `${byType.get("hour")}:${byType.get("minute")}`,
    weekday,
  };
}

async function validateTeacherAvailability(
  tenantId: string,
  teacherId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<void> {
  const [rules, exceptions] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { tenantId, teacherId, deletedAt: null },
      select: { weekday: true, weekdays: true, startTime: true, endTime: true, kind: true, allDay: true },
    }),
    prisma.availabilityException.findMany({
      where: { tenantId, teacherId, deletedAt: null },
      select: { type: true, startsOn: true, endsOn: true, startTime: true, endTime: true },
    }),
  ]);

  const start = getBusinessParts(startsAt);
  const end = getBusinessParts(endsAt);
  const exceptionForDay = exceptionsForDay(exceptions, start.date);
  const blockingException = findBlockingException(exceptions, start, end);

  if (blockingException) {
    const absenceLabel = { vacation: "Urlaub", sick: "Krank", block: "Frei" }[
      blockingException.type as "vacation" | "sick" | "block"
    ];
    const window = blockingException.startTime && blockingException.endTime
      ? ` ${blockingException.startTime}–${blockingException.endTime}`
      : "";
    throwConflict(`Lehrer ist abwesend (${absenceLabel}${window})`, {
      conflictType: "TEACHER_UNAVAILABLE",
      reason: blockingException.type,
      teacherId,
    });
  }

  const extraOpen = exceptionForDay.some((exception) => exception.type === AvailabilityExceptionType.extra_open);
  if (extraOpen) {
    return;
  }

  if (appointmentHitsUnavailable(rules, start, end)) {
    throwConflict("Lehrer ist in diesem Zeitraum nicht verfügbar", {
      conflictType: "TEACHER_UNAVAILABLE",
      reason: "unavailable_rule",
      teacherId,
    });
  }

  if (!appointmentFitsAvailable(rules, start, end)) {
    throwConflict("Lehrer ist in diesem Zeitraum nicht verfügbar", {
      conflictType: "TEACHER_UNAVAILABLE",
      teacherId,
    });
  }
}

async function validateSchedulingConstraints(
  tenantId: string,
  input: {
    startsAt: Date;
    endsAt: Date;
    status: AppointmentStatus;
    teacherIds: string[];
    resourceId: string | null;
    excludeAppointmentId?: string;
  },
): Promise<void> {
  ensureRange(input.startsAt, input.endsAt);

  if (input.status === AppointmentStatus.cancelled) {
    return;
  }

  const overlapWhere = {
    tenantId,
    deletedAt: null,
    status: { in: activeAppointmentStatuses },
    startsAt: { lt: input.endsAt },
    endsAt: { gt: input.startsAt },
    ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}),
  } satisfies Prisma.AppointmentWhereInput;

  for (const teacherId of input.teacherIds) {
    await validateTeacherAvailability(tenantId, teacherId, input.startsAt, input.endsAt);
    const conflicts = await prisma.appointment.findMany({
      where: {
        ...overlapWhere,
        OR: [{ teacherId }, { teachers: { some: { teacherId } } }],
      },
      select: { id: true, startsAt: true, endsAt: true },
      take: 3,
    });
    if (conflicts.length) {
      const freeSlots = await findFreeSlotsOnDay(tenantId, input).catch(() => []);
      throwConflict("Lehrer ist im Zeitraum bereits gebucht", {
        conflictType: "TIME_OVERLAP",
        teacherId,
        appointments: conflicts.map((row) => ({
          id: row.id,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
        })),
        freeSlots,
      });
    }
  }

  if (input.resourceId) {
    const resource = await requireResource(tenantId, input.resourceId);
    const overlapCount = await prisma.appointment.count({
      where: { ...overlapWhere, resourceId: input.resourceId },
    });
    if (overlapCount >= resource.capacity) {
      throwConflict("Ressource ist im Zeitraum bereits ausgelastet", {
        conflictType: "RESOURCE_DOUBLE_BOOK",
        resourceId: input.resourceId,
        capacity: resource.capacity,
      });
    }
  }
}

async function validateAppointmentReferences(
  tenantId: string,
  input: {
    teacherIds?: string[];
    resourceId?: string | null;
    lessonTypeId?: string | null;
    customerId?: string | null;
  },
): Promise<void> {
  for (const teacherId of input.teacherIds ?? []) {
    await requireTeacher(tenantId, teacherId);
  }
  if (input.resourceId) {
    await requireResource(tenantId, input.resourceId);
  }
  if (input.lessonTypeId) {
    await requireLessonType(tenantId, input.lessonTypeId);
  }
  if (input.customerId) {
    await requireCustomer(tenantId, input.customerId);
  }
}

/** Calendar views (home, Termine-Kalender) load a whole range in one request. */
export const MAX_APPOINTMENT_PAGE_SIZE = 500;

export async function listAppointments(
  tenantId: string,
  query: {
    from?: string;
    to?: string;
    teacherId?: string;
    lessonTypeId?: string;
    status?: string;
    q?: string;
    page?: string | number;
    pageSize?: string | number;
    sort?: string;
  },
) {
  const startsAtFilter: Prisma.DateTimeFilter = {};
  if (query.from) {
    startsAtFilter.gte = parseRequiredDate(query.from, "from");
  }
  if (query.to) {
    startsAtFilter.lt = parseRequiredDate(query.to, "to");
  }
  const teacherId = query.teacherId ? assertUuid(query.teacherId, "teacherId") : undefined;
  const lessonTypeId = query.lessonTypeId ? assertUuid(query.lessonTypeId, "lessonTypeId") : undefined;
  const statusFilter = query.status
    ? query.status
        .split(",")
        .map((status) => status.trim())
        .filter(Boolean)
        .map((status) => normalizeStatus(status))
        .filter((status): status is AppointmentStatus => Boolean(status))
    : undefined;
  const q = query.q?.trim();

  const pageRaw = Number(query.page ?? 1);
  const pageSizeRaw = Number(query.pageSize ?? 25);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 && pageSizeRaw <= MAX_APPOINTMENT_PAGE_SIZE
      ? Math.floor(pageSizeRaw)
      : 25;
  const sort = query.sort === "asc" ? "asc" : "desc";

  const where: Prisma.AppointmentWhereInput = {
    tenantId,
    deletedAt: null,
    ...(Object.keys(startsAtFilter).length ? { startsAt: startsAtFilter } : {}),
    ...(statusFilter?.length ? { status: { in: statusFilter } } : {}),
    ...(lessonTypeId ? { lessonTypeId } : {}),
    ...(teacherId || q
      ? {
          AND: [
            ...(teacherId
              ? [
                  {
                    OR: [{ teacherId }, { teachers: { some: { teacherId } } }],
                  } satisfies Prisma.AppointmentWhereInput,
                ]
              : []),
            ...(q
              ? [
                  {
                    OR: [
                      { appointmentContactText: { contains: q, mode: "insensitive" } },
                      { customer: { displayName: { contains: q, mode: "insensitive" } } },
                    ],
                  } satisfies Prisma.AppointmentWhereInput,
                ]
              : []),
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      select: appointmentSelect,
      orderBy: { startsAt: sort },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.appointment.count({ where }),
  ]);

  return {
    data: rows.map(toAppointmentDto),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export async function getAppointment(tenantId: string, appointmentIdInput: string | undefined) {
  const appointmentId = normalizeRequiredUuid(appointmentIdInput, "appointmentId");
  const row = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId, deletedAt: null },
    select: appointmentSelect,
  });
  if (!row) {
    throwNotFound("Termin nicht gefunden", { appointmentId });
  }
  return toAppointmentDto(row);
}

export async function createAppointment(
  tenantId: string,
  rawBody: unknown,
  createdByUserId?: string | null,
) {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const startsAt = parseRequiredDate(body.startsAt, "startsAt");
  const endsAt = parseRequiredDate(body.endsAt, "endsAt");
  const status = normalizeStatus(body.status) ?? AppointmentStatus.confirmed;
  const lessonTypeId = normalizeOptionalUuid(body.lessonTypeId, "lessonTypeId") ?? null;
  const teacherIds = parseTeacherIds(body) ?? [];
  const teacherId = teacherIds[0] ?? null;
  const resourcesEnabled = await tenantResourcesEnabled(tenantId);
  const resourceId = resourcesEnabled
    ? (normalizeOptionalUuid(body.resourceId, "resourceId") ?? null)
    : null;
  const customerId = normalizeOptionalUuid(body.customerId, "customerId") ?? null;
  const draftReminder = resolveDraftReminder(status, body);

  await validateAppointmentReferences(tenantId, { lessonTypeId, teacherIds, resourceId, customerId });
  await validateSchedulingConstraints(tenantId, { startsAt, endsAt, status, teacherIds, resourceId });

  const created = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.create({
      data: {
        tenantId,
        startsAt,
        endsAt,
        status,
        lessonTypeId,
        teacherId,
        resourceId,
        customerId,
        createdByUserId: createdByUserId || null,
        appointmentContactText: optionalTrimmedString(body.appointmentContactText),
        appointmentPhoneRaw: optionalTrimmedString(body.appointmentPhoneRaw),
        appointmentPhoneE164: optionalTrimmedString(body.appointmentPhoneE164),
        unstructuredNote: optionalTrimmedString(body.unstructuredNote),
        ...draftReminder,
      },
      select: { id: true },
    });
    if (teacherIds.length) {
      await tx.appointmentTeacher.createMany({
        data: teacherIds.map((id) => ({ appointmentId: appointment.id, teacherId: id })),
      });
    }
    return appointment;
  });
  const row = await prisma.appointment.findFirst({
    where: { id: created.id },
    select: appointmentSelect,
  });
  if (!row) {
    throwNotFound("Termin nicht gefunden", { appointmentId: created.id });
  }

  return toAppointmentDto(row);
}

export async function patchAppointment(
  tenantId: string,
  appointmentIdInput: string | undefined,
  rawBody: unknown,
  ifMatchHeader?: string,
) {
  const appointmentId = normalizeRequiredUuid(appointmentIdInput, "appointmentId");
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const existing = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId, deletedAt: null },
    select: appointmentSelect,
  });
  if (!existing) {
    throwNotFound("Termin nicht gefunden", { appointmentId });
  }

  const ifMatch = parseIfMatch(ifMatchHeader);
  if (ifMatch !== undefined && existing.version !== ifMatch) {
    throwVersionConflict("Termin wurde inzwischen verändert", {
      expectedVersion: ifMatch,
      currentVersion: existing.version,
    });
  }

  const startsAt = parseOptionalDate(body.startsAt, "startsAt") ?? existing.startsAt;
  const endsAt = parseOptionalDate(body.endsAt, "endsAt") ?? existing.endsAt;
  const status = normalizeStatus(body.status) ?? existing.status;
  const lessonTypeId = hasOwn(body, "lessonTypeId")
    ? normalizeOptionalUuid(body.lessonTypeId, "lessonTypeId") ?? null
    : existing.lessonTypeId;
  const parsedTeacherIds = parseTeacherIds(body);
  const teacherIds = parsedTeacherIds ?? assignedTeacherIdsFromRow(existing);
  const teacherId = teacherIds[0] ?? null;
  const resourcesEnabled = await tenantResourcesEnabled(tenantId);
  const resourceId =
    resourcesEnabled && hasOwn(body, "resourceId")
      ? normalizeOptionalUuid(body.resourceId, "resourceId") ?? null
      : existing.resourceId;
  const customerId = hasOwn(body, "customerId")
    ? normalizeOptionalUuid(body.customerId, "customerId") ?? null
    : existing.customerId;

  await validateAppointmentReferences(tenantId, { lessonTypeId, teacherIds, resourceId, customerId });
  await validateSchedulingConstraints(tenantId, {
    startsAt,
    endsAt,
    status,
    teacherIds,
    resourceId,
    excludeAppointmentId: appointmentId,
  });

  const data: Prisma.AppointmentUncheckedUpdateInput = {
    version: { increment: 1 },
  };
  if (hasOwn(body, "startsAt")) {
    data.startsAt = startsAt;
    if (startsAt.getTime() !== existing.startsAt.getTime()) {
      data.reminderPushSentAt = null;
    }
  }
  if (hasOwn(body, "endsAt")) data.endsAt = endsAt;
  if (hasOwn(body, "status")) data.status = status;
  if (hasOwn(body, "lessonTypeId")) data.lessonTypeId = lessonTypeId;
  if (parsedTeacherIds) data.teacherId = teacherId;
  if (resourcesEnabled && hasOwn(body, "resourceId")) data.resourceId = resourceId;
  if (hasOwn(body, "customerId")) data.customerId = customerId;
  if (hasOwn(body, "appointmentContactText")) {
    data.appointmentContactText = optionalTrimmedString(body.appointmentContactText);
  }
  if (hasOwn(body, "appointmentPhoneRaw")) {
    data.appointmentPhoneRaw = optionalTrimmedString(body.appointmentPhoneRaw);
  }
  if (hasOwn(body, "appointmentPhoneE164")) {
    data.appointmentPhoneE164 = optionalTrimmedString(body.appointmentPhoneE164);
  }
  if (hasOwn(body, "unstructuredNote")) {
    data.unstructuredNote = optionalTrimmedString(body.unstructuredNote);
  }
  const draftReminder = resolveDraftReminder(status, body, existing);
  data.draftReminderAt = draftReminder.draftReminderAt;
  data.draftReminderText = draftReminder.draftReminderText;
  if (draftReminder.draftReminderAt?.getTime() !== existing.draftReminderAt?.getTime()) {
    data.draftReminderSentAt = null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointmentId },
      data,
    });
    if (parsedTeacherIds) {
      await tx.appointmentTeacher.deleteMany({ where: { appointmentId } });
      if (parsedTeacherIds.length) {
        await tx.appointmentTeacher.createMany({
          data: parsedTeacherIds.map((id) => ({ appointmentId, teacherId: id })),
        });
      }
    }
    const linkedCustomerId = hasOwn(body, "customerId") ? customerId : existing.customerId;
    const customerName = optionalTrimmedString(body.customerName);
    if (linkedCustomerId && customerName && customerName.length >= 2) {
      await tx.customer.update({
        where: { id: linkedCustomerId },
        data: { displayName: customerName, version: { increment: 1 } },
      });
    }
  });
  const row = await prisma.appointment.findFirst({
    where: { id: appointmentId },
    select: appointmentSelect,
  });
  if (!row) {
    throwNotFound("Termin nicht gefunden", { appointmentId });
  }

  return toAppointmentDto(row);
}

export async function softDeleteAppointment(
  tenantId: string,
  appointmentIdInput: string | undefined,
  actorUserId: string,
) {
  const appointmentId = normalizeRequiredUuid(appointmentIdInput, "appointmentId");
  await getAppointment(tenantId, appointmentId);
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      deletedAt: new Date(),
      deletedByUserId: actorUserId,
      version: { increment: 1 },
    },
  });
}

export async function restoreAppointment(tenantId: string, appointmentIdInput: string | undefined) {
  const appointmentId = normalizeRequiredUuid(appointmentIdInput, "appointmentId");
  const existing = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId, deletedAt: { not: null } },
    select: { id: true, customerId: true },
  });
  if (!existing) {
    throwNotFound("Gelöschter Termin nicht gefunden", { appointmentId });
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointmentId },
      data: { deletedAt: null, deletedByUserId: null, version: { increment: 1 } },
    });
    if (!existing.customerId) return;
    const customer = await tx.customer.findFirst({
      where: { id: existing.customerId, tenantId, deletedAt: { not: null } },
      select: { id: true },
    });
    if (!customer) return;
    await tx.customer.update({
      where: { id: customer.id },
      data: { deletedAt: null, deletedByUserId: null, version: { increment: 1 } },
    });
    await tx.customerPhone.updateMany({
      where: { tenantId, customerId: customer.id, deletedAt: { not: null } },
      data: { deletedAt: null, deletedByUserId: null },
    });
  });

  return getAppointment(tenantId, appointmentId);
}

/** "#rrggbb" or null (= automatic color derived from the id on the client). */
function parseCalendarColor(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throwValidation("Farbe muss im Format #rrggbb sein", { field: "color" });
  }
  return value.toLowerCase();
}

const lessonTypeSelect = {
  id: true,
  tenantId: true,
  name: true,
  defaultDurationMin: true,
  color: true,
  createdAt: true,
  updatedAt: true,
  teachers: {
    where: { teacher: { deletedAt: null } },
    select: { teacherId: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.LessonTypeSelect;

function toLessonTypeDto(row: Prisma.LessonTypeGetPayload<{ select: typeof lessonTypeSelect }>) {
  const { teachers, ...rest } = row;
  return {
    ...rest,
    teacherIds: teachers.map((link) => link.teacherId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listLessonTypes(tenantId: string) {
  const rows = await prisma.lessonType.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { name: "asc" },
    select: lessonTypeSelect,
  });
  return { data: rows.map(toLessonTypeDto) };
}

function parseLessonTypeTeacherIds(body: Record<string, unknown>): string[] | undefined {
  if (!hasOwn(body, "teacherIds")) return undefined;
  if (body.teacherIds === null) return [];
  if (!Array.isArray(body.teacherIds)) {
    throwValidation("teacherIds muss eine Liste sein", { field: "teacherIds" });
  }
  const ids: string[] = [];
  for (const value of body.teacherIds as unknown[]) {
    if (typeof value !== "string" || !value.trim()) continue;
    const id = assertUuid(value, "teacherIds");
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

async function validateLessonTypeTeachers(tenantId: string, teacherIds: string[]) {
  if (!teacherIds.length) return;
  const found = await prisma.teacherProfile.findMany({
    where: { tenantId, deletedAt: null, id: { in: teacherIds } },
    select: { id: true },
  });
  const missing = teacherIds.filter((id) => !found.some((teacher) => teacher.id === id));
  if (missing.length) {
    throwNotFound("Lehrer nicht gefunden", { teacherIds: missing });
  }
}

function normalizeLessonTypePayload(rawBody: unknown, partial = false) {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const name = hasOwn(body, "name") ? optionalTrimmedString(body.name) : undefined;
  if (!partial && (!name || name.length < 2)) {
    throwValidation("Name ist erforderlich", { field: "name" });
  }
  if (name !== undefined && (!name || name.length < 2)) {
    throwValidation("Name ist erforderlich", { field: "name" });
  }

  let defaultDurationMin: number | null | undefined;
  if (hasOwn(body, "defaultDurationMin")) {
    if (body.defaultDurationMin === null || body.defaultDurationMin === "") {
      defaultDurationMin = null;
    } else {
      const parsed = Number(body.defaultDurationMin);
      if (!Number.isInteger(parsed) || parsed < 5 || parsed > 24 * 60) {
        throwValidation("Standard-Dauer muss zwischen 5 und 1440 Minuten liegen", {
          field: "defaultDurationMin",
        });
      }
      defaultDurationMin = parsed;
    }
  }

  const color = hasOwn(body, "color") ? parseCalendarColor(body.color) : undefined;

  return { name, defaultDurationMin, color, teacherIds: parseLessonTypeTeacherIds(body) };
}

export async function createLessonType(tenantId: string, rawBody: unknown) {
  const payload = normalizeLessonTypePayload(rawBody);
  await validateLessonTypeTeachers(tenantId, payload.teacherIds ?? []);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { useDefaultDuration: true },
  });
  const useDefaultDuration = tenant?.useDefaultDuration ?? true;
  const row = await prisma.lessonType.create({
    data: {
      tenantId,
      name: payload.name!,
      defaultDurationMin: useDefaultDuration ? payload.defaultDurationMin ?? null : null,
      color: payload.color ?? null,
      teachers: payload.teacherIds?.length
        ? { create: payload.teacherIds.map((teacherId) => ({ teacherId })) }
        : undefined,
    },
    select: lessonTypeSelect,
  });
  return toLessonTypeDto(row);
}

export async function patchLessonType(
  tenantId: string,
  lessonTypeIdInput: string | undefined,
  rawBody: unknown,
) {
  const lessonTypeId = normalizeRequiredUuid(lessonTypeIdInput, "lessonTypeId");
  const existing = await prisma.lessonType.findFirst({
    where: { id: lessonTypeId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    throwNotFound("Terminart nicht gefunden", { lessonTypeId });
  }
  const payload = normalizeLessonTypePayload(rawBody, true);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { useDefaultDuration: true },
  });
  const useDefaultDuration = tenant?.useDefaultDuration ?? true;
  const data: Prisma.LessonTypeUncheckedUpdateInput = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.color !== undefined) data.color = payload.color;
  if (payload.defaultDurationMin !== undefined) {
    data.defaultDurationMin = useDefaultDuration ? payload.defaultDurationMin : null;
  }
  const teacherIds = payload.teacherIds;
  if (teacherIds) {
    await validateLessonTypeTeachers(tenantId, teacherIds);
    data.teachers = {
      deleteMany: {},
      create: teacherIds.map((teacherId) => ({ teacherId })),
    };
  }

  const row = await prisma.lessonType.update({
    where: { id: lessonTypeId },
    data,
    select: lessonTypeSelect,
  });
  return toLessonTypeDto(row);
}

export async function softDeleteLessonType(
  tenantId: string,
  lessonTypeIdInput: string | undefined,
  actorUserId: string,
) {
  const lessonTypeId = normalizeRequiredUuid(lessonTypeIdInput, "lessonTypeId");
  const existing = await prisma.lessonType.findFirst({
    where: { id: lessonTypeId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    throwNotFound("Terminart nicht gefunden", { lessonTypeId });
  }
  await prisma.$transaction([
    prisma.tenant.updateMany({
      where: { id: tenantId, defaultLessonTypeId: lessonTypeId },
      data: { defaultLessonTypeId: null },
    }),
    prisma.lessonType.update({
      where: { id: lessonTypeId },
      data: { deletedAt: new Date(), deletedByUserId: actorUserId },
    }),
  ]);
}

export async function restoreLessonType(tenantId: string, lessonTypeIdInput: string | undefined) {
  const lessonTypeId = normalizeRequiredUuid(lessonTypeIdInput, "lessonTypeId");
  const existing = await prisma.lessonType.findFirst({
    where: { id: lessonTypeId, tenantId, deletedAt: { not: null } },
    select: { id: true },
  });
  if (!existing) {
    throwNotFound("Gelöschte Terminart nicht gefunden", { lessonTypeId });
  }
  const row = await prisma.lessonType.update({
    where: { id: lessonTypeId },
    data: { deletedAt: null, deletedByUserId: null },
    select: lessonTypeSelect,
  });
  return toLessonTypeDto(row);
}

export async function listCustomers(tenantId: string, query: { q?: string }) {
  const q = query.q?.trim();
  const rows = await prisma.customer.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(q ? { displayName: { contains: q, mode: "insensitive" } } : {}),
    },
    select: customerSelect,
    orderBy: { displayName: "asc" },
    take: 50,
  });

  return { data: rows.map(toCustomerDto) };
}

export async function getCustomer(tenantId: string, customerIdInput: string | undefined) {
  const customerId = normalizeRequiredUuid(customerIdInput, "customerId");
  const row = await prisma.customer.findFirst({
    where: { id: customerId, tenantId, deletedAt: null },
    select: customerSelect,
  });
  if (!row) {
    throwNotFound("Kunde nicht gefunden", { customerId });
  }
  return toCustomerDto(row);
}

export async function createCustomer(tenantId: string, rawBody: unknown) {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const displayName = optionalTrimmedString(body.displayName);
  if (!displayName || displayName.length < 2) {
    throwValidation("Kundenname ist erforderlich", { field: "displayName" });
  }
  const phones = Array.isArray(body.phones) ? body.phones : [];

  const row = await prisma.customer.create({
    data: {
      tenantId,
      displayName,
      customerSource: normalizeCustomerSource(body.customerSource),
      notes: optionalTrimmedString(body.notes),
      phones: phones.length
        ? {
            create: phones.map((phone, index) => {
              const phoneBody = (phone ?? {}) as Record<string, unknown>;
              return {
                tenantId,
                e164: optionalTrimmedString(phoneBody.e164),
                raw: optionalTrimmedString(phoneBody.raw),
                isPrimary: index === 0 || Boolean(phoneBody.isPrimary),
              };
            }),
          }
        : undefined,
    },
    select: customerSelect,
  });

  return toCustomerDto(row);
}

export async function patchCustomer(
  tenantId: string,
  customerIdInput: string | undefined,
  rawBody: unknown,
  ifMatchHeader?: string,
) {
  const customerId = normalizeRequiredUuid(customerIdInput, "customerId");
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const existing = await prisma.customer.findFirst({
    where: { id: customerId, tenantId, deletedAt: null },
    select: { id: true, version: true },
  });
  if (!existing) {
    throwNotFound("Kunde nicht gefunden", { customerId });
  }

  const ifMatch = parseIfMatch(ifMatchHeader);
  if (ifMatch !== undefined && existing.version !== ifMatch) {
    throwVersionConflict("Kunde wurde inzwischen verändert", {
      expectedVersion: ifMatch,
      currentVersion: existing.version,
    });
  }

  const data: Prisma.CustomerUpdateInput = { version: { increment: 1 } };
  if (hasOwn(body, "displayName")) {
    const displayName = optionalTrimmedString(body.displayName);
    if (!displayName || displayName.length < 2) {
      throwValidation("Kundenname ist erforderlich", { field: "displayName" });
    }
    data.displayName = displayName;
  }
  if (hasOwn(body, "notes")) {
    data.notes = optionalTrimmedString(body.notes);
  }

  const row = await prisma.customer.update({
    where: { id: customerId },
    data,
    select: customerSelect,
  });

  return toCustomerDto(row);
}

export async function softDeleteCustomer(
  tenantId: string,
  customerIdInput: string | undefined,
  actorUserId: string,
) {
  const customerId = normalizeRequiredUuid(customerIdInput, "customerId");
  await getCustomer(tenantId, customerId);
  const deletedAt = new Date();
  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customerId },
      data: { deletedAt, deletedByUserId: actorUserId, version: { increment: 1 } },
    }),
    prisma.customerPhone.updateMany({
      where: { tenantId, customerId, deletedAt: null },
      data: { deletedAt, deletedByUserId: actorUserId },
    }),
  ]);
}

export async function restoreCustomer(tenantId: string, customerIdInput: string | undefined) {
  const customerId = normalizeRequiredUuid(customerIdInput, "customerId");
  const existing = await prisma.customer.findFirst({
    where: { id: customerId, tenantId, deletedAt: { not: null } },
    select: { id: true },
  });
  if (!existing) {
    throwNotFound("Gelöschter Kunde nicht gefunden", { customerId });
  }
  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customerId },
      data: { deletedAt: null, deletedByUserId: null, version: { increment: 1 } },
    }),
    prisma.customerPhone.updateMany({
      where: { tenantId, customerId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedByUserId: null },
    }),
  ]);
  return getCustomer(tenantId, customerId);
}

export async function listAvailabilityRules(tenantId: string, teacherIdInput: string | undefined) {
  const teacherId = normalizeRequiredUuid(teacherIdInput, "teacherId");
  await requireTeacher(tenantId, teacherId);
  const rows = await prisma.availabilityRule.findMany({
    where: { tenantId, teacherId, deletedAt: null },
    orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    select: availabilityRuleSelect,
  });
  return { data: rows.map(toRuleDto) };
}

function normalizeWeekdays(body: Record<string, unknown>, partial: boolean): number[] | undefined {
  if (hasOwn(body, "weekdays")) {
    if (!Array.isArray(body.weekdays) || body.weekdays.length === 0) {
      throwValidation("Mindestens ein Wochentag ist erforderlich", { field: "weekdays" });
    }
    const days = [...new Set(body.weekdays.map((value) => Number(value)))].sort((a, b) => a - b);
    if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throwValidation("Wochentag muss zwischen 0 und 6 liegen", { field: "weekdays" });
    }
    return days;
  }
  if (hasOwn(body, "weekday")) {
    const weekday = Number(body.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throwValidation("Wochentag muss zwischen 0 und 6 liegen", { field: "weekday" });
    }
    return [weekday];
  }
  if (!partial) {
    throwValidation("Wochentag ist erforderlich", { field: "weekday" });
  }
  return undefined;
}

function normalizeRuleKind(value: unknown): AvailabilityRuleKind {
  if (value === AvailabilityRuleKind.unavailable || value === "unavailable") {
    return AvailabilityRuleKind.unavailable;
  }
  if (value === AvailabilityRuleKind.available || value === "available") {
    return AvailabilityRuleKind.available;
  }
  throwValidation("Art muss available oder unavailable sein", { field: "kind" });
}

function normalizeRulePayload(rawBody: unknown, partial = false) {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const weekdays = normalizeWeekdays(body, partial);
  const weekday = weekdays?.[0];

  const kind = hasOwn(body, "kind") ? normalizeRuleKind(body.kind) : undefined;
  const allDay = hasOwn(body, "allDay") ? Boolean(body.allDay) : undefined;
  const resolvedKind = kind ?? AvailabilityRuleKind.available;
  const resolvedAllDay = resolvedKind === AvailabilityRuleKind.unavailable && (allDay ?? false);

  let startTime = hasOwn(body, "startTime") ? normalizeTime(body.startTime, "startTime") : undefined;
  let endTime = hasOwn(body, "endTime") ? normalizeTime(body.endTime, "endTime") : undefined;
  if (!partial && resolvedAllDay) {
    startTime = startTime ?? "00:00";
    endTime = endTime ?? "23:59";
  }
  if (!partial && !resolvedAllDay && !startTime) {
    throwValidation("Startzeit ist erforderlich", { field: "startTime" });
  }
  if (!partial && !resolvedAllDay && !endTime) {
    throwValidation("Endzeit ist erforderlich", { field: "endTime" });
  }
  if (startTime && endTime && compareTimes(startTime, endTime) >= 0) {
    throwValidation("Endzeit muss nach der Startzeit liegen", { startTime, endTime });
  }

  const locationId = hasOwn(body, "locationId")
    ? normalizeOptionalUuid(body.locationId, "locationId") ?? null
    : undefined;
  const activityTags = hasOwn(body, "activityTags") && Array.isArray(body.activityTags)
    ? body.activityTags.filter((tag): tag is string => typeof tag === "string")
    : undefined;
  const priority = hasOwn(body, "priority") ? Number(body.priority) : undefined;
  if (priority !== undefined && !Number.isInteger(priority)) {
    throwValidation("Priorität muss eine ganze Zahl sein", { field: "priority" });
  }

  return { weekday, weekdays, startTime, endTime, kind, allDay, locationId, activityTags, priority };
}

export async function createAvailabilityRule(
  tenantId: string,
  teacherIdInput: string | undefined,
  rawBody: unknown,
) {
  const teacherId = normalizeRequiredUuid(teacherIdInput, "teacherId");
  await requireTeacher(tenantId, teacherId);
  const payload = normalizeRulePayload(rawBody);
  const weekdays = payload.weekdays ?? (payload.weekday !== undefined ? [payload.weekday] : []);
  const kind = payload.kind ?? AvailabilityRuleKind.available;
  const allDay = kind === AvailabilityRuleKind.unavailable && Boolean(payload.allDay);
  const row = await prisma.availabilityRule.create({
    data: {
      tenantId,
      teacherId,
      weekday: weekdays[0]!,
      weekdays,
      startTime: allDay ? (payload.startTime ?? "00:00") : payload.startTime!,
      endTime: allDay ? (payload.endTime ?? "23:59") : payload.endTime!,
      kind,
      allDay,
      locationId: payload.locationId,
      activityTags: payload.activityTags,
      priority: payload.priority ?? 0,
    },
    select: availabilityRuleSelect,
  });
  return { data: [toRuleDto(row)] };
}

export async function patchAvailabilityRule(
  tenantId: string,
  teacherIdInput: string | undefined,
  ruleIdInput: string | undefined,
  rawBody: unknown,
) {
  const teacherId = normalizeRequiredUuid(teacherIdInput, "teacherId");
  const ruleId = normalizeRequiredUuid(ruleIdInput, "ruleId");
  await requireTeacher(tenantId, teacherId);
  const existing = await prisma.availabilityRule.findFirst({
    where: { id: ruleId, tenantId, teacherId, deletedAt: null },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      kind: true,
      allDay: true,
      weekdays: true,
      weekday: true,
    },
  });
  if (!existing) {
    throwNotFound("Verfügbarkeitsregel nicht gefunden", { ruleId });
  }
  const payload = normalizeRulePayload(rawBody, true);
  const kind = payload.kind ?? existing.kind;
  const allDay = kind === AvailabilityRuleKind.unavailable && (payload.allDay ?? existing.allDay);
  const startTime = allDay ? (payload.startTime ?? existing.startTime ?? "00:00") : (payload.startTime ?? existing.startTime);
  const endTime = allDay ? (payload.endTime ?? existing.endTime ?? "23:59") : (payload.endTime ?? existing.endTime);
  if (!allDay && compareTimes(startTime, endTime) >= 0) {
    throwValidation("Endzeit muss nach der Startzeit liegen", { startTime, endTime });
  }

  const weekdays = payload.weekdays ?? (existing.weekdays.length ? existing.weekdays : [existing.weekday]);
  const data: Prisma.AvailabilityRuleUncheckedUpdateInput = {
    kind,
    allDay,
    startTime,
    endTime,
    weekdays,
    weekday: weekdays[0],
  };
  if (payload.locationId !== undefined) data.locationId = payload.locationId;
  if (payload.activityTags !== undefined) data.activityTags = payload.activityTags;
  if (payload.priority !== undefined) data.priority = payload.priority;

  const row = await prisma.availabilityRule.update({
    where: { id: ruleId },
    data,
    select: availabilityRuleSelect,
  });
  return toRuleDto(row);
}

export async function softDeleteAvailabilityRule(
  tenantId: string,
  teacherIdInput: string | undefined,
  ruleIdInput: string | undefined,
  actorUserId: string,
) {
  const teacherId = normalizeRequiredUuid(teacherIdInput, "teacherId");
  const ruleId = normalizeRequiredUuid(ruleIdInput, "ruleId");
  await requireTeacher(tenantId, teacherId);
  const rule = await prisma.availabilityRule.findFirst({
    where: { id: ruleId, tenantId, teacherId, deletedAt: null },
    select: { id: true },
  });
  if (!rule) {
    throwNotFound("Verfügbarkeitsregel nicht gefunden", { ruleId });
  }
  await prisma.availabilityRule.update({
    where: { id: ruleId },
    data: { deletedAt: new Date(), deletedByUserId: actorUserId },
  });
}

export async function listAvailabilityExceptions(tenantId: string, teacherIdInput: string | undefined) {
  const teacherId = normalizeRequiredUuid(teacherIdInput, "teacherId");
  await requireTeacher(tenantId, teacherId);
  const rows = await prisma.availabilityException.findMany({
    where: { tenantId, teacherId, deletedAt: null },
    orderBy: [{ startsOn: "asc" }, { startTime: "asc" }, { type: "asc" }],
    select: availabilityExceptionSelect,
  });
  return { data: rows.map(toExceptionDto) };
}

function normalizeExceptionPayload(rawBody: unknown, partial = false) {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const type = hasOwn(body, "type") ? normalizeExceptionType(body.type) : undefined;
  if (!partial && !type) {
    throwValidation("Ausnahmetyp ist erforderlich", { field: "type" });
  }
  const startsOn = hasOwn(body, "startsOn") ? parseDateOnly(body.startsOn, "startsOn") : undefined;
  const endsOn = hasOwn(body, "endsOn") ? parseDateOnly(body.endsOn, "endsOn") : undefined;
  if (!partial && !startsOn) {
    throwValidation("Startdatum ist erforderlich", { field: "startsOn" });
  }
  if (!partial && !endsOn) {
    throwValidation("Enddatum ist erforderlich", { field: "endsOn" });
  }
  const reason = hasOwn(body, "reason") ? optionalTrimmedString(body.reason) : undefined;
  let startTime: string | null | undefined;
  let endTime: string | null | undefined;
  if (hasOwn(body, "startTime") || hasOwn(body, "endTime")) {
    const rawStart = body.startTime;
    const rawEnd = body.endTime;
    const startEmpty = rawStart === null || rawStart === undefined || rawStart === "";
    const endEmpty = rawEnd === null || rawEnd === undefined || rawEnd === "";
    if (startEmpty && endEmpty) {
      startTime = null;
      endTime = null;
    } else if (startEmpty || endEmpty) {
      throwValidation("Von und Bis müssen beide gesetzt oder beide leer sein", { field: startEmpty ? "startTime" : "endTime" });
    } else {
      startTime = normalizeTime(rawStart, "startTime");
      endTime = normalizeTime(rawEnd, "endTime");
      if (compareTimes(startTime, endTime) >= 0) {
        throwValidation("Endzeit muss nach der Startzeit liegen", { startTime, endTime });
      }
    }
  }
  return { type, startsOn, endsOn, reason, startTime, endTime };
}

const availabilityExceptionSelect = {
  id: true,
  tenantId: true,
  teacherId: true,
  type: true,
  startsOn: true,
  endsOn: true,
  startTime: true,
  endTime: true,
  reason: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function createAvailabilityException(
  tenantId: string,
  teacherIdInput: string | undefined,
  rawBody: unknown,
) {
  const teacherId = normalizeRequiredUuid(teacherIdInput, "teacherId");
  await requireTeacher(tenantId, teacherId);
  const payload = normalizeExceptionPayload(rawBody);
  if (payload.endsOn! < payload.startsOn!) {
    throwValidation("Enddatum muss am oder nach dem Startdatum liegen", {
      startsOn: dateOnlyString(payload.startsOn!),
      endsOn: dateOnlyString(payload.endsOn!),
    });
  }

  const row = await prisma.availabilityException.create({
    data: {
      tenantId,
      teacherId,
      type: payload.type!,
      startsOn: payload.startsOn!,
      endsOn: payload.endsOn!,
      startTime: payload.startTime ?? null,
      endTime: payload.endTime ?? null,
      reason: payload.reason,
    },
    select: availabilityExceptionSelect,
  });
  return toExceptionDto(row);
}

export async function patchAvailabilityException(
  tenantId: string,
  teacherIdInput: string | undefined,
  exceptionIdInput: string | undefined,
  rawBody: unknown,
) {
  const teacherId = normalizeRequiredUuid(teacherIdInput, "teacherId");
  const exceptionId = normalizeRequiredUuid(exceptionIdInput, "exceptionId");
  await requireTeacher(tenantId, teacherId);
  const existing = await prisma.availabilityException.findFirst({
    where: { id: exceptionId, tenantId, teacherId, deletedAt: null },
    select: { id: true, startsOn: true, endsOn: true },
  });
  if (!existing) {
    throwNotFound("Verfügbarkeitsausnahme nicht gefunden", { exceptionId });
  }
  const payload = normalizeExceptionPayload(rawBody, true);
  const startsOn = payload.startsOn ?? existing.startsOn;
  const endsOn = payload.endsOn ?? existing.endsOn;
  if (endsOn < startsOn) {
    throwValidation("Enddatum muss am oder nach dem Startdatum liegen", {
      startsOn: dateOnlyString(startsOn),
      endsOn: dateOnlyString(endsOn),
    });
  }

  const data: Prisma.AvailabilityExceptionUncheckedUpdateInput = {};
  if (payload.type !== undefined) data.type = payload.type;
  if (payload.startsOn !== undefined) data.startsOn = payload.startsOn;
  if (payload.endsOn !== undefined) data.endsOn = payload.endsOn;
  if (payload.reason !== undefined) data.reason = payload.reason;
  if (payload.startTime !== undefined) data.startTime = payload.startTime;
  if (payload.endTime !== undefined) data.endTime = payload.endTime;

  const row = await prisma.availabilityException.update({
    where: { id: exceptionId },
    data,
    select: availabilityExceptionSelect,
  });
  return toExceptionDto(row);
}

export async function softDeleteAvailabilityException(
  tenantId: string,
  teacherIdInput: string | undefined,
  exceptionIdInput: string | undefined,
  actorUserId: string,
) {
  const teacherId = normalizeRequiredUuid(teacherIdInput, "teacherId");
  const exceptionId = normalizeRequiredUuid(exceptionIdInput, "exceptionId");
  await requireTeacher(tenantId, teacherId);
  const exception = await prisma.availabilityException.findFirst({
    where: { id: exceptionId, tenantId, teacherId, deletedAt: null },
    select: { id: true },
  });
  if (!exception) {
    throwNotFound("Verfügbarkeitsausnahme nicht gefunden", { exceptionId });
  }
  await prisma.availabilityException.update({
    where: { id: exceptionId },
    data: { deletedAt: new Date(), deletedByUserId: actorUserId },
  });
}

export async function updateTeacherProfile(tenantId: string, teacherIdInput: string | undefined, rawBody: unknown) {
  const teacherId = normalizeRequiredUuid(teacherIdInput, "teacherId");
  await requireTeacher(tenantId, teacherId);
  const body = (rawBody ?? {}) as Record<string, unknown>;
  if (!hasOwn(body, "color") && !hasOwn(body, "priority")) {
    throwValidation("color oder priority ist erforderlich");
  }
  const data: Prisma.TeacherProfileUncheckedUpdateInput = {};
  if (hasOwn(body, "color")) {
    data.color = parseCalendarColor(body.color);
  }
  if (hasOwn(body, "priority")) {
    const priority = Number(body.priority);
    if (!Number.isInteger(priority) || priority < -100 || priority > 100) {
      throwValidation("Priorität muss eine ganze Zahl zwischen -100 und 100 sein", { field: "priority" });
    }
    data.priority = priority;
  }
  return prisma.teacherProfile.update({
    where: { id: teacherId },
    data,
    select: { id: true, displayName: true, color: true, priority: true },
  });
}

export async function getSchedulingOptions(tenantId: string, query: { q?: string }) {
  const q = query.q?.trim();
  await ensureTeacherProfilesForTenant(tenantId);
  const [teachers, resources, lessonTypes, customers, tenant] = await Promise.all([
    prisma.teacherProfile.findMany({
      where: { tenantId, deletedAt: null, membership: { deletedAt: null } },
      select: { id: true, displayName: true, color: true, priority: true, qualifications: true },
      orderBy: [{ priority: "desc" }, { displayName: "asc" }],
    }),
    prisma.resource.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, capacity: true },
      orderBy: { name: "asc" },
    }),
    prisma.lessonType.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, defaultDurationMin: true },
      orderBy: { name: "asc" },
    }),
    prisma.customer.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(q ? { displayName: { contains: q, mode: "insensitive" } } : {}),
      },
      select: { id: true, displayName: true, customerSource: true },
      orderBy: { displayName: "asc" },
      take: 20,
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { defaultTeacherId: true, defaultLessonTypeId: true, teacherLabel: true, resourcesEnabled: true },
    }),
  ]);

  const defaultTeacherId =
    tenant?.defaultTeacherId && teachers.some((teacher) => teacher.id === tenant.defaultTeacherId)
      ? tenant.defaultTeacherId
      : null;
  const defaultLessonTypeId =
    tenant?.defaultLessonTypeId &&
    lessonTypes.some((lessonType) => lessonType.id === tenant.defaultLessonTypeId)
      ? tenant.defaultLessonTypeId
      : null;

  return {
    teachers,
    resources: tenant?.resourcesEnabled === false ? [] : resources,
    lessonTypes,
    customers,
    defaultTeacherId,
    defaultLessonTypeId,
    teacherLabel: tenant?.teacherLabel?.trim() || "Lehrer",
    resourcesEnabled: tenant?.resourcesEnabled ?? true,
    businessTimeZone: BUSINESS_TIME_ZONE,
  };
}

function overlapsRange(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function clusterOverlapping<T extends { id: string; startsAt: Date; endsAt: Date }>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const clusters: T[][] = [];
  let current: T[] = [];
  let clusterEnd = 0;
  for (const item of sorted) {
    if (!current.length || item.startsAt.getTime() < clusterEnd) {
      current.push(item);
      clusterEnd = Math.max(clusterEnd, item.endsAt.getTime());
      continue;
    }
    if (current.length > 1) clusters.push(current);
    current = [item];
    clusterEnd = item.endsAt.getTime();
  }
  if (current.length > 1) clusters.push(current);
  return clusters;
}

function parseMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function formatMinutes(total: number) {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addDaysToDateString(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function fromBusinessDateTime(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let millis = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 4; i += 1) {
    const parts = getBusinessParts(new Date(millis));
    const [actualYear, actualMonth, actualDay] = parts.date.split("-").map(Number);
    const [actualHour, actualMinute] = parts.time.split(":").map(Number);
    const delta =
      Date.UTC(year, month - 1, day, hour, minute) -
      Date.UTC(actualYear, actualMonth - 1, actualDay, actualHour, actualMinute);
    if (delta === 0) break;
    millis += delta;
  }
  return new Date(millis);
}

function conflictAppointmentDto(row: Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>) {
  const dto = toAppointmentDto(row);
  return {
    id: dto.id,
    startsAt: dto.startsAt,
    endsAt: dto.endsAt,
    status: dto.status,
    version: dto.version,
    appointmentContactText: dto.appointmentContactText,
    teacher: dto.teacher,
    teachers: dto.teachers,
    resource: dto.resource,
    lessonType: dto.lessonType,
    customer: dto.customer
      ? {
          id: dto.customer.id,
          displayName: dto.customer.displayName,
          phones: dto.customer.phones,
        }
      : null,
  };
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export async function listSchedulingConflicts(
  tenantId: string,
  query: { from?: string; to?: string },
) {
  const range = defaultRange();
  const from = query.from ? parseRequiredDate(query.from, "from") : range.from;
  const to = query.to ? parseRequiredDate(query.to, "to") : range.to;
  if (to <= from) {
    throwValidation("Ende muss nach dem Start liegen", { from: from.toISOString(), to: to.toISOString() });
  }

  const [rows, tenant] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: activeAppointmentStatuses },
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      select: appointmentSelect,
      orderBy: { startsAt: "asc" },
      take: 500,
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { teacherLabel: true, resourcesEnabled: true },
    }),
  ]);

  const teacherLabel = tenant?.teacherLabel?.trim() || "Lehrer";
  type AppointmentRow = (typeof rows)[number];
  const conflicts: {
    id: string;
    type: "TIME_OVERLAP" | "RESOURCE_DOUBLE_BOOK";
    title: string;
    detail: string;
    appointments: ReturnType<typeof conflictAppointmentDto>[];
  }[] = [];

  const byTeacher = new Map<string, AppointmentRow[]>();
  for (const row of rows) {
    for (const teacherId of assignedTeacherIdsFromRow(row)) {
      const list = byTeacher.get(teacherId) ?? [];
      list.push(row);
      byTeacher.set(teacherId, list);
    }
  }
  for (const [teacherId, list] of byTeacher) {
    for (const cluster of clusterOverlapping(list)) {
      const teacherName =
        cluster
          .flatMap((item) => item.teachers)
          .find((link) => link.teacherId === teacherId)?.teacher.displayName ||
        cluster.find((item) => item.teacherId === teacherId)?.teacher?.displayName ||
        teacherLabel;
      conflicts.push({
        id: `teacher:${teacherId}:${cluster.map((item) => item.id).sort().join("_")}`,
        type: "TIME_OVERLAP",
        title: `${teacherLabel} doppelt belegt`,
        detail: `${teacherName} · ${cluster.length} Termine überschneiden sich`,
        appointments: cluster.map(conflictAppointmentDto),
      });
    }
  }

  if (tenant?.resourcesEnabled !== false) {
    const byResource = new Map<string, AppointmentRow[]>();
    for (const row of rows) {
      if (!row.resourceId) continue;
      const list = byResource.get(row.resourceId) ?? [];
      list.push(row);
      byResource.set(row.resourceId, list);
    }
    for (const [resourceId, list] of byResource) {
      const capacity = list[0]?.resource?.capacity ?? 1;
      if (capacity <= 1) {
        for (const cluster of clusterOverlapping(list)) {
          conflicts.push({
            id: `resource:${resourceId}:${cluster.map((item) => item.id).sort().join("_")}`,
            type: "RESOURCE_DOUBLE_BOOK",
            title: "Ressource doppelt belegt",
            detail: `${list[0]?.resource?.name || "Ressource"} · ${cluster.length} Termine überschneiden sich`,
            appointments: cluster.map(conflictAppointmentDto),
          });
        }
        continue;
      }

      const events = list.flatMap((item) => [
        { at: item.startsAt.getTime(), delta: 1, item },
        { at: item.endsAt.getTime(), delta: -1, item },
      ]);
      events.sort((a, b) => a.at - b.at || a.delta - b.delta);
      const active = new Set<string>();
      const overflowGroups: AppointmentRow[][] = [];
      let lastKey = "";
      for (const event of events) {
        if (event.delta === 1) active.add(event.item.id);
        else active.delete(event.item.id);
        if (active.size > capacity) {
          const group = list.filter((item) => active.has(item.id));
          const key = group
            .map((item) => item.id)
            .sort()
            .join("_");
          if (key !== lastKey) {
            overflowGroups.push(group);
            lastKey = key;
          }
        }
      }
      for (const group of overflowGroups) {
        conflicts.push({
          id: `resource:${resourceId}:${group.map((item) => item.id).sort().join("_")}`,
          type: "RESOURCE_DOUBLE_BOOK",
          title: "Ressource überlastet",
          detail: `${group[0]?.resource?.name || "Ressource"} · Kapazität ${capacity}, ${group.length} gleichzeitige Termine`,
          appointments: group.map(conflictAppointmentDto),
        });
      }
    }
  }

  conflicts.sort(
    (a, b) => new Date(a.appointments[0]?.startsAt ?? 0).getTime() - new Date(b.appointments[0]?.startsAt ?? 0).getTime(),
  );

  return {
    data: conflicts,
    range: { from: from.toISOString(), to: to.toISOString() },
    teacherLabel,
    resourcesEnabled: tenant?.resourcesEnabled ?? true,
  };
}

type SlotCheckAppointment = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  teacherId: string | null;
  teacherIds: string[];
  resourceId: string | null;
};

function toSlotCheckAppointment(row: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  teacherId: string | null;
  resourceId: string | null;
  teachers?: { teacherId: string }[];
}): SlotCheckAppointment {
  return {
    id: row.id,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    teacherId: row.teacherId,
    resourceId: row.resourceId,
    teacherIds: assignedTeacherIdsFromRow({
      teacherId: row.teacherId,
      teachers: row.teachers ?? [],
    }),
  };
}

const slotCheckAppointmentSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  teacherId: true,
  resourceId: true,
  teachers: { select: { teacherId: true } },
} satisfies Prisma.AppointmentSelect;

function teacherBlockedByAvailability(
  rules: AvailabilityMatchRule[],
  exceptions: ExceptionMatch[],
  startsAt: Date,
  endsAt: Date,
) {
  const start = getBusinessParts(startsAt);
  const end = getBusinessParts(endsAt);
  const exceptionForDay = exceptionsForDay(exceptions, start.date);
  if (findBlockingException(exceptions, start, end)) return true;
  if (exceptionForDay.some((exception) => exception.type === AvailabilityExceptionType.extra_open)) {
    return false;
  }
  if (appointmentHitsUnavailable(rules, start, end)) return true;
  return !appointmentFitsAvailable(rules, start, end);
}

function slotIsFree(input: {
  startsAt: Date;
  endsAt: Date;
  teacherId: string | null;
  resourceId: string | null;
  excludeAppointmentId: string;
  nearby: SlotCheckAppointment[];
  resourceCapacity: Map<string, number>;
  rulesByTeacher: Map<string, AvailabilityMatchRule[]>;
  exceptionsByTeacher: Map<string, ExceptionMatch[]>;
}) {
  if (input.startsAt.getTime() <= Date.now()) return false;
  if (input.teacherId) {
    if (
      teacherBlockedByAvailability(
        input.rulesByTeacher.get(input.teacherId) ?? [],
        input.exceptionsByTeacher.get(input.teacherId) ?? [],
        input.startsAt,
        input.endsAt,
      )
    ) {
      return false;
    }
    const teacherBusy = input.nearby.some(
      (row) =>
        row.id !== input.excludeAppointmentId &&
        Boolean(input.teacherId && row.teacherIds.includes(input.teacherId)) &&
        overlapsRange(input.startsAt, input.endsAt, row.startsAt, row.endsAt),
    );
    if (teacherBusy) return false;
  }
  if (input.resourceId) {
    const capacity = input.resourceCapacity.get(input.resourceId) ?? 1;
    const overlapCount = input.nearby.filter(
      (row) =>
        row.id !== input.excludeAppointmentId &&
        row.resourceId === input.resourceId &&
        overlapsRange(input.startsAt, input.endsAt, row.startsAt, row.endsAt),
    ).length;
    if (overlapCount >= capacity) return false;
  }
  return true;
}

const FREE_SLOT_DEFAULT_WINDOW = { startTime: "08:00", endTime: "18:00" };

export type FreeSlot = { startsAt: string; endsAt: string; time: string };

/**
 * Free start times on the same business day with the same duration, closest to the requested
 * start first. A slot must be free for every teacher (and the resource, if set).
 */
async function findFreeSlotsOnDay(
  tenantId: string,
  input: {
    startsAt: Date;
    endsAt: Date;
    teacherIds: string[];
    resourceId: string | null;
    excludeAppointmentId?: string;
    limit?: number;
  },
): Promise<FreeSlot[]> {
  const limit = input.limit ?? 4;
  const durationMin = Math.max(15, Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000));
  const requested = getBusinessParts(input.startsAt);
  const dayStart = fromBusinessDateTime(requested.date, "00:00");
  const dayEnd = fromBusinessDateTime(addDaysToDateString(requested.date, 1), "00:00");

  const [rules, exceptions, rows, resource] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { tenantId, deletedAt: null, teacherId: { in: input.teacherIds } },
      select: { teacherId: true, weekday: true, weekdays: true, startTime: true, endTime: true, kind: true, allDay: true },
    }),
    prisma.availabilityException.findMany({
      where: { tenantId, deletedAt: null, teacherId: { in: input.teacherIds } },
      select: { teacherId: true, type: true, startsOn: true, endsOn: true, startTime: true, endTime: true },
    }),
    prisma.appointment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: activeAppointmentStatuses },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      select: slotCheckAppointmentSelect,
    }),
    input.resourceId
      ? prisma.resource.findFirst({ where: { id: input.resourceId, tenantId }, select: { capacity: true } })
      : null,
  ]);

  const rulesByTeacher = new Map<string, AvailabilityMatchRule[]>();
  for (const rule of rules) {
    const list = rulesByTeacher.get(rule.teacherId) ?? [];
    list.push({ ...rule, weekdays: rule.weekdays.length ? rule.weekdays : [rule.weekday] });
    rulesByTeacher.set(rule.teacherId, list);
  }
  const exceptionsByTeacher = new Map<string, ExceptionMatch[]>();
  for (const { teacherId, ...exception } of exceptions) {
    const list = exceptionsByTeacher.get(teacherId) ?? [];
    list.push(exception);
    exceptionsByTeacher.set(teacherId, list);
  }
  const checkBase = {
    excludeAppointmentId: input.excludeAppointmentId ?? "",
    nearby: rows.map(toSlotCheckAppointment),
    resourceCapacity: new Map(input.resourceId ? [[input.resourceId, resource?.capacity ?? 1]] : []),
    rulesByTeacher,
    exceptionsByTeacher,
  };

  // Without timed availability rules the whole day would count as free, so scan working hours only.
  const timedRules = (rulesByTeacher.get(input.teacherIds[0] ?? "") ?? []).filter(
    (rule) =>
      rule.kind !== AvailabilityRuleKind.unavailable && !rule.allDay && ruleCoversWeekday(rule, requested.weekday),
  );
  const windowStart = timedRules.length
    ? Math.min(...timedRules.map((rule) => parseMinutes(rule.startTime)))
    : parseMinutes(FREE_SLOT_DEFAULT_WINDOW.startTime);
  const windowEnd = timedRules.length
    ? Math.max(...timedRules.map((rule) => parseMinutes(rule.endTime)))
    : parseMinutes(FREE_SLOT_DEFAULT_WINDOW.endTime);
  const requestedMin = parseMinutes(requested.time);

  const candidates: number[] = [];
  for (let minute = windowStart; minute + durationMin <= windowEnd; minute += 15) {
    const startsAt = fromBusinessDateTime(requested.date, formatMinutes(minute));
    const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
    const free = input.teacherIds.every((teacherId, index) =>
      slotIsFree({ ...checkBase, startsAt, endsAt, teacherId, resourceId: index === 0 ? input.resourceId : null }),
    );
    if (free) candidates.push(minute);
  }

  candidates.sort((a, b) => Math.abs(a - requestedMin) - Math.abs(b - requestedMin) || a - b);
  const spacing = Math.min(durationMin, 60);
  const picked: number[] = [];
  for (const minute of candidates) {
    if (picked.length >= limit) break;
    if (picked.some((other) => Math.abs(other - minute) < spacing)) continue;
    picked.push(minute);
  }

  return picked
    .sort((a, b) => a - b)
    .map((minute) => {
      const startsAt = fromBusinessDateTime(requested.date, formatMinutes(minute));
      return {
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + durationMin * 60_000).toISOString(),
        time: formatMinutes(minute),
      };
    });
}

export type SuggestedPrioritySlot = {
  date: string;
  time: string;
  startsAt: string;
  endsAt: string;
  teacherId: string | null;
  teacherName: string | null;
  resourceId: string | null;
  priority: number;
};

function seededTieBreak(seed: string, id: string) {
  let hash = 2166136261;
  for (const char of `${seed}:${id}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Lesson-type teachers first, then teacher priority, then a pseudo-random order that is
 * stable per seed (business date) so suggestions don't jump on every availability refresh.
 */
export function rankTeacherIds(
  teachers: { id: string; priority: number }[],
  options: { lessonTypeTeacherIds?: string[]; seed: string },
): string[] {
  const typeTeachers = new Set(options.lessonTypeTeacherIds ?? []);
  const fitsType = (id: string) => (typeTeachers.has(id) ? 1 : 0);
  return [...teachers]
    .sort(
      (left, right) =>
        fitsType(right.id) - fitsType(left.id) ||
        right.priority - left.priority ||
        seededTieBreak(options.seed, left.id) - seededTieBreak(options.seed, right.id),
    )
    .map((teacher) => teacher.id);
}

async function lessonTypeTeacherIds(tenantId: string, lessonTypeId: string | null | undefined) {
  if (!lessonTypeId) return [];
  const links = await prisma.lessonTypeTeacher.findMany({
    where: { lessonTypeId, lessonType: { tenantId, deletedAt: null } },
    select: { teacherId: true },
  });
  return links.map((link) => link.teacherId);
}

export async function suggestPrioritySlots(
  tenantId: string,
  input: {
    teacherId?: string | null;
    resourceId?: string | null;
    lessonTypeId?: string | null;
    durationMin?: number;
    onDate?: string | null;
    days?: number;
    excludeAppointmentId?: string | null;
  },
  limitInput = 1,
): Promise<SuggestedPrioritySlot[]> {
  const durationMin = Math.max(15, input.durationMin ?? 60);
  const durationMs = durationMin * 60_000;
  const nowParts = getBusinessParts(new Date());
  const searchStartDate =
    input.onDate && /^\d{4}-\d{2}-\d{2}$/.test(input.onDate) && input.onDate >= nowParts.date
      ? input.onDate
      : nowParts.date;
  const dayCount = Math.max(1, input.days ?? (input.onDate ? 4 : 15));
  const searchEndDate = addDaysToDateString(searchStartDate, dayCount - 1);
  const searchFrom = fromBusinessDateTime(searchStartDate, "00:00");
  const searchTo = fromBusinessDateTime(addDaysToDateString(searchEndDate, 1), "00:00");

  const [teachers, typeTeacherIds, resources, rules, exceptions, nearbyRows, tenant] = await Promise.all([
    prisma.teacherProfile.findMany({
      where: { tenantId, deletedAt: null, membership: { deletedAt: null } },
      select: { id: true, displayName: true, priority: true },
      orderBy: [{ priority: "desc" }, { displayName: "asc" }],
    }),
    lessonTypeTeacherIds(tenantId, input.lessonTypeId),
    prisma.resource.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, capacity: true },
      orderBy: { name: "asc" },
    }),
    prisma.availabilityRule.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        teacherId: true,
        weekday: true,
        weekdays: true,
        startTime: true,
        endTime: true,
        kind: true,
        allDay: true,
        priority: true,
      },
    }),
    prisma.availabilityException.findMany({
      where: { tenantId, deletedAt: null },
      select: { teacherId: true, type: true, startsOn: true, endsOn: true, startTime: true, endTime: true },
    }),
    prisma.appointment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: activeAppointmentStatuses },
        startsAt: { lt: searchTo },
        endsAt: { gt: searchFrom },
      },
      select: slotCheckAppointmentSelect,
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { resourcesEnabled: true },
    }),
  ]);

  const nearby = nearbyRows.map(toSlotCheckAppointment);

  const resourcesEnabled = tenant?.resourcesEnabled ?? true;
  const resourceId = resourcesEnabled
    ? input.resourceId && resources.some((resource) => resource.id === input.resourceId)
      ? input.resourceId
      : (resources[0]?.id ?? null)
    : null;

  const preferredTeacherId =
    input.teacherId && teachers.some((teacher) => teacher.id === input.teacherId) ? input.teacherId : null;
  const teacherTiersFor = (date: string): string[][] => {
    const ranked = rankTeacherIds(teachers, { lessonTypeTeacherIds: typeTeacherIds, seed: date }).filter(
      (id) => id !== preferredTeacherId,
    );
    const typeTier = ranked.filter((id) => typeTeacherIds.includes(id));
    const restTier = ranked.filter((id) => !typeTeacherIds.includes(id));
    return [preferredTeacherId ? [preferredTeacherId] : [], typeTier, restTier].filter((tier) => tier.length);
  };

  const rulesByTeacher = new Map<string, AvailabilityMatchRule[]>();
  const priorityRulesByTeacher = new Map<string, AvailabilityMatchRule[]>();
  for (const rule of rules) {
    const mapped: AvailabilityMatchRule = {
      weekday: rule.weekday,
      weekdays: rule.weekdays.length ? rule.weekdays : [rule.weekday],
      startTime: rule.startTime,
      endTime: rule.endTime,
      kind: rule.kind,
      allDay: rule.allDay,
      priority: rule.priority,
    };
    const plain = rulesByTeacher.get(rule.teacherId) ?? [];
    plain.push(mapped);
    rulesByTeacher.set(rule.teacherId, plain);
    const ranked = priorityRulesByTeacher.get(rule.teacherId) ?? [];
    ranked.push(mapped);
    priorityRulesByTeacher.set(rule.teacherId, ranked);
  }
  const exceptionsByTeacher = new Map<
    string,
    ExceptionMatch[]
  >();
  for (const exception of exceptions) {
    const list = exceptionsByTeacher.get(exception.teacherId) ?? [];
    list.push({
      type: exception.type,
      startsOn: exception.startsOn,
      endsOn: exception.endsOn,
      startTime: exception.startTime,
      endTime: exception.endTime,
    });
    exceptionsByTeacher.set(exception.teacherId, list);
  }
  const resourceCapacity = new Map<string, number>(
    resources.map((resource) => [resource.id, resource.capacity]),
  );
  const checkBase = {
    excludeAppointmentId: input.excludeAppointmentId ?? "",
    nearby,
    resourceCapacity,
    rulesByTeacher,
    exceptionsByTeacher,
  };

  const teacherName = (id: string) => teachers.find((teacher) => teacher.id === id)?.displayName ?? null;

  const trySlot = (
    teacherId: string,
    startsAt: Date,
    priority: number,
  ): SuggestedPrioritySlot | null => {
    const endsAt = new Date(startsAt.getTime() + durationMs);
    if (
      !slotIsFree({
        ...checkBase,
        startsAt,
        endsAt,
        teacherId,
        resourceId,
      })
    ) {
      return null;
    }
    const parts = getBusinessParts(startsAt);
    return {
      date: parts.date,
      time: parts.time,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      teacherId,
      teacherName: teacherName(teacherId),
      resourceId,
      priority,
    };
  };

  const windowsFor = (teacherId: string, weekday: number, minPriority: number | null) => {
    const teacherRules = priorityRulesByTeacher.get(teacherId) ?? [];
    if (
      teacherRules.some(
        (rule) =>
          rule.kind === AvailabilityRuleKind.unavailable &&
          rule.allDay &&
          ruleCoversWeekday(rule, weekday),
      )
    ) {
      return [];
    }
    const available = teacherRules.filter((rule) => rule.kind !== AvailabilityRuleKind.unavailable);
    if (!available.length) {
      if (minPriority !== null && minPriority !== 0) return [];
      return [{ startTime: "08:00", endTime: "18:00", priority: 0 }];
    }
    return available
      .filter((rule) => ruleCoversWeekday(rule, weekday))
      .filter((rule) => minPriority === null || rule.priority === minPriority)
      .map((rule) => ({
        startTime: rule.allDay ? "00:00" : rule.startTime,
        endTime: rule.allDay ? "23:59" : rule.endTime,
        priority: rule.priority ?? 0,
      }))
      .sort((left, right) => right.priority - left.priority || left.startTime.localeCompare(right.startTime));
  };

  function* scanDay(
    teacherId: string,
    date: string,
    minPriority: number | null,
  ): Generator<SuggestedPrioritySlot> {
    const weekday = getBusinessParts(fromBusinessDateTime(date, "12:00")).weekday;
    for (const range of windowsFor(teacherId, weekday, minPriority)) {
      const startMin = parseMinutes(range.startTime);
      const endMin = parseMinutes(range.endTime);
      for (let slot = startMin; slot + durationMin <= endMin; slot += 15) {
        const startsAt = fromBusinessDateTime(date, formatMinutes(slot));
        const found = trySlot(teacherId, startsAt, range.priority);
        if (found) yield found;
      }
    }
  }

  const availableRules = rules.filter((rule) => rule.kind !== AvailabilityRuleKind.unavailable);
  const priorities: number[] = [
    ...new Set(availableRules.map((rule: { priority: number }) => Number(rule.priority) || 0)),
  ].sort((left, right) => right - left);
  const priorityLevels: Array<number | null> = availableRules.length ? priorities : [null];

  const limit = Math.max(1, limitInput);
  const picked: SuggestedPrioritySlot[] = [];
  // Further suggestions must not overlap earlier ones, so they are real alternatives.
  const overlapsPicked = (slot: SuggestedPrioritySlot) =>
    picked.some((other) => slot.startsAt < other.endsAt && slot.endsAt > other.startsAt);

  for (let dayOffset = 0; dayOffset < dayCount; dayOffset += 1) {
    const date = addDaysToDateString(searchStartDate, dayOffset);
    for (const tier of teacherTiersFor(date)) {
      for (const priority of priorityLevels) {
        for (const teacherId of tier) {
          for (const found of scanDay(teacherId, date, priority)) {
            if (overlapsPicked(found)) continue;
            picked.push(found);
            if (picked.length >= limit) return picked;
          }
        }
      }
    }
  }

  return picked;
}

export async function suggestNextPrioritySlot(
  tenantId: string,
  input: Parameters<typeof suggestPrioritySlots>[1],
): Promise<SuggestedPrioritySlot | null> {
  const [first] = await suggestPrioritySlots(tenantId, input, 1);
  return first ?? null;
}

export type TeacherAvailabilityReason = "absent" | "unavailable" | "booked";

export async function getTeacherAvailability(
  tenantId: string,
  query: {
    startsAt?: string;
    endsAt?: string;
    excludeAppointmentId?: string;
    teacherId?: string;
    resourceId?: string;
    lessonTypeId?: string;
  },
) {
  const startsAt = parseRequiredDate(query.startsAt, "startsAt");
  const endsAt = parseRequiredDate(query.endsAt, "endsAt");
  ensureRange(startsAt, endsAt);
  const excludeAppointmentId = query.excludeAppointmentId
    ? assertUuid(query.excludeAppointmentId, "excludeAppointmentId")
    : "";
  const preferredTeacherId = query.teacherId ? assertUuid(query.teacherId, "teacherId") : null;
  const resourceId = query.resourceId ? assertUuid(query.resourceId, "resourceId") : null;
  const lessonTypeId = query.lessonTypeId ? assertUuid(query.lessonTypeId, "lessonTypeId") : null;

  const [teachers, typeTeacherIds, rules, exceptions, rows] = await Promise.all([
    prisma.teacherProfile.findMany({
      where: { tenantId, deletedAt: null, membership: { deletedAt: null } },
      select: { id: true, priority: true },
    }),
    lessonTypeTeacherIds(tenantId, lessonTypeId),
    prisma.availabilityRule.findMany({
      where: { tenantId, deletedAt: null },
      select: { teacherId: true, weekday: true, weekdays: true, startTime: true, endTime: true, kind: true, allDay: true },
    }),
    prisma.availabilityException.findMany({
      where: { tenantId, deletedAt: null },
      select: { teacherId: true, type: true, startsOn: true, endsOn: true, startTime: true, endTime: true },
    }),
    prisma.appointment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: activeAppointmentStatuses },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: slotCheckAppointmentSelect,
    }),
  ]);

  const overlapping = rows.map(toSlotCheckAppointment);
  const start = getBusinessParts(startsAt);
  const end = getBusinessParts(endsAt);

  const ranking = rankTeacherIds(teachers, { lessonTypeTeacherIds: typeTeacherIds, seed: start.date });
  const rankedTeachers = ranking.map((id) => teachers.find((teacher) => teacher.id === id)!);

  const data = rankedTeachers.map((teacher) => {
    const teacherRules: AvailabilityMatchRule[] = rules
      .filter((rule) => rule.teacherId === teacher.id)
      .map((rule) => ({ ...rule, weekdays: rule.weekdays.length ? rule.weekdays : [rule.weekday] }));
    const teacherExceptions: ExceptionMatch[] = exceptions.filter((exception) => exception.teacherId === teacher.id);
    let reason: TeacherAvailabilityReason | null = null;
    if (findBlockingException(teacherExceptions, start, end)) {
      reason = "absent";
    } else if (teacherBlockedByAvailability(teacherRules, teacherExceptions, startsAt, endsAt)) {
      reason = "unavailable";
    } else if (overlapping.some((row) => row.teacherIds.includes(teacher.id))) {
      reason = "booked";
    }
    return {
      teacherId: teacher.id,
      available: reason === null,
      reason,
      fitsLessonType: typeTeacherIds.includes(teacher.id),
    };
  });

  const durationMin = Math.max(15, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000));
  const freeSlots = (
    await suggestPrioritySlots(
      tenantId,
      {
        teacherId: preferredTeacherId,
        resourceId,
        lessonTypeId,
        durationMin,
        onDate: start.date,
        days: 1,
        excludeAppointmentId,
      },
      2,
    )
  ).filter((slot) => slot.date === start.date);

  return {
    data,
    firstFreeSlot: freeSlots[0] ?? null,
    freeSlots,
  };
}

export type UnavailabilityKind = "vacation" | "sick" | "block" | "unavailable";

const UNAVAILABILITY_MAX_DAYS = 62;
const DAY_MINUTES = 24 * 60;

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Minutes of the day blocked by the weekly rules, mirroring `appointmentHitsUnavailable` / `appointmentFitsAvailable`. */
function ruleBlockedIntervals(rules: AvailabilityMatchRule[], weekday: number): [number, number][] {
  const blocked: [number, number][] = [];
  for (const rule of rules) {
    if (rule.kind !== AvailabilityRuleKind.unavailable || !ruleCoversWeekday(rule, weekday)) continue;
    if (rule.allDay) return [[0, DAY_MINUTES]];
    blocked.push([parseMinutes(rule.startTime), parseMinutes(rule.endTime)]);
  }
  const available = rules.filter((rule) => rule.kind !== AvailabilityRuleKind.unavailable);
  if (available.length) {
    const today = available.filter((rule) => ruleCoversWeekday(rule, weekday));
    if (!today.some((rule) => rule.allDay)) {
      let cursor = 0;
      for (const [start, end] of mergeIntervals(
        today.map((rule) => [parseMinutes(rule.startTime), parseMinutes(rule.endTime)]),
      )) {
        if (start > cursor) blocked.push([cursor, start]);
        cursor = Math.max(cursor, end);
      }
      if (cursor < DAY_MINUTES) blocked.push([cursor, DAY_MINUTES]);
    }
  }
  return mergeIntervals(blocked.filter(([start, end]) => end > start));
}

function businessMinuteToDate(date: string, minutes: number) {
  return minutes >= DAY_MINUTES
    ? fromBusinessDateTime(addDaysToDateString(date, 1), "00:00")
    : fromBusinessDateTime(date, formatMinutes(minutes));
}

/** Per teacher and business day: the time ranges in which they cannot be booked, and why. */
export async function listTeacherUnavailability(
  tenantId: string,
  query: { from?: string; to?: string; teacherId?: string | null },
) {
  const from = dateOnlyString(parseDateOnly(query.from, "from"));
  const to = dateOnlyString(parseDateOnly(query.to, "to"));
  if (to < from) {
    throwValidation("Ende muss nach dem Start liegen", { from, to });
  }
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDaysToDateString(date, 1)) {
    dates.push(date);
    if (dates.length > UNAVAILABILITY_MAX_DAYS) {
      throwValidation(`Zeitraum darf höchstens ${UNAVAILABILITY_MAX_DAYS} Tage umfassen`, { from, to });
    }
  }
  const teacherFilter = query.teacherId ? { teacherId: query.teacherId } : {};

  const [rules, exceptions] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { tenantId, deletedAt: null, ...teacherFilter },
      select: { teacherId: true, weekday: true, weekdays: true, startTime: true, endTime: true, kind: true, allDay: true },
    }),
    prisma.availabilityException.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...teacherFilter,
        startsOn: { lte: new Date(`${to}T00:00:00.000Z`) },
        endsOn: { gte: new Date(`${from}T00:00:00.000Z`) },
      },
      select: { teacherId: true, type: true, startsOn: true, endsOn: true, startTime: true, endTime: true, reason: true },
    }),
  ]);

  const teacherIds = new Set([...rules.map((rule) => rule.teacherId), ...exceptions.map((item) => item.teacherId)]);
  const data: {
    teacherId: string;
    date: string;
    kind: UnavailabilityKind;
    allDay: boolean;
    startsAt: string;
    endsAt: string;
    reason: string | null;
  }[] = [];

  for (const teacherId of teacherIds) {
    const teacherRules: AvailabilityMatchRule[] = rules
      .filter((rule) => rule.teacherId === teacherId)
      .map((rule) => ({ ...rule, weekdays: rule.weekdays.length ? rule.weekdays : [rule.weekday] }));
    const teacherExceptions = exceptions.filter((item) => item.teacherId === teacherId);

    for (const date of dates) {
      const push = (kind: UnavailabilityKind, start: number, end: number, reason: string | null = null) => {
        data.push({
          teacherId,
          date,
          kind,
          allDay: start <= 0 && end >= DAY_MINUTES,
          startsAt: businessMinuteToDate(date, start).toISOString(),
          endsAt: businessMinuteToDate(date, end).toISOString(),
          reason,
        });
      };

      const dayExceptions = exceptionsForDay(teacherExceptions, date) as typeof teacherExceptions;
      const absences = dayExceptions.filter((item) => blockingExceptionTypes.includes(item.type));
      const wholeDay = absences.find((item) => !item.startTime || !item.endTime);
      if (wholeDay) {
        push(wholeDay.type as UnavailabilityKind, 0, DAY_MINUTES, wholeDay.reason);
        continue;
      }
      for (const absence of absences) {
        push(absence.type as UnavailabilityKind, parseMinutes(absence.startTime!), parseMinutes(absence.endTime!), absence.reason);
      }

      if (dayExceptions.some((item) => item.type === AvailabilityExceptionType.extra_open)) continue;
      const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
      for (const [start, end] of ruleBlockedIntervals(teacherRules, weekday)) {
        push("unavailable", start, end);
      }
    }
  }

  data.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.teacherId.localeCompare(b.teacherId));
  return { data, range: { from, to } };
}

export async function suggestAppointmentAlternatives(
  tenantId: string,
  appointmentIdInput: string | undefined,
) {
  const appointmentId = normalizeRequiredUuid(appointmentIdInput, "appointmentId");
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId, deletedAt: null },
    select: appointmentSelect,
  });
  if (!appointment) {
    throwNotFound("Termin nicht gefunden", { appointmentId });
  }

  const durationMs = appointment.endsAt.getTime() - appointment.startsAt.getTime();
  const durationMin = Math.max(15, Math.round(durationMs / 60000));
  const startParts = getBusinessParts(appointment.startsAt);
  const searchFrom = fromBusinessDateTime(startParts.date, "00:00");
  const searchTo = fromBusinessDateTime(addDaysToDateString(startParts.date, 8), "00:00");

  const [teachers, resources, rules, exceptions, nearbyRows, tenant] = await Promise.all([
    prisma.teacherProfile.findMany({
      where: { tenantId, deletedAt: null, membership: { deletedAt: null } },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.resource.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, capacity: true },
      orderBy: { name: "asc" },
    }),
    prisma.availabilityRule.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        teacherId: true,
        weekday: true,
        weekdays: true,
        startTime: true,
        endTime: true,
        kind: true,
        allDay: true,
      },
    }),
    prisma.availabilityException.findMany({
      where: { tenantId, deletedAt: null },
      select: { teacherId: true, type: true, startsOn: true, endsOn: true, startTime: true, endTime: true },
    }),
    prisma.appointment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: activeAppointmentStatuses },
        startsAt: { lt: searchTo },
        endsAt: { gt: searchFrom },
      },
      select: slotCheckAppointmentSelect,
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { teacherLabel: true, resourcesEnabled: true },
    }),
  ]);

  const nearby = nearbyRows.map(toSlotCheckAppointment);
  const teacherLabel = tenant?.teacherLabel?.trim() || "Lehrer";
  const resourcesEnabled = tenant?.resourcesEnabled ?? true;
  const rulesByTeacher = new Map<string, AvailabilityMatchRule[]>();
  for (const rule of rules) {
    const list = rulesByTeacher.get(rule.teacherId) ?? [];
    list.push({
      weekday: rule.weekday,
      weekdays: rule.weekdays.length ? rule.weekdays : [rule.weekday],
      startTime: rule.startTime,
      endTime: rule.endTime,
      kind: rule.kind,
      allDay: rule.allDay,
    });
    rulesByTeacher.set(rule.teacherId, list);
  }
  const exceptionsByTeacher = new Map<
    string,
    ExceptionMatch[]
  >();
  for (const exception of exceptions) {
    const list = exceptionsByTeacher.get(exception.teacherId) ?? [];
    list.push({
      type: exception.type,
      startsOn: exception.startsOn,
      endsOn: exception.endsOn,
      startTime: exception.startTime,
      endTime: exception.endTime,
    });
    exceptionsByTeacher.set(exception.teacherId, list);
  }
  const resourceCapacity = new Map<string, number>(
    resources.map((resource) => [resource.id, resource.capacity]),
  );
  const checkBase: Omit<Parameters<typeof slotIsFree>[0], "startsAt" | "endsAt" | "teacherId" | "resourceId"> = {
    excludeAppointmentId: appointment.id,
    nearby,
    resourceCapacity,
    rulesByTeacher,
    exceptionsByTeacher,
  };

  const alternatives: {
    id: string;
    kind: "time" | "teacher" | "time_and_teacher" | "resource";
    title: string;
    detail: string;
    appointmentId: string;
    startsAt: string;
    endsAt: string;
    teacherId: string | null;
    resourceId: string | null;
  }[] = [];

  const pushAlternative = (
    kind: "time" | "teacher" | "time_and_teacher" | "resource",
    title: string,
    detail: string,
    startsAt: Date,
    endsAt: Date,
    teacherId: string | null,
    resourceId: string | null,
  ) => {
    if (alternatives.length >= 6) return;
    const id = `${kind}:${startsAt.toISOString()}:${teacherId ?? "none"}:${resourceId ?? "none"}`;
    if (alternatives.some((item) => item.id === id)) return;
    if (
      teacherId === appointment.teacherId &&
      resourceId === appointment.resourceId &&
      Math.abs(startsAt.getTime() - appointment.startsAt.getTime()) < 60_000
    ) {
      return;
    }
    alternatives.push({
      id,
      kind,
      title,
      detail,
      appointmentId: appointment.id,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      teacherId,
      resourceId,
    });
  };

  if (appointment.teacherId) {
    for (const teacher of teachers) {
      if (teacher.id === appointment.teacherId) continue;
      if (
        slotIsFree({
          ...checkBase,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          teacherId: teacher.id,
          resourceId: appointment.resourceId,
        })
      ) {
        pushAlternative(
          "teacher",
          `Anderer ${teacherLabel}`,
          `${teacher.displayName} · gleiche Zeit · verfügbar`,
          appointment.startsAt,
          appointment.endsAt,
          teacher.id,
          appointment.resourceId,
        );
      }
      if (alternatives.filter((item) => item.kind === "teacher").length >= 2) break;
    }
  }

  if (resourcesEnabled && appointment.resourceId) {
    for (const resource of resources) {
      if (resource.id === appointment.resourceId) continue;
      if (
        slotIsFree({
          ...checkBase,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          teacherId: appointment.teacherId,
          resourceId: resource.id,
        })
      ) {
        pushAlternative(
          "resource",
          "Andere Ressource",
          `${resource.name} · gleiche Zeit · frei`,
          appointment.startsAt,
          appointment.endsAt,
          appointment.teacherId,
          resource.id,
        );
      }
      if (alternatives.filter((item) => item.kind === "resource").length >= 2) break;
    }
  }

  const scanTeacher = appointment.teacherId
    ? teachers.filter((teacher) => teacher.id === appointment.teacherId)
    : teachers.slice(0, 1);
  const extraTeachers = teachers.filter((teacher) => teacher.id !== appointment.teacherId).slice(0, 3);
  const scanTeachers = [...scanTeacher, ...extraTeachers];

  for (const teacher of scanTeachers) {
    for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
      const date = addDaysToDateString(startParts.date, dayOffset);
      const weekday = getBusinessParts(fromBusinessDateTime(date, "12:00")).weekday;
      const teacherRules = rulesByTeacher.get(teacher.id) ?? [];
      if (
        teacherRules.some(
          (rule) =>
            rule.kind === AvailabilityRuleKind.unavailable &&
            rule.allDay &&
            ruleCoversWeekday(rule, weekday),
        )
      ) {
        continue;
      }
      const windows = teacherRules.filter(
        (rule) => rule.kind !== AvailabilityRuleKind.unavailable && ruleCoversWeekday(rule, weekday),
      );
      const ranges = windows.length
        ? windows.map((rule) => ({
            startTime: rule.allDay ? "00:00" : rule.startTime,
            endTime: rule.allDay ? "23:59" : rule.endTime,
          }))
        : [{ startTime: "08:00", endTime: "18:00" }];
      for (const range of ranges) {
        const startMin = parseMinutes(range.startTime);
        const endMin = parseMinutes(range.endTime);
        for (let slot = startMin; slot + durationMin <= endMin; slot += 15) {
          const startsAt = fromBusinessDateTime(date, formatMinutes(slot));
          const endsAt = new Date(startsAt.getTime() + durationMs);
          if (
            !slotIsFree({
              ...checkBase,
              startsAt,
              endsAt,
              teacherId: teacher.id,
              resourceId: appointment.resourceId,
            })
          ) {
            continue;
          }
          const sameTeacher = teacher.id === appointment.teacherId;
          const timeLabel = `${formatMinutes(slot)}–${formatMinutes(slot + durationMin)}`;
          const dayLabel = dayOffset === 0 ? "Heute" : dayOffset === 1 ? "Morgen" : date;
          if (sameTeacher) {
            pushAlternative(
              "time",
              "Anderes Zeitfenster",
              `${dayLabel} ${timeLabel} · ${teacher.displayName} frei`,
              startsAt,
              endsAt,
              teacher.id,
              appointment.resourceId,
            );
          } else {
            pushAlternative(
              "time_and_teacher",
              `Zeit & ${teacherLabel}`,
              `${dayLabel} ${timeLabel} · ${teacher.displayName}`,
              startsAt,
              endsAt,
              teacher.id,
              appointment.resourceId,
            );
          }
          break;
        }
        if (alternatives.length >= 6) break;
      }
      if (alternatives.length >= 6) break;
    }
    if (alternatives.length >= 6) break;
  }

  return {
    appointment: conflictAppointmentDto(appointment),
    data: alternatives,
    teacherLabel,
  };
}
