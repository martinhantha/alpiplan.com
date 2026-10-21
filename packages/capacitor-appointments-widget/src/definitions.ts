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

export interface AppointmentsWidgetSyncOptions {
  tenantId: string;
  /** Origin, e.g. https://app.alpiplan.com */
  apiBaseUrl: string;
  appointments: WidgetAppointmentPayload[];
}

export interface AppointmentsWidgetPlugin {
  sync(options: AppointmentsWidgetSyncOptions): Promise<void>;
  clear(): Promise<void>;
}
