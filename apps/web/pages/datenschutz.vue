<script setup lang="ts">
definePageMeta({
  public: true,
  layout: false,
});

const config = useRuntimeConfig().public;

const providerName = config.legalName || "Alpiplan";
const privacyEmail = config.privacyEmail || "support@alpiplan.com";
const legalAddress = config.legalAddress?.trim() || null;

const lastUpdated = "16. Oktober 2026";

useSeoMeta({
  title: "Datenschutzerklärung — Alpiplan",
  description:
    "Informationen zur Verarbeitung personenbezogener Daten in der Alpiplan-App und im Web.",
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
        <h1 class="font-display text-3xl sm:text-4xl leading-tight">Datenschutzerklärung</h1>
        <p class="text-sm text-neutral-600 dark:text-neutral-400">Stand: {{ lastUpdated }}</p>
        <p class="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          Diese Erklärung beschreibt, wie der Betreiber von Alpiplan („wir“) personenbezogene Daten
          verarbeitet, wenn du die Alpiplan-Webanwendung oder mobile Apps nutzt. Sie ergänzt die
          Datenschutzhinweise deiner Organisation (Mandant), sofern diese als Verantwortliche für
          Kund:innen- und Lehrkräftedaten auftritt.
        </p>
      </header>

      <article class="legal-prose space-y-8">
        <section>
          <h2>1. Verantwortlicher</h2>
          <p>
            Verantwortlich für die in dieser Erklärung genannten Verarbeitungen durch uns als
            Software-Anbieter:
          </p>
          <p>
            <strong>{{ providerName }}</strong>
            <template v-if="legalAddress">
              <br />
              {{ legalAddress }}
            </template>
            <br />
            E-Mail:
            <a :href="`mailto:${privacyEmail}`">{{ privacyEmail }}</a>
          </p>
        </section>

        <section>
          <h2>2. Rollen nach DSGVO</h2>
          <ul>
            <li>
              <strong>Mandant (z.&nbsp;B. Skischule):</strong> Verantwortliche für die in seinem
              Account verarbeiteten Daten (Lehrkräfte, Kund:innen, Termine, Notizen).
            </li>
            <li>
              <strong>Alpiplan-Betreiber:</strong> In der Regel Auftragsverarbeiter gegenüber dem
              Mandanten, soweit wir diese Daten in der Cloud speichern und technisch bereitstellen.
            </li>
            <li>
              <strong>Nutzende:</strong> Betroffene Personen mit Rechten auf Auskunft, Berichtigung,
              Löschung, Einschränkung, Widerspruch und Datenübertragbarkeit — wenden sich für
              mandantengeführte Daten primär an ihre Organisation; wir unterstützen den Mandanten bei
              der Erfüllung technischer Anfragen.
            </li>
          </ul>
        </section>

        <section>
          <h2>3. Verarbeitete Daten und Zwecke</h2>
          <h3>3.1 Konto und Nutzung</h3>
          <ul>
            <li>Anmeldedaten (E-Mail, Passwort-Hash), Name, Sprache, Rollen und Mandantenzugehörigkeit</li>
            <li>Termine, Verfügbarkeiten, Kund:innen- und Kontaktdaten, Notizen, Zahlungsstatus</li>
            <li>Technische Protokolle (zeitlich begrenzt, zweckgebunden, minimiert)</li>
          </ul>
          <p>
            <strong>Zwecke:</strong> Bereitstellung der Planungs- und Erfassungsfunktionen,
            Authentifizierung, Mandantentrennung, Support, Sicherheit und Stabilität.
          </p>
          <p>
            <strong>Rechtsgrundlagen:</strong> Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;b DSGVO
            (Vertrag/Nutzung im Auftrag des Mandanten), lit.&nbsp;f (berechtigtes Interesse an
            sicherem Betrieb), ggf. lit.&nbsp;a (Einwilligung für optionale Funktionen).
          </p>

          <h3>3.2 Push-Benachrichtigungen</h3>
          <p>
            Wenn du Push-Mitteilungen aktivierst, speichern wir Geräte- bzw. Push-Token, um dich über
            Termine zu informieren. Rechtsgrundlage: Einwilligung (Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;a
            DSGVO), widerrufbar in den Geräte- oder App-Einstellungen.
          </p>

          <h3>3.3 Gerätefunktionen (optional)</h3>
          <ul>
            <li>
              <strong>Kontakte:</strong> Lesen/Schreiben nur nach OS-Berechtigung und deiner Aktion
              (z.&nbsp;B. Kontakt speichern); die App funktioniert ohne Adressbuch.
            </li>
            <li>
              <strong>Spracheingabe:</strong> Bevorzugt on-device über Betriebssystem-APIs; Audio wird
              nicht dauerhaft auf unseren Servern gespeichert, sofern du keine Cloud-Transkription
              gesondert aktivierst.
            </li>
            <li>
              <strong>Android-Anrufhinweise (optional):</strong> Standardmäßig aus; bei Opt-in
              erfolgt Verarbeitung bevorzugt nur auf dem Gerät, ohne serverseitige Speicherung von
              Anrufprotokollen.
            </li>
          </ul>
        </section>

        <section>
          <h2>4. Hosting und Auftragsverarbeiter</h2>
          <p>
            Die Anwendung wird auf Servern in der EU bzw. im EWR betrieben (konkreter Standort und
            Unterauftragsverarbeiter werden im Auftragsverarbeitungsvertrag mit deinem Mandanten
            geführt). Für Push-Dienste können Anbieter wie Apple (APNs) oder Google (FCM) eingebunden
            sein.
          </p>
        </section>

        <section>
          <h2>5. Speicherdauer</h2>
          <p>
            Wir speichern personenbezogene Daten, solange dein Mandanten-Account aktiv ist und
            gesetzliche Aufbewahrungspflichten bestehen. Gelöschte Einträge können zunächst im
            Papierkorb bzw. als Soft Delete vorliegen; endgültige Löschung oder Anonymisierung erfolgt
            nach dokumentierten Fristen oder auf berechtigten Antrag des Mandanten.
          </p>
        </section>

        <section>
          <h2>6. Deine Rechte</h2>
          <p>Du hast gegenüber dem Verantwortlichen u.&nbsp;a. folgende Rechte:</p>
          <ul>
            <li>Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung</li>
            <li>Datenübertragbarkeit, soweit anwendbar</li>
            <li>Widerspruch gegen Verarbeitung auf Basis berechtigter Interessen</li>
            <li>Widerruf erteilter Einwilligungen mit Wirkung für die Zukunft</li>
            <li>Beschwerde bei einer Datenschutz-Aufsichtsbehörde</li>
          </ul>
          <p>
            Für Daten, die deine Organisation als Mandant verarbeitet, wende dich bitte zuerst an
            diese. Für Anfragen an uns als Anbieter: <a :href="`mailto:${privacyEmail}`">{{ privacyEmail }}</a>.
          </p>
        </section>

        <section>
          <h2>7. Sicherheit</h2>
          <p>
            Wir setzen technische und organisatorische Maßnahmen ein (u.&nbsp;a. Verschlüsselung in
            Transit, Mandantentrennung, Zugriffskontrollen). Details sind in der TOM-Dokumentation für
            Auftragsverarbeitung beschrieben.
          </p>
        </section>

        <section>
          <h2>8. Änderungen</h2>
          <p>
            Wir passen diese Erklärung an, wenn sich Rechtslage oder Produktfunktionen ändern. Die
            aktuelle Fassung ist unter dieser URL abrufbar.
          </p>
        </section>
      </article>

      <footer class="border-t border-neutral-200 pt-6 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400 space-y-3">
        <p>
          <NuxtLink to="/support" class="underline underline-offset-2">Support</NuxtLink>
        </p>
        <p>
          Hinweis: Diese Seite ersetzt keine individuelle Rechtsberatung. Vor Produktivbetrieb sollte
          der Text durch Fachanwält:innen bzw. Datenschutzbeauftragte geprüft werden.
        </p>
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
