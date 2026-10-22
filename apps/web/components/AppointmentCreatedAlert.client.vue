<script setup lang="ts">
import type { AppointmentLiveEvent } from "~/types/live-events";

const { alert, dismiss, canAskNotifications, enableNotifications } = useAppointmentAlerts();
const { t, intlLocale } = useAppLocale();

function formatWhen(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat(intlLocale.value, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const when = computed(() => (alert.value ? formatWhen(alert.value.startsAt) : ""));
const previousWhen = computed(() =>
  alert.value?.type === "appointment.moved" && alert.value.previousStartsAt !== alert.value.startsAt
    ? formatWhen(alert.value.previousStartsAt)
    : "",
);

const headline = computed(() => {
  if (alert.value?.type === "appointment.moved") return t("alerts.moved");
  if (alert.value?.type === "appointment.deleted") return t("alerts.deleted");
  return t("alerts.created");
});

const icon = computed(() => {
  if (alert.value?.type === "appointment.moved") return "i-lucide-calendar-clock";
  if (alert.value?.type === "appointment.deleted") return "i-lucide-calendar-x";
  return "i-lucide-calendar-plus";
});

function iconWrapClass(event: AppointmentLiveEvent | null) {
  if (event?.type === "appointment.deleted") {
    return "bg-red-100 dark:bg-red-900/40";
  }
  if (event?.type === "appointment.moved") {
    return "bg-amber-100 dark:bg-amber-900/40";
  }
  return "bg-primary-100 dark:bg-primary-900/50";
}

function iconClass(event: AppointmentLiveEvent | null) {
  if (event?.type === "appointment.deleted") {
    return "size-5 text-red-700 dark:text-red-200";
  }
  if (event?.type === "appointment.moved") {
    return "size-5 text-amber-800 dark:text-amber-200";
  }
  return "size-5 text-primary-700 dark:text-primary-200";
}

async function openAppointments() {
  dismiss();
  await navigateTo("/appointments");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="alert"
      class="fixed inset-x-3 z-[80] flex justify-center pointer-events-none"
      style="top: max(0.75rem, var(--app-safe-top))"
    >
      <div
        class="pointer-events-auto w-full max-w-md rounded-xl border border-primary-200 dark:border-primary-800 bg-white dark:bg-neutral-900 shadow-lg p-4"
        role="status"
        aria-live="polite"
      >
        <div class="flex items-start gap-3">
          <div class="mt-0.5 rounded-lg p-2" :class="iconWrapClass(alert)">
            <UIcon :name="icon" :class="iconClass(alert)" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">{{ headline }}</p>
            <p class="mt-0.5 text-sm text-neutral-800 dark:text-neutral-100 truncate">{{ alert.title }}</p>
            <p class="mt-0.5 text-xs text-neutral-500">
              <template v-if="alert.type === 'appointment.moved' && previousWhen">
                {{ previousWhen }} → {{ when }}
              </template>
              <template v-else>
                {{ when }}
              </template>
              <span v-if="alert.teacherName"> · {{ alert.teacherName }}</span>
              <span v-if="alert.type === 'appointment.moved' && alert.actorName"> · {{ t("alerts.byActor", { name: alert.actorName }) }}</span>
            </p>
            <div class="mt-3 flex justify-end gap-2">
              <UButton v-if="canAskNotifications" size="xs" variant="soft" color="neutral" @click="enableNotifications">
                {{ t("common.notifications") }}
              </UButton>
              <UButton size="xs" variant="ghost" color="neutral" @click="dismiss">{{ t("common.close") }}</UButton>
              <UButton
                v-if="alert.type !== 'appointment.deleted'"
                size="xs"
                color="primary"
                icon="i-lucide-calendar-days"
                @click="openAppointments"
              >
                {{ t("common.view") }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
