<script setup lang="ts">
type ThemePreference = "system" | "light" | "dark";

withDefaults(
  defineProps<{
    /** Single icon button that cycles through the modes (for tight headers). */
    compact?: boolean;
  }>(),
  { compact: false },
);

const colorMode = useColorMode();
const { t } = useI18n();

const options = computed(() => [
  { value: "system" as const, label: t("theme.system"), icon: "i-lucide-monitor" },
  { value: "light" as const, label: t("theme.light"), icon: "i-lucide-sun" },
  { value: "dark" as const, label: t("theme.dark"), icon: "i-lucide-moon" },
]);

const current = computed(
  () => options.value.find((o) => o.value === colorMode.preference) ?? options.value[0]!,
);

function select(value: ThemePreference) {
  colorMode.preference = value;
}

function cycle() {
  const order: ThemePreference[] = ["system", "light", "dark"];
  const idx = order.indexOf(colorMode.preference as ThemePreference);
  select(order[(idx + 1) % order.length]!);
}
</script>

<template>
  <ClientOnly>
    <UButton
      v-if="compact"
      size="sm"
      variant="ghost"
      color="neutral"
      :icon="current.icon"
      :aria-label="`${$t('theme.title')}: ${current.label}`"
      :title="`${$t('theme.title')}: ${current.label}`"
      @click="cycle"
    />
    <div
      v-else
      role="radiogroup"
      :aria-label="$t('theme.title')"
      class="inline-flex w-full rounded-full bg-neutral-200/60 p-1 dark:bg-neutral-800"
    >
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="radio"
        :aria-checked="colorMode.preference === option.value"
        :title="option.label"
        class="flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium transition"
        :class="
          colorMode.preference === option.value
            ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-white'
            : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100'
        "
        @click="select(option.value)"
      >
        <UIcon :name="option.icon" class="size-3.5" />
        <span>{{ option.label }}</span>
      </button>
    </div>
    <template #fallback>
      <div :class="compact ? 'size-8' : 'h-9 w-full'" />
    </template>
  </ClientOnly>
</template>
