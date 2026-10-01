// @ts-nocheck
import { PrismaClient, type Prisma, type Customer } from "@prisma/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type LegacyObjectId = { $oid?: string } | string | null | undefined;

type LegacyPilot = {
  _id?: string;
  name?: string;
  email?: string;
  phone?: string;
  info?: string;
  color?: string;
};

type LegacyFlightType = {
  _id?: string;
  name?: string;
  price?: string;
  user?: string;
};

type LegacyFlight = {
  _id?: LegacyObjectId;
  date?: string;
  pilot?: LegacyPilot | null;
  pilots?: LegacyPilot[] | null;
  passanger?: string;
  phone?: string;
  info?: string;
  completed?: boolean;
  user?: string;
  deleted?: number | boolean | string | null;
  ftype?: string | LegacyFlightType | null;
};

type ImportError = {
  index: number;
  legacyId: string | null;
  message: string;
};

type CliOptions = {
  file: string;
  tenant: string;
  update: boolean;
};

const prisma = new PrismaClient();
const LEGACY_SOURCE = "mongo:myflights.flights";
const DEFAULT_FILE = "tmp/flights.json";
const DEFAULT_TENANT = "tandem-flights";
const DEFAULT_DURATION_MIN = 60;
const ERROR_REPORT_PATH = "tmp/flights.import.errors.json";
const PILOT_NAME_ALIAS_BY_EMAIL: Record<string, string> = {
  "albert@tandem.flights": "Ally",
};
const PILOT_NAME_ALIAS_BY_NAME: Record<string, string> = {
  alebert: "Ally",
};

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    file: DEFAULT_FILE,
    tenant: DEFAULT_TENANT,
    update: false,
  };

  for (const token of argv) {
    if (token.startsWith("--file=")) {
      options.file = token.slice("--file=".length);
      continue;
    }
    if (token.startsWith("--tenant=")) {
      options.tenant = token.slice("--tenant=".length);
      continue;
    }
    if (token === "--update") {
      options.update = true;
    }
  }

  return options;
}

function extractLegacyId(value: LegacyObjectId): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.$oid === "string" && value.$oid.trim().length > 0) {
    return value.$oid.trim();
  }
  return null;
}

