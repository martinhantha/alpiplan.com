import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const plistPath = resolve("ios/App/App/Info.plist");
if (!existsSync(plistPath)) process.exit(0);

const capacitorConfig = readFileSync(resolve("capacitor.config.ts"), "utf8");
const appId = capacitorConfig.match(/appId:\s*"([^"]+)"/)?.[1] ?? "at.alpiplan.app";
const appName = capacitorConfig.match(/appName:\s*"([^"]+)"/)?.[1] ?? "Alpiplan";
const versionBlock = capacitorConfig.match(/nativeAppVersion\s*=\s*\{([^}]+)\}/)?.[1];
const versionCode = versionBlock?.match(/versionCode:\s*(\d+)/)?.[1];
const versionName = versionBlock?.match(/versionName:\s*"([^"]+)"/)?.[1];

const stringKeys = {
  CFBundleDisplayName: appName,
  NSContactsUsageDescription: `${appName} speichert oder liest Kontakte nur, wenn du das ausdrücklich auslöst.`,
  NSMicrophoneUsageDescription: `${appName} nutzt das Mikrofon nur für die Sprachaufnahme in der Schnellerfassung.`,
  NSSpeechRecognitionUsageDescription: `${appName} wandelt deine Sprache in Text um, um Termine vorzubereiten.`,
};

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

let xml = readFileSync(plistPath, "utf8");
const inserts = [];

for (const [key, value] of Object.entries(stringKeys)) {
  const escaped = escapeXml(value);
  const existing = new RegExp(
    `(<key>${key}</key>\\s*<string>)[\\s\\S]*?(</string>)`,
  );
  if (existing.test(xml)) {
    xml = xml.replace(existing, `$1${escaped}$2`);
    continue;
  }
  inserts.push(`\t<key>${key}</key>\n\t<string>${escaped}</string>`);
}

if (!xml.includes("<key>LSApplicationQueriesSchemes</key>")) {
  inserts.push(
    [
      "\t<key>LSApplicationQueriesSchemes</key>",
      "\t<array>",
      "\t\t<string>whatsapp</string>",
      "\t\t<string>whatsapp-business</string>",
      "\t</array>",
    ].join("\n"),
  );
}

if (inserts.length > 0) {
  const next = xml.replace(
    /\t<\/dict>\n<\/plist>\s*$/,
    `${inserts.join("\n")}\n\t</dict>\n</plist>\n`,
  );
  if (next === xml) {
    console.warn("Could not patch ios/App/App/Info.plist — unexpected plist format.");
    process.exit(1);
  }
  xml = next;
}

writeFileSync(plistPath, xml);

const pbxprojPath = resolve("ios/App/App.xcodeproj/project.pbxproj");
if (existsSync(pbxprojPath)) {
  let pbxproj = readFileSync(pbxprojPath, "utf8").replace(
    /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g,
    `PRODUCT_BUNDLE_IDENTIFIER = ${appId};`,
  );
  if (versionCode && versionName) {
    pbxproj = pbxproj.replace(
      /MARKETING_VERSION = [^;]+;/g,
      `MARKETING_VERSION = ${versionName};`,
    );
    pbxproj = pbxproj.replace(
      /CURRENT_PROJECT_VERSION = [^;]+;/g,
      `CURRENT_PROJECT_VERSION = ${versionCode};`,
    );
  }
  writeFileSync(pbxprojPath, pbxproj);
}

const versionLabel =
  versionCode && versionName ? `, version ${versionName} (${versionCode})` : "";
console.log(`Patched iOS identity ${appName} (${appId})${versionLabel}.`);
