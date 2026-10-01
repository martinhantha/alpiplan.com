import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";

/*
 * Requires the MongoDB Node.js Driver
 * https://mongodb.github.io/node-mongodb-native
 */

type LegacyPilotDoc = {
  _id?: unknown;
  name?: string;
  email?: string;
};

type LegacyFlightDoc = {
  pilot?: LegacyPilotDoc | null;
  pilots?: LegacyPilotDoc[] | null;
};

const defaultMongoUri =
  "mongodb://cluster0-shard-00-02.e0ea1.mongodb.net,cluster0-shard-00-01.e0ea1.mongodb.net,cluster0-shard-00-00.e0ea1.mongodb.net/?tls=true&authMechanism=MONGODB-X509&authSource=%24external&serverMonitoringMode=poll&maxIdleTimeMS=30000&minPoolSize=0&maxPoolSize=5&maxConnecting=6&replicaSet=atlas-9l7gkv-shard-0&appName=Data+Explorer--6159de92d355ff085acdfcea";
const outputPath = process.env.MONGO_EXPORT_PATH ?? "./tmp/flights.json";
const pilotsOutputPath =
  process.env.MONGO_PILOTS_EXPORT_PATH ?? "./tmp/pilots.json";
const flightsByPilotOutputPath =
  process.env.MONGO_FLIGHTS_BY_PILOT_PATH ?? "./tmp/flights-by-pilot.json";
const mongoUri = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? defaultMongoUri;
const dbName = process.env.MONGODB_DB ?? process.env.MONGO_DB ?? "myflights";
const pilotEmailFilter = process.env.MONGO_PILOT_EMAIL?.trim().toLowerCase();

function pilotKey(pilot: LegacyPilotDoc | null | undefined): string | null {
  if (!pilot) return null;
  const email = pilot.email?.trim().toLowerCase();
  if (email) return email;
  const name = pilot.name?.trim();
  if (name) return name.toLowerCase();
  return null;
}

function collectPilotsFromFlight(flight: LegacyFlightDoc): LegacyPilotDoc[] {
  const seen = new Set<string>();
  const result: LegacyPilotDoc[] = [];
  const push = (pilot: LegacyPilotDoc | null | undefined) => {
    const key = pilotKey(pilot);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(pilot as LegacyPilotDoc);
  };
  push(flight.pilot ?? undefined);
  if (Array.isArray(flight.pilots)) {
    for (const pilot of flight.pilots) push(pilot);
  }
  return result;
}

function groupFlightsByPilot(flights: LegacyFlightDoc[]): Record<string, LegacyFlightDoc[]> {
  const groups: Record<string, LegacyFlightDoc[]> = {};
  for (const flight of flights) {
    const pilots = collectPilotsFromFlight(flight);
    const keys = pilots.length
      ? pilots.map((pilot) => pilotKey(pilot)).filter(Boolean)
      : ["(ohne Pilot)"];
    for (const key of keys as string[]) {
      (groups[key] ??= []).push(flight);
    }
  }
  return groups;
}

function buildFlightFilter(): Record<string, unknown> {
  if (!pilotEmailFilter) return {};
  return {
    $or: [
      { "pilot.email": pilotEmailFilter },
      { pilots: { $elemMatch: { email: pilotEmailFilter } } },
    ],
  };
}

async function main() {
  const useX509 = /authMechanism=MONGODB-X509/i.test(mongoUri);
  const tlsCertificateKeyFile = process.env.MONGO_TLS_CERT_KEY_FILE;

  if (useX509 && !tlsCertificateKeyFile) {
    throw new Error(
      "Missing MONGO_TLS_CERT_KEY_FILE. Point it to your Atlas X.509 client PEM file."
    );
  }

  const client = await MongoClient.connect(
    mongoUri,
    useX509
      ? {
          tls: true,
          tlsCertificateKeyFile,
          tlsCertificateKeyFilePassword:
            process.env.MONGO_TLS_CERT_KEY_FILE_PASSWORD,
        }
      : undefined
  );

  const db = client.db(dbName);
  const filter = buildFlightFilter();
  const coll = db.collection("flights");
  const cursor = coll.find(filter).sort({ date: -1 });
  const result = (await cursor.toArray()) as LegacyFlightDoc[];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  const byPilot = groupFlightsByPilot(result);
  fs.writeFileSync(flightsByPilotOutputPath, JSON.stringify(byPilot, null, 2));

  let pilotsExported = 0;
  try {
    const pilots = await db.collection("pilots").find({}).sort({ name: 1 }).toArray();
    fs.writeFileSync(pilotsOutputPath, JSON.stringify(pilots, null, 2));
    pilotsExported = pilots.length;
  } catch {
    // pilots collection may not exist in every deployment
  }

  const perPilotCounts = Object.fromEntries(
    Object.entries(byPilot)
      .map(([key, flights]) => [key, flights.length] as const)
      .sort((a, b) => b[1] - a[1])
  );

  console.info(
    JSON.stringify(
      {
        flights: result.length,
        outputPath: path.resolve(outputPath),
        flightsByPilotPath: path.resolve(flightsByPilotOutputPath),
        pilotsOutputPath: path.resolve(pilotsOutputPath),
        pilotsExported,
        pilotEmailFilter: pilotEmailFilter ?? null,
        flightsPerPilot: perPilotCounts,
      },
      null,
      2
    )
  );

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
