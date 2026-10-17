import { getQuery, getRouterParam, setResponseHeader } from "h3";
import { requireTenantAccess } from "~/server/utils/authz";
import { appointmentCsvTemplate, exportAppointmentsCsv, parseDateRange } from "~/server/utils/appointment-data";

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"), ["ADMIN"]);
  const query = getQuery(event);

  let filename: string;
  let csv: string;
  if (query.template === "1") {
    filename = "termine_vorlage.csv";
    csv = appointmentCsvTemplate();
  } else {
    const range = parseDateRange(query.from, query.to);
    filename = `termine_${access.tenant.slug}_${range.from}_${range.to}.csv`;
    csv = await exportAppointmentsCsv(access.tenant.id, range);
  }

  setResponseHeader(event, "content-type", "text/csv; charset=utf-8");
  setResponseHeader(event, "content-disposition", `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`);
  setResponseHeader(event, "cache-control", "no-store");
  return csv;
});
