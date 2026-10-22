<script setup lang="ts">
const { reminder, minutesLeft, teacherLabel, dismiss } = useAppointmentReminders();
const { t, intlLocale } = useAppLocale();

const when = computed(() => {
  if (!reminder.value) return "";
  return new Intl.DateTimeFormat(intlLocale.value, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(reminder.value.startsAt));
});

async function openAppointment() {
  dismiss();
  await navigateTo("/appointments");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="reminder"
      class="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40"
      style="padding-top: max(1rem, var(--app-safe-top)); padding-bottom: max(1rem, var(--app-safe-bottom))"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appointment-reminder-title"
    >
      <div class="w-full max-w-md rounded-xl border border-primary-200 dark:border-primary-800 bg-white dark:bg-neutral-900 shadow-lg p-4">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 rounded-lg bg-primary-100 dark:bg-primary-900/50 p-2">
            <UIcon name="i-lucide-bell-ring" class="size-5 text-primary-700 dark:text-primary-200" />
          </div>
          <div class="min-w-0 flex-1">
            <p id="appointment-reminder-title" class="text-sm font-semibold">{{ t("alerts.reminderTitle") }}</p>
            <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {{ t("alerts.reminderBody", { minutes: minutesLeft }) }}
            </p>
            <p class="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-50">
              {{ reminder.title }}
            </p>
            <p class="mt-0.5 text-xs text-neutral-500">
              {{ when }}
              <span v-if="reminder.teacherName"> · {{ teacherLabel }}: {{ reminder.teacherName }}</span>
            </p>
            <div class="mt-3 flex justify-end gap-2">
              <UButton size="xs" variant="ghost" color="neutral" @click="dismiss">{{ t("common.later") }}</UButton>
              <UButton size="xs" color="primary" icon="i-lucide-calendar-days" @click="openAppointment">
                {{ t("common.view") }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
