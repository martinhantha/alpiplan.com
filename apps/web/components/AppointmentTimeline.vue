<script lang="ts">
export interface TimelineAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  lessonType: { id: string; name: string; color?: string | null } | null;
  resource: { id: string; name: string } | null;
}

export type TimelineBlockKind = "vacation" | "sick" | "block" | "unavailable";

/** A range in which the row's person cannot be booked (absence or outside their hours). */
export interface TimelineBlock {
  id: string;
  kind: TimelineBlockKind;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  reason?: string | null;
}

export const TIMELINE_BLOCK_LABELS: Record<TimelineBlockKind, string> = {
  vacation: "Urlaub",
  sick: "Krank",
  block: "Frei",
  unavailable: "Nicht verfügbar",
};

export const TIMELINE_BLOCK_COLORS: Record<TimelineBlockKind, string> = {
  vacation: "#0ea5e9",
  sick: "#f43f5e",
  block: "#f59e0b",
  unavailable: "#737373",
};

export interface TimelineRowInput<T extends TimelineAppointment = TimelineAppointment> {
  id: string;
  name: string;
  color?: string | null;
  appointments: T[];
  blocks?: TimelineBlock[];
}

export interface TimelineMove<T extends TimelineAppointment = TimelineAppointment> {
  appointment: T;
  startsAt: Date;
  endsAt: Date;
  fromRowId: string;
  toRowId: string;
}

export interface TimelineCreate {
  startsAt: Date;
  rowId: string;
}
</script>

<script setup lang="ts" generic="T extends TimelineAppointment">
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { DropdownMenuItem } from "@nuxt/ui";
import { avatarColor, avatarInitials } from "../utils/avatar";

const { t } = useI18n();

const props = defineProps<{
  rows: TimelineRowInput<T>[];
  day: Date;
  fromHour: number;
  toHour: number;
  canMove: boolean;
  canChangeRow: boolean;
  /** Clicking free space in a row emits `create`. */
  canCreate?: boolean;
  /** Color rows and items per person; otherwise everything uses the primary color. */
  personColors?: boolean;
  savingId?: string;
  showResource?: boolean;
  titleOf: (appointment: T) => string;
  formatTime: (value: string | Date) => string;
  menuItems?: (appointment: T) => DropdownMenuItem[][];
}>();

const emit = defineEmits<{
  open: [appointment: T];
  move: [move: TimelineMove<T>];
  create: [create: TimelineCreate];
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
    const blockItems = (row.blocks ?? [])
      .map((block) => ({
        block,
        start: Math.max(rangeStart.value, minutesIntoDay(block.startsAt)),
        end: Math.min(rangeEnd.value, minutesIntoDay(block.endsAt)),
      }))
      .filter((item) => item.end > item.start);
    const absence = (row.blocks ?? []).find((block) => block.allDay) ?? null;
    return { ...row, items, blockItems, absence, lanes, height: lanes * LANE_HEIGHT + ROW_PADDING };
  }),
);

function blockStyle(kind: TimelineBlockKind, emphasized: boolean) {
  const color = TIMELINE_BLOCK_COLORS[kind];
  const strong = kind === "unavailable" ? (emphasized ? 16 : 9) : emphasized ? 26 : 15;
  const weak = kind === "unavailable" ? 3 : 6;
  return {
    backgroundImage: `repeating-linear-gradient(135deg, color-mix(in srgb, ${color} ${strong}%, transparent) 0 6px, color-mix(in srgb, ${color} ${weak}%, transparent) 6px 12px)`,
    borderColor: `color-mix(in srgb, ${color} ${emphasized ? 55 : 30}%, transparent)`,
  };
}

function blockKindLabel(kind: TimelineBlockKind) {
  return t(`blocks.${kind}`);
}

function blockTitle(block: TimelineBlock) {
  const label = blockKindLabel(block.kind);
  const window = block.allDay ? t("blocks.allDayParen") : `${props.formatTime(block.startsAt)}–${props.formatTime(block.endsAt)}`;
  return [`${label} (${window})`, block.reason].filter(Boolean).join(" · ");
}

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

/** Chip body follows the lesson type; the left stripe keeps the person color. */
function chipColor(appointment: TimelineAppointment, row: { id: string; color?: string | null }) {
  const type = appointment.lessonType;
  return type ? avatarColor(type.id, type.color) : rowColor(row);
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

// --- Click into free space ----------------------------------------------

const CREATE_PREVIEW_MINUTES = 60;
const hoverSlot = ref<{ rowId: string; start: number } | null>(null);
const menuOpenFor = ref<string | null>(null);

function slotStartAt(clientX: number) {
  const el = rowsRef.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width) return null;
  const minutes = rangeStart.value + ((clientX - rect.left) / rect.width) * span.value;
  const start = Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.min(Math.max(start, rangeStart.value), rangeEnd.value - SNAP_MINUTES);
}

