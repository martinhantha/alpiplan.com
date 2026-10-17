<script setup lang="ts">
definePageMeta({
  public: true,
  layout: false,
});

const config = useRuntimeConfig().public;

const providerName = config.legalName || "Alpiplan";
const supportEmail = config.supportEmail || "support@alpiplan.com";

useSeoMeta({
  title: "Support — Alpiplan",
  description: "Hilfe zur Alpiplan-App: Kontakt, häufige Fragen und Hinweise für Teams.",
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
          Zur Anmeldung
        </NuxtLink>
        <div class="flex items-center gap-3">
          <AppLogo size="sm" />
          <span class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Alpiplan</span>
        </div>
        <h1 class="font-display text-3xl sm:text-4xl leading-tight">Support</h1>
        <p class="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          Alpiplan wird von {{ providerName }} betrieben. Hier findest du Ansprechpartner und
          Antworten auf typische Fragen zur App und zum Web.
        </p>
      </header>

      <article class="legal-prose space-y-8">
        <section>
          <h2>Kontakt</h2>
          <p>
            Für technische Probleme, Fehlermeldungen oder Fragen zum Betrieb der Plattform:
          </p>
          <p>
            <a :href="`mailto:${supportEmail}`">{{ supportEmail }}</a>
          </p>
          <p>
            Bitte gib möglichst an: Gerät (iPhone, Android, Browser), App-Version, Mandant
            (Organisation) und eine kurze Beschreibung inkl. Screenshots, falls hilfreich.
          </p>
        </section>

        <section>
          <h2>Zugang &amp; Konto</h2>
          <p>
            Alpiplan wird in der Regel über deine Organisation (Skischule, Team) bereitgestellt.
            Login-Daten, Rollen und Mandantenzugang vergibt der <strong>Administrator deiner
            Organisation</strong> — nicht der App-Anbieter.
          </p>
          <ul>
            <li>
              Passwort vergessen → auf der Anmeldeseite „Passwort vergessen?“ wählen oder
              Administrator deiner Organisation um einen Passwort-Link bitten
            </li>
            <li>Kein Mandant sichtbar → Administrator um Einladung bitten</li>
            <li>Neue Organisation / Vertrag → über den Ansprechpartner deines Teams oder {{ supportEmail }}</li>
          </ul>
        </section>

        <section>
          <h2>Push-Mitteilungen</h2>
          <ul>
            <li>In den <strong>Einstellungen</strong> der App Push aktivieren und Berechtigung erteilen</li>
            <li>iOS: Systemeinstellungen → Mitteilungen → Alpiplan prüfen</li>
            <li>Web: Browser-Benachrichtigungen erlauben; bei iPhone oft über „Zum Home-Bildschirm“</li>
          </ul>
          <p>
            Kommen weiterhin keine Mitteilungen an, schreib uns mit Gerätetyp und Uhrzeit eines
            fehlenden Hinweises.
          </p>
        </section>

        <section>
          <h2>Datenschutz</h2>
          <p>
            Informationen zur Datenverarbeitung:
            <NuxtLink to="/datenschutz">Datenschutzerklärung</NuxtLink>.
            Datenschutzanfragen zu Kund:innen- oder Termindaten richtest du primär an deine
            Organisation; der Anbieter unterstützt Mandanten bei technischen Anfragen.
          </p>
        </section>
      </article>

      <footer
        class="border-t border-neutral-200 pt-6 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400 flex flex-wrap gap-x-4 gap-y-1"
      >
        <NuxtLink to="/datenschutz" class="underline underline-offset-2">Datenschutz</NuxtLink>
        <NuxtLink to="/login" class="underline underline-offset-2">Anmelden</NuxtLink>
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
