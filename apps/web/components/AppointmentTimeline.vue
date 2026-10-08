<script lang="ts">
export interface TimelineAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  lessonType: { id: string; name: string } | null;
  resource: { id: string; name: string } | null;
}

export interface TimelineRowInput<T extends TimelineAppointment = TimelineAppointment> {
  id: string;
  name: string;
  color?: string | null;
  appointments: T[];
}

export interface TimelineMove<T extends TimelineAppointment = TimelineAppointment> {
  appointment: T;
  startsAt: Date;
  endsAt: Date;
  fromRowId: string;
  toRowId: string;
}
</script>

<script setup lang="ts" generic="T extends TimelineAppointment">
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { avatarColor, avatarInitials } from "../utils/avatar";

const props = defineProps<{
  rows: TimelineRowInput<T>[];
  day: Date;
  fromHour: number;
  toHour: number;
  canMove: boolean;
  canChangeRow: boolean;
  /** Color rows and items per person; otherwise everything uses the primary color. */
  personColors?: boolean;
  savingId?: string;
  showResource?: boolean;
  titleOf: (appointment: T) => string;
  formatTime: (value: string | Date) => string;
}>();

const emit = defineEmits<{
  open: [appointment: T];
  move: [move: TimelineMove<T>];
}>();

const LANE_HEIGHT = 58;
const ROW_PADDING = 10;
const HOUR_MIN_WIDTH = 88;
const SNAP_MINUTES = 15;
const DRAG_THRESHOLD_PX = 4;

const rangeStart = computed(() => props.fromHour * 60);
const rangeEnd = computed(() => props.toHour * 60);
const span = computed(() => rangeEnd.value - rangeStart.value);
const hours = computed(() => Array.from({ length: props.toHour - props.fromHour }, (_, i) => props.fromHour + i));

function minutesIntoDay(value: string | Date) {
  return (new Date(value).getTime() - props.day.getTime()) / 60000;
}

function percentOf(minutes: number) {
  return ((minutes - rangeStart.value) / span.value) * 100;
}

const layout = computed(() =>
  props.rows.map((row) => {
    const laneEnds: number[] = [];
    const items: { appointment: T; start: number; end: number; lane: number }[] = [];
    const sorted = [...row.appointments].sort((a, b) => minutesIntoDay(a.startsAt) - minutesIntoDay(b.startsAt));
    for (const appointment of sorted) {
      const start = Math.max(rangeStart.value, minutesIntoDay(appointment.startsAt));
      const end = Math.min(rangeEnd.value, minutesIntoDay(appointment.endsAt));
      if (end <= start) continue;
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      items.push({ appointment, start, end, lane });
    }
    const lanes = Math.max(1, laneEnds.length);
    return { ...row, items, lanes, height: lanes * LANE_HEIGHT + ROW_PADDING };
  }),
);

const now = ref(new Date());
let nowTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  nowTimer = setInterval(() => (now.value = new Date()), 60_000);
});
onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer);
  endDrag();
});

const nowMinutes = computed(() => {
  const minutes = minutesIntoDay(now.value);
  if (minutes < 0 || minutes >= 24 * 60) return null;
  if (minutes < rangeStart.value || minutes > rangeEnd.value) return null;
  return minutes;
});

const initials = avatarInitials;

const UNASSIGNED_COLOR = "#a3a3a3";

function rowColor(row: { id: string; color?: string | null }) {
  if (row.id === "__unassigned") return UNASSIGNED_COLOR;
  return props.personColors ? avatarColor(row.id, row.color) : "var(--ui-primary)";
}

function chipStyle(color: string, status: TimelineAppointment["status"]) {
  const tint = status === "cancelled" ? 6 : 15;
  return {
    backgroundImage: `linear-gradient(color-mix(in srgb, ${color} ${tint}%, transparent), color-mix(in srgb, ${color} ${tint}%, transparent))`,
    borderColor: `color-mix(in srgb, ${color} ${status === "draft" ? 70 : 35}%, transparent)`,
  };
}

const statusChipClass: Record<TimelineAppointment["status"], string> = {
  confirmed: "",
  draft: "border-dashed",
  completed: "",
  cancelled: "line-through opacity-60",
};

// --- Drag & drop ---------------------------------------------------------

type DragMode = "move" | "resize";

