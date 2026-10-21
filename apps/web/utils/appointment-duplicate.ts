/** Fields needed to prefill Schnellerfassung for a new appointment (same slot, not saved yet). */
export type QuickCaptureDuplicateSource = {
  id: string;
  version?: number;
  status: string;
  startsAt: string;
  endsAt: string;
  appointmentContactText: string | null;
  appointmentPhoneRaw?: string | null;
  appointmentPhoneE164?: string | null;
  unstructuredNote?: string | null;
  draftReminderAt?: string | null;
  draftReminderText?: string | null;
  draftReminderSentAt?: string | null;
  teacher: unknown;
  teachers?: unknown;
  resource: unknown;
  lessonType: unknown;
  customer: unknown;
};

export function toQuickCaptureDuplicateSeed<T extends QuickCaptureDuplicateSource>(
  source: T,
): Omit<T, "id" | "version"> & { id: "" } {
  const status = source.status === "draft" ? "draft" : "confirmed";
  return {
    ...source,
    id: "",
    version: undefined,
    status: status as T["status"],
    ...(status !== "draft"
      ? { draftReminderAt: null, draftReminderText: null, draftReminderSentAt: null }
      : {}),
  };
}
