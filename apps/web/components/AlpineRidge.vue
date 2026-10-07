<script setup lang="ts">
withDefaults(
  defineProps<{
    /** "night" for dark hero backgrounds, "subtle" tints via currentColor on light surfaces. */
    variant?: "night" | "subtle";
  }>(),
  { variant: "night" },
);
</script>

<template>
  <svg viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <template v-if="variant === 'night'">
      <circle cx="860" cy="150" r="42" fill="#fb7d5c" />
      <path
        d="M0 250 140 150l90 60 150-130 120 95 90-55 170 120 120-90 140 110 180-120v180H0z"
        fill="#3a2a7a"
      />
      <path d="m380 80-38 33 22-6 16 14 18-16 22 4z" fill="#fff" fill-opacity="0.8" />
      <path
        d="M0 290 180 180l110 70 170-150 130 110 100-60 160 100 140-80 210 140v10H0z"
        fill="#261b57"
      />
      <path d="M0 320 220 240l160 50 200-90 180 80 160-50 280 90z" fill="#15102e" />
    </template>
    <template v-else>
      <circle cx="860" cy="150" r="34" fill="#fb7d5c" fill-opacity="0.35" />
      <path
        d="M0 250 140 150l90 60 150-130 120 95 90-55 170 120 120-90 140 110 180-120v180H0z"
        fill="currentColor"
        fill-opacity="0.06"
      />
      <path
        d="M0 290 180 180l110 70 170-150 130 110 100-60 160 100 140-80 210 140v10H0z"
        fill="currentColor"
        fill-opacity="0.08"
      />
      <path d="M0 320 220 240l160 50 200-90 180 80 160-50 280 90z" fill="currentColor" fill-opacity="0.1" />
    </template>
  </svg>
</template>
