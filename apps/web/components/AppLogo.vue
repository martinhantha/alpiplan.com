<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    size?: "sm" | "md" | "lg";
    showWordmark?: boolean;
    /** White wordmark for dark backgrounds (hero, login). */
    inverted?: boolean;
  }>(),
  {
    size: "md",
    showWordmark: true,
    inverted: false,
  },
);

const uid = `alpiplan-logo-${useId()}`;
const ids = { bg: `${uid}-bg`, rock: `${uid}-rock`, shade: `${uid}-shade` };

const sizeClasses = {
  sm: { root: "gap-2", mark: "size-8", text: "text-[1.25rem]" },
  md: { root: "gap-2.5", mark: "size-9", text: "text-[1.4rem]" },
  lg: { root: "gap-3", mark: "size-12", text: "text-[1.9rem]" },
} as const;

const classes = computed(() => sizeClasses[props.size]);
</script>

<template>
  <span
    class="group/logo inline-flex max-w-full min-w-0 items-center"
    :class="classes.root"
    role="img"
    aria-label="Alpiplan"
  >
    <svg
      viewBox="0 0 512 512"
      class="shrink-0 drop-shadow-sm transition-transform duration-300 ease-(--ease-calm) group-hover/logo:-translate-y-0.5 group-hover/logo:-rotate-3"
      :class="classes.mark"
      aria-hidden="true"
    >
      <defs>
        <linearGradient :id="ids.bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#6a4ae0" />
          <stop offset="1" stop-color="#1a1040" />
        </linearGradient>
        <linearGradient :id="ids.rock" x1="0" y1="152" x2="0" y2="400" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#f3efff" />
          <stop offset="1" stop-color="#d4cbf8" />
        </linearGradient>
        <linearGradient :id="ids.shade" x1="0" y1="152" x2="0" y2="400" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#d6ccfb" />
          <stop offset="1" stop-color="#ad9eec" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="128" :fill="`url(#${ids.bg})`" />
      <g fill="#fff" fill-opacity="0.85">
        <circle cx="380" cy="120" r="7" />
        <circle cx="420" cy="176" r="5" />
        <circle cx="318" cy="100" r="4" />
        <circle cx="130" cy="150" r="5" />
      </g>
      <path d="M64 400 216 152l80 124 48-64 104 188z" :fill="`url(#${ids.rock})`" />
      <path d="M216 152l80 124-34 124h-34z" :fill="`url(#${ids.shade})`" />
      <path d="M344 212l104 188h-86z" :fill="`url(#${ids.shade})`" />
      <path d="M216 152l44 68-18-8-14 16-16-18-18 14-20-4z" fill="#fff" />
      <path d="M344 212l20 36-12-6-10 12-12-10-13 4z" fill="#fff" />    </svg>
    <span
      v-if="showWordmark"
      class="font-display min-w-0 truncate pb-[0.06em] leading-none"
      :class="[classes.text, inverted ? 'text-white' : 'text-neutral-900 dark:text-white']"
      aria-hidden="true"
    >alpi<span :class="inverted ? 'text-glow-300' : 'text-primary-600 dark:text-primary-300'">plan</span></span>
  </span>
</template>
