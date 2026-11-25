/** Real-service print fixtures exclusively for the disposable browser-test database. */
import { closePrisma } from "@/platform/db";
import { createMileageTrip } from "@/modules/mileage";
import { E2E_DB } from "./db";

for (const key of ["DATABASE_URL", "APP_DATABASE_URL"]) if (new URL(process.env[key] ?? "").pathname !== `/${E2E_DB}`) throw new Error("Refusing non-E2E database");
process.env.APP_URL = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
process.env.AUTH_SECRET = "e2e-mileage-print-only-e2e-mileage-print-only";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const [userId, companyId, mode = "initial"] = process.argv.slice(2);
if (![userId, companyId].every(id => id && /^[0-9a-f-]{36}$/.test(id)) || !["initial", "extra", "capacity"].includes(mode)) throw new Error("Invalid print fixture arguments");
const actor = { userId: userId!, companyId: companyId! };
try {
  const count = mode === "initial" ? 106 : mode === "extra" ? 1 : 893;
  for (let i = 0; i < count; i++) {
    const personal = mode === "initial" && i === 0, long = mode === "initial" && i === 1;
    await createMileageTrip(actor, {
      date: personal || mode === "extra" ? "2026-09-30" : long ? "2026-09-01" : "2026-09-15",
      vehicle: "IMP95 %_ " + (long ? "X".repeat(71) : "véhicule exemple"),
      origin: long ? "O".repeat(160) : "Québec", destination: long ? "D".repeat(160) : "Montréal",
      usage: personal ? "PERSONAL" : "BUSINESS", purpose: personal ? "" : long ? "M".repeat(200) : mode === "extra" ? "Trajet relu à l’ouverture" : `Visite imprimable ${i}`,
      distanceMeters: mode === "extra" ? 1000 : long ? 12345 : 1,
    });
  }
  process.stdout.write(JSON.stringify({ count }));
} finally { await closePrisma(); }
