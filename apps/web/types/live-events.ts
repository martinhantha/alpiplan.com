export const APPOINTMENT_LIVE_EVENT = "alpiplan:appointment-live";
/** @deprecated Use APPOINTMENT_LIVE_EVENT */
export const APPOINTMENT_CREATED_EVENT = APPOINTMENT_LIVE_EVENT;

export type AppointmentLiveEventType =
  | "appointment.created"
  | "appointment.moved"
  | "appointment.updated"
  | "appointment.deleted";

export interface AppointmentLiveEvent {
  type: AppointmentLiveEventType;
  tenantId: string;
  appointmentId: string;
  actorUserId: string;
  actorName?: string | null;
  createdByUserId: string | null;
  teacherUserId: string | null;
  teacherUserIds: string[];
  /** Users of teachers assigned before the change, so they drop the appointment from their views. */
  previousTeacherUserIds?: string[];
  title: string;
  startsAt: string;
  previousStartsAt?: string | null;
  teacherName: string | null;
  previousTeacherName?: string | null;
  teacherId: string | null;
  /** Set per viewer by the event stream: false means sync silently, without an alert. */
  notify?: boolean;
}

export type AppointmentCreatedLiveEvent = AppointmentLiveEvent;