function onRowPointerMove(event: PointerEvent, rowId: string) {
  if (!props.canCreate || drag.value || event.pointerType !== "mouse" || event.target !== event.currentTarget) {
    hoverSlot.value = null;
    return;
  }
  const start = slotStartAt(event.clientX);
  hoverSlot.value = start === null ? null : { rowId, start };
}

function onRowClick(event: MouseEvent, rowId: string) {
  if (!props.canCreate || suppressClickFor || event.target !== event.currentTarget) return;
  const start = slotStartAt(event.clientX);
  if (start === null) return;
  hoverSlot.value = null;
  emit("create", { startsAt: new Date(props.day.getTime() + start * 60000), rowId });
}

function hoverSlotEnd(start: number) {
  return Math.min(start + CREATE_PREVIEW_MINUTES, rangeEnd.value);
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
          class="sticky left-0 z-30 w-14 shrink-0 border-r border-neutral-200 bg-white sm:w-48 dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div class="flex h-10 items-end border-b border-neutral-200 px-3 pb-2 dark:border-neutral-800">
            <span class="hidden text-[11px] font-medium uppercase tracking-wider text-neutral-400 sm:inline">{{ t("timeline.team") }}</span>
          </div>
          <div
            v-for="row in layout"
            :key="row.id"
            class="flex items-center justify-center gap-2.5 border-b border-neutral-100 px-2 transition-colors sm:px-3 last:border-b-0 sm:justify-start dark:border-neutral-900"
            :class="ghostTargetRow === row.id ? 'bg-primary-50/70 dark:bg-primary-500/10' : ''"
            :style="{ height: `${row.height}px` }"
          >
            <UPopover
              mode="click"
              :content="{ side: 'right', align: 'center' }"
              :ui="{ content: 'max-w-sm p-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400' }"
            >
              <button
                type="button"
                class="flex size-8 shrink-0 items-center justify-center rounded-full sm:pointer-events-none"
                :class="
                  row.id !== '__unassigned'
                    ? 'text-[11px] font-semibold text-white shadow-sm'
                    : 'border border-dashed border-neutral-300 text-neutral-400 dark:border-neutral-700'
                "
                :style="row.id !== '__unassigned' ? { backgroundColor: rowColor(row) } : undefined"
                :aria-label="row.name"
              >
                <template v-if="row.id !== '__unassigned'">{{ initials(row.name) }}</template>
                <UIcon v-else name="i-lucide-user-x" class="size-4" />
              </button>
              <template #content>
                <p class="font-medium text-neutral-800 dark:text-neutral-100">{{ row.name }}</p>
                <p class="text-xs text-neutral-500 tabular-nums">
                  {{ row.appointments.length }} {{ row.appointments.length === 1 ? t("common.appointment") : t("nav.appointments") }}
                </p>
                <p
                  v-for="block in row.blocks ?? []"
                  :key="block.id"
                  class="mt-1 text-xs font-medium"
                  :style="{ color: TIMELINE_BLOCK_COLORS[block.kind] }"
                >
                  {{ blockTitle(block) }}
                </p>
              </template>
            </UPopover>
            <div class="hidden min-w-0 sm:block">
              <p class="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{{ row.name }}</p>
              <p class="flex items-center gap-1.5 text-[11px] text-neutral-500 tabular-nums">
                <span>{{ row.appointments.length }} {{ row.appointments.length === 1 ? t("common.appointment") : t("nav.appointments") }}</span>
                <span
                  v-if="row.absence"
                  class="truncate rounded px-1 font-medium"
                  :style="{
                    color: TIMELINE_BLOCK_COLORS[row.absence.kind],
                    backgroundColor: `color-mix(in srgb, ${TIMELINE_BLOCK_COLORS[row.absence.kind]} 12%, transparent)`,
                  }"
                  :title="blockTitle(row.absence)"
                >
                  {{ blockKindLabel(row.absence.kind) }}
                </span>
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
              :class="[
                ghostTargetRow === row.id ? 'bg-primary-50/50 dark:bg-primary-500/5' : 'hover:bg-neutral-50/60 dark:hover:bg-white/[0.015]',
                canCreate ? 'cursor-copy' : '',
              ]"
              :style="{ height: `${row.height}px` }"
              @pointermove="onRowPointerMove($event, row.id)"
              @pointerleave="hoverSlot = null"
              @click="onRowClick($event, row.id)"
            >
              <div
                v-for="item in row.blockItems"
                :key="item.block.id"
                class="absolute inset-y-0 overflow-hidden border-x transition-[background-image]"
                :class="canCreate ? 'cursor-not-allowed' : ''"
                :style="{
                  ...blockStyle(item.block.kind, ghostTargetRow === row.id),
                  left: `${percentOf(item.start)}%`,
                  width: `${percentOf(item.end) - percentOf(item.start)}%`,
                }"
                :title="blockTitle(item.block)"
              >
                <span
                  class="absolute bottom-0.5 left-1 max-w-[calc(100%-0.5rem)] truncate text-[10px] font-semibold uppercase tracking-wide"
                  :style="{ color: TIMELINE_BLOCK_COLORS[item.block.kind] }"
                >
                  {{ blockKindLabel(item.block.kind) }}
                </span>
              </div>
              <div
                v-if="hoverSlot?.rowId === row.id && !drag?.active"
                class="pointer-events-none absolute flex items-center gap-1 rounded-lg border border-dashed border-primary-400 bg-primary-50/60 px-2 text-[11px] font-medium tabular-nums text-primary-700 dark:border-primary-500/60 dark:bg-primary-500/10 dark:text-primary-200"
                :style="{
                  left: `calc(${percentOf(hoverSlot.start)}% + 2px)`,
                  width: `calc(${percentOf(hoverSlotEnd(hoverSlot.start)) - percentOf(hoverSlot.start)}% - 4px)`,
                  top: `${ROW_PADDING / 2 + 2}px`,
                  height: `${LANE_HEIGHT - 4}px`,
                }"
              >
                <UIcon name="i-lucide-plus" class="size-3.5 shrink-0" />
                <span class="truncate">{{ formatMinutes(hoverSlot.start) }}</span>
              </div>
              <div
                v-for="item in row.items"
                :key="item.appointment.id"
                role="button"
                tabindex="0"
                draggable="false"
                class="group absolute flex select-none overflow-hidden rounded-lg border bg-white text-left text-neutral-900 shadow-sm transition-[box-shadow,transform,opacity] duration-150 hover:z-10 hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary-500 dark:bg-neutral-900 dark:text-neutral-50"
                :class="[
                  statusChipClass[item.appointment.status],
                  canMove && item.appointment.status !== 'cancelled' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                  isDragging(item.appointment.id) ? 'opacity-35 shadow-none' : '',
                  savingId === item.appointment.id ? 'animate-pulse' : '',
                  menuOpenFor === item.appointment.id ? 'z-10 shadow-md' : '',
                ]"
                :style="{
                  ...chipStyle(chipColor(item.appointment, row), item.appointment.status),
                  left: `calc(${percentOf(item.start)}% + 2px)`,
                  width: `calc(${percentOf(item.end) - percentOf(item.start)}% - 4px)`,
                  top: `${item.lane * LANE_HEIGHT + ROW_PADDING / 2 + 2}px`,
                  height: `${LANE_HEIGHT - 4}px`,
                }"
                :title="chipTitle(item.appointment)"
                @pointerdown="onPointerDown($event, item, row.id, 'move')"
                @dragstart.prevent
                @click="onChipClick(item.appointment)"
                @keydown.enter.self.prevent="onChipClick(item.appointment)"
                @keydown.space.self.prevent="onChipClick(item.appointment)"
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
                      :title="t('appointment.status.draft')"
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
                <span
                  v-if="menuItems"
                  class="absolute right-2 top-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                  :class="menuOpenFor === item.appointment.id ? 'opacity-100' : ''"
                  @pointerdown.stop
                  @click.stop
                  @keydown.stop
                >
                  <UDropdownMenu
                    :items="menuItems(item.appointment)"
                    :content="{ align: 'end' }"
                    :modal="false"
                    @update:open="(open: boolean) => (menuOpenFor = open ? item.appointment.id : null)"
                  >
                    <button
                      type="button"
                      class="flex size-6 items-center justify-center rounded-md bg-white/90 text-neutral-600 shadow-sm ring-1 ring-neutral-200 hover:text-neutral-900 dark:bg-neutral-800/90 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:text-white"
                      :aria-label="t('timeline.actions')"
                      :title="t('common.actions')"
                    >
                      <UIcon name="i-lucide-ellipsis" class="size-4" />
                    </button>
                  </UDropdownMenu>
                </span>
              </div>

              <div
                v-if="drag?.active && drag.rowId === row.id"
                class="pointer-events-none absolute z-20 flex overflow-hidden rounded-lg border bg-white text-neutral-900 shadow-xl ring-2 ring-primary-500 dark:bg-neutral-900 dark:text-neutral-50"
                :style="{
                  ...chipStyle(chipColor(drag.appointment, row), drag.appointment.status),
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
      {{
        t("timeline.dragHint", {
          row: canChangeRow ? t("timeline.dragRow") : "",
          create: canCreate ? t("timeline.dragCreate") : "",
        })
      }}
    </div>
  </div>
</template>
