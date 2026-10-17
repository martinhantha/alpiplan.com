import bcrypt from "bcryptjs";
import { AppointmentStatus, TenantRole } from "@prisma/client";
import { prisma } from "~/server/utils/prisma";
import { throwApiError, throwConflict, throwNotFound, throwValidation } from "~/server/utils/api-errors";
import { assertUuid } from "~/server/utils/authz";

const userPublicSelect = {
  id: true,
  email: true,
  name: true,
  isSuperadmin: true,
  disabledAt: true,
} as const;

const allowedRoles: TenantRole[] = [TenantRole.ADMIN, TenantRole.STAFF, TenantRole.END_CUSTOMER];

export type UserActor = { id: string; isSuperadmin: boolean };

function normalizeRole(value: unknown): TenantRole {
  if (typeof value !== "string" || !allowedRoles.includes(value as TenantRole)) {
    throwValidation("Gültige Rolle ist erforderlich", { field: "role" });
  }
  return value as TenantRole;
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throwValidation("E-Mail ist erforderlich", { field: "email" });
  }
  const email = value.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throwValidation("Gültige E-Mail ist erforderlich", { field: "email" });
  }
  return email;
}

export async function assertEmailAvailable(email: string, excludeUserId?: string) {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing && existing.id !== excludeUserId) {
    throwConflict("Diese E-Mail ist bereits vergeben", { field: "email" });
  }
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length ? name : null;
}

const teacherRoles: TenantRole[] = [TenantRole.ADMIN, TenantRole.STAFF];

export async function ensureTeacherProfile(params: {
  tenantId: string;
  membershipId: string;
  role: TenantRole;
  displayName: string;
}) {
  if (!teacherRoles.includes(params.role)) return;
  const displayName = params.displayName.trim() || "Lehrer";
  const [membership, existing] = await Promise.all([
    prisma.membership.findUnique({
      where: { id: params.membershipId },
      select: { performsAppointments: true },
    }),
    prisma.teacherProfile.findUnique({
      where: { membershipId: params.membershipId },
      select: { id: true, deletedAt: true },
    }),
  ]);
  if (membership && !membership.performsAppointments) {
    if (existing && !existing.deletedAt) {
      await prisma.$transaction([
        prisma.teacherProfile.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        }),
        prisma.tenant.updateMany({
          where: { id: params.tenantId, defaultTeacherId: existing.id },
          data: { defaultTeacherId: null },
        }),
      ]);
    }
    return;
  }
  if (!existing) {
    await prisma.teacherProfile.create({
      data: {
        tenantId: params.tenantId,
        membershipId: params.membershipId,
        displayName,
      },
    });
    return;
  }
  if (existing.deletedAt) {
    await prisma.teacherProfile.update({
      where: { id: existing.id },
      data: { deletedAt: null, deletedByUserId: null, displayName, tenantId: params.tenantId },
    });
  }
}

export async function ensureTeacherProfilesForTenant(tenantId: string) {
  const memberships = await prisma.membership.findMany({
    where: { tenantId, deletedAt: null, role: { in: teacherRoles }, performsAppointments: true },
    select: {
      id: true,
      role: true,
      user: { select: { name: true, email: true } },
    },
  });
  for (const membership of memberships) {
    await ensureTeacherProfile({
      tenantId,
      membershipId: membership.id,
      role: membership.role,
      displayName: membership.user.name?.trim() || membership.user.email,
    });
  }
}

export async function listTenantMembers(tenantId: string) {
  await ensureTeacherProfilesForTenant(tenantId);
  const memberships = await prisma.membership.findMany({
    where: { tenantId, deletedAt: null, user: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      performsAppointments: true,
      createdAt: true,
      user: {
        select: userPublicSelect,
      },
      teacherProfile: {
        select: { id: true, color: true, priority: true, deletedAt: true },
      },
    },
  });

  return {
    data: memberships.map((m) => ({
      membershipId: m.id,
      role: m.role,
      performsAppointments: m.performsAppointments,
      createdAt: m.createdAt.toISOString(),
      teacherProfile:
        m.teacherProfile && !m.teacherProfile.deletedAt
          ? { id: m.teacherProfile.id, color: m.teacherProfile.color, priority: m.teacherProfile.priority }
          : null,
      user: {
        ...m.user,
        disabledAt: m.user.disabledAt?.toISOString() ?? null,
      },
    })),
  };
}

