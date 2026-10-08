<script setup lang="ts">
import { computed } from "vue";
import { avatarColor } from "../utils/avatar";

const props = defineProps<{
  teacherId: string;
  color: string | null | undefined;
  disabled?: boolean;
}>();

const emit = defineEmits<{ change: [color: string | null] }>();

const isAuto = computed(() => !props.color);
const current = computed(() => avatarColor(props.teacherId, props.color));

function pick(color: string | null) {
  if (props.disabled || color === (props.color?.toLowerCase() ?? null)) return;
  emit("change", color);
}
</script>

<template>
  <div class="flex items-center gap-2">
    <label
      class="relative flex h-8 cursor-pointer items-center gap-2 rounded-md border border-neutral-200 pl-1.5 pr-2.5 text-xs transition-colors hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500"
      :class="disabled ? 'pointer-events-none opacity-50' : ''"
      title="Farbe auswählen"
    >
      <span class="size-5 rounded-full shadow-inner" :style="{ backgroundColor: current }" />
      <span class="text-neutral-700 dark:text-neutral-200">{{ isAuto ? "Automatisch" : "Eigene Farbe" }}</span>
      <input
        type="color"
        class="absolute inset-0 size-full cursor-pointer opacity-0"
        :value="current"
        :disabled="disabled"
        @change="pick(($event.target as HTMLInputElement).value.toLowerCase())"
      />
    </label>
    <UButton
      v-if="!isAuto"
      size="xs"
      color="neutral"
      variant="ghost"
      icon="i-lucide-rotate-ccw"
      :disabled="disabled"
      title="Wieder automatisch zuweisen"
      @click="pick(null)"
    >
      Auto
    </UButton>
  </div>
</template>
