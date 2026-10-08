<script setup lang="ts">
import { avatarInitials } from "../utils/avatar";

defineProps<{
  time: string;
  title: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  color: string | null;
  /** Shown as initials avatar, e.g. the teacher in the week view. */
  personName?: string | null;
}>();
</script>

<template>
  <button
    type="button"
    class="flex w-full min-w-0 items-center gap-1.5 rounded-md border border-l-[3px] border-neutral-200 bg-neutral-50 px-1.5 py-1 text-left text-xs leading-tight transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
    :class="[
      status === 'draft' ? 'border-dashed' : '',
      status === 'cancelled' ? 'opacity-55 line-through' : '',
    ]"
    :style="color ? { borderLeftColor: color, borderLeftStyle: 'solid' } : {}"
  >
    <span class="shrink-0 font-semibold tabular-nums text-neutral-800 dark:text-neutral-100">{{ time }}</span>
    <span class="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">{{ title }}</span>
    <span v-if="status === 'draft'" class="size-1.5 shrink-0 rounded-full bg-amber-500" title="Entwurf" />
    <UIcon
      v-else-if="status === 'completed'"
      name="i-lucide-circle-check"
      class="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
      title="Erledigt"
    />
    <span
      v-if="personName"
      class="flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white"
      :style="{ backgroundColor: color ?? '#a3a3a3' }"
      :title="personName"
    >
      {{ avatarInitials(personName) }}
    </span>
  </button>
</template>
