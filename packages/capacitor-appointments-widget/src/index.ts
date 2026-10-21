import { registerPlugin } from "@capacitor/core";
import type { AppointmentsWidgetPlugin } from "./definitions";

const AppointmentsWidget = registerPlugin<AppointmentsWidgetPlugin>("AppointmentsWidget", {
  web: () => import("./web").then((module) => new module.AppointmentsWidgetWeb()),
});

export * from "./definitions";
export { AppointmentsWidget };
