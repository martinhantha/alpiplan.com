import { WebPlugin } from "@capacitor/core";
import type { AppointmentsWidgetPlugin } from "./definitions";

export class AppointmentsWidgetWeb extends WebPlugin implements AppointmentsWidgetPlugin {
  async sync(): Promise<void> {
    // Browser: no home screen widget.
  }

  async clear(): Promise<void> {}
}
