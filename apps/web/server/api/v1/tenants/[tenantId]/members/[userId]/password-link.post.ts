import { getRouterParam } from "h3";
import { throwNotFound } from "~/server/utils/api-errors";
import { assertUuid, requireTenantAccess } from "~/server/utils/authz";
import { sendPasswordLink } from "~/server/utils/password-tokens";
import { prisma } from "~/server/utils/prisma";

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"), ["ADMIN"]);
  const userId = assertUuid(getRouterParam(event, "userId"), "userId");

  const membership = await prisma.membership.findFirst({
    where: { tenantId: access.tenant.id, userId, deletedAt: null },
    select: { id: true },
  });
  if (!membership) {
    throwNotFound("Mitgliedschaft nicht gefunden", { tenantId: access.tenant.id, userId });
  }

  return sendPasswordLink(event, {
    userId,
    actor: access.session.user,
    tenantName: access.tenant.name,
  });
});
