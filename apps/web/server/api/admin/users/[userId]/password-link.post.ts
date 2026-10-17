import { getRouterParam } from "h3";
import { assertUuid, requireSuperadmin } from "~/server/utils/authz";
import { sendPasswordLink } from "~/server/utils/password-tokens";
import { prisma } from "~/server/utils/prisma";

export default defineEventHandler(async (event) => {
  const session = await requireSuperadmin(event);
  const userId = assertUuid(getRouterParam(event, "userId"), "userId");

  const membership = await prisma.membership.findFirst({
    where: { userId, deletedAt: null, tenant: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { tenant: { select: { name: true } } },
  });

  return sendPasswordLink(event, {
    userId,
    actor: session.user,
    tenantName: membership?.tenant.name,
  });
});
