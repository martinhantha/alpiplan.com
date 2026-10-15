import { getRouterParam, setHeader, setResponseStatus } from "h3";
import { requireTenantAccess } from "~/server/utils/authz";
import {
  shouldNotifyAppointmentLive,
  shouldReceiveAppointmentLive,
  subscribeAppointmentEvents,
} from "~/server/utils/appointment-events";
import { prisma } from "~/server/utils/prisma";
import type { LiveViewer } from "~/utils/appointment-live-audience";

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"));

  setHeader(event, "Content-Type", "text/event-stream; charset=utf-8");
  setHeader(event, "Cache-Control", "no-cache, no-transform");
  setHeader(event, "Connection", "keep-alive");
  setHeader(event, "X-Accel-Buffering", "no");
  setResponseStatus(event, 200);

  const res = event.node.res;
  res.flushHeaders?.();

  const write = (chunk: string) => {
    if (res.writableEnded) return;
    res.write(chunk);
    (res as { flush?: () => void }).flush?.();
  };

  write("retry: 3000\n\n");
  write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const preferences = await prisma.user.findUnique({
    where: { id: access.actorUserId },
    select: { appointmentMovedAlertsEnabled: true },
  });
  const viewer: LiveViewer = {
    userId: access.actorUserId,
    isAdmin: access.role === "ADMIN" || access.role === "SUPERADMIN",
    movedAlertsEnabled: preferences?.appointmentMovedAlertsEnabled !== false,
  };

  const unsubscribe = subscribeAppointmentEvents(access.tenant.id, (payload) => {
    if (!shouldReceiveAppointmentLive(viewer, payload)) {
      return;
    }
    write(`data: ${JSON.stringify({ ...payload, notify: shouldNotifyAppointmentLive(viewer, payload) })}\n\n`);
  });

  const ping = setInterval(() => write(": ping\n\n"), 20_000);

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
      resolve();
    };
    event.node.req.once("close", cleanup);
    event.node.req.once("end", cleanup);
    event.node.req.once("error", cleanup);
  });
});
