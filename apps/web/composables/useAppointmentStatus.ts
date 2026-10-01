import { appointmentStatusColor } from "../utils/appointment-status";

export function useAppointmentStatus() {
  const { t } = useI18n();

  function appointmentStatusLabel(status: string): string | null {
    switch (status) {
      case "draft":
        return t("appointment.status.draft");
      case "completed":
        return t("appointment.status.completed");
      case "cancelled":
        return t("appointment.status.cancelled");
      default:
        return null;
    }
  }

  return { appointmentStatusLabel, appointmentStatusColor };
}
