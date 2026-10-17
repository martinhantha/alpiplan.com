import { randomUUID } from "node:crypto";
import { AppointmentStatus, CustomerSource, Prisma } from "@prisma/client";
import { prisma } from "~/server/utils/prisma";
import { throwConflict, throwValidation } from "~/server/utils/api-errors";
import { addCalendarDays, dateKey, tzParts, zonedLocalDate } from "~/utils/rome-time";

/** Admin tools: CSV export/import and range deletion of a tenant's appointments. */

export const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_CHARS = 10 * 1024 * 1024;
const ID_CHUNK = 5000;

// --- Date range ---------------------------------------------------------------

export interface DateRange {
  from: string;
  to: string;
  startsAt: Date;
  endsBefore: Date;
}

function parseYmd(value: unknown, field: string) {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()) : null;
  if (!match) throwValidation(`${field} muss ein Datum (JJJJ-MM-TT) sein`, { field });
  const ymd = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  if (check.getUTCMonth() !== ymd.month - 1 || check.getUTCDate() !== ymd.day) {
    throwValidation(`${field} ist kein gültiges Datum`, { field });
  }
  return ymd;
}

/** `from`/`to` are inclusive calendar days in business time (Europe/Rome), matched against startsAt. */
export function parseDateRange(fromInput: unknown, toInput: unknown): DateRange {
  const from = parseYmd(fromInput, "from");
  const to = parseYmd(toInput, "to");
  if (dateKey(from) > dateKey(to)) {
    throwValidation("„Von“ darf nicht nach „Bis“ liegen", { field: "from" });
  }
  return {
    from: dateKey(from),
    to: dateKey(to),
    startsAt: zonedLocalDate(from, 0, 0),
    endsBefore: zonedLocalDate(addCalendarDays(to, 1), 0, 0),
  };
}

function rangeWhere(tenantId: string, range: DateRange): Prisma.AppointmentWhereInput {
  return { tenantId, startsAt: { gte: range.startsAt, lt: range.endsBefore } };
}

// --- CSV ------------------------------------------------------------------------

const DELIMITER = ";";

interface Column {
  key: ColumnKey;
  header: string;
  aliases: string[];
}

type ColumnKey =
  | "id"
  | "start"
  | "end"
  | "status"
  | "lessonType"
  | "teachers"
  | "resource"
  | "customer"
  | "contact"
  | "phone"
  | "phoneE164"
  | "note"
  | "createdAt"
  | "createdBy";

const columns: Column[] = [
  { key: "id", header: "ID", aliases: ["id"] },
  { key: "start", header: "Beginn", aliases: ["beginn", "start", "startsat", "von", "inizio"] },
  { key: "end", header: "Ende", aliases: ["ende", "end", "endsat", "bis", "fine"] },
  { key: "status", header: "Status", aliases: ["status", "stato"] },
  { key: "lessonType", header: "Termintyp", aliases: ["termintyp", "lessontype", "typ", "type", "tipo"] },
  {
    key: "teachers",
    header: "Lehrer",
    aliases: ["lehrer", "teachers", "teacher", "pilot", "piloten", "insegnante", "insegnanti", "maestro"],
  },
  { key: "resource", header: "Ressource", aliases: ["ressource", "resource", "risorsa"] },
  { key: "customer", header: "Kunde", aliases: ["kunde", "customer", "cliente"] },
  { key: "contact", header: "Kontakt", aliases: ["kontakt", "contact", "contatto", "appointmentcontacttext"] },
  { key: "phone", header: "Telefon", aliases: ["telefon", "phone", "telefono", "appointmentphoneraw"] },
  { key: "phoneE164", header: "Telefon E.164", aliases: ["telefone164", "phonee164", "e164", "appointmentphonee164"] },
  { key: "note", header: "Notiz", aliases: ["notiz", "note", "notes", "nota", "unstructurednote"] },
  { key: "createdAt", header: "Erstellt am", aliases: ["erstelltam", "createdat"] },
  { key: "createdBy", header: "Erstellt von", aliases: ["erstelltvon", "createdby"] },
];

