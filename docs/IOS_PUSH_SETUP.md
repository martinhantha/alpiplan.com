# iOS Messaging (Push) — Schritt für Schritt

Alpiplan nutzt **Firebase Cloud Messaging (FCM)** für Termin-Push (neu/verschoben, 15-Min-Erinnerung, Abend-Briefing). Auf iOS leitet Firebase über **APNs** an Apple weiter. Die Web-UI in der Capacitor-Hülle registriert den Geräte-Token auf dem **gleichen Server** wie unter `CAPACITOR_SERVER_URL`.

Zwei Arten von „Messaging“:

| Art | Wann | Technik |
|-----|------|---------|
| **Live in der App** | App offen | Server-Sent Events (`/api/v1/tenants/.../events`) + In-App-Popup |
| **Push** | App im Hintergrund / geschlossen | FCM → APNs → System-Benachrichtigung |

Diese Anleitung betrifft **Push**. Live-Updates funktionieren unabhängig davon, sobald du eingeloggt bist und `https://app.alpiplan.com` lädt.

---

## Übersicht (5 Blöcke)

1. **Apple** — kostenpflichtiges Developer Program + APNs-Key (`.p8`)
2. **Firebase** — iOS-App + APNs-Key hochladen + `GoogleService-Info.plist`
3. **Server (Production)** — `FIREBASE_SERVICE_ACCOUNT` auf Coolify
4. **Mac / Xcode** — `cap:sync`, signieren, auf **echtem iPhone** installieren
5. **Test** — Token in DB, Push auslösen

Lokalen Check auf dem Mac:

```bash
cd apps/mobile-shell
pnpm check:ios-push
```

---

## Schritt 1 — Apple Developer Program

Ohne **bezahltes** Programm (99 €/Jahr) oder **Einladung in ein Team** mit Admin-Rechten:

- Kein Zugriff auf **Keys** → kein APNs-Key
- Kein zuverlässiges **Push Notifications**-Signing auf dem Gerät

**Aktion:**

