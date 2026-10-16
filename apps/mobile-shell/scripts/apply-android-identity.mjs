import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const MIN_SDK_VERSION = 24;
const COMPILE_SDK_VERSION = 36;
const TARGET_SDK_VERSION = 36;
const { appId, appName } = readIdentity();
const { versionCode, versionName } = readNativeVersion();

function readCapacitorConfigSource() {
  return readFileSync(resolve(root, "capacitor.config.ts"), "utf8");
}

function readIdentity() {
  const source = readCapacitorConfigSource();
  const appId = source.match(/appId:\s*"([^"]+)"/)?.[1];
  const appName = source.match(/appName:\s*"([^"]+)"/)?.[1];
  if (!appId || !appName) {
    throw new Error("Could not read appId/appName from capacitor.config.ts");
  }
  return { appId, appName };
}

function readNativeVersion() {
  const source = readCapacitorConfigSource();
  const block = source.match(/nativeAppVersion\s*=\s*\{([^}]+)\}/)?.[1];
  const versionCode = Number(block?.match(/versionCode:\s*(\d+)/)?.[1]);
  const versionName = block?.match(/versionName:\s*"([^"]+)"/)?.[1];
  if (!versionCode || !versionName) {
    throw new Error(
      "Could not read versionCode/versionName from nativeAppVersion in capacitor.config.ts",
    );
  }
  return { versionCode, versionName };
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function findFiles(dir, fileName) {
  if (!existsSync(dir)) return [];
  const matches = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) matches.push(...findFiles(path, fileName));
    else if (entry.name === fileName) matches.push(path);
  }
  return matches;
}

function removeEmptyDirs(startDir, stopAt) {
  let dir = startDir;
  while (dir.startsWith(stopAt) && dir !== stopAt) {
    if (!existsSync(dir) || readdirSync(dir).length > 0) break;
    rmSync(dir, { recursive: true, force: true });
    dir = dirname(dir);
  }
}

const variablesPath = resolve(root, "android/variables.gradle");
if (existsSync(variablesPath)) {
  let variables = readFileSync(variablesPath, "utf8");
  variables = variables.replace(
    /minSdkVersion\s*=\s*\d+/,
    `minSdkVersion = ${MIN_SDK_VERSION}`,
  );
  variables = variables.replace(
    /compileSdkVersion\s*=\s*\d+/,
    `compileSdkVersion = ${COMPILE_SDK_VERSION}`,
  );
  variables = variables.replace(
    /targetSdkVersion\s*=\s*\d+/,
    `targetSdkVersion = ${TARGET_SDK_VERSION}`,
  );
  writeFileSync(variablesPath, variables);
}

const stringsPath = resolve(root, "android/app/src/main/res/values/strings.xml");
if (!existsSync(stringsPath)) process.exit(0);

writeFileSync(
  stringsPath,
  `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">${xmlEscape(appName)}</string>
    <string name="title_activity_main">${xmlEscape(appName)}</string>
    <string name="package_name">${xmlEscape(appId)}</string>
    <string name="custom_url_scheme">${xmlEscape(appId)}</string>
</resources>
`,
);

const gradlePath = resolve(root, "android/app/build.gradle");
if (existsSync(gradlePath)) {
  let gradle = readFileSync(gradlePath, "utf8");
  gradle = gradle.replace(/namespace\s+"[^"]+"/, `namespace "${appId}"`);
  gradle = gradle.replace(/applicationId\s+"[^"]+"/, `applicationId "${appId}"`);
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);
  writeFileSync(gradlePath, gradle);
}

const javaRoot = resolve(root, "android/app/src/main/java");
const destDir = join(javaRoot, ...appId.split("."));
const destFile = join(destDir, "MainActivity.java");
mkdirSync(destDir, { recursive: true });
writeFileSync(
  destFile,
  `package ${appId};\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n`,
);

for (const file of findFiles(javaRoot, "MainActivity.java")) {
  if (file === destFile) continue;
  rmSync(file, { force: true });
  removeEmptyDirs(dirname(file), javaRoot);
}

console.log(
  `Applied Android identity ${appName} (${appId}), version ${versionName} (${versionCode}).`,
);
