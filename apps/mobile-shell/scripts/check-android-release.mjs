import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const variablesPath = resolve(root, "android/variables.gradle");
const appGradlePath = resolve(root, "android/app/build.gradle");
const keystorePath = resolve(root, "android/keystore.properties");

let failed = false;

function fail(message) {
  console.error(`✗ ${message}`);
  failed = true;
}

function ok(message) {
  console.log(`✓ ${message}`);
}

if (!existsSync(variablesPath) || !existsSync(appGradlePath)) {
  fail("android/ fehlt — zuerst: pnpm cap:add:android && pnpm cap:sync");
  process.exit(1);
}

const configSource = readFileSync(resolve(root, "capacitor.config.ts"), "utf8");
const versionBlock = configSource.match(/nativeAppVersion\s*=\s*\{([^}]+)\}/)?.[1];
const expectedCode = Number(versionBlock?.match(/versionCode:\s*(\d+)/)?.[1]);
const expectedName = versionBlock?.match(/versionName:\s*"([^"]+)"/)?.[1];

const variables = readFileSync(variablesPath, "utf8");
const targetSdk = Number(variables.match(/targetSdkVersion\s*=\s*(\d+)/)?.[1]);
const compileSdk = Number(variables.match(/compileSdkVersion\s*=\s*(\d+)/)?.[1]);

if (targetSdk >= 36 && compileSdk >= 36) {
  ok(`target/compile SDK ${targetSdk} (Play verlangt mindestens 36)`);
} else {
  fail(
    `targetSdk=${targetSdk}, compileSdk=${compileSdk} — Play verlangt 36. Ausführen: node scripts/apply-android-identity.mjs`,
  );
}

const gradle = readFileSync(appGradlePath, "utf8");
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];

if (versionCode === expectedCode && versionName === expectedName) {
  ok(`versionCode ${versionCode}, versionName ${versionName}`);
} else {
  fail(
    `build.gradle (${versionCode}/${versionName}) weicht von capacitor.config.ts (${expectedCode}/${expectedName}) ab — node scripts/apply-android-identity.mjs`,
  );
}

if (gradle.includes("alpiplan-release-signing") && existsSync(keystorePath)) {
  ok("Release-Signierung (keystore.properties vorhanden)");
} else if (!gradle.includes("alpiplan-release-signing")) {
  fail("Release-Signierung fehlt — node scripts/patch-android-release-signing.mjs");
} else {
  fail("android/keystore.properties fehlt — unsigniertes AAB wird von Play abgelehnt");
}

if (failed) {
  console.error("\nVor Upload: pnpm cap:sync (oder die Scripts oben), dann ./gradlew bundleRelease");
  process.exit(1);
}

console.log("\nBereit für: cd android && ./gradlew bundleRelease");