const statusAliases: Record<string, AppointmentStatus> = {
  draft: AppointmentStatus.draft,
  entwurf: AppointmentStatus.draft,
  bozza: AppointmentStatus.draft,
  confirmed: AppointmentStatus.confirmed,
  bestaetigt: AppointmentStatus.confirmed,
  bestätigt: AppointmentStatus.confirmed,
  confermato: AppointmentStatus.confirmed,
  completed: AppointmentStatus.completed,
  abgeschlossen: AppointmentStatus.completed,
  erledigt: AppointmentStatus.completed,
  completato: AppointmentStatus.completed,
  cancelled: AppointmentStatus.cancelled,
  canceled: AppointmentStatus.cancelled,
  abgesagt: AppointmentStatus.cancelled,
  storniert: AppointmentStatus.cancelled,
  annullato: AppointmentStatus.cancelled,
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9äöü]/g, "");
}

/** Spreadsheet apps execute cells starting with these characters; phone numbers like "+39 …" stay untouched. */
function guardFormula(value: string): string {
  if (/^[=@\t\r]/.test(value)) return `'${value}`;
  if (/^[+-]/.test(value) && !/^[+-][\d\s()./-]*$/.test(value)) return `'${value}`;
  return value;
}

function unguardFormula(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

function csvCell(value: string | null | undefined): string {
  const text = guardFormula(value ?? "");
  return /[";\r\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values: Array<string | null | undefined>): string {
  return values.map(csvCell).join(DELIMITER);
}

function detectDelimiter(headerLine: string): string {
  const candidates = [";", ",", "\t"];
  let best = DELIMITER;
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = headerLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180-ish parser: quoted fields, doubled quotes, CRLF/LF, optional BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const firstLineEnd = text.search(/\r?\n/);
  const delimiter = detectDelimiter(firstLineEnd === -1 ? text : text.slice(0, firstLineEnd));
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim().length));
}

