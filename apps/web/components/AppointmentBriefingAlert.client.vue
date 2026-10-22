<script setup lang="ts">
const { briefing, dismiss } = useNextDayBriefing();
const { t, intlLocale } = useAppLocale();

function formatTime(value: string) {
  return new Intl.DateTimeFormat(intlLocale.value, {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const tomorrowLabel = computed(() => {
  if (!briefing.value) return "";
  const [year, month, day] = briefing.value.dateKey.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return new Intl.DateTimeFormat(intlLocale.value, {
    timeZone: "UTC",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  }).format(tomorrow);
});

async function openAppointments() {
  dismiss();
  await navigateTo("/appointments");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="briefing"
      class="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40"
      style="padding-top: max(1rem, var(--app-safe-top)); padding-bottom: max(1rem, var(--app-safe-bottom))"
      role="dialog"
      aria-modal="true"
      aria-labelledby="next-day-briefing-title"
    >
      <div class="w-full max-w-md rounded-xl border border-primary-200 dark:border-primary-800 bg-white dark:bg-neutral-900 shadow-lg p-4">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 rounded-lg bg-primary-100 dark:bg-primary-900/50 p-2">
            <UIcon name="i-lucide-sunrise" class="size-5 text-primary-700 dark:text-primary-200" />
          </div>
          <div class="min-w-0 flex-1">
            <p id="next-day-briefing-title" class="text-sm font-semibold">{{ t("alerts.tomorrowTitle") }}</p>
            <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {{ t(briefing.items.length === 1 ? "alerts.tomorrowOne" : "alerts.tomorrowMany", { count: briefing.items.length, date: tomorrowLabel }) }}
            </p>
            <ul class="mt-2 space-y-1 text-sm">
              <li v-for="item in briefing.items" :key="item.id" class="flex gap-2 min-w-0">
                <span class="tabular-nums shrink-0 font-medium">{{ formatTime(item.startsAt) }}</span>
                <span class="truncate text-neutral-800 dark:text-neutral-100">{{ item.title }}</span>
              </li>
            </ul>
            <div class="mt-3 flex justify-end gap-2">
              <UButton size="xs" variant="ghost" color="neutral" @click="dismiss">{{ t("common.close") }}</UButton>
              <UButton size="xs" color="primary" icon="i-lucide-calendar-days" @click="openAppointments">
                {{ t("common.view") }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
