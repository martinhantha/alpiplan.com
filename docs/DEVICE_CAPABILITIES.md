# Native Gerätefähigkeiten — Adapter-Konzept

Implementierung: Paket [`packages/device-capabilities`](../packages/device-capabilities), native Hülle [`apps/mobile-shell`](../apps/mobile-shell).

## Prinzipien

- **Kern-App** funktioniert ohne jede native Erweiterung (`WebDeviceCapabilities`: Contact Picker falls vorhanden, sonst vCard-Download).
- Plattform-spezifische Logik **nur** in Adaptern; Nuxt-UI spricht nur **`DeviceCapabilities`** an (`useDeviceCapabilities()`).
- **Android Call Hints:** optional, Opt-in in Einstellungen, gekapselt in `AndroidCallHintCapabilities`; keine Rohdaten an den Server (siehe [LEGAL_PRIVACY.md](./LEGAL_PRIVACY.md)).
- Tests: gegen `NoOpDeviceCapabilities` mocken.

## Interface

- `pickContact` — native Kontakte oder Web Contact Picker
- `saveOrUpdateDeviceContact` — native Kontakte; Browser: `.vcf`-Download
- `getRecentCallHints` — Android optional; iOS/Web leer. Ein laufender Anruf kommt als erster Eintrag mit `active: true` (über `PHONE_STATE`-Broadcast, braucht `READ_PHONE_STATE` + `READ_CALL_LOG`); Event `callStateChanged` lädt das Formular neu.
- `startSpeechToText` / `takePhoto` / `requestPushPermission` — Platzhalter bzw. Web-Notification

## Einbindung

1. Client-Plugin `apps/web/plugins/device-capabilities.client.ts` wählt die Implementierung:
   - Browser → `WebDeviceCapabilities`
   - Capacitor iOS/Android → `CapacitorDeviceCapabilities` (`@capacitor-community/contacts`)
   - Android + Opt-in → `AndroidCallHintCapabilities` + Plugin `@alpiplan/capacitor-call-hints`
2. Native Projekte: `apps/mobile-shell` (Capacitor lädt die gehostete Nuxt-URL).
