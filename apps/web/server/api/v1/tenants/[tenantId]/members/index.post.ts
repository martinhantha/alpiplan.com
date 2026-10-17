import { getRouterParam, readBody, setResponseStatus } from "h3";
import { requireTenantAccess } from "~/server/utils/authz";
import { addTenantMember } from "~/server/utils/members";
import { sendPasswordLink } from "~/server/utils/password-tokens";
import { prisma } from "~/server/utils/prisma";

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"), ["ADMIN"]);
  const body = await readBody(event);
  const member = await addTenantMember(access.tenant.id, body);
  const needsPassword =
    body?.sendInvite === true &&
    Boolean(
      await prisma.user.findFirst({ where: { id: member.user.id, passwordHash: null }, select: { id: true } }),
    );
  const passwordLink = needsPassword
    ? await sendPasswordLink(event, {
        userId: member.user.id,
        actor: access.session.user,
        tenantName: access.tenant.name,
      })
    : undefined;
  setResponseStatus(event, 201);
  return { ...member, passwordLink };
});