export async function addTenantMember(tenantId: string, rawBody: unknown) {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const role = normalizeRole(body.role);
  const name = normalizeName(body.name);
  const passwordRaw = typeof body.password === "string" ? body.password : "";
  const sendInvite = body.sendInvite === true;

  let user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { ...userPublicSelect, passwordHash: true },
  });

  if (!user) {
    if (!(sendInvite && !passwordRaw) && passwordRaw.length < 6) {
      throwValidation("Passwort muss mindestens 6 Zeichen haben", { field: "password" });
    }
    const passwordHash = passwordRaw ? await bcrypt.hash(passwordRaw, 10) : null;
    user = await prisma.user.create({
      data: { email, name, passwordHash, isSuperadmin: false },
      select: { ...userPublicSelect, passwordHash: true },
    });
  }

  const existing = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId: user.id } },
    select: { id: true, deletedAt: true },
  });

  if (existing && !existing.deletedAt) {
    throwConflict("Benutzer ist bereits Mitglied dieses Mandanten", {
      conflictType: "MEMBER_EXISTS",
      userId: user.id,
    });
  }

  const membership = existing
    ? await prisma.membership.update({
        where: { id: existing.id },
        data: { role, deletedAt: null, deletedByUserId: null },
        select: { id: true, role: true, createdAt: true },
      })
    : await prisma.membership.create({
        data: { tenantId, userId: user.id, role },
        select: { id: true, role: true, createdAt: true },
      });

  await ensureTeacherProfile({
    tenantId,
    membershipId: membership.id,
    role: membership.role,
    displayName: user.name?.trim() || user.email,
  });

  return {
    membershipId: membership.id,
    role: membership.role,
    createdAt: membership.createdAt.toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperadmin: user.isSuperadmin,
      disabledAt: user.disabledAt?.toISOString() ?? null,
    },
  };
}

export async function updateTenantMember(
  tenantId: string,
  userIdInput: string | undefined,
  rawBody: unknown,
  actor: UserActor,
) {
  const userId = assertUuid(userIdInput, "userId");
  const body = (rawBody ?? {}) as Record<string, unknown>;

  const membership = await prisma.membership.findFirst({
    where: { tenantId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!membership) {
    throwNotFound("Mitgliedschaft nicht gefunden", { tenantId, userId });
  }

  const userUpdate: { email?: string; name?: string | null; passwordHash?: string } = {};
  if (hasOwn(body, "email")) {
    const email = normalizeEmail(body.email);
    await assertEmailAvailable(email, userId);
    userUpdate.email = email;
  }
  if (hasOwn(body, "name")) {
    userUpdate.name = normalizeName(body.name);
  }
  if (hasOwn(body, "password")) {
    const passwordRaw = typeof body.password === "string" ? body.password : "";
    if (passwordRaw.length > 0) {
      if (passwordRaw.length < 6) {
        throwValidation("Passwort muss mindestens 6 Zeichen haben", { field: "password" });
      }
      userUpdate.passwordHash = await bcrypt.hash(passwordRaw, 10);
    }
  }

  const membershipUpdate: { role?: TenantRole; performsAppointments?: boolean } = {};
  if (hasOwn(body, "role")) {
    membershipUpdate.role = normalizeRole(body.role);
  }
  if (hasOwn(body, "performsAppointments")) {
    if (typeof body.performsAppointments !== "boolean") {
      throwValidation("performsAppointments muss true oder false sein", { field: "performsAppointments" });
    }
    membershipUpdate.performsAppointments = body.performsAppointments;
    if (!body.performsAppointments) {
      await assertNoOpenTeacherAppointments(membership.id);
    }
  }

  const wantsDisabled = hasOwn(body, "disabled");
  if (!Object.keys(userUpdate).length && !Object.keys(membershipUpdate).length && !wantsDisabled) {
    throwValidation("Keine Änderungen übermittelt");
  }

  if (wantsDisabled) {
    await setUserDisabled(userId, Boolean(body.disabled), actor);
  }

  if (Object.keys(userUpdate).length || Object.keys(membershipUpdate).length) {
    await prisma.$transaction([
      ...(Object.keys(membershipUpdate).length
        ? [
            prisma.membership.update({
              where: { id: membership.id },
              data: membershipUpdate,
              select: { id: true },
            }),
          ]
        : []),
      ...(Object.keys(userUpdate).length
        ? [prisma.user.update({ where: { id: userId }, data: userUpdate })]
        : []),
    ]);
  }

  const refreshed = await prisma.membership.findUnique({
    where: { id: membership.id },
    select: {
      id: true,
      role: true,
      performsAppointments: true,
      createdAt: true,
      user: { select: userPublicSelect },
    },
  });
  if (!refreshed) {
    throwNotFound("Mitgliedschaft nicht gefunden", { tenantId, userId });
  }

  await ensureTeacherProfile({
    tenantId,
    membershipId: refreshed.id,
    role: refreshed.role,
    displayName: refreshed.user.name?.trim() || refreshed.user.email,
  });

  return {
    membershipId: refreshed.id,
    role: refreshed.role,
    performsAppointments: refreshed.performsAppointments,
    createdAt: refreshed.createdAt.toISOString(),
    user: {
      ...refreshed.user,
      disabledAt: refreshed.user.disabledAt?.toISOString() ?? null,
    },
  };
}

async function assertNoOpenTeacherAppointments(membershipId: string) {
  const profile = await prisma.teacherProfile.findUnique({
    where: { membershipId },
    select: { id: true, deletedAt: true },
  });
  if (!profile || profile.deletedAt) return;
  const openCount = await prisma.appointment.count({
    where: {
      deletedAt: null,
      status: { in: [AppointmentStatus.draft, AppointmentStatus.confirmed] },
      endsAt: { gt: new Date() },
      OR: [{ teacherId: profile.id }, { teachers: { some: { teacherId: profile.id } } }],
    },
  });
  if (openCount > 0) {
    throwConflict(
      `Benutzer hat noch ${openCount} offene ${openCount === 1 ? "Termin" : "Termine"} – bitte zuerst einer anderen Person zuweisen.`,
      { conflictType: "OPEN_APPOINTMENTS", openCount },
    );
  }
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export async function removeTenantMember(
  tenantId: string,
  userIdInput: string | undefined,
  actorUserId: string,
) {
  const userId = assertUuid(userIdInput, "userId");
  const membership = await prisma.membership.findFirst({
    where: { tenantId, userId, deletedAt: null },
    select: { id: true, teacherProfile: { select: { id: true } } },
  });
  if (!membership) {
    throwNotFound("Mitgliedschaft nicht gefunden", { tenantId, userId });
  }
  await prisma.$transaction(async (tx) => {
    await tx.membership.update({
      where: { id: membership.id },
      data: { deletedAt: new Date(), deletedByUserId: actorUserId },
    });
    if (membership.teacherProfile) {
      await tx.tenant.updateMany({
        where: { id: tenantId, defaultTeacherId: membership.teacherProfile.id },
        data: { defaultTeacherId: null },
      });
    }
  });
}

export async function restoreTenantMember(tenantId: string, membershipIdInput: string | undefined) {
  const membershipId = assertUuid(membershipIdInput, "id");
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, tenantId, deletedAt: { not: null } },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: {
        select: {
          ...userPublicSelect,
          deletedAt: true,
        },
      },
    },
  });
  if (!membership) {
    throwNotFound("Gelöschte Mitgliedschaft nicht gefunden", { membershipId });
  }

  await prisma.$transaction(async (tx) => {
    await tx.membership.update({
      where: { id: membership.id },
      data: { deletedAt: null, deletedByUserId: null },
    });
    if (membership.user.deletedAt) {
      await tx.user.update({
        where: { id: membership.user.id },
        data: { deletedAt: null, deletedByUserId: null, disabledAt: null },
      });
    }
  });

  await ensureTeacherProfile({
    tenantId,
    membershipId: membership.id,
    role: membership.role,
    displayName: membership.user.name?.trim() || membership.user.email,
  });

  const refreshed = await prisma.membership.findUnique({
    where: { id: membership.id },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: userPublicSelect },
    },
  });
  if (!refreshed) {
    throwNotFound("Mitgliedschaft nicht gefunden", { membershipId });
  }

  return {
    membershipId: refreshed.id,
    role: refreshed.role,
    createdAt: refreshed.createdAt.toISOString(),
    user: {
      ...refreshed.user,
      disabledAt: refreshed.user.disabledAt?.toISOString() ?? null,
    },
  };
}

