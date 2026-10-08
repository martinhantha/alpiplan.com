<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { $fetch } from "ofetch";
import { formatTeachersCaption } from "../utils/appointment-contact";
import { avatarColor, avatarInitials } from "../utils/avatar";
import type { TimelineMove } from "../components/AppointmentTimeline.vue";

interface AppointmentListItem {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  version: number;
  appointmentContactText: string | null;
  appointmentPhoneRaw: string | null;
  appointmentPhoneE164: string | null;
  unstructuredNote: string | null;
  teacher: { id: string; displayName: string; color?: string | null } | null;
  teachers?: { id: string; displayName: string; color?: string | null }[] | null;
  resource: { id: string; name: string } | null;
  lessonType: { id: string; name: string } | null;
  customer: {
    id: string;
    displayName: string;
    phones?: { e164: string | null; raw: string | null; isPrimary: boolean }[];
  } | null;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface SchedulingOptions {
  teachers: { id: string; displayName: string; color?: string | null }[];
}

const { primaryTenant, teacherLabel, resourcesEnabled, speechRecognitionEnabled, canManageTenant, canAccessWorkspace } = useAuth();
const { appointmentStatusLabel, appointmentStatusColor } = useAppointmentStatus();
const { intlLocale } = useAppLocale();

const appointments = ref<AppointmentListItem[]>([]);
const pagination = ref<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
const options = ref<SchedulingOptions | null>(null);
const loading = ref(false);
const error = ref("");
const savingId = ref("");
const filterOpen = ref(false);
const quickOpen = ref(false);
const quickStartVoice = ref(false);
const quickInitialContact = ref("");
const editingAppointment = ref<AppointmentListItem | null>(null);
type AppointmentsView = "list" | "calendar";
type CalendarMode = "day" | "timeline" | "week" | "team" | "month";

const VIEW_STORAGE_KEY = "alpiplan.appointments.view";
const CALENDAR_MODE_STORAGE_KEY = "alpiplan.appointments.calendarMode";
const TIMELINE_STORAGE_KEY = "alpiplan.appointments.timeline";
const CALENDAR_MODES: CalendarMode[] = ["day", "timeline", "week", "team", "month"];

const view = ref<AppointmentsView>("list");
const calendarMode = ref<CalendarMode>("week");
const dayAnchor = ref<Date>(startOfDay(new Date()));
const weekStart = ref<Date>(getMondayOf(new Date()));
const monthAnchor = ref<Date>(firstOfMonth(new Date()));
const timeline = reactive({ auto: true, fromHour: 9, toHour: 17 });

function restoreViewPreference() {
  if (typeof localStorage === "undefined") return;
  const storedView = localStorage.getItem(VIEW_STORAGE_KEY);
  if (storedView === "list" || storedView === "calendar") view.value = storedView;
  const storedMode = localStorage.getItem(CALENDAR_MODE_STORAGE_KEY) as CalendarMode | null;
  if (storedMode && CALENDAR_MODES.includes(storedMode)) calendarMode.value = storedMode;
  try {
    const storedTimeline = JSON.parse(localStorage.getItem(TIMELINE_STORAGE_KEY) || "null");
    if (storedTimeline && typeof storedTimeline === "object") {
      const { auto, fromHour, toHour } = storedTimeline;
      if (typeof auto === "boolean") timeline.auto = auto;
      if (Number.isInteger(fromHour) && Number.isInteger(toHour) && fromHour >= 0 && toHour <= 24 && fromHour < toHour) {
        timeline.fromHour = fromHour;
        timeline.toHour = toHour;
      }
    }
  } catch {
    // ignore corrupt preference
  }
}

function persistViewPreference() {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(VIEW_STORAGE_KEY, view.value);
  localStorage.setItem(CALENDAR_MODE_STORAGE_KEY, calendarMode.value);
}

watch(timeline, () => {
  if (timeline.fromHour >= timeline.toHour) {
    if (timeline.toHour >= 24) timeline.fromHour = timeline.toHour - 1;
    else timeline.toHour = timeline.fromHour + 1;
  }
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify(timeline));
});

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function appointmentColor(appointment: AppointmentListItem): string | null {
  if (!canManageTenant.value) return null;
  const teacher = appointment.teachers?.[0] ?? appointment.teacher;
  return teacher ? avatarColor(teacher.id, teacher.color) : null;
}