function formatLocal(date: Date): string {
  const p = tzParts(date);
  return `${dateKey(p)} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Accepts "JJJJ-MM-TT HH:mm", "TT.MM.JJJJ HH:mm" (business time) or ISO 8601 with offset. */
function parseLocalDateTime(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let ymd: { year: number; month: number; day: number } | null = null;
  let hour = 0;
  let minute = 0;

  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(trimmed);
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (iso) {
    ymd = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    hour = Number(iso[4]);
    minute = Number(iso[5]);
  } else if (german) {
    ymd = { year: Number(german[3]), month: Number(german[2]), day: Number(german[1]) };
    hour = Number(german[4]);
    minute = Number(german[5]);
  } else if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  } else {
    return null;
  }

  if (hour > 23 || minute > 59) return null;
  const check = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  if (check.getUTCMonth() !== ymd.month - 1 || check.getUTCDate() !== ymd.day) return null;
  return zonedLocalDate(ymd, hour, minute);
}

// --- Export ---------------------------------------------------------------------

const exportSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  appointmentContactText: true,
  appointmentPhoneRaw: true,
  appointmentPhoneE164: true,
  unstructuredNote: true,
  createdAt: true,
  lessonType: { select: { name: true } },
  teacher: { select: { displayName: true } },
  teachers: { select: { teacher: { select: { displayName: true } } }, orderBy: { createdAt: "asc" } },
  resource: { select: { name: true } },
  customer: { select: { displayName: true } },
  createdBy: { select: { name: true, email: true } },
} satisfies Prisma.AppointmentSelect;

export function appointmentCsvTemplate(): string {
  const header = csvLine(columns.map((c) => c.header));
  const example = csvLine([
    "",
    "2026-12-27 10:00",
    "2026-12-27 12:00",
    "confirmed",
    "Privatstunde",
    "Max Muster",
    "",
    "Familie Rossi",
    "Anna Rossi",
    "+39 333 1234567",
    "+393331234567",
    "Treffpunkt Talstation",
    "",
    "",
  ]);
  return `\uFEFF${header}\r\n${example}\r\n`;
}

export async function exportAppointmentsCsv(tenantId: string, range: DateRange): Promise<string> {
  const rows = await prisma.appointment.findMany({
    where: { ...rangeWhere(tenantId, range), deletedAt: null },
    select: exportSelect,
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
  });

  const lines = [csvLine(columns.map((c) => c.header))];
  for (const row of rows) {
    const teacherNames = row.teachers.length
      ? row.teachers.map((link) => link.teacher.displayName)
      : row.teacher
        ? [row.teacher.displayName]
        : [];
    lines.push(
      csvLine([
        row.id,
        formatLocal(row.startsAt),
        formatLocal(row.endsAt),
        row.status,
        row.lessonType?.name,
        teacherNames.join(", "),
        row.resource?.name,
        row.customer?.displayName,
        row.appointmentContactText,
        row.appointmentPhoneRaw,
        row.appointmentPhoneE164,
        row.unstructuredNote,
        formatLocal(row.createdAt),
        row.createdBy ? row.createdBy.name?.trim() || row.createdBy.email : "",
      ]),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// --- Import ---------------------------------------------------------------------

export interface ImportIssue {
  line: number;
  message: string;
}

export interface ImportResult {
  dryRun: boolean;
  imported: boolean;
  totalRows: number;
  toCreate: number;
  skipped: number;
  newCustomers: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

interface PlannedAppointment {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  lessonTypeId: string | null;
  teacherIds: string[];
  resourceId: string | null;
  customerKey: string | null;
  contact: string | null;
  phoneRaw: string | null;
  phoneE164: string | null;
  note: string | null;
}

function nameKey(value: string): string {
  return value.trim().toLowerCase();
}

function nullable(value: string | undefined): string | null {
  const trimmed = unguardFormula((value ?? "").trim());
  return trimmed.length ? trimmed : null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function importAppointmentsCsv(
  tenantId: string,
  csvInput: unknown,
  options: { dryRun: boolean; actorUserId: string },
): Promise<ImportResult> {
  if (typeof csvInput !== "string" || !csvInput.trim()) {
    throwValidation("CSV-Inhalt fehlt", { field: "csv" });
  }
  if (csvInput.length > MAX_IMPORT_CHARS) {
    throwValidation("Datei ist zu groß (max. 10 MB)", { field: "csv" });
  }

  const table = parseCsv(csvInput);
  const [headerRow, ...dataRows] = table;
  if (!headerRow || !dataRows.length) {
    throwValidation("Die Datei enthält keine Termine", { field: "csv" });
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throwValidation(`Maximal ${MAX_IMPORT_ROWS} Termine pro Import`, { field: "csv" });
  }

  const columnIndex = new Map<ColumnKey, number>();
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    const column = columns.find((c) => c.aliases.includes(normalized));
    if (column && !columnIndex.has(column.key)) columnIndex.set(column.key, index);
  });
  if (!columnIndex.has("start") || !columnIndex.has("end")) {
    throwValidation("Spalten „Beginn“ und „Ende“ sind erforderlich", { field: "csv" });
  }
  const cell = (row: string[], key: ColumnKey) => {
    const index = columnIndex.get(key);
    return index === undefined ? undefined : row[index];
  };

  const [tenant, lessonTypes, teachers, resources, customers] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { resourcesEnabled: true } }),
    prisma.lessonType.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, name: true } }),
    prisma.teacherProfile.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, displayName: true, membership: { select: { user: { select: { email: true } } } } },
    }),
    prisma.resource.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, name: true } }),
    prisma.customer.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const lessonTypeByName = new Map(lessonTypes.map((item) => [nameKey(item.name), item.id]));
  const teacherByName = new Map<string, string>();
  for (const teacher of teachers) {
    teacherByName.set(nameKey(teacher.displayName), teacher.id);
    teacherByName.set(nameKey(teacher.membership.user.email), teacher.id);
  }
  const resourceByName = new Map(resources.map((item) => [nameKey(item.name), item.id]));
  const customerByName = new Map<string, string>();
  for (const customer of customers) {
    const key = nameKey(customer.displayName);
    if (!customerByName.has(key)) customerByName.set(key, customer.id);
  }

  const requestedIds = dataRows
    .map((row) => (cell(row, "id") ?? "").trim())
    .filter((id) => uuidPattern.test(id));
  const existingIds = new Map<string, string>();
  for (let i = 0; i < requestedIds.length; i += ID_CHUNK) {
    const found = await prisma.appointment.findMany({
      where: { id: { in: requestedIds.slice(i, i + ID_CHUNK) } },
      select: { id: true, tenantId: true },
    });
    for (const item of found) existingIds.set(item.id, item.tenantId);
  }

  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const planned: PlannedAppointment[] = [];
  const newCustomers = new Map<string, { id: string; displayName: string }>();
  const seenIds = new Set<string>();
  let skipped = 0;

  dataRows.forEach((row, index) => {
    const line = index + 2;
    const rowErrors: string[] = [];

    const rawId = (cell(row, "id") ?? "").trim();
    let id: string = randomUUID();
    if (rawId) {
      if (!uuidPattern.test(rawId)) {
        rowErrors.push("ID ist keine gültige UUID");
      } else if (seenIds.has(rawId)) {
        rowErrors.push("ID kommt in der Datei mehrfach vor");
      } else if (existingIds.get(rawId) === tenantId) {
        seenIds.add(rawId);
        skipped++;
        warnings.push({ line, message: "Termin existiert bereits – übersprungen" });
        return;
      } else if (!existingIds.has(rawId)) {
        id = rawId;
      }
      seenIds.add(rawId);
    }

    const startsAt = parseLocalDateTime(cell(row, "start") ?? "");
    const endsAt = parseLocalDateTime(cell(row, "end") ?? "");
    if (!startsAt) rowErrors.push("Beginn fehlt oder ist ungültig (JJJJ-MM-TT HH:mm)");
    if (!endsAt) rowErrors.push("Ende fehlt oder ist ungültig (JJJJ-MM-TT HH:mm)");
    if (startsAt && endsAt && endsAt <= startsAt) rowErrors.push("Ende muss nach Beginn liegen");

    const statusRaw = nullable(cell(row, "status"));
    const status = statusRaw ? statusAliases[nameKey(statusRaw)] : AppointmentStatus.confirmed;
    if (!status) rowErrors.push(`Unbekannter Status „${statusRaw}“`);

    const lessonTypeName = nullable(cell(row, "lessonType"));
    const lessonTypeId = lessonTypeName ? lessonTypeByName.get(nameKey(lessonTypeName)) ?? null : null;
    if (lessonTypeName && !lessonTypeId) rowErrors.push(`Unbekannter Termintyp „${lessonTypeName}“`);

    const teacherIds: string[] = [];
    for (const name of (nullable(cell(row, "teachers")) ?? "").split(/[|,]/).map((n) => n.trim()).filter(Boolean)) {
      const teacherId = teacherByName.get(nameKey(name));
      if (!teacherId) rowErrors.push(`Unbekannter Lehrer „${name}“`);
      else if (!teacherIds.includes(teacherId)) teacherIds.push(teacherId);
    }

    const resourceName = tenant?.resourcesEnabled ? nullable(cell(row, "resource")) : null;
    const resourceId = resourceName ? resourceByName.get(nameKey(resourceName)) ?? null : null;
    if (resourceName && !resourceId) rowErrors.push(`Unbekannte Ressource „${resourceName}“`);

    const customerName = nullable(cell(row, "customer"));
    let customerKey: string | null = null;
    if (customerName) {
      customerKey = nameKey(customerName);
      if (!customerByName.has(customerKey) && !newCustomers.has(customerKey)) {
        newCustomers.set(customerKey, { id: randomUUID(), displayName: customerName });
      }
    }

    if (rowErrors.length) {
      errors.push({ line, message: rowErrors.join(" · ") });
      return;
    }
    planned.push({
      id,
      startsAt: startsAt!,
      endsAt: endsAt!,
      status: status!,
      lessonTypeId,
      teacherIds,
      resourceId,
      customerKey,
      contact: nullable(cell(row, "contact")),
      phoneRaw: nullable(cell(row, "phone")),
      phoneE164: nullable(cell(row, "phoneE164")),
      note: nullable(cell(row, "note")),
    });
  });

  const usedCustomerKeys = new Set(planned.map((p) => p.customerKey).filter(Boolean));
  const customersToCreate = [...newCustomers.entries()]
    .filter(([key]) => usedCustomerKeys.has(key))
    .map(([, value]) => value);

  const result: ImportResult = {
    dryRun: options.dryRun,
    imported: false,
    totalRows: dataRows.length,
    toCreate: planned.length,
    skipped,
    newCustomers: customersToCreate.length,
    errors,
    warnings,
  };
  if (options.dryRun || errors.length || !planned.length) return result;

  const customerId = (key: string | null) =>
    key ? customerByName.get(key) ?? newCustomers.get(key)?.id ?? null : null;

  await prisma.$transaction(
    async (tx) => {
      if (customersToCreate.length) {
        await tx.customer.createMany({
          data: customersToCreate.map((c) => ({
            id: c.id,
            tenantId,
            displayName: c.displayName,
            customerSource: CustomerSource.import,
          })),
        });
      }
      await tx.appointment.createMany({
        data: planned.map((p) => ({
          id: p.id,
          tenantId,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          status: p.status,
          lessonTypeId: p.lessonTypeId,
          teacherId: p.teacherIds[0] ?? null,
          resourceId: p.resourceId,
          customerId: customerId(p.customerKey),
          appointmentContactText: p.contact,
          appointmentPhoneRaw: p.phoneRaw,
          appointmentPhoneE164: p.phoneE164,
          unstructuredNote: p.note,
          createdByUserId: options.actorUserId,
        })),
      });
      const teacherLinks = planned.flatMap((p) => p.teacherIds.map((teacherId) => ({ appointmentId: p.id, teacherId })));
      if (teacherLinks.length) {
        await tx.appointmentTeacher.createMany({ data: teacherLinks });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: options.actorUserId,
          action: "appointments.import",
          entityType: "Appointment",
          payload: { created: planned.length, skipped, newCustomers: customersToCreate.length },
        },
      });
    },
    { timeout: 120_000 },
  );

  return { ...result, imported: true };
}

// --- Range summary & delete -----------------------------------------------------

export async function summarizeAppointmentRange(tenantId: string, range: DateRange) {
  const [byStatus, inTrash] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["status"],
      where: { ...rangeWhere(tenantId, range), deletedAt: null },
      _count: { _all: true },
    }),
    prisma.appointment.count({ where: { ...rangeWhere(tenantId, range), deletedAt: { not: null } } }),
  ]);
  const statusCounts = Object.fromEntries(
    Object.values(AppointmentStatus).map((status) => [
      status,
      byStatus.find((item) => item.status === status)?._count._all ?? 0,
    ]),
  ) as Record<AppointmentStatus, number>;
  const active = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  return { from: range.from, to: range.to, active, inTrash, byStatus: statusCounts };
}

export type RangeDeleteMode = "soft" | "permanent";

export async function deleteAppointmentRange(
  tenantId: string,
  range: DateRange,
  options: { mode: RangeDeleteMode; expectedCount: unknown; actorUserId: string },
) {
  const where: Prisma.AppointmentWhereInput =
    options.mode === "permanent"
      ? rangeWhere(tenantId, range)
      : { ...rangeWhere(tenantId, range), deletedAt: null };
  const ids = (await prisma.appointment.findMany({ where, select: { id: true } })).map((row) => row.id);

  if (typeof options.expectedCount !== "number" || options.expectedCount !== ids.length) {
    throwConflict("Die Anzahl der Termine hat sich geändert – bitte Zeitraum neu laden und erneut bestätigen", {
      expectedCount: options.expectedCount,
      actualCount: ids.length,
    });
  }
  if (!ids.length) return { deleted: 0, mode: options.mode };

  await prisma.$transaction(
    async (tx) => {
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK);
        if (options.mode === "permanent") {
          await tx.customer.updateMany({
            where: { tenantId, createdFromAppointmentId: { in: chunk } },
            data: { createdFromAppointmentId: null },
          });
          await tx.appointment.deleteMany({ where: { id: { in: chunk } } });
        } else {
          await tx.appointment.updateMany({
            where: { id: { in: chunk } },
            data: { deletedAt: new Date(), deletedByUserId: options.actorUserId, version: { increment: 1 } },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: options.actorUserId,
          action: options.mode === "permanent" ? "appointments.purge_range" : "appointments.delete_range",
          entityType: "Appointment",
          payload: { from: range.from, to: range.to, count: ids.length },
        },
      });
    },
    { timeout: 120_000 },
  );

  return { deleted: ids.length, mode: options.mode };
}
