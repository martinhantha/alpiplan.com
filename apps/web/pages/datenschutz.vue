<script setup lang="ts">
definePageMeta({
  public: true,
  layout: false,
});

const config = useRuntimeConfig().public;
const { t } = useI18n();

const providerName = config.legalName || "Alpiplan";
const privacyEmail = config.privacyEmail || "support@alpiplan.com";
const legalAddress = config.legalAddress?.trim() || null;

useSeoMeta({
  title: () => t("privacyPage.seoTitle"),
  description: () => t("privacyPage.seoDescription"),
  robots: "index, follow",
});
</script>

<template>
  <div
    class="min-h-dvh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 pt-[max(1.5rem,var(--app-safe-top))] pb-[max(2rem,var(--app-safe-bottom))]"
  >
    <div class="mx-auto max-w-3xl px-6 py-8 space-y-10">
      <header class="space-y-4 border-b border-neutral-200 pb-8 dark:border-neutral-800">
        <NuxtLink
          to="/login"
          class="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <UIcon name="i-lucide-arrow-left" class="size-4" />
          {{ t("privacyPage.back") }}
        </NuxtLink>
        <div class="flex items-center gap-3">
          <AppLogo size="sm" />
          <span class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Alpiplan</span>
        </div>
        <h1 class="font-display text-3xl sm:text-4xl leading-tight">{{ t("privacyPage.title") }}</h1>
        <p class="text-sm text-neutral-600 dark:text-neutral-400">
          {{ t("privacyPage.updated", { date: t("privacyPage.updatedDate") }) }}
        </p>
        <p class="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          {{ t("privacyPage.intro") }}
        </p>
      </header>

      <article class="legal-prose space-y-8">
        <section>
          <h2>{{ t("privacyPage.s1") }}</h2>
          <p>{{ t("privacyPage.s1body") }}</p>
          <p>
            <strong>{{ providerName }}</strong>
            <template v-if="legalAddress">
              <br />
              {{ legalAddress }}
            </template>
            <br />
            {{ t("common.email") }}:
            <a :href="`mailto:${privacyEmail}`">{{ privacyEmail }}</a>
          </p>
        </section>

        <section>
          <h2>{{ t("privacyPage.s2") }}</h2>
          <ul>
            <li>{{ t("privacyPage.s2tenant") }}</li>
            <li>{{ t("privacyPage.s2operator") }}</li>
            <li>{{ t("privacyPage.s2users") }}</li>
          </ul>
        </section>

        <section>
          <h2>{{ t("privacyPage.s3") }}</h2>
          <h3>{{ t("privacyPage.s31") }}</h3>
          <ul>
            <li>{{ t("privacyPage.s31a") }}</li>
            <li>{{ t("privacyPage.s31b") }}</li>
            <li>{{ t("privacyPage.s31c") }}</li>
          </ul>
          <p>{{ t("privacyPage.s31purposes") }}</p>
          <p>{{ t("privacyPage.s31legal") }}</p>

          <h3>{{ t("privacyPage.s32") }}</h3>
          <p>{{ t("privacyPage.s32body") }}</p>

          <h3>{{ t("privacyPage.s33") }}</h3>
          <ul>
            <li>{{ t("privacyPage.s33contacts") }}</li>
            <li>{{ t("privacyPage.s33speech") }}</li>
            <li>{{ t("privacyPage.s33calls") }}</li>
          </ul>
        </section>

        <section>
          <h2>{{ t("privacyPage.s4") }}</h2>
          <p>{{ t("privacyPage.s4body") }}</p>
        </section>

        <section>
          <h2>{{ t("privacyPage.s5") }}</h2>
          <p>{{ t("privacyPage.s5body") }}</p>
        </section>

        <section>
          <h2>{{ t("privacyPage.s6") }}</h2>
          <p>{{ t("privacyPage.s6lead") }}</p>
          <ul>
            <li>{{ t("privacyPage.s6a") }}</li>
            <li>{{ t("privacyPage.s6b") }}</li>
            <li>{{ t("privacyPage.s6c") }}</li>
            <li>{{ t("privacyPage.s6d") }}</li>
            <li>{{ t("privacyPage.s6e") }}</li>
          </ul>
          <p>
            {{ t("privacyPage.s6contact") }}
            <a :href="`mailto:${privacyEmail}`">{{ privacyEmail }}</a>
          </p>
        </section>

        <section>
          <h2>{{ t("privacyPage.s7") }}</h2>
          <p>{{ t("privacyPage.s7body") }}</p>
        </section>

        <section>
          <h2>{{ t("privacyPage.s8") }}</h2>
          <p>{{ t("privacyPage.s8body") }}</p>
        </section>
      </article>

      <footer class="border-t border-neutral-200 pt-6 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400 space-y-3">
        <p>
          <NuxtLink to="/support" class="underline underline-offset-2">{{ t("privacyPage.support") }}</NuxtLink>
        </p>
        <p>{{ t("privacyPage.disclaimer") }}</p>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.legal-prose :deep(h2) {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}

.legal-prose :deep(h3) {
  font-size: 1rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}

.legal-prose :deep(p),
.legal-prose :deep(li) {
  font-size: 0.9375rem;
  line-height: 1.65;
  color: var(--color-neutral-700);
}

.dark .legal-prose :deep(p),
.dark .legal-prose :deep(li) {
  color: var(--color-neutral-300);
}

.legal-prose :deep(ul) {
  list-style: disc;
  padding-left: 1.25rem;
  margin: 0.5rem 0 1rem;
}

.legal-prose :deep(a) {
  color: var(--color-primary-600);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.dark .legal-prose :deep(a) {
  color: var(--color-primary-400);
}
</style>