function teachersCaption(appointment: AppointmentListItem) {
  return formatTeachersCaption(appointment, {
    teacherProfileId: primaryTenant.value?.teacherProfileId,
    canManageTenant: canManageTenant.value,
    teacherLabel: teacherLabel.value,
  });
}

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function firstOfMonth(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

const filters = reactive({
  q: "",
  teacherId: "",
  status: "draft,confirmed",
  from: "",
  to: "",
});
const page = ref(1);
const pageSize = ref(25);

const statusOptions = [
  { value: "draft,confirmed", label: "Offen" },
  { value: "draft", label: "Entwurf" },
  { value: "completed", label: "Erledigt" },
  { value: "cancelled", label: "Storniert" },
  { value: "", label: "Alle" },
];

const canLoad = computed(() => Boolean(primaryTenant.value?.tenantId));

const activeFilterCount = computed(() => {
  let n = 0;
  if (filters.q) n += 1;
  if (filters.teacherId) n += 1;
  if (filters.status !== "draft,confirmed") n += 1;
  if (filters.from) n += 1;
  if (filters.to) n += 1;
  return n;
});

const rangeLabel = computed(() => {
  if (!pagination.value.total) return "0 Termine";
  const start = (pagination.value.page - 1) * pagination.value.pageSize + 1;
  const end = Math.min(pagination.value.page * pagination.value.pageSize, pagination.value.total);
  return `${start}–${end} von ${pagination.value.total}`;
});

function appointmentTitle(appointment: AppointmentListItem) {
  return appointment.customer?.displayName || appointment.appointmentContactText || "Termin ohne Kontakt";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(intlLocale.value, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toIsoDateStart(dateValue: string) {
  return new Date(`${dateValue}T00:00:00`).toISOString();
}

function toIsoDateEndExclusive(dateValue: string) {
  const end = new Date(`${dateValue}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return end.toISOString();
}

async function loadAppointments() {
  if (!primaryTenant.value?.tenantId) {
    appointments.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const isCalendar = view.value === "calendar";
    const range = isCalendar ? calendarRange.value : null;
    const fromIso = range
      ? range.from.toISOString()
      : filters.from
        ? toIsoDateStart(filters.from)
        : undefined;
    const toIso = range
      ? range.to.toISOString()
      : filters.to
        ? toIsoDateEndExclusive(filters.to)
        : undefined;
    const response = await $fetch<{ data: AppointmentListItem[]; pagination: Pagination }>(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/appointments`,
      {
        credentials: "include",
        query: {
          q: filters.q || undefined,
          teacherId: filters.teacherId || undefined,
          status: filters.status || undefined,
          from: fromIso,
          to: toIso,
          page: isCalendar ? 1 : page.value,
          pageSize: isCalendar ? 500 : pageSize.value,
          sort: "asc",
        },
      },
    );
    appointments.value = response.data;
    pagination.value = response.pagination;
  } catch (e: unknown) {
    const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
    error.value = err.data?.data?.message || err.data?.message || err.statusMessage || "Termine konnten nicht geladen werden";
  } finally {
    loading.value = false;
  }
}

const calendarRange = computed(() => {
  if (isDayMode(calendarMode.value)) {
    return { from: dayAnchor.value, to: addDays(dayAnchor.value, 1) };
  }
  if (isWeekMode(calendarMode.value)) {
    return { from: weekStart.value, to: addDays(weekStart.value, 7) };
  }
  const gridStart = getMondayOf(monthAnchor.value);
  return { from: gridStart, to: addDays(gridStart, 42) };
});

const weekDays = computed(() => {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart.value, i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date, key };
  });
});

const monthGrid = computed(() => {
  const gridStart = getMondayOf(monthAnchor.value);
  const month = monthAnchor.value.getMonth();
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date, key, inMonth: date.getMonth() === month };
  });
});

const weekdayHeaders = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function dateKey(value: string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function appointmentsByDay(key: string) {
  return appointments.value
    .filter((a) => dateKey(a.startsAt) === key)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const dayAppointments = computed(() => appointmentsByDay(toDateKey(dayAnchor.value)));

const dayColumns = computed(() => {
  const columns = new Map<
    string,
    { id: string; name: string; color: string | null; appointments: AppointmentListItem[] }
  >();
  const unassigned: AppointmentListItem[] = [];
  for (const appointment of dayAppointments.value) {
    const teachers = appointment.teachers?.length
      ? appointment.teachers
      : appointment.teacher
        ? [appointment.teacher]
        : [];
    if (!teachers.length) {
      unassigned.push(appointment);
      continue;
    }
    for (const teacher of teachers) {
      const column = columns.get(teacher.id) ?? {
        id: teacher.id,
        name: teacher.displayName,
        color: teacher.color ?? null,
        appointments: [],
      };
      column.appointments.push(appointment);
      columns.set(teacher.id, column);
    }
  }
  const sorted = [...columns.values()].sort((a, b) => a.name.localeCompare(b.name, intlLocale.value));
  if (unassigned.length) {
    sorted.push({ id: "__unassigned", name: `Ohne ${teacherLabel.value}`, color: null, appointments: unassigned });
  }
  return sorted;
});

const WEEK_DAY_VISIBLE = 8;
const TEAM_CELL_VISIBLE = 3;

const teamRows = computed(() => {
  const rows = new Map<
    string,
    { id: string; name: string; color: string | null; byDay: Map<string, AppointmentListItem[]> }
  >();
  for (const teacher of options.value?.teachers ?? []) {
    rows.set(teacher.id, { id: teacher.id, name: teacher.displayName, color: teacher.color ?? null, byDay: new Map() });
  }
  const unassigned = { id: UNASSIGNED_ROW_ID, name: `Ohne ${teacherLabel.value}`, color: null, byDay: new Map() };
  const sortedAppointments = [...appointments.value].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  for (const appointment of sortedAppointments) {
    const key = dateKey(appointment.startsAt);
    const teachers = appointment.teachers?.length
      ? appointment.teachers
      : appointment.teacher
        ? [appointment.teacher]
        : [];
    const targets = teachers.length
      ? teachers.map((teacher) => {
          const row = rows.get(teacher.id) ?? {
            id: teacher.id,
            name: teacher.displayName,
            color: teacher.color ?? null,
            byDay: new Map(),
          };
          rows.set(teacher.id, row);
          return row;
        })
      : [unassigned];
    for (const row of targets) {
      const list = row.byDay.get(key) ?? [];
      list.push(appointment);
      row.byDay.set(key, list);
    }
  }
  const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, intlLocale.value));
  if (unassigned.byDay.size) sorted.push(unassigned);
  return sorted;
});

