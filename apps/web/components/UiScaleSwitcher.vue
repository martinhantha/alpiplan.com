<script setup lang="ts">
import { UI_SCALES, type UiScale } from "../utils/ui-scale";

const props = defineProps<{
  modelValue: UiScale;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [UiScale];
}>();

const { t } = useI18n();

const options = computed(() =>
  UI_SCALES.map((value) => ({
    value,
    label: t(`uiScale.${value}`),
    icon:
      value === "small"
        ? "i-lucide-minus"
        : value === "medium"
          ? "i-lucide-equal"
          : "i-lucide-plus",
  })),
);

function select(value: UiScale) {
  if (props.disabled || value === props.modelValue) return;
  emit("update:modelValue", value);
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="$t('uiScale.title')"
    class="inline-flex w-full max-w-md rounded-full bg-neutral-200/60 p-1 dark:bg-neutral-800"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === option.value"
      :disabled="disabled"
      :title="option.label"
      class="flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium transition disabled:opacity-50"
      :class="
        modelValue === option.value
          ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-white'
          : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100'
      "
      @click="select(option.value)"
    >
      <UIcon :name="option.icon" class="size-3.5" />
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>
