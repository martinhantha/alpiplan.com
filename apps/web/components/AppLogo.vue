<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    size?: "sm" | "md" | "lg";
    /** Modern sans wordmark next to the mark. */
    showWordmark?: boolean;
  }>(),
  {
    size: "md",
    showWordmark: true,
  },
);

const sizeClasses = {
  sm: { root: "h-7 gap-1.5", text: "text-xl" },
  md: { root: "h-8 gap-2", text: "text-[1.375rem]" },
  lg: { root: "h-12 gap-2.5", text: "text-[2rem]" },
} as const;

const classes = computed(() => sizeClasses[props.size]);
</script>

<template>
  <span
    class="inline-flex max-w-full min-w-0 items-center"
    :class="classes.root"
    role="img"
    aria-label="Alpiplan"
  >
    <img src="/logo-mark.png" alt="" class="h-full w-auto shrink-0 dark:hidden">
    <img src="/logo-mark-on-dark.png" alt="" class="hidden h-full w-auto shrink-0 dark:block">
    <span v-if="showWordmark" class="brand-wordmark min-w-0 truncate pb-[0.08em]" :class="classes.text">
      <span class="brand-wordmark-alpi">alpi</span><span class="brand-wordmark-plan">plan</span>
    </span>
  </span>
</template>