function parseDateOrThrow(value: string | undefined): Date {
  if (!value) {
    throw new Error("Missing date");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toE164Fallback(rawPhone: string | null): string | null {
  if (!rawPhone) return null;
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

function isPastFlightDate(date: Date): boolean {
  const flightDay = new Date(date);
  flightDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return flightDay < today;
}

function isDeletedFlight(value: LegacyFlight["deleted"]): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

function normalizePilotName(name: string | null, email: string | null): string | null {
  if (email) {
    const byEmail = PILOT_NAME_ALIAS_BY_EMAIL[email];
    if (byEmail) return byEmail;
  }
  if (!name) return null;
  const byName = PILOT_NAME_ALIAS_BY_NAME[name.toLowerCase()];
  return byName ?? name;
}

function getPrimaryPilot(flight: LegacyFlight): LegacyPilot | null {
  if (flight.pilot && normalizeOptionalString(flight.pilot.email)) {
    return flight.pilot;
  }
  if (flight.pilot && normalizeOptionalString(flight.pilot.name)) {
    return flight.pilot;
  }
  if (Array.isArray(flight.pilots)) {
    const withEmail = flight.pilots.find((pilot) =>
      Boolean(normalizeOptionalString(pilot?.email))
    );
    if (withEmail) return withEmail;
    const withName = flight.pilots.find((pilot) =>
      Boolean(normalizeOptionalString(pilot?.name))
    );
    if (withName) return withName;
  }
  return null;
}

function pilotImportEmail(
  pilot: LegacyPilot,
  tenantSlug: string
): string | null {
  const direct = normalizeOptionalString(pilot.email)?.toLowerCase();
  if (direct) return direct;
  const name = normalizeOptionalString(pilot.name);
  if (!name) return null;
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  if (!slug) return null;
  const legacyId = normalizeOptionalString(pilot._id)?.replace(/[^a-z0-9]/gi, "");
  const suffix = legacyId ? `.${legacyId.slice(-8)}` : "";
  return `legacy.${slug}${suffix}@${tenantSlug}.import.local`;
}

function collectLegacyPilots(flight: LegacyFlight): LegacyPilot[] {
  const seen = new Set<string>();
  const result: LegacyPilot[] = [];
  const push = (pilot: LegacyPilot | null | undefined) => {
    if (!pilot) return;
    if (!normalizeOptionalString(pilot.email) && !normalizeOptionalString(pilot.name)) {
      return;
    }
    const key =
      normalizeOptionalString(pilot.email)?.toLowerCase() ??
      normalizeOptionalString(pilot.name)?.toLowerCase() ??
      normalizeOptionalString(pilot._id);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(pilot);
  };
  push(flight.pilot ?? undefined);
  if (Array.isArray(flight.pilots)) {
    for (const pilot of flight.pilots) push(pilot);
  }
  return result;
}

function pilotStatsLabel(
  pilot: LegacyPilot | null,
  tenantSlug: string
): string {
  if (!pilot) return "(ohne Pilot)";
  const email = pilotImportEmail(pilot, tenantSlug);
  const name = normalizePilotName(normalizeOptionalString(pilot.name), email);
  return name ?? email ?? "(ohne Pilot)";
}

async function syncAppointmentTeachers(
  tx: Prisma.TransactionClient,
  appointmentId: string,
  teacherIds: string[]
): Promise<void> {
  await tx.appointmentTeacher.deleteMany({ where: { appointmentId } });
  if (!teacherIds.length) return;
  await tx.appointmentTeacher.createMany({
    data: teacherIds.map((teacherId) => ({ appointmentId, teacherId })),
    skipDuplicates: true,
  });
}

function getFlightTypeInfo(ftype: LegacyFlight["ftype"]): {
  legacyFtypeId: string | null;
  lessonTypeName: string | null;
} {
  if (!ftype) {
    return { legacyFtypeId: null, lessonTypeName: null };
  }
  if (typeof ftype === "string") {
    const legacyFtypeId = normalizeOptionalString(ftype);
    return {
      legacyFtypeId,
      lessonTypeName: legacyFtypeId ? `Legacy Flight ${legacyFtypeId}` : null,
    };
  }
  const legacyFtypeId = normalizeOptionalString(ftype._id);
  const lessonTypeName = normalizeOptionalString(ftype.name);
  return {
    legacyFtypeId,
    lessonTypeName:
      lessonTypeName ??
      (legacyFtypeId ? `Legacy Flight ${legacyFtypeId}` : null),
  };
}

async function loadFlights(filePath: string): Promise<LegacyFlight[]> {
  const absolutePath = path.resolve(filePath);
  const content = await readFile(absolutePath, "utf8");
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("Expected JSON array in flights file");
    }
    return parsed as LegacyFlight[];
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LegacyFlight);
}

async function ensureTeacherProfile(
  tx: Prisma.TransactionClient,
  tenantId: string,
  tenantSlug: string,
  pilot: LegacyPilot | undefined
): Promise<string | null> {
  if (!pilot) return null;
  const email = pilotImportEmail(pilot, tenantSlug);
  if (!email) return null;

  const rawPilotName = normalizeOptionalString(pilot?.name);
  const pilotName = normalizePilotName(rawPilotName, email);
  const user = await tx.user.upsert({
    where: { email },
    create: {
      email,
      name: pilotName,
      passwordHash: null,
    },
    update: {},
  });

  if (!user.name && pilotName) {
    await tx.user.update({
      where: { id: user.id },
      data: { name: pilotName },
    });
  }

  const membership = await tx.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId,
        userId: user.id,
      },
    },
    create: {
      tenantId,
      userId: user.id,
      role: "STAFF",
    },
    update: {
      role: "STAFF",
      deletedAt: null,
      deletedByUserId: null,
    },
  });

  const teacherDisplayName = pilotName ?? email;
  const teacher = await tx.teacherProfile.upsert({
    where: { membershipId: membership.id },
    create: {
      tenantId,
      membershipId: membership.id,
      displayName: teacherDisplayName,
    },
    update: {
      tenantId,
      displayName: teacherDisplayName,
      deletedAt: null,
      deletedByUserId: null,
    },
  });

  return teacher.id;
}