function bookedHoursLabel(list: AppointmentListItem[]) {
  const minutes = list
    .filter((appointment) => appointment.status !== "cancelled")
    .reduce((sum, a) => sum + (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000, 0);
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${String(hours).replace(".", ",")} h`;
}

function openDay(date: Date, mode: "day" | "timeline" = "day") {
  dayAnchor.value = startOfDay(date);
  calendarMode.value = mode;
  persistViewPreference();
  loadAppointments();
}

function isDayMode(mode: CalendarMode) {
  return mode === "day" || mode === "timeline";
}

function isWeekMode(mode: CalendarMode) {
  return mode === "week" || mode === "team";
}

function minutesIntoDay(value: string) {
  return (new Date(value).getTime() - dayAnchor.value.getTime()) / 60000;
}

const timelineHours = computed(() => {
  if (!timeline.auto) return { from: timeline.fromHour, to: timeline.toHour };
  if (!dayAppointments.value.length) return { from: 9, to: 17 };
  let min = 24 * 60;
  let max = 0;
  for (const appointment of dayAppointments.value) {
    min = Math.min(min, minutesIntoDay(appointment.startsAt));
    max = Math.max(max, minutesIntoDay(appointment.endsAt));
  }
  const from = Math.max(0, Math.floor(min / 60));
  const to = Math.min(24, Math.max(from + 1, Math.ceil(max / 60)));
  return { from, to };
});

const timelineHiddenCount = computed(() => {
  const rangeStart = timelineHours.value.from * 60;
  const rangeEnd = timelineHours.value.to * 60;
  return dayAppointments.value.filter(
    (appointment) =>
      minutesIntoDay(appointment.endsAt) <= rangeStart || minutesIntoDay(appointment.startsAt) >= rangeEnd,
  ).length;
});

const UNASSIGNED_ROW_ID = "__unassigned";

interface AppointmentSnapshot {
  startsAt: string;
  endsAt: string;
  teacherIds: string[] | null;
}

const lastMove = ref<{ appointmentId: string; message: string; previous: AppointmentSnapshot } | null>(null);
let lastMoveTimer: ReturnType<typeof setTimeout> | undefined;

function assignedTeacherIds(appointment: AppointmentListItem): string[] {
  if (appointment.teachers?.length) return appointment.teachers.map((teacher) => teacher.id);
  return appointment.teacher ? [appointment.teacher.id] : [];
}

function nextTeacherIds(current: string[], fromRowId: string, toRowId: string): string[] {
  if (fromRowId === UNASSIGNED_ROW_ID) return toRowId === UNASSIGNED_ROW_ID ? [] : [toRowId];
  if (toRowId === UNASSIGNED_ROW_ID) return current.filter((id) => id !== fromRowId);
  if (current.includes(toRowId)) return current.filter((id) => id !== fromRowId);
  return current.map((id) => (id === fromRowId ? toRowId : id));
}

async function patchAppointmentSchedule(appointment: AppointmentListItem, body: Record<string, unknown>) {
  if (!primaryTenant.value?.tenantId) throw new Error("Kein Mandant");
  return $fetch<AppointmentListItem>(
    `/api/v1/tenants/${primaryTenant.value.tenantId}/appointments/${appointment.id}`,
    {
      method: "PATCH",
      credentials: "include",
      body,
      headers: { "If-Match": String(appointment.version) },
    },
  );
}

function replaceAppointment(updated: AppointmentListItem) {
  appointments.value = appointments.value.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
}

function showLastMove(appointmentId: string, message: string, previous: AppointmentSnapshot) {
  lastMove.value = { appointmentId, message, previous };
  if (lastMoveTimer) clearTimeout(lastMoveTimer);
  lastMoveTimer = setTimeout(() => (lastMove.value = null), 10_000);
}

async function onTimelineMove(move: TimelineMove<AppointmentListItem>) {
  const { appointment } = move;
  const teacherChanged = move.fromRowId !== move.toRowId;
  const previousTeacherIds = assignedTeacherIds(appointment);
  const body: Record<string, unknown> = {
    startsAt: move.startsAt.toISOString(),
    endsAt: move.endsAt.toISOString(),
  };
  if (teacherChanged) body.teacherIds = nextTeacherIds(previousTeacherIds, move.fromRowId, move.toRowId);

  const previous: AppointmentSnapshot = {
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    teacherIds: teacherChanged ? previousTeacherIds : null,
  };
  replaceAppointment({ ...appointment, startsAt: body.startsAt as string, endsAt: body.endsAt as string });
  savingId.value = appointment.id;
  error.value = "";
  try {
    const updated = await patchAppointmentSchedule(appointment, body);
    replaceAppointment(updated);
    const target = teacherChanged
      ? ` zu ${dayColumns.value.find((column) => column.id === move.toRowId)?.name ?? teacherLabel.value}`
      : "";
    showLastMove(
      appointment.id,
      `„${appointmentTitle(appointment)}“ ${formatTime(updated.startsAt)}–${formatTime(updated.endsAt)}${target}`,
      previous,
    );
  } catch (e: unknown) {
    const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
    error.value =
      err.data?.data?.message || err.data?.message || err.statusMessage || "Termin konnte nicht verschoben werden";
    await loadAppointments();
  } finally {
    savingId.value = "";
  }
}

async function undoLastMove() {
  const move = lastMove.value;
  if (!move) return;
  const appointment = appointments.value.find((item) => item.id === move.appointmentId);
  lastMove.value = null;
  if (!appointment) return;
  const body: Record<string, unknown> = { startsAt: move.previous.startsAt, endsAt: move.previous.endsAt };
  if (move.previous.teacherIds) body.teacherIds = move.previous.teacherIds;
  savingId.value = appointment.id;
  error.value = "";
  try {
    replaceAppointment(await patchAppointmentSchedule(appointment, body));
  } catch (e: unknown) {
    const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
    error.value =
      err.data?.data?.message || err.data?.message || err.statusMessage || "Rückgängig machen fehlgeschlagen";
    await loadAppointments();
  } finally {
    savingId.value = "";
  }
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatDayHeader(date: Date) {
  return new Intl.DateTimeFormat(intlLocale.value, { weekday: "short", day: "2-digit", month: "2-digit" }).format(date);
}

function formatTime(value: string | Date) {
  return new Intl.DateTimeFormat(intlLocale.value, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const calendarRangeLabel = computed(() => {
  if (isDayMode(calendarMode.value)) {
    return new Intl.DateTimeFormat(intlLocale.value, {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(dayAnchor.value);
  }
  if (isWeekMode(calendarMode.value)) {
    const start = weekStart.value;
    const end = addDays(start, 6);
    const fmt = new Intl.DateTimeFormat(intlLocale.value, { day: "2-digit", month: "2-digit", year: "numeric" });
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  }
  const fmt = new Intl.DateTimeFormat(intlLocale.value, { month: "long", year: "numeric" });
  return fmt.format(monthAnchor.value);
});

function shiftCalendar(direction: 1 | -1) {
  if (isDayMode(calendarMode.value)) {
    dayAnchor.value = addDays(dayAnchor.value, direction);
  } else if (isWeekMode(calendarMode.value)) {
    weekStart.value = addDays(weekStart.value, direction * 7);
  } else {
    monthAnchor.value = addMonths(monthAnchor.value, direction);
  }
  loadAppointments();
}

function goToToday() {
  const today = new Date();
  dayAnchor.value = startOfDay(today);
  weekStart.value = getMondayOf(today);
  monthAnchor.value = firstOfMonth(today);
  loadAppointments();
}

function isWithin(date: Date, from: Date, to: Date) {
  return date.getTime() >= from.getTime() && date.getTime() < to.getTime();
}

function setCalendarMode(next: CalendarMode) {
  if (calendarMode.value === next) return;
  const previous = calendarMode.value;
  const today = startOfDay(new Date());
  if (isDayMode(next) && !isDayMode(previous)) {
    const { from, to } = calendarRange.value;
    if (isWeekMode(previous)) {
      if (!isWithin(dayAnchor.value, from, to)) {
        dayAnchor.value = isWithin(today, from, to) ? today : from;
      }
    } else {
      const monthStart = monthAnchor.value;
      const monthEnd = addMonths(monthStart, 1);
      if (!isWithin(dayAnchor.value, monthStart, monthEnd)) {
        dayAnchor.value = isWithin(today, monthStart, monthEnd) ? today : monthStart;
      }
    }
  } else if (isWeekMode(next)) {
    if (!isWeekMode(previous)) {
      weekStart.value = getMondayOf(isDayMode(previous) ? dayAnchor.value : monthAnchor.value);
    }
  } else if (next === "month") {
    monthAnchor.value = firstOfMonth(isDayMode(previous) ? dayAnchor.value : weekStart.value);
  }
  calendarMode.value = next;
  persistViewPreference();
  loadAppointments();
}

function setView(next: AppointmentsView) {
  if (view.value === next) return;
  view.value = next;
  if (next === "calendar") {
    goToToday();
  } else {
    page.value = 1;
    loadAppointments();
  }
  persistViewPreference();
}

function isToday(date: Date) {
  const t = new Date();
  return (
    date.getFullYear() === t.getFullYear() &&
    date.getMonth() === t.getMonth() &&
    date.getDate() === t.getDate()
  );
}

async function loadOptions() {
  if (!primaryTenant.value?.tenantId || !canManageTenant.value) return;
  options.value = await $fetch<SchedulingOptions>(
    `/api/v1/tenants/${primaryTenant.value.tenantId}/scheduling/options`,
    { credentials: "include" },
  );
}

function openQuickCapture() {
  editingAppointment.value = null;
  quickInitialContact.value = "";
  quickStartVoice.value = false;
  quickOpen.value = true;
}

function openAssistant() {
  editingAppointment.value = null;
  quickInitialContact.value = "";
  quickStartVoice.value = speechRecognitionEnabled.value;
  quickOpen.value = true;
}

function openEditAppointment(appointment: AppointmentListItem) {
  editingAppointment.value = appointment;
  quickInitialContact.value = "";
  quickStartVoice.value = false;
  quickOpen.value = true;
}

function closeQuickCapture() {
  quickOpen.value = false;
  editingAppointment.value = null;
  quickStartVoice.value = false;
}

async function onAppointmentSaved() {
  closeQuickCapture();
  await loadAppointments();
}

function applyFilters() {
  page.value = 1;
  loadAppointments();
}

function resetFilters() {
  filters.q = "";
  filters.teacherId = "";
  filters.status = "draft,confirmed";
  filters.from = "";
  filters.to = "";
  page.value = 1;
  loadAppointments();
}

async function markCompleted(appointment: AppointmentListItem) {
  if (!primaryTenant.value?.tenantId) return;
  savingId.value = appointment.id;
  error.value = "";
  try {
    await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/appointments/${appointment.id}`, {
      method: "PATCH",
      credentials: "include",
      body: { status: "completed" },
      headers: { "If-Match": String(appointment.version) },
    });
    await loadAppointments();
  } catch (e: unknown) {
    const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
    error.value =
      err.data?.data?.message || err.data?.message || err.statusMessage || "Termin konnte nicht abgehakt werden";
  } finally {
    savingId.value = "";
  }
}

