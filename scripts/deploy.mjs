#!/usr/bin/env node
/**
 * Release von develop nach main.
 *
 *   pnpm deploy:main [--dry-run] [--yes] [--minor|--major|--version <x.y.z>]
 *
 * Alltag bleibt auf develop. Das Script erhöht nativeAppVersion in
 * apps/mobile-shell/capacitor.config.ts, committet auf develop, setzt das
 * annotierte Tag vX.Y.Z und schiebt main per Fast-Forward auf denselben Commit.
 * Coolify deployt den Branch main.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";

const DEVELOP = "develop";
const MAIN = "main";
const CONFIG = "apps/mobile-shell/capacitor.config.ts";
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};
const step = (msg) => console.log(`\n${c.bold("▸")} ${c.bold(msg)}`);
const info = (msg) => console.log(`  ${msg}`);

class DeployError extends Error {}
const fail = (msg) => {
  throw new DeployError(msg);
};

function run(cmd, cmdArgs, { capture = false } = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const detail = capture && res.stderr ? `\n${res.stderr.trim()}` : "";
    fail(`Befehl fehlgeschlagen: ${cmd} ${cmdArgs.join(" ")}${detail}`);
  }
  return capture ? res.stdout.trim() : "";
}

function succeeds(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { cwd: REPO_ROOT, stdio: "ignore" });
  return res.status === 0;
}

let rl;
async function ask(question) {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  return (await rl.question(question)).trim();
}

async function confirm(question, defaultYes = false) {
  if (flag("yes")) return true;
  const answer = (await ask(`  ${question} ${defaultYes ? "[J/n]" : "[j/N]"} `)).toLowerCase();
  if (!answer) return defaultYes;
  return ["j", "ja", "y", "yes"].includes(answer);
}

function readNativeVersion(source) {
  const block = source.match(/nativeAppVersion\s*=\s*\{([^}]+)\}/)?.[1];
  const versionCode = Number(block?.match(/versionCode:\s*(\d+)/)?.[1]);
  const versionName = block?.match(/versionName:\s*"([^"]+)"/)?.[1];
  if (!versionCode || !versionName) {
    fail(`versionCode/versionName fehlen in ${CONFIG}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(versionName)) {
    fail(`versionName "${versionName}" ist kein x.y.z`);
  }
  return { versionCode, versionName };
}

function parseSemver(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? "");
  if (!match) fail(`${label} muss x.y.z sein, war "${value ?? ""}"`);
  return match.slice(1).map(Number);
}

function compareSemver(a, b) {
  const left = parseSemver(a, "versionName");
  const right = parseSemver(b, "versionName");
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function nextVersionName(current) {
  const explicit = option("version");
  const levels = ["major", "minor", "patch"].filter((level) => flag(level));
  if (explicit && levels.length > 0) fail("--version schließt --major/--minor/--patch aus.");
  if (levels.length > 1) fail("Nur eine von --major, --minor, --patch angeben.");
  if (explicit) {
    parseSemver(explicit, "--version");
    return explicit;
  }
  const [major, minor, patch] = parseSemver(current, "versionName");
  const level = levels[0] ?? "patch";
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function writeNativeVersion(source, versionCode, versionName) {
  const block = source.match(/nativeAppVersion\s*=\s*\{[^}]+\}/);
  if (!block) fail(`nativeAppVersion fehlt in ${CONFIG}`);
  const updatedBlock = block[0]
    .replace(/versionCode:\s*\d+/, `versionCode: ${versionCode}`)
    .replace(/versionName:\s*"[^"]+"/, `versionName: "${versionName}"`);
  if (updatedBlock === block[0]) fail(`Version in ${CONFIG} konnte nicht ersetzt werden.`);
  return source.replace(block[0], updatedBlock);
}

function isAncestor(ancestor, descendant) {
  return succeeds("git", ["merge-base", "--is-ancestor", ancestor, descendant]);
}

/** Unveröffentlichter Release-Commit auf HEAD: nur noch main fast-forwarden und pushen. */
function unpublishedRelease() {
  const subject = run("git", ["log", "-1", "--format=%s"], { capture: true });
  const tag = /^Release (v\d+\.\d+\.\d+)$/.exec(subject)?.[1];
  if (!tag) return null;
  const head = run("git", ["rev-parse", "HEAD"], { capture: true });
  if (
    succeeds("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${MAIN}`]) &&
    run("git", ["rev-parse", `origin/${MAIN}`], { capture: true }) === head
  ) {
    return null;
  }
  if (!succeeds("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`])) {
    fail(`HEAD ist bereits ${tag}, das Tag fehlt aber. Nicht noch einmal versionieren.`);
  }
  const tagSha = run("git", ["rev-parse", `${tag}^{}`], { capture: true });
  if (tagSha !== head) return null;
  return tag;
}

function ensureReleaseBranch() {
  if (!succeeds("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${DEVELOP}`])) {
    fail(
      `Branch ${DEVELOP} fehlt. Einmalig anlegen und Coolify auf ${MAIN} lassen:\n` +
        `  git checkout -b ${DEVELOP}\n` +
        `  git push -u origin ${DEVELOP}`,
    );
  }
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  if (branch !== DEVELOP) {
    fail(`Release startet auf ${DEVELOP}. Aktuell ist "${branch}" ausgecheckt.`);
  }
  if (run("git", ["status", "--porcelain"], { capture: true })) {
    fail("Es gibt uncommittete Änderungen. Bitte erst committen.");
  }
  if (!succeeds("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${MAIN}`])) {
    fail(`Branch ${MAIN} fehlt lokal.`);
  }
}

function ensureHistoryCanFastForward(tag, { allowExistingTag = false } = {}) {
  if (!allowExistingTag && succeeds("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`])) {
    fail(`Tag ${tag} existiert bereits.`);
  }

  if (succeeds("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${DEVELOP}`])) {
    const [behind, ahead] = run(
      "git",
      ["rev-list", "--left-right", "--count", `origin/${DEVELOP}...${DEVELOP}`],
      { capture: true },
    )
      .split(/\s+/)
      .map(Number);
    if (behind > 0) {
      fail(`${DEVELOP} ist ${behind} Commit(s) hinter origin/${DEVELOP}. Bitte zuerst pullen.`);
    }
    if (ahead > 0) info(`${DEVELOP} ist ${ahead} Commit(s) vor origin/${DEVELOP} und wird mit gepusht.`);
  } else {
    info(`origin/${DEVELOP} fehlt noch und wird beim Push angelegt.`);
  }

  if (!succeeds("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${MAIN}`])) {
    fail(`origin/${MAIN} fehlt.`);
  }
  if (!isAncestor(`origin/${MAIN}`, DEVELOP)) {
    fail(`origin/${MAIN} hat Commits, die nicht in ${DEVELOP} sind. Bitte zuerst ${MAIN} in ${DEVELOP} mergen.`);
  }
  if (!isAncestor(MAIN, DEVELOP)) {
    fail(`Lokal ${MAIN} hat Commits, die nicht in ${DEVELOP} sind. Bitte zuerst ${MAIN} in ${DEVELOP} mergen.`);
  }
}

async function main() {
  if (flag("help") || flag("h")) {
    console.log(`pnpm deploy:main [Optionen]

  Release von ${DEVELOP} nach ${MAIN}: Version in ${CONFIG} erhöhen,
  Tag vX.Y.Z setzen, ${MAIN} fast-forwarden und pushen.
  Coolify deployt ${MAIN}. Alltag bleibt auf ${DEVELOP}.

  --patch                   versionName Patch erhöhen (Standard), versionCode + 1
  --minor                   versionName Minor erhöhen, versionCode + 1
  --major                   versionName Major erhöhen, versionCode + 1
  --version <x.y.z>         versionName setzen, versionCode + 1
  --dry-run                 nur anzeigen, nichts ändern
  --yes                     ohne Rückfrage pushen`);
    return;
  }

  const unknown = args.filter((arg, index) => {
    if (!arg.startsWith("--")) return option("version") === arg && args[index - 1] === "--version" ? false : true;
    return !["help", "h", "patch", "minor", "major", "version", "dry-run", "yes"].includes(arg.slice(2));
  });
  if (unknown.length > 0) fail(`Unbekannte Option: ${unknown.join(", ")}`);

  step("Git prüfen");
  ensureReleaseBranch();
  run("git", ["fetch", "--quiet", "--tags", "origin"]);
  const resumeTag = unpublishedRelease();
  const source = readFileSync(new URL(`../${CONFIG}`, import.meta.url), "utf8");
  const current = readNativeVersion(source);
  let tag = resumeTag;
  if (!tag) {
    const versionName = nextVersionName(current.versionName);
    if (compareSemver(versionName, current.versionName) <= 0) {
      fail(`Neue versionName ${versionName} muss größer als ${current.versionName} sein.`);
    }
    const versionCode = current.versionCode + 1;
    tag = `v${versionName}`;
    ensureHistoryCanFastForward(tag);
    step("Release");
    info(`versionName  ${current.versionName} → ${c.bold(versionName)}`);
    info(`versionCode  ${current.versionCode} → ${c.bold(String(versionCode))}`);
    info(`Tag          ${tag}`);
    info(`Branch       ${DEVELOP} → ${MAIN}`);
    if (flag("dry-run")) {
      info(c.dim("--dry-run: nichts committet, nichts gepusht."));
      return;
    }
    if (!(await confirm(`Release ${tag} auf ${MAIN} pushen?`))) fail("Abgebrochen.");
    step(`${CONFIG} setzen`);
    writeFileSync(new URL(`../${CONFIG}`, import.meta.url), writeNativeVersion(source, versionCode, versionName));
    try {
      run("git", ["add", "--", CONFIG]);
      run("git", [
        "commit",
        "-m",
        `Release ${tag}`,
        "-m",
        `versionCode ${versionCode}, versionName ${versionName}.`,
      ]);
    } catch (err) {
      spawnSync("git", ["restore", "--source=HEAD", "--staged", "--worktree", "--", CONFIG], {
        cwd: REPO_ROOT,
        stdio: "inherit",
      });
      throw err;
    }
    run("git", ["tag", "-a", tag, "-m", `Release ${tag}`, "-m", `versionCode ${versionCode}, versionName ${versionName}.`]);
  } else {
    ensureHistoryCanFastForward(tag, { allowExistingTag: true });
    step("Release fortsetzen");
    info(`Tag ${tag} liegt auf ${DEVELOP} und fehlt auf origin/${MAIN}.`);
    if (flag("dry-run")) {
      info(c.dim("--dry-run: nichts gepusht."));
      return;
    }
    if (!(await confirm(`Release ${tag} auf ${MAIN} pushen?`))) fail("Abgebrochen.");
  }
  const sha = run("git", ["rev-parse", "--short", "HEAD"], { capture: true });
  info(`Commit ${sha} auf ${DEVELOP}, Tag ${tag}.`);

  step(`${MAIN} fast-forward`);
  let switched = false;
  try {
    run("git", ["checkout", MAIN]);
    switched = true;
    run("git", ["merge", "--ff-only", DEVELOP]);
    const developUpstream = succeeds("git", ["rev-parse", "--abbrev-ref", "--quiet", `${DEVELOP}@{upstream}`]);
    run("git", developUpstream ? ["push", "origin", DEVELOP] : ["push", "-u", "origin", DEVELOP]);
    run("git", ["push", "origin", MAIN, `refs/tags/${tag}`]);
  } finally {
    if (switched && run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true }) !== DEVELOP) {
      run("git", ["checkout", DEVELOP]);
    }
  }

  step("Fertig");
  info(c.green(`${tag} ist auf ${MAIN} (${sha}).`));
  info(`Coolify deployt ${MAIN}. Weiterarbeiten auf ${DEVELOP}.`);
  info(c.dim("Ohne Auto-Deploy: pnpm deploy:local vom selben Commit."));
}

main()
  .catch((err) => {
    console.error(`\n${c.red("✖")} ${err instanceof DeployError ? err.message : err.stack}`);
    process.exitCode = 1;
  })
  .finally(() => rl?.close());
