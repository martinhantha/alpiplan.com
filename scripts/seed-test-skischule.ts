import { randomUUID } from "node:crypto";
import { type AppointmentStatus, type Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addCalendarDays, tzParts, zonedLocalDate } from "../apps/web/utils/rome-time";
import { deleteTenantPermanently } from "./lib/delete-tenant";

const prisma = new PrismaClient();

const TENANT_SLUG = process.env.TEST_SKISCHULE_SLUG ?? "test-skischule";
const TENANT_NAME = process.env.TEST_SKISCHULE_NAME ?? "Test Skischule";
const PASSWORD = process.env.TEST_SKISCHULE_PASSWORD ?? "test123";
const EMAIL_DOMAIN = `${TENANT_SLUG}.local`;
const DAYS_BACK = 14;
const DAYS_AHEAD = 42;

const TEACHERS = [
  { name: "Anna Gruber", focus: "kurs" },
  { name: "Lukas Hofer", focus: "kurs" },
  { name: "Sophie Pichler", focus: "kurs" },
  { name: "Matthias Huber", focus: "kurs" },
  { name: "Julia Mair", focus: "training" },
  { name: "Florian Steiner", focus: "training" },
  { name: "Lena Moser", focus: "training" },
  { name: "Simon Egger", focus: "privat" },
  { name: "Katharina Wolf", focus: "privat" },
  { name: "David Brunner", focus: "privat" },
] as const;

const LESSON_TYPES = {
  kurs: { name: "Skikurs", durationMin: 120 },
  privat: { name: "Privatstunde", durationMin: 60 },
  training: { name: "Training", durationMin: 90 },
} as const;

const RESOURCES = ["Treffpunkt Talstation", "Kinderland", "Übungshang", "Rennpiste Nord"];

const FIRST_NAMES = [
  "Maximilian", "Emma", "Paul", "Mia", "Felix", "Hannah", "Jonas", "Lea", "Elias", "Laura",
  "Tobias", "Sarah", "Niklas", "Marie", "Fabian", "Clara", "Moritz", "Valentina", "Jakob", "Nina",
  "Luca", "Giulia", "Marco", "Chiara", "Thomas", "Eva",
];
const LAST_NAMES = [
  "Müller", "Schmid", "Wagner", "Bauer", "Fischer", "Weber", "Rossi", "Bianchi", "Kofler", "Gasser",
  "Lechner", "Thaler", "Oberhofer", "Ferrari", "Plattner", "Kerschbaumer",
];
const KURS_GROUPS = ["Gruppe Blau", "Gruppe Rot", "Gruppe Schwarz", "Kinderkurs Bambini", "Anfänger Erwachsene"];
const TRAINING_GROUPS = ["Rennteam U12", "Rennteam U14", "Rennteam U16", "Masters Training", "Freeride Camp"];

