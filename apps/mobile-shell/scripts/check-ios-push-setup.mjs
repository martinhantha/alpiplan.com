#!/usr/bin/env node
/**
 * Read-only checklist for iOS push prerequisites on this machine.
 * Run from apps/mobile-shell: pnpm check:ios-push
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const repoRoot = resolve(root, "../..");

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function warn(msg) {
  console.log(`  ⚠ ${msg}`);
}
function fail(msg) {
  console.log(`  ✗ ${msg}`);
}

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function plistBundleId(path) {
  if (!existsSync(path)) return null;
  const m = readFileSync(path, "utf8").match(/<key>BUNDLE_ID<\/key>\s*<string>([^<]+)<\/string>/);
  return m?.[1]?.trim() ?? null;
}

console.log("\nAlpiplan — iOS push setup check\n");

let issues = 0;

// --- Plist ---
const plistSources = [
  resolve(root, "GoogleService-Info.plist"),
  resolve(repoRoot, "GoogleService-Info.plist"),
];
const plistSource = plistSources.find((p) => existsSync(p));
const plistInApp = resolve(root, "ios/App/App/GoogleService-Info.plist");

if (plistSource) {
  ok(`GoogleService-Info.plist (${plistSource.replace(repoRoot + "/", "")})`);
  const bundle = plistBundleId(plistSource);
  if (bundle === "at.alpiplan.app") ok(`BUNDLE_ID = ${bundle}`);
  else {
    fail(`BUNDLE_ID is "${bundle ?? "?"}", expected at.alpiplan.app`);
    issues++;
  }
} else {
  fail("GoogleService-Info.plist missing in apps/mobile-shell/ or repo root");
  fail("  → Download from Firebase; without it cap:sync disables FCM on iOS");
  issues++;
}

if (existsSync(plistInApp)) ok("Copied to ios/App/App/GoogleService-Info.plist");
else if (plistSource) {
  warn("Not yet in ios/App/App/ — run: pnpm cap:sync");
  issues++;
}

// --- Native project ---
const podfile = resolve(root, "ios/App/Podfile");
if (existsSync(podfile)) {
  const pod = readFileSync(podfile, "utf8");
  if (pod.includes("FirebaseMessaging")) ok("Podfile includes FirebaseMessaging");
  else {
    fail("Podfile missing FirebaseMessaging — run: pnpm cap:sync");
    issues++;
  }
} else {
  warn("ios/App/Podfile not found — run: pnpm cap:add:ios && pnpm cap:sync");
  issues++;
}

const entitlements = resolve(root, "ios/App/App/App.entitlements");
if (existsSync(entitlements) && readFileSync(entitlements, "utf8").includes("aps-environment")) {
  ok("Push entitlement App.entitlements (aps-environment)");
} else if (plistSource) {
  warn("App.entitlements missing — run: pnpm cap:sync with GoogleService-Info.plist present");
  issues++;
} else {
  ok("No push entitlement (expected without GoogleService-Info.plist — Personal Team OK)");
}

const pbx = resolve(root, "ios/App/App.xcodeproj/project.pbxproj");
if (existsSync(pbx)) {
  const text = readFileSync(pbx, "utf8");
  if (text.includes("CODE_SIGN_ENTITLEMENTS") && plistSource) ok("Xcode CODE_SIGN_ENTITLEMENTS set");
  if (text.includes("GoogleService-Info.plist in Resources") && plistSource) {
    ok("GoogleService-Info.plist in Xcode Copy Bundle Resources");
  }
}

// --- Server URL ---
const env = { ...loadEnvFile(resolve(repoRoot, ".env")), ...loadEnvFile(resolve(root, ".env")) };
const serverUrl = env.CAPACITOR_SERVER_URL?.trim();
if (serverUrl) {
  try {
    const host = new URL(serverUrl).host;
    ok(`CAPACITOR_SERVER_URL → ${host}`);
    if (host === "localhost" || host.startsWith("127.") || host.startsWith("10.0.2.2")) {
      warn("Local URL: push tokens POST to local server; use app.alpiplan.com for production push tests");
    }
  } catch {
    fail("CAPACITOR_SERVER_URL is not a valid URL");
    issues++;
  }
} else {
  warn("CAPACITOR_SERVER_URL not set in .env — cap sync may not load remote app");
  issues++;
}

// --- Local Firebase admin (optional) ---
const saFile = env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
if (saFile) {
  const abs = saFile.startsWith("/") ? saFile : resolve(repoRoot, saFile);
  if (existsSync(abs)) ok(`Local FIREBASE_SERVICE_ACCOUNT_FILE readable (${saFile})`);
  else {
    warn(`FIREBASE_SERVICE_ACCOUNT_FILE set but file missing: ${saFile}`);
    warn("  → pnpm dev:web will NOT send push; production Coolify FIREBASE_SERVICE_ACCOUNT is separate");
  }
} else if (env.FIREBASE_SERVICE_ACCOUNT?.trim()) {
  ok("FIREBASE_SERVICE_ACCOUNT inline set (local dev can send push)");
} else {
  warn("No local Firebase admin config — OK if phone uses app.alpiplan.com with Coolify secret");
}

console.log("\n--- Manual steps (cannot verify here) ---");
console.log("  • Apple Developer Program + APNs .p8 key uploaded in Firebase Cloud Messaging");
console.log("  • Coolify web: FIREBASE_SERVICE_ACCOUNT (service account JSON, project alpiplan)");
console.log("  • Xcode: paid team signing, run on physical iPhone, allow notifications");
console.log("  • DB: DevicePushToken row with platform = ios after login");
console.log("\nFull guide: docs/IOS_PUSH_SETUP.md\n");

if (issues > 0) {
  console.log(`Result: ${issues} item(s) need attention on this Mac.\n`);
  process.exitCode = 1;
} else {
  console.log("Result: local iOS client prerequisites look good. Complete Apple/Firebase/Coolify steps above.\n");
}
