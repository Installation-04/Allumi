import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll } from "vitest";
import { TEMPLATE_DB, urlsFor } from "./config";

// One database per test file, cloned from the migrated template: files are isolated and run in parallel.
const dbName = `allumi_t_${process.pid}_${randomBytes(3).toString("hex")}`;
// Captured now: beforeAll replaces DATABASE_URL with this file's own database.
const urls = urlsFor(dbName);

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName} TEMPLATE ${TEMPLATE_DB}`);
  await admin.end();

  process.env.DATABASE_URL = urls.owner;
  process.env.APP_DATABASE_URL = urls.app;
  process.env.APP_URL ??= "http://localhost:3000";
  process.env.AUTH_SECRET = "integration-tests-secret-integration-tests";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  process.env.LOG_LEVEL = "silent";
});

afterAll(async () => {
  const { closePrisma } = await import("@/platform/db");
  await closePrisma();
  const admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});
