import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MARKER = "// alpiplan-release-signing";
const root = process.cwd();
const gradlePath = resolve(root, "android/app/build.gradle");
const keystorePropsPath = resolve(root, "android/keystore.properties");

if (!existsSync(gradlePath)) process.exit(0);

let gradle = readFileSync(gradlePath, "utf8");
if (gradle.includes(MARKER)) {
  if (!existsSync(keystorePropsPath)) {
    console.warn(
      "Missing android/keystore.properties — release AAB will be UNSIGNED (Play Store rejects it).",
    );
    console.warn("Copy keystore.properties.example → android/keystore.properties and add your upload keystore.");
  }
  process.exit(0);
}

const header = `apply plugin: 'com.android.application'

${MARKER}
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

`;

gradle = gradle.replace(/^apply plugin: 'com\.android\.application'\n+/m, header);

gradle = gradle.replace(
  /android \{\n/,
  `android {
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
            }
        }
    }
`,
);

gradle = gradle.replace(
  /(\s+)release \{\n(\s+)minifyEnabled/,
  `$1release {
$2if (keystorePropertiesFile.exists()) {
$2    signingConfig signingConfigs.release
$2}
$2minifyEnabled`,
);

writeFileSync(gradlePath, gradle);

if (!existsSync(keystorePropsPath)) {
  console.warn(
    "Patched release signing in build.gradle, but android/keystore.properties is missing.",
  );
  console.warn("Play Store requires a signed bundle — see keystore.properties.example.");
} else {
  console.log("Patched Android release signing (upload keystore).");
}
