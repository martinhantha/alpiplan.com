<script setup lang="ts">
withDefaults(
  defineProps<{
    ariaLabel?: string;
  }>(),
  {
    ariaLabel: "Weitere Informationen",
  },
);
</script>

<template>
  <UPopover
    mode="click"
    :content="{ side: 'top', align: 'start' }"
    :ui="{ content: 'max-w-sm p-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400' }"
  >
    <UButton
      type="button"
      variant="ghost"
      color="neutral"
      size="xs"
      icon="i-lucide-info"
      :aria-label="ariaLabel"
      class="shrink-0 size-6 p-0 text-neutral-400/80 hover:text-neutral-600 dark:hover:text-neutral-300"
    />
    <template #content>
      <slot />
    </template>
  </UPopover>
</template>
