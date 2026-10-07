import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const iconSrc = resolve(root, "resources/icon.png");
const foregroundSrc = existsSync(resolve(root, "resources/icon-foreground.png"))
  ? resolve(root, "resources/icon-foreground.png")
  : iconSrc;
const backgroundSrc = resolve(root, "resources/icon-background.png");
const resDir = resolve(root, "android/app/src/main/res");

if (!existsSync(iconSrc)) {
  console.warn("Missing resources/icon.png — skip Android branding.");
  process.exit(0);
}
if (!existsSync(resDir)) process.exit(0);

function runSips(args) {
  const result = spawnSync("sips", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "sips failed").trim());
  }
}

function ensureDir(file) {
  mkdirSync(dirname(file), { recursive: true });
}

const densities = [
  { dir: "mipmap-mdpi", launcher: 48, foreground: 108 },
  { dir: "mipmap-hdpi", launcher: 72, foreground: 162 },
  { dir: "mipmap-xhdpi", launcher: 96, foreground: 216 },
  { dir: "mipmap-xxhdpi", launcher: 144, foreground: 324 },
  { dir: "mipmap-xxxhdpi", launcher: 192, foreground: 432 },
];

for (const { dir, launcher, foreground } of densities) {
  const outDir = resolve(resDir, dir);
  mkdirSync(outDir, { recursive: true });
  runSips(["-z", String(launcher), String(launcher), iconSrc, "--out", resolve(outDir, "ic_launcher.png")]);
  runSips(["-z", String(launcher), String(launcher), iconSrc, "--out", resolve(outDir, "ic_launcher_round.png")]);
  runSips([
    "-z",
    String(foreground),
    String(foreground),
    foregroundSrc,
    "--out",
    resolve(outDir, "ic_launcher_foreground.png"),
  ]);
  if (existsSync(backgroundSrc)) {
    runSips([
      "-z",
      String(foreground),
      String(foreground),
      backgroundSrc,
      "--out",
      resolve(outDir, "ic_launcher_background.png"),
    ]);
  }
}

writeFileSync(
  resolve(resDir, "values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#1A1040</color>
</resources>
`,
);

const adaptiveBackground = existsSync(backgroundSrc)
  ? "@mipmap/ic_launcher_background"
  : "@color/ic_launcher_background";
const adaptiveIcon = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="${adaptiveBackground}"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
mkdirSync(resolve(resDir, "mipmap-anydpi-v26"), { recursive: true });
writeFileSync(resolve(resDir, "mipmap-anydpi-v26/ic_launcher.xml"), adaptiveIcon);
writeFileSync(resolve(resDir, "mipmap-anydpi-v26/ic_launcher_round.xml"), adaptiveIcon);

const robot = resolve(resDir, "drawable-v24/ic_launcher_foreground.xml");
if (existsSync(robot)) unlinkSync(robot);

const splashes = [
  ["drawable/splash.png", 480, 320],
  ["drawable-port-mdpi/splash.png", 320, 480],
  ["drawable-port-hdpi/splash.png", 480, 800],
  ["drawable-port-xhdpi/splash.png", 720, 1280],
  ["drawable-port-xxhdpi/splash.png", 960, 1600],
  ["drawable-port-xxxhdpi/splash.png", 1280, 1920],
  ["drawable-land-mdpi/splash.png", 480, 320],
  ["drawable-land-hdpi/splash.png", 800, 480],
  ["drawable-land-xhdpi/splash.png", 1280, 720],
  ["drawable-land-xxhdpi/splash.png", 1600, 960],
  ["drawable-land-xxxhdpi/splash.png", 1920, 1280],
];

function writeSplash(dest, width, height) {
  ensureDir(dest);
  const logoSize = Math.max(64, Math.round(Math.min(width, height) * 0.38));
  const tmp = `${dest}.logo.png`;
  runSips(["-z", String(logoSize), String(logoSize), iconSrc, "--out", tmp]);
  runSips([
    "--padToHeightWidth",
    String(height),
    String(width),
    "--padColor",
    "000000",
    tmp,
    "--out",
    dest,
  ]);
  unlinkSync(tmp);
}

for (const [relative, width, height] of splashes) {
  writeSplash(resolve(resDir, relative), width, height);
}

console.log("Applied Alpiplan app icon and splash to Android.");
