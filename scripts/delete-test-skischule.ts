import { PrismaClient } from "@prisma/client";
import { deleteTenantPermanently } from "./lib/delete-tenant";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const confirmed = args.includes("--yes");
const slug = args.find((a) => !a.startsWith("--")) ?? process.env.TEST_SKISCHULE_SLUG ?? "test-skischule";

async function main(): Promise<void> {
  const summary = await deleteTenantPermanently(prisma, slug, { dryRun: !confirmed });
  if (!summary) {
    console.info(`No tenant with slug "${slug}" found — nothing to delete.`);
    return;
  }

  console.info(`${confirmed ? "Deleted" : "Would delete"} "${summary.tenantName}" (slug: ${slug}, id: ${summary.tenantId})`);
  for (const [table, count] of Object.entries(summary.counts)) {
    if (count) console.info(`  ${table}: ${count}`);
  }
  if (summary.deletedUserEmails.length) {
    console.info(`  user accounts: ${summary.deletedUserEmails.join(", ")}`);
  }
  if (!confirmed) console.info(`\nDry run only. Re-run with --yes to delete permanently.`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