async function findOrCreateLessonType(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lessonTypeName: string | null
): Promise<string | null> {
  const normalizedName = normalizeOptionalString(lessonTypeName ?? undefined);
  if (!normalizedName) return null;

  const existing = await tx.lessonType.findFirst({
    where: {
      tenantId,
      name: normalizedName,
    },
    select: {
      id: true,
    },
  });
  if (existing) return existing.id;

  const created = await tx.lessonType.create({
    data: {
      tenantId,
      name: normalizedName,
      defaultDurationMin: DEFAULT_DURATION_MIN,
    },
    select: {
      id: true,
    },
  });
  return created.id;
}

async function findOrCreateCustomer(
  tx: Prisma.TransactionClient,
  tenantId: string,
  displayNameInput: string | null,
  phoneRawInput: string | null
): Promise<Customer | null> {
  const displayName = normalizeOptionalString(displayNameInput ?? undefined);
  const phoneRaw = normalizeOptionalString(phoneRawInput ?? undefined);

  if (!displayName) return null;

  let existing: Customer | null = null;
  if (phoneRaw) {
    existing = await tx.customer.findFirst({
      where: {
        tenantId,
        displayName,
        deletedAt: null,
        phones: {
          some: {
            raw: phoneRaw,
            deletedAt: null,
          },
        },
      },
    });
  } else {
    existing = await tx.customer.findFirst({
      where: {
        tenantId,
        displayName,
        deletedAt: null,
      },
    });
  }

  if (existing) return existing;

  return tx.customer.create({
    data: {
      tenantId,
      displayName,
      customerSource: "import",
      phones: phoneRaw
        ? {
            create: {
              tenantId,
              raw: phoneRaw,
              e164: toE164Fallback(phoneRaw),
              isPrimary: true,
            },
          }
        : undefined,
    },
  });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const flights = await loadFlights(options.file);
  const errors: ImportError[] = [];
  let created = 0;
  let skipped = 0;
  let updated = 0;
  const flightsPerPilot = new Map<string, number>();

  const tenant = await prisma.tenant.findUnique({
    where: { slug: options.tenant },
    select: { id: true, slug: true },
  });
  if (!tenant) {
    throw new Error(`Tenant with slug "${options.tenant}" not found.`);
  }

  const existingAppointments = await prisma.appointment.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, parseSnapshot: true },
  });
  const appointmentIdByLegacyId = new Map<string, string>();
  for (const appointment of existingAppointments) {
    const legacyId = normalizeOptionalString(
      (appointment.parseSnapshot as { legacyId?: string } | null)?.legacyId
    );
    if (legacyId && !appointmentIdByLegacyId.has(legacyId)) {
      appointmentIdByLegacyId.set(legacyId, appointment.id);
    }
  }

  for (const [index, flight] of flights.entries()) {
    const legacyId = extractLegacyId(flight._id);
    try {
      if (!legacyId) {
        throw new Error("Missing _id.$oid legacy identifier");
      }

      const startsAt = parseDateOrThrow(flight.date);
      const endsAt = new Date(
        startsAt.getTime() + DEFAULT_DURATION_MIN * 60 * 1000
      );
      const passengerName = normalizeOptionalString(flight.passanger);
      const phoneRaw = normalizeOptionalString(flight.phone);
      const phoneE164 = toE164Fallback(phoneRaw);
      const note = normalizeOptionalString(flight.info);
      const legacyPilots = collectLegacyPilots(flight);
      const primaryPilot = getPrimaryPilot(flight) ?? legacyPilots[0] ?? null;
      const deleted = isDeletedFlight(flight.deleted);
      const { legacyFtypeId, lessonTypeName } = getFlightTypeInfo(flight.ftype);
      const existingAppointmentId = appointmentIdByLegacyId.get(legacyId) ?? null;

      await prisma.$transaction(async (tx) => {
        if (existingAppointmentId && !options.update) {
          skipped += 1;
          return;
        }

        const teacherIds: string[] = [];
        for (const legacyPilot of legacyPilots) {
          const id = await ensureTeacherProfile(
            tx,
            tenant.id,
            tenant.slug,
            legacyPilot
          );
          if (id && !teacherIds.includes(id)) teacherIds.push(id);
        }
        const teacherId = teacherIds[0] ?? null;
        const lessonTypeId = await findOrCreateLessonType(
          tx,
          tenant.id,
          lessonTypeName
        );
        const customer = await findOrCreateCustomer(
          tx,
          tenant.id,
          passengerName,
          phoneRaw
        );

        const parseSnapshot = {
          legacyId,
          legacySource: LEGACY_SOURCE,
          createdByEmail: normalizeOptionalString(flight.user),
          pilotColor: normalizeOptionalString(primaryPilot?.color),
          pilotInfo: normalizeOptionalString(primaryPilot?.info),
          legacyDeleted: deleted,
          legacyFtypeId,
          legacyFtypeName: lessonTypeName,
          legacyPilots: legacyPilots.length ? legacyPilots : null,
        };

        const appointmentData: Prisma.AppointmentUncheckedCreateInput = {
          tenantId: tenant.id,
          startsAt,
          endsAt,
          status: deleted
            ? "cancelled"
            : flight.completed || isPastFlightDate(startsAt)
              ? "completed"
              : "confirmed",
          lessonTypeId,
          teacherId,
          customerId: customer?.id ?? null,
          appointmentContactText: passengerName,
          appointmentPhoneRaw: phoneRaw,
          appointmentPhoneE164: phoneE164,
          unstructuredNote: note,
          parseSnapshot,
          deletedAt: deleted ? new Date() : null,
          deletedByUserId: null,
        };

        let appointmentId = existingAppointmentId;
        if (existingAppointmentId) {
          await tx.appointment.update({
            where: { id: existingAppointmentId },
            data: appointmentData,
          });
          updated += 1;
        } else {
          const createdAppointment = await tx.appointment.create({
            data: appointmentData,
            select: { id: true },
          });
          appointmentId = createdAppointment.id;
          appointmentIdByLegacyId.set(legacyId, createdAppointment.id);
          created += 1;
        }

        if (appointmentId) {
          await syncAppointmentTeachers(tx, appointmentId, teacherIds);
        }
      });

      const statsKey = pilotStatsLabel(primaryPilot, tenant.slug);
      flightsPerPilot.set(statsKey, (flightsPerPilot.get(statsKey) ?? 0) + 1);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown import error";
      errors.push({
        index,
        legacyId,
        message,
      });
      console.error(
        `[${index}] Failed${legacyId ? ` (${legacyId})` : ""}: ${message}`
      );
    }
  }

  const errorOutputAbsolutePath = path.resolve(ERROR_REPORT_PATH);
  await mkdir(path.dirname(errorOutputAbsolutePath), { recursive: true });
  await writeFile(errorOutputAbsolutePath, JSON.stringify(errors, null, 2), "utf8");

  console.info(
    JSON.stringify(
      {
        tenant: tenant.slug,
        file: path.resolve(options.file),
        flights: flights.length,
        created,
        updated,
        skipped,
        errors: errors.length,
        errorReport: errorOutputAbsolutePath,
        flightsPerPilot: Object.fromEntries(
          [...flightsPerPilot.entries()].sort((a, b) => b[1] - a[1])
        ),
      },
      null,
      2
    )
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