export async function setUserDisabled(userId: string, disabled: boolean, actor: UserActor) {
  if (userId === actor.id) {
    throwValidation(disabled ? "Du kannst dich nicht selbst sperren" : "Du kannst dich nicht selbst entsperren");
  }
  const target = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, isSuperadmin: true },
  });
  if (!target) {
    throwNotFound("Benutzer nicht gefunden", { userId });
  }
  if (target.isSuperadmin && !actor.isSuperadmin) {
    throwApiError(403, "FORBIDDEN", "Superadmin kann nicht gesperrt werden");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { disabledAt: disabled ? new Date() : null },
  });
}

export async function softDeleteUser(userId: string, actor: UserActor, tenantId?: string) {
  if (userId === actor.id) {
    throwValidation("Du kannst dich nicht selbst löschen");
  }
  const target = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      isSuperadmin: true,
      memberships: { where: { deletedAt: null }, select: { tenantId: true } },
    },
  });
  if (!target) {
    throwNotFound("Benutzer nicht gefunden", { userId });
  }
  if (target.isSuperadmin && !actor.isSuperadmin) {
    throwApiError(403, "FORBIDDEN", "Superadmin kann nicht gelöscht werden");
  }
  if (!actor.isSuperadmin) {
    if (!tenantId) {
      throwApiError(403, "FORBIDDEN", "Keine Berechtigung, diesen Benutzer zu löschen");
    }
    const inTenant = target.memberships.some((m) => m.tenantId === tenantId);
    if (!inTenant) {
      throwNotFound("Mitgliedschaft nicht gefunden", { tenantId, userId });
    }
    const otherTenants = target.memberships.filter((m) => m.tenantId !== tenantId);
    if (otherTenants.length) {
      throwConflict(
        "Benutzer ist noch in anderen Mandanten und kann nur von einem Superadmin gelöscht werden",
        { otherTenantCount: otherTenants.length },
      );
    }
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { deletedAt: now, deletedByUserId: actor.id, disabledAt: now },
    }),
    prisma.membership.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: now, deletedByUserId: actor.id },
    }),
  ]);
}