/** Deterministic PRNG so every reseed produces the same plan. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261008);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const chance = (p: number) => rand() < p;

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".");
}

async function main(): Promise<void> {
  const removed = await deleteTenantPermanently(prisma, TENANT_SLUG);
  if (removed) console.info(`Removed previous "${removed.tenantName}" before reseeding.`);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const tenant = await prisma.tenant.create({
    data: {
      name: TENANT_NAME,
      slug: TENANT_SLUG,
      teacherLabel: "Skilehrer",
      useDefaultDuration: true,
      resourcesEnabled: true,
    },
  });

  const admin = await prisma.user.create({
    data: { email: `admin@${EMAIL_DOMAIN}`, name: "Test Admin", passwordHash },
  });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: admin.id, role: "ADMIN" } });

  const teachers: { id: string; userId: string; focus: (typeof TEACHERS)[number]["focus"]; dayOff: number }[] = [];
  for (const [index, t] of TEACHERS.entries()) {
    const user = await prisma.user.create({
      data: { email: `${slugify(t.name)}@${EMAIL_DOMAIN}`, name: t.name, passwordHash },
    });
    const membership = await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "STAFF" },
    });
    const profile = await prisma.teacherProfile.create({
      data: {
        tenantId: tenant.id,
        membershipId: membership.id,
        displayName: t.name,
        qualifications: [t.focus, index < 3 ? "Landesskilehrer" : "Anwärter"],
      },
    });
    teachers.push({ id: profile.id, userId: user.id, focus: t.focus, dayOff: (index % 5) + 1 });
  }

  const lessonTypeIds = {} as Record<keyof typeof LESSON_TYPES, string>;
  for (const [key, lt] of Object.entries(LESSON_TYPES) as [keyof typeof LESSON_TYPES, (typeof LESSON_TYPES)[keyof typeof LESSON_TYPES]][]) {
    const row = await prisma.lessonType.create({
      data: { tenantId: tenant.id, name: lt.name, defaultDurationMin: lt.durationMin },
    });
    lessonTypeIds[key] = row.id;
  }

  const resourceIds: string[] = [];
  for (const name of RESOURCES) {
    const row = await prisma.resource.create({ data: { tenantId: tenant.id, name, capacity: 12 } });
    resourceIds.push(row.id);
  }
  const [talstation, kinderland, uebungshang, rennpiste] = resourceIds as [string, string, string, string];

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { defaultTeacherId: teachers[0]!.id, defaultLessonTypeId: lessonTypeIds.privat },
  });

  const customers: { id: string; name: string; phone: string }[] = [];
  for (let i = 0; i < 60; i++) {
    const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const digits = String(3_000_000 + Math.floor(rand() * 6_999_999));
    const italian = chance(0.4);
    const phone = italian ? `+39 34${digits.slice(0, 1)} ${digits.slice(1)}` : `+43 664 ${digits}`;
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        displayName: name,
        customerSource: "manual",
        notes: chance(0.3) ? pick(["Fortgeschritten", "Anfänger", "Snowboard-Umsteiger", "Kind 7 Jahre"]) : null,
        phones: {
          create: { tenantId: tenant.id, raw: phone, e164: phone.replace(/\s+/g, ""), isPrimary: true },
        },
      },
    });
    customers.push({ id: customer.id, name, phone });
  }

  const allWeekdays = [0, 1, 2, 3, 4, 5, 6];
  await prisma.availabilityRule.createMany({
    data: teachers.map((t) => {
      const weekdays = allWeekdays.filter((d) => d !== t.dayOff);
      return {
        tenantId: tenant.id,
        teacherId: t.id,
        weekday: weekdays[0]!,
        weekdays,
        startTime: "08:30",
        endTime: "17:00",
        kind: "available" as const,
      };
    }),
  });

  const today = tzParts(new Date());
  const toDate = (offset: number) => {
    const d = addCalendarDays(today, offset);
    return new Date(Date.UTC(d.year, d.month - 1, d.day));
  };
  const absentDays = new Map<string, Set<number>>();
  const exceptions = [
    { teacher: teachers[3]!, type: "vacation" as const, from: 10, to: 16, reason: "Urlaub" },
    { teacher: teachers[6]!, type: "sick" as const, from: -3, to: -1, reason: "Krank" },
  ];
  for (const e of exceptions) {
    const days = absentDays.get(e.teacher.id) ?? new Set<number>();
    for (let d = e.from; d <= e.to; d++) days.add(d);
    absentDays.set(e.teacher.id, days);
  }
  await prisma.availabilityException.createMany({
    data: exceptions.map((e) => ({
      tenantId: tenant.id,
      teacherId: e.teacher.id,
      type: e.type,
      startsOn: toDate(e.from),
      endsOn: toDate(e.to),
      reason: e.reason,
    })),
  });

  type Slot = { kind: keyof typeof LESSON_TYPES; hour: number; minute: number; resourceId: string | null };
  const scheduleFor = (focus: (typeof TEACHERS)[number]["focus"]): Slot[] => {
    if (focus === "kurs") {
      return [
        { kind: "kurs", hour: 9, minute: 30, resourceId: chance(0.5) ? kinderland : talstation },
        ...(chance(0.6) ? [{ kind: "privat" as const, hour: 12, minute: 0, resourceId: null }] : []),
        { kind: "kurs", hour: 13, minute: 30, resourceId: uebungshang },
        ...(chance(0.4) ? [{ kind: "privat" as const, hour: 15, minute: 45, resourceId: null }] : []),
      ];
    }
    if (focus === "training") {
      return [
        { kind: "training", hour: 8, minute: 45, resourceId: rennpiste },
        ...(chance(0.5) ? [{ kind: "privat" as const, hour: 10, minute: 30, resourceId: null }] : []),
        { kind: "training", hour: 13, minute: 0, resourceId: rennpiste },
        ...(chance(0.5) ? [{ kind: "privat" as const, hour: 15, minute: 0, resourceId: null }] : []),
      ];
    }
    const privateStarts: [number, number][] = [[9, 0], [10, 15], [11, 30], [13, 0], [14, 15], [15, 30]];
    return privateStarts
      .filter(() => chance(0.75))
      .map(([hour, minute]) => ({ kind: "privat" as const, hour, minute, resourceId: null }));
  };

  const now = Date.now();
  const appointments: Prisma.AppointmentCreateManyInput[] = [];
  const links: { appointmentId: string; teacherId: string }[] = [];

  for (let offset = -DAYS_BACK; offset <= DAYS_AHEAD; offset++) {
    const day = addCalendarDays(today, offset);
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    for (const teacher of teachers) {
      if (weekday === teacher.dayOff || absentDays.get(teacher.id)?.has(offset)) continue;
      for (const slot of scheduleFor(teacher.focus)) {
        const startsAt = zonedLocalDate(day, slot.hour, slot.minute);
        const endsAt = new Date(startsAt.getTime() + LESSON_TYPES[slot.kind].durationMin * 60_000);
        const past = endsAt.getTime() < now;
        let status: AppointmentStatus = past ? "completed" : chance(0.15) ? "draft" : "confirmed";
        if (chance(0.05)) status = "cancelled";

        const customer = slot.kind === "privat" ? pick(customers) : null;
        const id = randomUUID();
        appointments.push({
          id,
          tenantId: tenant.id,
          startsAt,
          endsAt,
          status,
          lessonTypeId: lessonTypeIds[slot.kind],
          teacherId: teacher.id,
          resourceId: slot.resourceId,
          customerId: customer?.id ?? null,
          appointmentContactText:
            customer?.name ?? (slot.kind === "kurs" ? pick(KURS_GROUPS) : pick(TRAINING_GROUPS)),
          appointmentPhoneRaw: customer?.phone ?? null,
          appointmentPhoneE164: customer?.phone.replace(/\s+/g, "") ?? null,
          unstructuredNote: chance(0.15) ? pick(["Leihski mitbringen", "Treffpunkt Sessellift", "Videoanalyse", "Erste Stunde"]) : null,
          createdByUserId: admin.id,
          reminderPushSentAt: past ? startsAt : null,
        });
        links.push({ appointmentId: id, teacherId: teacher.id });
      }
    }
  }

  await prisma.appointment.createMany({ data: appointments });
  await prisma.appointmentTeacher.createMany({ data: links });

  const hours = appointments.reduce(
    (sum, a) => sum + (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 3_600_000,
    0,
  );
  console.info(`Seed OK — "${TENANT_NAME}" (slug: ${TENANT_SLUG})`);
  console.info(`  ${teachers.length} Skilehrer, ${customers.length} Kunden, ${appointments.length} Termine (${hours} Stunden)`);
  console.info(`  Login admin: admin@${EMAIL_DOMAIN} / ${PASSWORD}`);
  console.info(`  Login Lehrer: z. B. ${slugify(TEACHERS[0].name)}@${EMAIL_DOMAIN} / ${PASSWORD}`);
  console.info(`  Löschen: pnpm test-skischule:delete --yes`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