async function deleteAppointment(appointment: AppointmentListItem) {
  if (!primaryTenant.value?.tenantId) return;
  if (!confirm(`Termin „${appointmentTitle(appointment)}“ wirklich löschen? Er kann im Papierkorb wiederhergestellt werden.`)) return;
  savingId.value = appointment.id;
  error.value = "";
  try {
    await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/appointments/${appointment.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    await loadAppointments();
  } catch (e: unknown) {
    const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
    error.value =
      err.data?.data?.message || err.data?.message || err.statusMessage || "Termin konnte nicht gelöscht werden";
  } finally {
    savingId.value = "";
  }
}

function goToPage(target: number) {
  const next = Math.max(1, Math.min(pagination.value.totalPages, target));
  if (next === page.value) return;
  page.value = next;
  loadAppointments();
}

watch(pageSize, () => {
  page.value = 1;
  loadAppointments();
});

watch(quickOpen, (open) => {
  if (!open) {
    editingAppointment.value = null;
    quickStartVoice.value = false;
  }
});

onBeforeUnmount(() => {
  if (lastMoveTimer) clearTimeout(lastMoveTimer);
});

onMounted(async () => {
  restoreViewPreference();
  await loadOptions();
  await loadAppointments();
});

useAppointmentListSync(loadAppointments);

watch(
  () => primaryTenant.value?.tenantId,
  async () => {
    page.value = 1;
    await loadOptions();
    await loadAppointments();
  },
);
</script>

<template>
  <UContainer class="py-8 space-y-5">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p class="text-sm text-muted font-medium">Alpiplan · Termine</p>
        <h1 class="font-display text-3xl sm:text-4xl">
          Termine
          <span class="ml-2 text-sm font-normal text-neutral-500">({{ pagination.total }})</span>
        </h1>
        <p v-if="!canManageTenant" class="mt-1 text-sm text-neutral-500">
          Nur eigene Termine. Löschen nur durch Admin.
        </p>
      </div>
      <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <div class="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700 overflow-hidden">
          <button
            type="button"
            class="px-2 sm:px-3 py-1.5 text-sm flex items-center gap-1 transition"
            :class="
              view === 'list'
                ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/40 dark:text-primary-100'
                : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            "
            aria-label="Listenansicht"
            title="Liste"
            @click="setView('list')"
          >
            <UIcon name="i-lucide-list" class="size-4" />
            <span class="hidden sm:inline">Liste</span>
          </button>
          <button
            type="button"
            class="px-2 sm:px-3 py-1.5 text-sm flex items-center gap-1 border-l border-neutral-300 dark:border-neutral-700 transition"
            :class="
              view === 'calendar'
                ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/40 dark:text-primary-100'
                : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            "
            aria-label="Kalenderansicht"
            title="Kalender"
            @click="setView('calendar')"
          >
            <UIcon name="i-lucide-calendar-range" class="size-4" />
            <span class="hidden sm:inline">Kalender</span>
          </button>
        </div>
        <UButton
          variant="outline"
          color="neutral"
          icon="i-lucide-filter"
          aria-label="Filter"
          title="Filter"
          @click="filterOpen = !filterOpen"
        >
          <span class="hidden sm:inline">Filter</span>
          <UBadge v-if="activeFilterCount" color="primary" variant="subtle" class="sm:ml-1">
            {{ activeFilterCount }}
          </UBadge>
          <UIcon
            :name="filterOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="ml-1 size-4 hidden sm:inline-flex"
          />
        </UButton>
        <UButton
          v-if="canAccessWorkspace && speechRecognitionEnabled"
          variant="outline"
          color="neutral"
          icon="i-lucide-message-circle-question"
          aria-label="Assistent"
          title="Assistent"
          @click="openAssistant"
        >
          <span class="hidden sm:inline">Assistent</span>
        </UButton>
        <UButton
          v-if="canAccessWorkspace"
          icon="i-lucide-plus"
          color="primary"
          aria-label="Neuer Termin"
          title="Neuer Termin"
          @click="openQuickCapture"
        >
          <span class="hidden sm:inline">Neuer Termin</span>
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-circle-alert"
      :title="error"
    />

    <UCard v-if="filterOpen">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-medium">Filter</h2>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="filterOpen = false" />
        </div>
      </template>

      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <UInput v-model="filters.q" placeholder="Suche Kunde oder Kontakttext" />
        <select
          v-if="canManageTenant"
          v-model="filters.teacherId"
          class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
        >
          <option value="">Alle {{ teacherLabel }}</option>
          <option v-for="teacher in options?.teachers || []" :key="teacher.id" :value="teacher.id">
            {{ teacher.displayName }}
          </option>
        </select>
        <select
          v-model="filters.status"
          class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
        >
          <option v-for="status in statusOptions" :key="status.label" :value="status.value">
            {{ status.label }}
          </option>
        </select>
        <UInput v-model="filters.from" type="date" />
        <UInput v-model="filters.to" type="date" />
      </div>

      <template #footer>
        <div class="flex gap-2">
          <UButton :disabled="!canLoad" :loading="loading" icon="i-lucide-search" @click="applyFilters">
            Anwenden
          </UButton>
          <UButton variant="ghost" color="neutral" @click="resetFilters">
            Zurücksetzen
          </UButton>
        </div>
      </template>
    </UCard>

    <template v-if="view === 'list'">
      <div class="flex items-center justify-between gap-3 text-sm text-neutral-600 dark:text-neutral-400">
        <span>{{ rangeLabel }}</span>
        <div class="flex items-center gap-2">
          <span>Pro Seite</span>
          <select
            v-model.number="pageSize"
            class="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
          >
            <option :value="10">10</option>
            <option :value="25">25</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </div>
      </div>

      <div v-if="!primaryTenant" class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400">
        Für Termine brauchst du eine Mandanten-Mitgliedschaft.
      </div>
      <div v-else-if="!appointments.length && !loading" class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400">
        Keine Termine passend zu den Filtern.
      </div>
      <div v-else class="space-y-3">
        <UCard v-for="appointment in appointments" :key="appointment.id">
          <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
            <div class="min-w-52 grow">
              <div class="flex items-start gap-2">
                <div class="min-w-0">
                  <p class="font-medium">{{ appointmentTitle(appointment) }}</p>
                  <p class="text-sm text-neutral-600 dark:text-neutral-400">
                    {{ formatDateTime(appointment.startsAt) }}–{{ formatDateTime(appointment.endsAt).split(', ').pop() }}
                  </p>
                </div>
                <UBadge
                  v-if="appointmentStatusLabel(appointment.status)"
                  :color="appointmentStatusColor(appointment.status)"
                  variant="subtle"
                  class="shrink-0"
                >
                  {{ appointmentStatusLabel(appointment.status) }}
                </UBadge>
              </div>
              <div class="mt-1.5 flex flex-wrap gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                <span v-if="teachersCaption(appointment)" class="inline-flex items-center gap-1.5">
                  <span
                    v-if="appointmentColor(appointment)"
                    class="size-2 shrink-0 rounded-full"
                    :style="{ backgroundColor: appointmentColor(appointment)! }"
                  />
                  {{ teachersCaption(appointment) }}
                </span>
                <span v-if="resourcesEnabled && appointment.resource">Ressource: {{ appointment.resource.name }}</span>
                <span v-if="appointment.lessonType">Art: {{ appointment.lessonType.name }}</span>
              </div>
            </div>
            <AppointmentQuickActions
              class="ml-auto shrink-0"
              :appointment="appointment"
              :loading="savingId === appointment.id"
              :show-edit="canAccessWorkspace"
              :show-complete="canAccessWorkspace"
              :show-delete="canManageTenant"
              @edit="openEditAppointment(appointment)"
              @complete="markCompleted(appointment)"
              @delete="deleteAppointment(appointment)"
            />
          </div>
        </UCard>
      </div>

      <div
        v-if="pagination.totalPages > 1"
        class="flex items-center justify-between gap-3 pt-2"
      >
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          icon="i-lucide-chevron-left"
          :disabled="pagination.page <= 1 || loading"
          @click="goToPage(pagination.page - 1)"
        >
          Zurück
        </UButton>
        <span class="text-sm text-neutral-600 dark:text-neutral-400">
          Seite {{ pagination.page }} / {{ pagination.totalPages }}
        </span>
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          trailing-icon="i-lucide-chevron-right"
          :disabled="pagination.page >= pagination.totalPages || loading"
          @click="goToPage(pagination.page + 1)"
        >
          Weiter
        </UButton>
      </div>
    </template>

    <template v-else>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 flex-wrap">
          <div class="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700 overflow-hidden">
            <button
              type="button"
              class="px-3 py-1.5 text-sm transition"
              :class="
                calendarMode === 'day'
                  ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/40 dark:text-primary-100'
                  : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              "
              @click="setCalendarMode('day')"
            >
              Tag
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm border-l border-neutral-300 dark:border-neutral-700 transition"
              :class="
                calendarMode === 'timeline'
                  ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/40 dark:text-primary-100'
                  : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              "
              @click="setCalendarMode('timeline')"
            >
              Zeitachse
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm border-l border-neutral-300 dark:border-neutral-700 transition"
              :class="
                calendarMode === 'week' || (calendarMode === 'team' && !canManageTenant)
                  ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/40 dark:text-primary-100'
                  : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              "
              @click="setCalendarMode('week')"
            >
              Woche
            </button>
            <button
              v-if="canManageTenant"
              type="button"
              class="px-3 py-1.5 text-sm border-l border-neutral-300 dark:border-neutral-700 transition"
              :class="
                calendarMode === 'team'
                  ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/40 dark:text-primary-100'
                  : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              "
              title="Woche nach Personen"
              @click="setCalendarMode('team')"
            >
              Team
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm border-l border-neutral-300 dark:border-neutral-700 transition"
              :class="
                calendarMode === 'month'
                  ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/40 dark:text-primary-100'
                  : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              "
              @click="setCalendarMode('month')"
            >
              Monat
            </button>
          </div>
          <div class="flex items-center gap-1">
            <UButton size="sm" variant="outline" color="neutral" icon="i-lucide-chevron-left" @click="shiftCalendar(-1)" />
            <UButton size="sm" variant="ghost" color="neutral" @click="goToToday">Heute</UButton>
            <UButton size="sm" variant="outline" color="neutral" icon="i-lucide-chevron-right" @click="shiftCalendar(1)" />
          </div>
        </div>
        <span class="text-sm font-medium text-neutral-700 dark:text-neutral-200 capitalize">
          {{ calendarRangeLabel }}
        </span>
      </div>

      <div
        v-if="calendarMode === 'timeline'"
        class="flex items-center gap-x-3 gap-y-2 flex-wrap text-sm text-neutral-600 dark:text-neutral-400"
      >
        <label class="inline-flex items-center gap-1.5 cursor-pointer">
          <input v-model="timeline.auto" type="checkbox" class="rounded border-neutral-300 dark:border-neutral-700" />
          Nach Terminen ausrichten
        </label>
        <div class="inline-flex items-center gap-1.5" :class="timeline.auto ? 'opacity-50' : ''">
          <span>Von</span>
          <select
            v-model.number="timeline.fromHour"
            :disabled="timeline.auto"
            class="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
          >
            <option v-for="hour in 24" :key="hour - 1" :value="hour - 1">{{ formatHour(hour - 1) }}</option>
          </select>
          <span>bis</span>
          <select
            v-model.number="timeline.toHour"
            :disabled="timeline.auto"
            class="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
          >
            <option v-for="hour in 24" :key="hour" :value="hour" :disabled="hour <= timeline.fromHour">
              {{ formatHour(hour) }}
            </option>
          </select>
        </div>
        <span v-if="timelineHiddenCount" class="text-xs text-amber-700 dark:text-amber-300">
          {{ timelineHiddenCount }} Termin(e) außerhalb des Zeitraums
        </span>
      </div>

      <div v-if="!primaryTenant" class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400">
        Für Termine brauchst du eine Mandanten-Mitgliedschaft.
      </div>

      <template v-else-if="calendarMode === 'timeline'">
        <div
          v-if="!dayAppointments.length && !loading"
          class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
        >
          Keine Termine an diesem Tag.
        </div>
        <template v-else>
          <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 -translate-y-1"
            leave-active-class="transition duration-150 ease-in"
            leave-to-class="opacity-0"
          >
            <div
              v-if="lastMove"
              class="flex items-center justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-100"
            >
              <span class="flex min-w-0 items-center gap-2">
                <UIcon name="i-lucide-check-circle-2" class="size-4 shrink-0" />
                <span class="truncate">Verschoben: {{ lastMove.message }}</span>
              </span>
              <div class="flex shrink-0 items-center gap-1">
                <UButton size="xs" variant="soft" color="primary" icon="i-lucide-undo-2" @click="undoLastMove">
                  Rückgängig
                </UButton>
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="lastMove = null" />
              </div>
            </div>
          </Transition>
          <AppointmentTimeline
            :rows="dayColumns"
            :day="dayAnchor"
            :from-hour="timelineHours.from"
            :to-hour="timelineHours.to"
            :can-move="canAccessWorkspace"
            :can-change-row="canManageTenant"
            :person-colors="canManageTenant"
            :saving-id="savingId"
            :show-resource="resourcesEnabled"
            :title-of="appointmentTitle"
            :format-time="formatTime"
            @open="openEditAppointment"
            @move="onTimelineMove"
          />
        </template>
      </template>

      <template v-else-if="calendarMode === 'day'">
        <div
          v-if="!dayAppointments.length && !loading"
          class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
        >
          Keine Termine an diesem Tag.
        </div>
        <div v-else class="overflow-x-auto -mx-1 px-1 pb-1">
          <div
            class="grid gap-2"
            :style="{ gridTemplateColumns: `repeat(${Math.max(dayColumns.length, 1)}, minmax(15rem, 1fr))` }"
          >
            <div
              v-for="column in dayColumns"
              :key="column.id"
              class="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-2 flex flex-col gap-2"
            >
              <div class="flex items-center justify-between gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    v-if="canManageTenant"
                    class="size-2.5 shrink-0 rounded-full"
                    :class="column.id === UNASSIGNED_ROW_ID ? 'border border-dashed border-neutral-400' : ''"
                    :style="column.id === UNASSIGNED_ROW_ID ? {} : { backgroundColor: avatarColor(column.id, column.color) }"
                  />
                  <span class="truncate">{{ column.name }}</span>
                </span>
                <span class="text-xs font-normal text-neutral-500 tabular-nums">{{ column.appointments.length }}</span>
              </div>
              <div
                v-for="appointment in column.appointments"
                :key="appointment.id"
                class="rounded-md border border-l-[3px] border-neutral-200 dark:border-neutral-800 px-2.5 py-2 text-sm bg-neutral-50 dark:bg-neutral-900"
                :style="!canManageTenant || column.id === UNASSIGNED_ROW_ID ? {} : { borderLeftColor: avatarColor(column.id, column.color) }"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-medium tabular-nums">
                        {{ formatTime(appointment.startsAt) }}–{{ formatTime(appointment.endsAt) }}
                      </span>
                      <UBadge
                        v-if="appointmentStatusLabel(appointment.status)"
                        :color="appointmentStatusColor(appointment.status)"
                        variant="subtle"
                        size="xs"
                      >
                        {{ appointmentStatusLabel(appointment.status) }}
                      </UBadge>
                    </div>
                    <p class="mt-0.5 font-medium truncate">{{ appointmentTitle(appointment) }}</p>
                    <div class="mt-0.5 flex flex-wrap gap-x-2 text-xs text-neutral-500">
                      <span v-if="resourcesEnabled && appointment.resource">{{ appointment.resource.name }}</span>
                      <span v-if="appointment.lessonType">{{ appointment.lessonType.name }}</span>
                    </div>
                  </div>
                  <AppointmentQuickActions
                    class="shrink-0"
                    compact
                    :appointment="appointment"
                    :loading="savingId === appointment.id"
                    :show-edit="canAccessWorkspace"
                    :show-complete="canAccessWorkspace"
                    :show-delete="canManageTenant"
                    @edit="openEditAppointment(appointment)"
                    @complete="markCompleted(appointment)"
                    @delete="deleteAppointment(appointment)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-else-if="calendarMode === 'team' && canManageTenant" class="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table class="w-full min-w-[56rem] table-fixed border-collapse text-xs">
          <thead>
            <tr class="bg-neutral-50 dark:bg-neutral-900/60">
              <th class="sticky left-0 z-10 w-40 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900">
                Team
              </th>
              <th
                v-for="day in weekDays"
                :key="day.key"
                class="border-b border-l border-neutral-200 px-2 py-1.5 text-left font-medium dark:border-neutral-800"
                :class="isToday(day.date) ? 'bg-primary-50 text-primary-800 dark:bg-primary-500/10 dark:text-primary-200' : 'text-neutral-600 dark:text-neutral-400'"
              >
                <button type="button" class="hover:text-primary-700 dark:hover:text-primary-200" title="Zeitachse für diesen Tag" @click="openDay(day.date, 'timeline')">
                  {{ formatDayHeader(day.date) }}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!teamRows.length">
              <td colspan="8" class="px-3 py-4 text-sm text-neutral-500">Keine {{ teacherLabel }} hinterlegt.</td>
            </tr>
            <tr v-for="row in teamRows" :key="row.id" class="align-top">
              <th class="sticky left-0 z-10 border-b border-neutral-100 bg-white px-3 py-2 text-left font-normal dark:border-neutral-900 dark:bg-neutral-950">
                <div class="flex items-center gap-2">
                  <span
                    v-if="row.id !== UNASSIGNED_ROW_ID"
                    class="flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                    :style="{ backgroundColor: avatarColor(row.id, row.color) }"
                  >
                    {{ avatarInitials(row.name) }}
                  </span>
                  <span v-else class="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-neutral-300 text-neutral-400 dark:border-neutral-700">
                    <UIcon name="i-lucide-user-x" class="size-3" />
                  </span>
                  <span class="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{{ row.name }}</span>
                </div>
              </th>
              <td
                v-for="day in weekDays"
                :key="day.key"
                class="border-b border-l border-neutral-100 p-1 dark:border-neutral-900"
                :class="isToday(day.date) ? 'bg-primary-50/40 dark:bg-primary-500/5' : ''"
              >
                <div v-if="row.byDay.get(day.key)?.length" class="flex flex-col gap-1">
                  <CalendarChip
                    v-for="appointment in row.byDay.get(day.key)!.slice(0, TEAM_CELL_VISIBLE)"
                    :key="appointment.id"
                    :time="formatTime(appointment.startsAt)"
                    :title="appointmentTitle(appointment)"
                    :status="appointment.status"
                    :color="row.id === UNASSIGNED_ROW_ID ? null : avatarColor(row.id, row.color)"
                    @click="openEditAppointment(appointment)"
                  />
                  <button
                    type="button"
                    class="flex items-center justify-between rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-primary-700 dark:hover:bg-neutral-800 dark:hover:text-primary-200"
                    title="Zeitachse für diesen Tag"
                    @click="openDay(day.date, 'timeline')"
                  >
                    <span v-if="row.byDay.get(day.key)!.length > TEAM_CELL_VISIBLE">
                      +{{ row.byDay.get(day.key)!.length - TEAM_CELL_VISIBLE }} weitere
                    </span>
                    <span v-else />
                    <span class="tabular-nums">{{ bookedHoursLabel(row.byDay.get(day.key)!) }}</span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="calendarMode === 'week' || calendarMode === 'team'" class="grid grid-cols-1 gap-2 md:grid-cols-7">
        <div
          v-for="day in weekDays"
          :key="day.key"
          class="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-white p-1.5 md:min-h-[140px] dark:bg-neutral-950"
          :class="
            isToday(day.date)
              ? 'border-primary-300 dark:border-primary-700 ring-1 ring-primary-200 dark:ring-primary-900/40'
              : 'border-neutral-200 dark:border-neutral-800'
          "
        >
          <button
            type="button"
            class="flex items-center justify-between px-0.5 text-left text-xs font-medium text-neutral-600 hover:text-primary-700 dark:text-neutral-400 dark:hover:text-primary-200"
            title="Tagesansicht"
            @click="openDay(day.date, canManageTenant ? 'timeline' : 'day')"
          >
            <span>{{ formatDayHeader(day.date) }}</span>
            <span v-if="appointmentsByDay(day.key).length" class="font-normal tabular-nums text-neutral-400">
              {{ appointmentsByDay(day.key).length }}
            </span>
          </button>
          <CalendarChip
            v-for="appointment in appointmentsByDay(day.key).slice(0, WEEK_DAY_VISIBLE)"
            :key="appointment.id"
            :time="formatTime(appointment.startsAt)"
            :title="appointmentTitle(appointment)"
            :status="appointment.status"
            :color="appointmentColor(appointment)"
            :person-name="canManageTenant ? (appointment.teachers?.[0] ?? appointment.teacher)?.displayName : null"
            @click="openEditAppointment(appointment)"
          />
          <button
            v-if="appointmentsByDay(day.key).length > WEEK_DAY_VISIBLE"
            type="button"
            class="rounded px-1.5 py-1 text-left text-[11px] font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-500/10"
            @click="openDay(day.date, canManageTenant ? 'timeline' : 'day')"
          >
            +{{ appointmentsByDay(day.key).length - WEEK_DAY_VISIBLE }} weitere
          </button>
          <p v-if="!appointmentsByDay(day.key).length" class="px-0.5 text-xs italic text-neutral-400">Keine Termine</p>
        </div>
      </div>

      <div v-else class="space-y-1">
        <div class="grid grid-cols-7 gap-px sm:gap-1 text-[10px] sm:text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <div v-for="header in weekdayHeaders" :key="header" class="px-0.5 sm:px-2 py-1 text-center sm:text-left">
            {{ header }}
          </div>
        </div>
        <div class="grid grid-cols-7 gap-px sm:gap-1">
          <div
            v-for="day in monthGrid"
            :key="day.key"
            class="rounded-md border min-h-[72px] sm:min-h-[110px] p-0.5 sm:p-1.5 flex flex-col gap-0.5 sm:gap-1 transition overflow-hidden"
            :class="[
              day.inMonth
                ? 'bg-white dark:bg-neutral-950'
                : 'bg-neutral-50 dark:bg-neutral-900/50 text-neutral-400',
              isToday(day.date)
                ? 'border-primary-300 dark:border-primary-700 ring-1 ring-primary-200 dark:ring-primary-900/40'
                : 'border-neutral-200 dark:border-neutral-800',
            ]"
          >
            <div class="flex items-center justify-center sm:justify-end text-[11px] sm:text-xs">
              <span
                class="font-medium tabular-nums"
                :class="isToday(day.date) ? 'text-primary-700 dark:text-primary-200' : ''"
              >
                {{ day.date.getDate() }}
              </span>
            </div>
            <div class="flex flex-col gap-0.5 sm:gap-1 min-w-0">
              <button
                v-for="appointment in appointmentsByDay(day.key).slice(0, 3)"
                :key="appointment.id"
                type="button"
                class="rounded px-0.5 sm:px-1.5 py-0.5 text-[9px] sm:text-[11px] leading-tight border truncate text-left"
                :class="{
                  'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800 text-primary-900 dark:text-primary-100':
                    appointment.status === 'confirmed',
                  'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100':
                    appointment.status === 'completed',
                  'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100':
                    appointment.status === 'draft',
                  'bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 line-through':
                    appointment.status === 'cancelled',
                }"
                :title="`${formatTime(appointment.startsAt)} ${appointmentTitle(appointment)}`"
                @click="openEditAppointment(appointment)"
              >
                <span
                  v-if="appointmentColor(appointment)"
                  class="mr-0.5 inline-block size-1.5 rounded-full align-middle sm:mr-1 sm:size-2"
                  :style="{ backgroundColor: appointmentColor(appointment)! }"
                />
                <span class="font-medium tabular-nums">{{ formatTime(appointment.startsAt) }}</span>
                <span class="ml-0.5 hidden sm:inline">{{ appointmentTitle(appointment) }}</span>
              </button>
              <button
                v-if="appointmentsByDay(day.key).length > 3"
                type="button"
                class="text-[9px] sm:text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 text-left truncate"
                @click="openDay(day.date)"
              >
                +{{ appointmentsByDay(day.key).length - 3 }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <UModal v-model:open="quickOpen" :ui="{ content: 'max-w-2xl' }">
      <template #header>
        <div class="flex items-center justify-between gap-3 w-full">
          <div class="min-w-0 flex items-center gap-1">
            <h2 class="font-medium truncate">
              {{ editingAppointment ? $t("home.editAppointment") : $t("home.newQuickCapture") }}
            </h2>
            <FieldInfoPopover :aria-label="$t('home.modalHintAria')">
              <template v-if="editingAppointment">{{ $t("home.editHint") }}</template>
              <template v-else>
                {{
                  $t(speechRecognitionEnabled ? "home.captureHintVoice" : "home.captureHintText", {
                    teacher: teacherLabel,
                    resource: resourcesEnabled ? $t("home.resourceSuffix") : "",
                  })
                }}
              </template>
            </FieldInfoPopover>
          </div>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="closeQuickCapture" />
        </div>
      </template>
      <template #body>
        <QuickCaptureForm
          :key="editingAppointment?.id ?? `${quickStartVoice ? 'voice' : 'type'}-${quickInitialContact || 'empty'}`"
          :appointment="editingAppointment"
          :initial-contact-text="quickInitialContact"
          :start-with-voice="quickStartVoice"
          @saved="onAppointmentSaved"
          @cancel="closeQuickCapture"
        />
      </template>
    </UModal>
  </UContainer>
</template>