interface DragState {
  appointment: T;
  mode: DragMode;
  pointerId: number;
  originRowId: string;
  startX: number;
  startY: number;
  originStart: number;
  originEnd: number;
  pxPerMinute: number;
  active: boolean;
  start: number;
  end: number;
  rowId: string;
}

const rowsRef = ref<HTMLElement | null>(null);
const drag: Ref<DragState | null> = ref(null);
let suppressClickFor: string | null = null;

function snap(minutes: number) {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

function rowIdAt(clientY: number): string | null {
  const el = rowsRef.value;
  if (!el) return null;
  let y = clientY - el.getBoundingClientRect().top;
  for (const row of layout.value) {
    if (y < row.height) return row.id;
    y -= row.height;
  }
  return layout.value[layout.value.length - 1]?.id ?? null;
}

function onPointerDown(
  event: PointerEvent,
  item: { appointment: T; start: number; end: number },
  rowId: string,
  mode: DragMode,
) {
  if (!props.canMove || event.button !== 0 || event.pointerType === "touch") return;
  if (item.appointment.status === "cancelled" || props.savingId === item.appointment.id) return;
  const width = rowsRef.value?.clientWidth ?? 0;
  if (!width) return;
  event.stopPropagation();
  window.getSelection()?.removeAllRanges();
  drag.value = {
    appointment: item.appointment,
    mode,
    pointerId: event.pointerId,
    originRowId: rowId,
    startX: event.clientX,
    startY: event.clientY,
    originStart: minutesIntoDay(item.appointment.startsAt),
    originEnd: minutesIntoDay(item.appointment.endsAt),
    pxPerMinute: width / span.value,
    active: false,
    start: minutesIntoDay(item.appointment.startsAt),
    end: minutesIntoDay(item.appointment.endsAt),
    rowId,
  };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", cancelDrag);
  window.addEventListener("keydown", onKeyDown);
}

function onPointerMove(event: PointerEvent) {
  const state = drag.value;
  if (!state || event.pointerId !== state.pointerId) return;
  updateDrag(state, event);
}

function updateDrag(state: DragState, event: PointerEvent) {
  const dx = event.clientX - state.startX;
  const dy = event.clientY - state.startY;
  if (!state.active) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    state.active = true;
    document.body.style.cursor = state.mode === "resize" ? "ew-resize" : "grabbing";
    document.body.style.userSelect = "none";
  }
  const delta = snap(dx / state.pxPerMinute);
  const duration = state.originEnd - state.originStart;
  if (state.mode === "move") {
    const start = Math.min(Math.max(state.originStart + delta, rangeStart.value), rangeEnd.value - duration);
    state.start = start;
    state.end = start + duration;
    if (props.canChangeRow) state.rowId = rowIdAt(event.clientY) ?? state.originRowId;
  } else {
    state.end = Math.min(Math.max(state.originEnd + delta, state.originStart + SNAP_MINUTES), rangeEnd.value);
  }
}

function onPointerUp(event: PointerEvent) {
  const state = drag.value;
  if (!state || event.pointerId !== state.pointerId) return;
  updateDrag(state, event);
  if (state.active) {
    suppressClickFor = state.appointment.id;
    setTimeout(() => (suppressClickFor = null), 0);
    const changed =
      state.start !== state.originStart || state.end !== state.originEnd || state.rowId !== state.originRowId;
    if (changed) {
      emit("move", {
        appointment: state.appointment,
        startsAt: new Date(props.day.getTime() + state.start * 60000),
        endsAt: new Date(props.day.getTime() + state.end * 60000),
        fromRowId: state.originRowId,
        toRowId: state.rowId,
      });
    }
  }
  endDrag();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") cancelDrag();
}

function cancelDrag() {
  if (drag.value?.active) {
    suppressClickFor = drag.value.appointment.id;
    setTimeout(() => (suppressClickFor = null), 0);
  }
  endDrag();
}

function endDrag() {
  drag.value = null;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", cancelDrag);
  window.removeEventListener("keydown", onKeyDown);
}

function onChipClick(appointment: T) {
  if (suppressClickFor === appointment.id) return;
  emit("open", appointment);
}

const isDragging = (id: string) => drag.value?.active && drag.value.appointment.id === id;

