import { getQuery } from "h3";
import { inspectPasswordToken } from "~/server/utils/password-tokens";

export default defineEventHandler(async (event) => {
  return inspectPasswordToken(getQuery(event).token);
});
