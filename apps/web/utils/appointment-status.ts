export type AppointmentStatus = "draft" | "confirmed" | "completed" | "cancelled";

export function appointmentStatusColor(
  status: string,
): "primary" | "success" | "warning" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "cancelled":
      return "neutral";
    case "draft":
      return "warning";
    default:
      return "primary";
  }
}
