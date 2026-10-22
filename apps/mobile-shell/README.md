# Mobile Shell (Capacitor)

Die Alpiplan-UI bleibt Nuxt (`apps/web`). Diese App ist nur die native Hülle: Android/iOS-WebView plus Plugins für **Kontakte** und (Android) **letzte Anrufe**.

## Prinzip

- Browser: volle Web-App, Kontakt speichern als **vCard**, kein Anrufprotokoll.
- Capacitor: dieselbe UI, native Kontakte, auf Android optionale Call-Hints.
- Die Hülle lädt die **gehostete Nuxt-App** (`CAPACITOR_SERVER_URL`). Auth-Cookies funktionieren so wie im Browser.

## Erstes Setup

```bash
# 1. In der Repo-Root-.env setzen, z. B.:
#    CAPACITOR_SERVER_URL=https://app.alpiplan.com  # Live (App-Test)
#    CAPACITOR_SERVER_URL=http://10.0.2.2:3000            # Android-Emulator
#    CAPACITOR_SERVER_URL=http://192.168.x.x:3000         # physisches Gerät (LAN-IP)

# 2. Web-App lokal starten (fürs Gerät: --host 0.0.0.0)
pnpm dev:web

# 3. Native Projekte einmalig anlegen (erzeugt android/ und ios/)
cd apps/mobile-shell
pnpm cap:add:android
pnpm cap:add:ios   # nur auf macOS
pnpm cap:sync
pnpm cap:open:android
```

`capacitor.config.ts` liest `CAPACITOR_SERVER_URL` aus der Root-`.env`. Ohne diese Variable (und ohne Prefix auf `cap:sync`) zeigt die App die Platzhalterseite „nicht gesetzt“.

- **Live / App-Test:** `https://app.alpiplan.com` — UI und `/api` kommen von Production; kein lokaler Nuxt nötig.
- **Android-Emulator (lokal):** `http://10.0.2.2:3000` — `10.0.2.2` ist der Host-Rechner, nicht `localhost` und oft auch nicht `192.168.x.x`.
- **Physisches Gerät (lokal):** `http://192.168.x.x:3000` (LAN-IP des Rechners, nicht `localhost`). Nuxt muss mit `--host 0.0.0.0` lauschen.

Nach dem ersten `cap add android` in `android/app/src/main/AndroidManifest.xml` nichts extra für Call-Log oder Mikrofon tun — das Plugin bringt `READ_CALL_LOG`, `RECORD_AUDIO` und `WRITE_CONTACTS` mit. Kontakte werden lokal unter dem Konto **Alpiplan** gespeichert (nicht Google).

`pnpm cap:add:ios` und `pnpm cap:sync` schreiben die Privacy-Keys in `ios/App/App/Info.plist` (Kontakte, Mikrofon, Spracherkennung). Ohne `NSContactsUsageDescription` stürzt iOS beim Speichern eines Kontakts ab. Dieselben Commands setzen App-Icon und Splash aus `resources/icon.png` (Android und iOS).

## iOS-Push

Schritt-für-Schritt (Apple, Firebase, Coolify, Xcode, Test): **[docs/IOS_PUSH_SETUP.md](../../docs/IOS_PUSH_SETUP.md)**

Kurz-Check auf dem Mac:

```bash
cd apps/mobile-shell
pnpm check:ios-push
pnpm cap:sync
pnpm cap:open:ios
```

Ohne `GoogleService-Info.plist` setzt `patch-ios-push.mjs` nur iOS 15 und **kein** Push-Entitlement (Personal Team kann signieren). Mit Plist: FCM + Entitlement; bezahltes Apple-Team + APNs-Key in Firebase nötig für echte Push-Zustellung.

## Produktion

```bash
# .env: CAPACITOR_SERVER_URL=https://app.alpiplan.com
pnpm cap:sync
```

Store-Builds: Android Studio / Xcode. `READ_CALL_LOG` ist bei Google Play eine **eingeschränkte** Permission — internes APK/MDM ist der einfachere Weg; Play Store braucht eine Kernfunktions-Begründung.

### Android Play Store (signiertes AAB)

1. **Version** in `capacitor.config.ts` → `nativeAppVersion` (`versionCode` + `versionName`). `pnpm deploy` auf `develop` erhöht beide Felder, taggt `vX.Y.Z` und schiebt das nach `main`. Gilt für **Android und iOS** (nach `pnpm cap:sync` bzw. `patch-ios-info-plist` / `apply-android-identity`). Ein Store-Upload ohne Web-Release: die beiden Felder von Hand erhöhen.
2. **Upload-Keystore:** einmalig z. B. `keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`
3. `keystore.properties.example` nach `android/keystore.properties` kopieren, Passwörter setzen, `upload-keystore.jks` nach `android/` legen.
4. `pnpm cap:sync` (setzt Version + Release-Signierung in `build.gradle`).
5. `cd android && ./gradlew bundleRelease` — AAB unter `app/build/outputs/bundle/release/app-release.aab`.

Ohne `keystore.properties` baut Gradle ein **unsigniertes** Release-Bundle; die Play Console lehnt das ab.

### Updates

- **Web-Deploy:** Die Hülle lädt die gehostete App, Änderungen kommen ohne Store-Update an. Nuxt erkennt einen neuen Build (alle 5 Minuten und beim Zurückkehren in die App), zeigt „Neue Version verfügbar – Neu laden“ und lädt beim nächsten Seitenwechsel automatisch neu.
- **Native Hülle (Store):** Ist im Store eine neuere Version live, zeigt die App automatisch „Update verfügbar“ (keine Konfiguration nötig). Android installiert über Play In-App-Update direkt in der App, iOS öffnet den App Store.
- **Update erzwingen:** Nur bei Bedarf `NUXT_APP_UPDATE_{ANDROID,IOS}_MIN_VERSION_CODE` am Server setzen, sobald die Version im Store live ist (siehe `.env.example`). Shells ohne `@capacitor/app` (bis `versionCode` 8) gelten als Version 0 und können den Store-Hinweis nicht selbst abfragen — sie erreicht man nur über `MIN`.

## Plugins

| Plugin | Zweck |
|--------|--------|
| `@capacitor-community/contacts` | Kontakt wählen; Fallback beim Schreiben |
| `@alpiplan/capacitor-call-hints` | Android: letzte Nummern, Mikrofon-Permission, lokale Alpiplan-Kontakte |
| `@alpiplan/capacitor-appointments-widget` | Android: Home-Screen-Widget mit nächsten Terminen (Anrufen, erledigt) |
| `@capacitor/app` | Installierte `versionCode` für den Update-Abgleich |
| `@capawesome/capacitor-app-update` | Android In-App-Update, App Store / Play Store öffnen |

iOS liefert für Call-Hints immer eine leere Liste (OS-Limit).