1. [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll) — oder Account-Inhaber lädt dich unter [App Store Connect → Users and Access](https://appstoreconnect.apple.com/access/users) ein (**Admin** für Keys).
2. Mit dem **richtigen** Apple-ID anmelden (Team oben rechts prüfen).

---

## Schritt 2 — APNs-Authentifizierungsschlüssel (.p8)

1. [Certificates, Identifiers & Profiles → Keys](https://developer.apple.com/account/resources/authkeys/list) → **+**
2. Name z. B. `Alpiplan APNs`
3. **Apple Push Notifications service (APNs)** aktivieren → **Configure**:
   - **Sandbox & Production**
   - **Team Scoped (All Topics)**
4. **Register** → **Download** (`AuthKey_XXXXXXXXXX.p8`) — **nur einmal** downloadbar, sicher aufbewahren (nicht ins Git).
5. Notieren:
   - **Key ID** (10 Zeichen)
   - **Team ID** (Membership / oben rechts im Portal)

**App-ID:** Bundle `at.alpiplan.app`. Unter [Identifiers](https://developer.apple.com/account/resources/identifiers/list) soll **Push Notifications** aktiv sein (Xcode legt sie oft beim ersten Signieren an).

---

## Schritt 3 — Firebase (Projekt `alpiplan`)

1. [Firebase Console](https://console.firebase.google.com/) → Projekt **alpiplan**
2. **Project settings** → **Cloud Messaging** → **Apple app configuration** → iOS-App `at.alpiplan.app`
3. **APNs Authentication Key** hochladen: `.p8`, **Key ID**, **Team ID**
4. Falls noch keine iOS-App: **Add app** → iOS → Bundle-ID **`at.alpiplan.app`** → **`GoogleService-Info.plist`** herunterladen

**Aktion auf dem Mac:**

```bash
# Datei ablegen (gitignored):
# apps/mobile-shell/GoogleService-Info.plist
```

In der Plist prüfen: `BUNDLE_ID` = `at.alpiplan.app`, `PROJECT_ID` = `alpiplan`.

---

## Schritt 4 — Production-Server (Coolify)

Push sendet der **web**-Container auf `app.alpiplan.com`, nicht dein lokaler `pnpm dev:web` (außer du konfigurierst Firebase lokal separat).

1. Coolify → Alpiplan **web**-Service → Secrets
2. **`FIREBASE_SERVICE_ACCOUNT`** = kompletter Inhalt der Firebase-**Dienstkonto-JSON** (Firebase → Project settings → Service accounts → Generate new private key)
3. Deploy / Neustart

**Hinweis:** Das ist **nicht** `GoogleService-Info.plist` und **nicht** die `.p8`-Datei. Server braucht die **Admin-SDK-JSON**.

Lokal (optional zum Testen gegen `pnpm dev:web`):

```bash
# In Repo-Root .env z. B.:
# FIREBASE_SERVICE_ACCOUNT_FILE=tmp/firebase-adminsdk.json
# Datei muss wirklich existieren — sonst [push] FIREBASE_SERVICE_ACCOUNT_FILE konnte nicht gelesen werden
```

---

## Schritt 5 — Capacitor / Xcode

**Root `.env`:**

```bash
CAPACITOR_SERVER_URL=https://app.alpiplan.com
```

```bash
cd apps/mobile-shell
pnpm check:ios-push    # sollte grün sein, wenn Plist da ist
pnpm cap:sync
pnpm cap:open:ios
```

In **Xcode** (Target **App**):

1. **Signing & Capabilities** → **Team** = bezahltes Team (nicht nur Personal Team, wenn Push-Entitlement Fehler wirft)
2. **Push Notifications** sollte durch Entitlement `App/App.entitlements` (`aps-environment`) vorhanden sein
3. **Product → Clean Build Folder**
4. **Physisches iPhone** wählen (Simulator: Push unzuverlässig; Live-UI geht trotzdem)
5. **Run**

In der Konsole erwarten:

- `⚡️ Loading app at https://app.alpiplan.com...`
- Kein dauerhaftes `didFailToRegisterForRemoteNotificationsWithError` (Signing/APNs-Problem)

---

## Schritt 6 — App: Berechtigung & Token

1. In Alpiplan **einloggen**
2. **Benachrichtigungen erlauben**, wenn iOS fragt (sonst: Einstellungen → Alpiplan → Mitteilungen)
3. ~2–5 s warten — die Web-App ruft `registerNativePushToken()` auf und POSTet nach `/api/auth/push-token` mit `platform: "ios"`

**DB prüfen** (Production-Postgres):

```sql
SELECT platform, LEFT(token, 24) AS token_start, "updatedAt"
FROM "DevicePushToken"
WHERE "userId" = '<deine-user-uuid>'
ORDER BY "updatedAt" DESC;
```

Erwartung: mindestens eine Zeile mit **`platform = ios`**.

- **Keine Zeile** → Gerät/Firebase/Permission (Schritte 3–5 wiederholen, neu installieren)
- **Zeile vorhanden** → Client OK; bei fehlendem Push → Schritt 3 (APNs in Firebase) oder Schritt 4 (Server-FCM)

---

## Schritt 7 — End-to-End-Test

1. iPhone: Alpiplan **im Hintergrund** oder **beenden** (nicht nur Home, wirklich testen mit geschlossener App)
2. **Anderer User** (oder zweites Gerät): Termin anlegen/verschieben, der **dich** benachrichtigen soll
3. System-Benachrichtigung sollte erscheinen

**App offen:** Du siehst eher **In-App-Popup** + ggf. **lokale** Notification; Remote-Push wird im Vordergrund absichtlich unterdrückt (kein Doppel-Banner).

**15-Min-Erinnerung / 20:00-Briefing:** Laufen über den Server-Ticker auf Production; brauchen ebenfalls FCM + ios-Token.

---

## Alternative ohne Apple-Account — Web-App auf dem Home-Bildschirm

Ab **iOS 16.4** bekommt Alpiplan auch als Web-App Push, wenn sie geschlossen ist (Standard-Web-Push, kein Firebase, kein Developer Program).

**Server (einmalig):**

```bash
cd apps/web && npx web-push generate-vapid-keys
```

In Coolify (web-Service) setzen und neu deployen:

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT=mailto:…` (Kontaktadresse, Apple verlangt sie)

Keys danach **nicht mehr wechseln** — sonst müssen alle Geräte Push neu einschalten.

**iPhone:**

1. `https://app.alpiplan.com` in **Safari** öffnen → **Teilen** → **Zum Home-Bildschirm**
2. Alpiplan **über das neue Symbol** öffnen und einloggen
3. **Einstellungen → Benachrichtigungen → Push auf diesem Gerät** einschalten → Mitteilungen erlauben
4. DB: Zeile mit `platform = web` in `DevicePushToken`

In einem normalen Safari-Tab auf dem iPhone gibt es keinen Push (Apple-Vorgabe). Am Mac/PC funktioniert es in Safari, Chrome, Edge und Firefox direkt im Tab.

---

## Fehlerbehebung (Kurz)

| Symptom | Wahrscheinliche Ursache |
|---------|-------------------------|
| „Access Unavailable“ bei Apple Keys | Kein bezahltes Developer Program |
| Xcode: Personal Team + Push capability | Entitlement entfernen (Plist weg + `cap:sync`) **oder** bezahltes Team |
| `FIREBASE_SERVICE_ACCOUNT_FILE konnte nicht gelesen werden` (lokal) | Pfad in `.env` falsch / Datei fehlt |
| Kein ios-Token in DB | Keine Notification-Permission, alte App ohne Firebase, Signing |
| Token in DB, kein Push | APNs-Key nicht in Firebase, falsches Firebase-Projekt, Server ohne `FIREBASE_SERVICE_ACCOUNT` |
| Nur Simulator getestet | Auf **echtes iPhone** wechseln |

---

## Referenz (Code)

- Token-Registrierung: `apps/web/utils/push-registration.ts`
- Server sendet FCM inkl. APNs-Block: `apps/web/server/utils/push.ts`
- iOS native: `apps/mobile-shell/scripts/patch-ios-push.mjs`, Plugin `AlpiplanDevicePlugin.swift`
