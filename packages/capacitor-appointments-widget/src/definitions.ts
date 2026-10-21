export interface WidgetAppointmentPayload {
  id: string;
  version: number;
  status: string;
  startsAt: string;
  title: string;
  phone: string | null;
  /** Pre-formatted time/date label for the widget row */
  timeLabel: string;
}

export type WidgetWhatsAppApp = "whatsapp" | "business";

export interface AppointmentsWidgetSyncOptions {
  tenantId: string;
  /** Origin, e.g. https://app.alpiplan.com */
  apiBaseUrl: string;
  appointments: WidgetAppointmentPayload[];
  /** Resolved app theme (light/dark), matches Nuxt color mode. */
  darkMode: boolean;
  /** Same preference as in app settings (WhatsApp vs Business). */
  whatsAppApp?: WidgetWhatsAppApp;
}

export interface AppointmentsWidgetPlugin {
  sync(options: AppointmentsWidgetSyncOptions): Promise<void>;
  clear(): Promise<void>;
}
