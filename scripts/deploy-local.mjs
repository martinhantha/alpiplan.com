#!/usr/bin/env node
/**
 * Baut das Web-Image lokal, lädt es per Docker-Context auf den Coolify-Server
 * und startet den bestehenden Coolify-Container damit neu (ohne Server-Build).
 *
 *   pnpm deploy:local [--migrate] [--dry-run] [--yes]
 *                     [--context <docker-context>] [--build-context <docker-context>]
 *
 * Coolify selbst bleibt unverändert: der nächste normale Deploy in Coolify
 * erzeugt die Compose-Datei neu und baut wie gewohnt am Server.
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SERVICE = "web-alpiplan";
const DOCKERFILE = "apps/web/Dockerfile";
const MIN_FREE_GB = 1.5;
const HEALTH_TIMEOUT_MS = 120_000;
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag("help") || flag("h")) {
  console.log(`pnpm deploy:local [Optionen]

  --migrate                 prisma migrate deploy vor dem Neustart ausführen
  --dry-run                 nur lokal bauen und prüfen, nichts hochladen
  --yes                     keine Rückfragen (Standardwerte verwenden)
  --context <name>          Docker-Context des Servers (oder DEPLOY_CONTEXT)
  --build-context <name>    lokaler Docker-Context (oder DEPLOY_BUILD_CONTEXT)
  --health-url <url>        Health-Endpoint (Standard: <SERVICE_URL>/api/health)`);
  process.exit(0);
}

const assumeYes = flag("yes");
const dryRun = flag("dry-run");
const wantMigrate = flag("migrate");

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};
const step = (msg) => console.log(`\n${c.bold("▸")} ${c.bold(msg)}`);
const info = (msg) => console.log(`  ${msg}`);
const warn = (msg) => console.log(`  ${c.yellow("!")} ${msg}`);

class DeployError extends Error {}
const fail = (msg) => {
  throw new DeployError(msg);
};

function run(cmd, cmdArgs, { capture = false, env = {} } = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, ...env },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const detail = capture && res.stderr ? `\n${res.stderr.trim()}` : "";
    fail(`Befehl fehlgeschlagen: ${cmd} ${cmdArgs.join(" ")}${detail}`);
  }
  return capture ? res.stdout.trim() : "";
}

function succeeds(cmd, cmdArgs, { env = {} } = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    cwd: REPO_ROOT,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
  return res.status === 0;
}

let rl;
async function ask(question) {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  return (await rl.question(question)).trim();
}

async function confirm(question, defaultYes = true) {
  if (assumeYes) return defaultYes;
  const answer = (await ask(`  ${question} ${defaultYes ? "[J/n]" : "[j/N]"} `)).toLowerCase();
  if (!answer) return defaultYes;
  return ["j", "ja", "y", "yes"].includes(answer);
}

async function choose(title, items, defaultValue) {
  if (items.length === 0) fail(`${title}: keine Auswahl verfügbar.`);
  if (assumeYes || items.length === 1) return defaultValue ?? items[0].value;
  console.log(`  ${title}:`);
  items.forEach((item, i) => {
    const mark = item.value === defaultValue ? c.green(" (Vorschlag)") : "";
    console.log(`    ${String(i + 1).padStart(2)}) ${item.label}${mark}`);
  });
  const answer = await ask(`  Auswahl [Enter = ${defaultValue}]: `);
  if (!answer) return defaultValue;
  const byIndex = items[Number(answer) - 1];
  const byName = items.find((item) => item.value === answer);
  const picked = byIndex ?? byName;
  if (!picked) fail(`Ungültige Auswahl: ${answer}`);
  return picked.value;
}

function sshTarget(endpoint) {
  const url = new URL(endpoint);
  const host = url.username ? `${url.username}@${url.hostname}` : url.hostname;
  return ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", ...(url.port ? ["-p", url.port] : []), host];
}

function containerEnv(context, container) {
  const lines = run(
    "docker",
    ["--context", context, "inspect", container, "--format", "{{range .Config.Env}}{{println .}}{{end}}"],
    { capture: true },
  ).split("\n");
  return Object.fromEntries(
    lines.filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  step("Git prüfen");
  if (run("git", ["status", "--porcelain"], { capture: true })) {
    fail("Es gibt uncommittete Änderungen. Bitte erst committen und pushen.");
  }
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  const sha = run("git", ["rev-parse", "HEAD"], { capture: true });
  run("git", ["fetch", "--quiet", "origin"]);
  if (!succeeds("git", ["rev-parse", "--verify", "--quiet", "@{u}"])) {
    fail(`Branch ${branch} hat keinen Upstream. Bitte erst pushen.`);
  }
  const upstream = run("git", ["rev-parse", "@{u}"], { capture: true });
  if (sha !== upstream) {
    fail(
      `HEAD (${sha.slice(0, 7)}) entspricht nicht ${branch}@origin (${upstream.slice(0, 7)}). ` +
        "Bitte erst pushen/pullen, sonst baut der nächste Coolify-Deploy eine andere Version.",
    );
  }
  info(`${branch} @ ${sha.slice(0, 7)} ${c.dim(run("git", ["log", "-1", "--format=%s"], { capture: true }))}`);

  step("Docker-Contexts");
  const contexts = run("docker", ["context", "ls", "--format", "{{json .}}"], { capture: true })
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const remoteContexts = contexts.filter((ctx) => ctx.DockerEndpoint?.startsWith("ssh://"));

  let remote = option("context") ?? process.env.DEPLOY_CONTEXT;
  if (!remote) {
    const suggestion = remoteContexts.find((ctx) => ctx.Current) ?? remoteContexts[0];
    remote = await choose(
      "Ziel-Server",
      remoteContexts.map((ctx) => ({ value: ctx.Name, label: `${ctx.Name}  ${c.dim(ctx.DockerEndpoint)}` })),
      suggestion?.Name,
    );
  }
  const remoteCtx = contexts.find((ctx) => ctx.Name === remote);
  if (!remoteCtx?.DockerEndpoint?.startsWith("ssh://")) fail(`Docker-Context "${remote}" ist kein SSH-Context.`);

  const local =
    option("build-context") ??
    process.env.DEPLOY_BUILD_CONTEXT ??
    (contexts.some((ctx) => ctx.Name === "desktop-linux") ? "desktop-linux" : "default");
  if (!succeeds("docker", ["--context", local, "info"])) {
    fail(`Lokaler Docker (Context "${local}") ist nicht erreichbar. Läuft Docker Desktop?`);
  }
  info(`Build lokal:  ${local}`);
  info(`Server:       ${remote} ${c.dim(remoteCtx.DockerEndpoint)}`);
  const ssh = sshTarget(remoteCtx.DockerEndpoint);

  step("Coolify-Ressource auf dem Server suchen");
  const candidates = run(
    "docker",
    [
      "--context",
      remote,
      "ps",
      "--filter",
      "label=coolify.type=application",
      "--filter",
      `name=${SERVICE}-`,
      "--format",
      '{{.Names}}\t{{.Image}}\t{{.Label "coolify.applicationUuid"}}',
    ],
    { capture: true },
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, image, uuid] = line.split("\t");
      return { name, image, uuid };
    })
    .filter((ct) => ct.uuid);
  if (candidates.length === 0) {
    fail(`Kein laufender Coolify-Container "${SERVICE}" gefunden. Einmal normal über Coolify deployen.`);
  }
  if (candidates.length > 1) {
    fail(`Mehrere Container gefunden: ${candidates.map((ct) => ct.name).join(", ")}`);
  }
  const [{ name: container, image: currentImage, uuid }] = candidates;
  const appDir = `/data/coolify/applications/${uuid}`;
  const image = `${uuid}_${SERVICE}:${sha}`;
  const remoteEnv = containerEnv(remote, container);

  const arch = run("docker", ["--context", remote, "info", "--format", "{{.Architecture}}"], { capture: true });
  const platform = { x86_64: "linux/amd64", amd64: "linux/amd64", aarch64: "linux/arm64", arm64: "linux/arm64" }[arch];
  if (!platform) fail(`Unbekannte Server-Architektur: ${arch}`);

  const coolifyBranch = (remoteEnv.COOLIFY_BRANCH ?? "").replaceAll('"', "");
  if (coolifyBranch && coolifyBranch !== branch) {
    warn(`Coolify deployt Branch "${coolifyBranch}", lokal ist "${branch}" ausgecheckt.`);
    if (!(await confirm("Trotzdem fortfahren?", false))) fail("Abgebrochen.");
  }

  const healthUrl =
    option("health-url") ??
    process.env.DEPLOY_HEALTH_URL ??
    (remoteEnv.SERVICE_URL_WEB_ALPIPLAN ? `${remoteEnv.SERVICE_URL_WEB_ALPIPLAN.split(",")[0]}/api/health` : undefined);

  info(`Container:    ${container}`);
  info(`Läuft jetzt:  ${currentImage}`);
  info(`Neu:          ${image}`);
  info(`Plattform:    ${platform}`);
  info(`Health:       ${healthUrl ?? c.dim("(keine URL gefunden)")}`);
  if (currentImage === image) warn("Dieser Commit läuft bereits.");
  if (!dryRun && !(await confirm("Deploy starten?"))) fail("Abgebrochen.");

  step(`Image lokal bauen (${platform})`);
  run("docker", [
    "--context",
    local,
    "build",
    "--platform",
    platform,
    "-f",
    DOCKERFILE,
    "--label",
    `org.opencontainers.image.revision=${sha}`,
    "-t",
    image,
    ".",
  ]);
  if (!succeeds("docker", ["--context", local, "run", "--rm", "--platform", platform, image, "test", "-x", "/app/node_modules/.bin/prisma"])) {
    fail("Image enthält keine Prisma-CLI (/app/node_modules/.bin/prisma).");
  }
  info(c.green("Build ok."));

  if (dryRun) {
    info(c.dim("--dry-run: nichts hochgeladen, nichts neu gestartet."));
    return;
  }

  step("Image auf den Server laden");
  const freeKb = Number(
    run("ssh", [...ssh, "df -Pk /var/lib/docker | awk 'NR==2 {print $4}'"], { capture: true }),
  );
  const freeGb = freeKb / 1024 / 1024;
  info(`Freier Platz am Server: ${freeGb.toFixed(1)} GB`);
  if (freeGb < MIN_FREE_GB) {
    fail(`Zu wenig Platz am Server (< ${MIN_FREE_GB} GB). Z. B. "docker image prune -a" am Server ausführen.`);
  }
  if (succeeds("docker", ["--context", remote, "image", "inspect", image])) {
    info("Image ist am Server bereits vorhanden.");
  } else {
    run("bash", ["-o", "pipefail", "-c", 'docker --context "$L" save "$IMG" | gzip -1 | docker --context "$R" load'], {
      env: { L: local, R: remote, IMG: image },
    });
  }

  step("Datenbank-Migrationen");
  const networks = run(
    "docker",
    ["--context", remote, "inspect", container, "--format", "{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}"],
    { capture: true },
  )
    .split("\n")
    .filter(Boolean);
  const network = networks.includes("alpiplan-network") ? "alpiplan-network" : networks[0];
  if (!remoteEnv.DATABASE_URL) fail("DATABASE_URL im laufenden Container nicht gefunden.");
  const prisma = (cmd) => [
    "--context",
    remote,
    "run",
    "--rm",
    "--network",
    network,
    "-e",
    "DATABASE_URL",
    image,
    "sh",
    "-c",
    `cd /app && ./node_modules/.bin/prisma migrate ${cmd}`,
  ];
  const pending = !succeeds("docker", prisma("status"), { env: { DATABASE_URL: remoteEnv.DATABASE_URL } });
  if (!pending) {
    info("Keine ausstehenden Migrationen.");
  } else if (wantMigrate || (await confirm("Ausstehende Migrationen gefunden. Jetzt ausführen?", false))) {
    run("docker", prisma("deploy"), { env: { DATABASE_URL: remoteEnv.DATABASE_URL } });
  } else {
    warn("Migrationen übersprungen (mit --migrate ausführen).");
  }

  step("Container neu starten");
  const compose = `docker compose --project-name ${uuid} -f docker-compose.yaml up -d --no-build --no-deps ${SERVICE}`;
  run("ssh", [
    ...ssh,
    [
      "set -e",
      `cd ${appDir}`,
      "cp docker-compose.yaml docker-compose.yaml.before-local",
      "cp .env .env.before-local",
      `sed -i 's#${uuid}_${SERVICE}:[0-9A-Za-z._-]*#${image}#' docker-compose.yaml`,
      `grep -q '${image}' docker-compose.yaml`,
      `sed -i 's/^SOURCE_COMMIT=.*/SOURCE_COMMIT=${sha}/' .env`,
      compose,
    ].join("\n"),
  ]);

  step("Health-Check");
  const healthy = await waitHealthy({ remote, container, image, healthUrl });
  if (!healthy) {
    run("docker", ["--context", remote, "logs", "--tail", "40", container]);
    warn("Neue Version ist nicht gesund.");
    if (await confirm("Auf vorherige Version zurücksetzen?", true)) {
      run("ssh", [
        ...ssh,
        [
          "set -e",
          `cd ${appDir}`,
          "cp docker-compose.yaml.before-local docker-compose.yaml",
          "cp .env.before-local .env",
          compose,
        ].join("\n"),
      ]);
      fail(`Zurückgesetzt auf ${currentImage}.`);
    }
    fail("Deploy fehlgeschlagen, Container läuft mit neuer Version weiter.");
  }

  step("Alte Images aufräumen");
  const keep = new Set([image, currentImage]);
  const old = run(
    "docker",
    ["--context", remote, "images", "--filter", `reference=${uuid}_${SERVICE}`, "--format", "{{.Repository}}:{{.Tag}}"],
    { capture: true },
  )
    .split("\n")
    .filter((ref) => ref && !keep.has(ref));
  for (const ref of old) {
    if (succeeds("docker", ["--context", remote, "image", "rm", ref])) info(`entfernt ${c.dim(ref)}`);
  }
  if (old.length === 0) info("Nichts zu tun (aktuelle + vorherige Version bleiben).");

  console.log(`\n${c.green("✔")} ${c.bold(`Deployed ${sha.slice(0, 7)}`)} ${c.dim(`→ ${remote}`)}`);
  console.log(c.dim("  Coolify zeigt weiterhin den letzten eigenen Deploy an; der nächste Coolify-Deploy baut wieder am Server."));
}

async function waitHealthy({ remote, container, image, healthUrl }) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(3000);
    const state = spawnSync(
      "docker",
      ["--context", remote, "inspect", container, "--format", "{{.State.Status}}\t{{.Config.Image}}"],
      { encoding: "utf8" },
    ).stdout?.trim();
    const [status, runningImage] = (state ?? "").split("\t");
    if (status !== "running" || runningImage !== image) {
      info(c.dim(`Container: ${status || "?"}`));
      continue;
    }
    if (!healthUrl) return true;
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        info(c.green(`${healthUrl} → ${res.status}`));
        return true;
      }
      info(c.dim(`${healthUrl} → ${res.status}`));
    } catch (err) {
      info(c.dim(`${healthUrl} → ${err.cause?.code ?? err.name}`));
    }
  }
  return false;
}

main()
  .catch((err) => {
    console.error(`\n${c.red("✖")} ${err instanceof DeployError ? err.message : err.stack}`);
    process.exitCode = 1;
  })
  .finally(() => rl?.close());