const ghostTargetRow = computed(() => (drag.value?.active ? drag.value.rowId : null));

function formatMinutes(minutes: number) {
  return props.formatTime(new Date(props.day.getTime() + minutes * 60000));
}

function chipTitle(appointment: T) {
  const parts = [
    `${props.formatTime(appointment.startsAt)}–${props.formatTime(appointment.endsAt)}`,
    props.titleOf(appointment),
    appointment.lessonType?.name,
    props.showResource ? appointment.resource?.name : undefined,
  ].filter(Boolean);
  return parts.join(" · ");
}
</script>

<template>
  <div
    class="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-(--shadow-soft) dark:border-neutral-800 dark:bg-neutral-950"
  >
    <div class="overflow-x-auto">
      <div class="flex min-w-full w-max">
        <!-- Names column -->
        <div
          class="sticky left-0 z-30 w-36 shrink-0 border-r border-neutral-200 bg-white sm:w-48 dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div class="flex h-10 items-end border-b border-neutral-200 px-3 pb-2 dark:border-neutral-800">
            <span class="text-[11px] font-medium uppercase tracking-wider text-neutral-400">Team</span>
          </div>
          <div
            v-for="row in layout"
            :key="row.id"
            class="flex items-center gap-2.5 border-b border-neutral-100 px-3 transition-colors last:border-b-0 dark:border-neutral-900"
            :class="ghostTargetRow === row.id ? 'bg-primary-50/70 dark:bg-primary-500/10' : ''"
            :style="{ height: `${row.height}px` }"
          >
            <span
              v-if="row.id !== '__unassigned'"
              class="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white shadow-sm"
              :style="{ backgroundColor: rowColor(row) }"
            >
              {{ initials(row.name) }}
            </span>
            <span
              v-else
              class="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-neutral-300 text-neutral-400 dark:border-neutral-700"
            >
              <UIcon name="i-lucide-user-x" class="size-4" />
            </span>
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{{ row.name }}</p>
              <p class="text-[11px] text-neutral-500 tabular-nums">
                {{ row.appointments.length }} {{ row.appointments.length === 1 ? "Termin" : "Termine" }}
              </p>
            </div>
          </div>
        </div>

        <!-- Time grid -->
        <div class="relative flex-1" :style="{ minWidth: `${hours.length * HOUR_MIN_WIDTH}px` }">
          <div class="relative z-20 h-10 border-b border-neutral-200 dark:border-neutral-800">
            <span
              v-for="hour in hours"
              :key="hour"
              class="absolute bottom-2 pl-2 text-[11px] font-medium tabular-nums text-neutral-500"
              :style="{ left: `${percentOf(hour * 60)}%` }"
            >
              {{ String(hour).padStart(2, "0") }}:00
            </span>
            <span
              v-if="nowMinutes !== null"
              class="absolute bottom-1 z-10 -translate-x-1/2 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white shadow"
              :style="{ left: `${percentOf(nowMinutes)}%` }"
            >
              {{ formatTime(now) }}
            </span>
          </div>

          <div ref="rowsRef" class="relative">
            <!-- grid lines -->
            <div class="pointer-events-none absolute inset-0">
              <template v-for="hour in hours" :key="hour">
                <div
                  v-if="hour !== fromHour"
                  class="absolute inset-y-0 w-px bg-neutral-200/80 dark:bg-neutral-800"
                  :style="{ left: `${percentOf(hour * 60)}%` }"
                />
                <div
                  class="absolute inset-y-0 border-l border-dashed border-neutral-100 dark:border-neutral-900"
                  :style="{ left: `${percentOf(hour * 60 + 30)}%` }"
                />
              </template>
            </div>

            <div
              v-if="nowMinutes !== null"
              class="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-red-500/80"
              :style="{ left: `${percentOf(nowMinutes)}%` }"
            />

            <div
              v-for="row in layout"
              :key="row.id"
              class="relative border-b border-neutral-100 transition-colors last:border-b-0 dark:border-neutral-900"
              :class="ghostTargetRow === row.id ? 'bg-primary-50/50 dark:bg-primary-500/5' : 'hover:bg-neutral-50/60 dark:hover:bg-white/[0.015]'"
              :style="{ height: `${row.height}px` }"
            >
              <button
                v-for="item in row.items"
                :key="item.appointment.id"
                type="button"
                draggable="false"
                class="group absolute flex select-none overflow-hidden rounded-lg border bg-white text-left text-neutral-900 shadow-sm transition-[box-shadow,transform,opacity] duration-150 hover:z-10 hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary-500 dark:bg-neutral-900 dark:text-neutral-50"
                :class="[
                  statusChipClass[item.appointment.status],
                  canMove && item.appointment.status !== 'cancelled' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                  isDragging(item.appointment.id) ? 'opacity-35 shadow-none' : '',
                  savingId === item.appointment.id ? 'animate-pulse' : '',
                ]"
                :style="{
                  ...chipStyle(rowColor(row), item.appointment.status),
                  left: `calc(${percentOf(item.start)}% + 2px)`,
                  width: `calc(${percentOf(item.end) - percentOf(item.start)}% - 4px)`,
                  top: `${item.lane * LANE_HEIGHT + ROW_PADDING / 2 + 2}px`,
                  height: `${LANE_HEIGHT - 4}px`,
                }"
                :title="chipTitle(item.appointment)"
                @pointerdown="onPointerDown($event, item, row.id, 'move')"
                @dragstart.prevent
                @click="onChipClick(item.appointment)"
              >
                <span class="w-1 shrink-0" :style="{ backgroundColor: rowColor(row) }" />
                <span class="min-w-0 flex-1 px-2 py-1.5 leading-tight">
                  <span class="flex items-center gap-1 text-[11px] font-medium tabular-nums">
                    <span class="truncate opacity-70">
                      {{ formatTime(item.appointment.startsAt) }} – {{ formatTime(item.appointment.endsAt) }}
                    </span>
                    <span
                      v-if="item.appointment.status === 'draft'"
                      class="size-1.5 shrink-0 rounded-full bg-amber-500"
                      title="Entwurf"
                    />
                    <UIcon
                      v-else-if="item.appointment.status === 'completed'"
                      name="i-lucide-circle-check"
                      class="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                    />
                  </span>
                  <span class="block truncate text-xs font-semibold">{{ titleOf(item.appointment) }}</span>
                  <span v-if="item.appointment.lessonType" class="block truncate text-[11px] opacity-60">
                    {{ item.appointment.lessonType.name }}
                  </span>
                </span>
                <span
                  v-if="canMove && item.appointment.status !== 'cancelled'"
                  class="absolute inset-y-0 right-0 w-2 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
                  @pointerdown="onPointerDown($event, item, row.id, 'resize')"
                >
                  <span class="absolute inset-y-3 right-0.5 w-0.5 rounded-full bg-current opacity-40" />
                </span>
              </button>

              <div
                v-if="drag?.active && drag.rowId === row.id"
                class="pointer-events-none absolute z-20 flex overflow-hidden rounded-lg border bg-white text-neutral-900 shadow-xl ring-2 ring-primary-500 dark:bg-neutral-900 dark:text-neutral-50"
                :style="{
                  ...chipStyle(rowColor(row), drag.appointment.status),
                  left: `calc(${percentOf(drag.start)}% + 2px)`,
                  width: `calc(${percentOf(drag.end) - percentOf(drag.start)}% - 4px)`,
                  top: `${ROW_PADDING / 2 + 2}px`,
                  height: `${LANE_HEIGHT - 4}px`,
                }"
              >
                <span class="w-1 shrink-0" :style="{ backgroundColor: rowColor(row) }" />
                <span class="min-w-0 flex-1 px-2 py-1.5 leading-tight">
                  <span class="block truncate text-[11px] font-semibold tabular-nums">
                    {{ formatMinutes(drag.start) }} – {{ formatMinutes(drag.end) }}
                  </span>
                  <span class="block truncate text-xs font-semibold">{{ titleOf(drag.appointment) }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="canMove"
      class="flex items-center gap-1.5 border-t border-neutral-100 px-3 py-2 text-[11px] text-neutral-500 dark:border-neutral-900"
    >
      <UIcon name="i-lucide-mouse-pointer-2" class="size-3.5" />
      Ziehen zum Verschieben{{ canChangeRow ? " (auch auf andere Personen)" : "" }}, rechten Rand ziehen für die Dauer, Esc bricht ab.
    </div>
  </div>
</template>
