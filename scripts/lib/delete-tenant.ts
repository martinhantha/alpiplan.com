import type { Prisma, PrismaClient } from "@prisma/client";

export type TenantDeleteSummary = {
  tenantId: string;
  tenantName: string;
  counts: Record<string, number>;
  deletedUserEmails: string[];
};

/**
 * Users that belong only to this tenant (and are not superadmin) are removed together with it;
 * users with other memberships or superadmin rights only lose their membership.
 */
async function exclusiveUserIds(tx: Prisma.TransactionClient, tenantId: string): Promise<string[]> {
  const memberships = await tx.membership.findMany({
    where: { tenantId },
    select: { user: { select: { id: true, isSuperadmin: true, memberships: { select: { tenantId: true } } } } },
  });
  return memberships
    .map((m) => m.user)
    .filter((u) => !u.isSuperadmin && u.memberships.every((other) => other.tenantId === tenantId))
    .map((u) => u.id);
}

async function countTenantRows(tx: Prisma.TransactionClient, tenantId: string, userIds: string[]) {
  const byTenant = { where: { tenantId } };
  return {
    appointments: await tx.appointment.count(byTenant),
    customers: await tx.customer.count(byTenant),
    teacherProfiles: await tx.teacherProfile.count(byTenant),
    memberships: await tx.membership.count(byTenant),
    lessonTypes: await tx.lessonType.count(byTenant),
    resources: await tx.resource.count(byTenant),
    availabilityRules: await tx.availabilityRule.count(byTenant),
    availabilityExceptions: await tx.availabilityException.count(byTenant),
    packages: await tx.package.count(byTenant),
    payments: await tx.payment.count(byTenant),
    appointmentTemplates: await tx.appointmentTemplate.count(byTenant),
    automationRules: await tx.automationRule.count(byTenant),
    auditLogs: await tx.auditLog.count(byTenant),
    users: userIds.length,
  };
}

/** Permanently removes a tenant and every row that references it (no soft delete). */
export async function deleteTenantPermanently(
  prisma: PrismaClient,
  slug: string,
  options: { dryRun?: boolean } = {},
): Promise<TenantDeleteSummary | null> {
  return prisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });
      if (!tenant) return null;
      const tenantId = tenant.id;

      const userIds = await exclusiveUserIds(tx, tenantId);
      const counts = await countTenantRows(tx, tenantId, userIds);
      const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { email: true } });
      const summary: TenantDeleteSummary = {
        tenantId,
        tenantName: tenant.name,
        counts,
        deletedUserEmails: users.map((u) => u.email),
      };
      if (options.dryRun) return summary;

      const byTenant = { where: { tenantId } };

      await tx.auditLog.deleteMany(byTenant);
      await tx.automationRun.deleteMany({ where: { rule: { tenantId } } });
      await tx.automationRule.deleteMany(byTenant);
      await tx.appointmentTemplate.deleteMany(byTenant);
      await tx.userAssistantPreference.deleteMany({
        where: { OR: [{ tenantId }, { userId: { in: userIds } }] },
      });
      await tx.payment.deleteMany(byTenant);
      await tx.package.deleteMany(byTenant);
      await tx.deviceContactLink.deleteMany(byTenant);
      await tx.customerMergeHistory.deleteMany(byTenant);
      await tx.nextDayBriefingPush.deleteMany(byTenant);

      await tx.tenant.update({
        where: { id: tenantId },
        data: { defaultTeacherId: null, defaultLessonTypeId: null },
      });

      await tx.appointmentTeacher.deleteMany({ where: { appointment: { tenantId } } });
      await tx.appointment.deleteMany(byTenant);
      await tx.availabilityException.deleteMany(byTenant);
      await tx.availabilityRule.deleteMany(byTenant);

      await tx.customerPhone.deleteMany({ where: { customer: { tenantId } } });
      await tx.customerAddress.deleteMany({ where: { customer: { tenantId } } });
      await tx.customerTag.deleteMany({ where: { customer: { tenantId } } });
      await tx.customer.deleteMany(byTenant);

      await tx.resource.deleteMany(byTenant);
      await tx.lessonType.deleteMany(byTenant);
      await tx.teacherProfile.deleteMany(byTenant);
      await tx.membership.deleteMany(byTenant);
      await tx.tenant.delete({ where: { id: tenantId } });

      if (userIds.length) {
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
      }

      return summary;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
