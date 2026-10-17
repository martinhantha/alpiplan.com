import bcrypt from "bcryptjs";
import { TenantRole } from "@prisma/client";
import { prisma } from "~/server/utils/prisma";
import { requireSuperadmin } from "~/server/utils/authz";
import { assertEmailAvailable, ensureTeacherProfile, normalizeEmail } from "~/server/utils/members";
import { sendPasswordLink } from "~/server/utils/password-tokens";

export default defineEventHandler(async (event) => {
  const session = await requireSuperadmin(event);
  const body = await readBody<{
    email?: string;
    name?: string;
    password?: string;
    isSuperadmin?: boolean;
    tenantId?: string;
    role?: TenantRole;
    sendInvite?: boolean;
  }>(event);

  const email = normalizeEmail(body.email);
  await assertEmailAvailable(email);
  const password = body.password ?? "";
  const name = body.name?.trim() || null;
  const isSuperadmin = Boolean(body.isSuperadmin);
  const sendInvite = body.sendInvite === true && !password;

  if (!sendInvite && password.length < 6) {
    throw createError({ statusCode: 400, statusMessage: "Passwort muss mindestens 6 Zeichen haben" });
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const role = body.role && Object.values(TenantRole).includes(body.role) ? body.role : undefined;

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      isSuperadmin,
      memberships:
        body.tenantId && role
          ? {
              create: {
                tenantId: body.tenantId,
                role,
              },
            }
          : undefined,
    },
    select: {
      id: true,
      email: true,
      name: true,
      isSuperadmin: true,
      memberships: { select: { id: true, tenantId: true, role: true } },
    },
  });

  for (const membership of user.memberships) {
    await ensureTeacherProfile({
      tenantId: membership.tenantId,
      membershipId: membership.id,
      role: membership.role,
      displayName: user.name?.trim() || user.email,
    });
  }

  const passwordLink = sendInvite
    ? await sendPasswordLink(event, {
        userId: user.id,
        actor: session.user,
        tenantName: body.tenantId
          ? (await prisma.tenant.findUnique({ where: { id: body.tenantId }, select: { name: true } }))?.name
          : null,
      })
    : undefined;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isSuperadmin: user.isSuperadmin,
    passwordLink,
  };
});
