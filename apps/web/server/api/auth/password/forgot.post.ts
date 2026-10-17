import { readBody } from "h3";
import { requestPasswordReset } from "~/server/utils/password-tokens";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event);
  await requestPasswordReset(event, body?.email);
  return { ok: true };
});
