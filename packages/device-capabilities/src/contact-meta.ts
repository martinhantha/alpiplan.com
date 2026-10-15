import type { ContactWritePayload } from "./types.js";

export const ALPIPLAN_CONTACT_ORGANIZATION = "Alpiplan";
export const ALPIPLAN_CONTACT_NOTE = "Gespeichert aus der Alpiplan-App";

export function withAlpiplanContactMeta(payload: ContactWritePayload): ContactWritePayload {
  const organization = payload.organization?.trim() || ALPIPLAN_CONTACT_ORGANIZATION;
  const sourceNote =
    organization === ALPIPLAN_CONTACT_ORGANIZATION
      ? ALPIPLAN_CONTACT_NOTE
      : `${ALPIPLAN_CONTACT_NOTE} (${organization})`;
  const existing = payload.note?.trim();
  const noteParts = new Set<string>();
  if (
    existing &&
    existing !== ALPIPLAN_CONTACT_ORGANIZATION &&
    !existing.startsWith(ALPIPLAN_CONTACT_NOTE)
  ) {
    noteParts.add(existing);
  }
  noteParts.add(sourceNote);
  return {
    ...payload,
    organization,
    note: [...noteParts].join("\n"),
  };
}
