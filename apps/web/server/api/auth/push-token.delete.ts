import { readBody } from "h3";
import { requireSession } from "~/server/utils/authz";
import { prisma } from "~/server/utils/prisma";
import { normalizeWebPushToken } from "~/server/utils/web-push";

export default defineEventHandler(async (event) => {
  const session = await requireSession(event);
  const body = ((await readBody(event)) ?? {}) as { token?: unknown };
  const rawToken = typeof body.token === "string" ? body.token.trim() : "";
  const token = (rawToken && normalizeWebPushToken(rawToken)) || rawToken;
  if (token) {
    await prisma.devicePushToken.deleteMany({ where: { userId: session.user.id, token } });
  } else {
    await prisma.devicePushToken.deleteMany({ where: { userId: session.user.id } });
  }
  return { ok: true as const };
});
