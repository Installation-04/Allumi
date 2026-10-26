import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { owner } from "./helpers";
import { appClient, asAccountant, asOwnerA, asOwnerB, asReader, inContext, seedWorld, sqlstate, W, type Context } from "./world";

/**
 * The database side of the integrations: who may read the credentials, what never changes, what the audit trail may
 * hold, and what an imported transaction must look like. Each test is one transaction under a user's context,
 * rolled back at the end; a refusal test builds its own fixtures because a failed statement aborts the transaction.
 */
let db: pg.Client;
let app: pg.Client;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  app = await appClient();
});
afterAll(async () => {
  await app?.end();
  await db?.end();
});

// 'SECRET-MARKER' as bytes: it must never show in the audit trail, whatever its encoding.
const SECRET_HEX = "5345435245542d4d41524b4552";
const CONNECTION_COLUMNS = "id, company_id, provider, label, account_id, import_from, created_by_id, updated_at";

async function connection(label = "Stripe boutique", overrides: { account?: string; provider?: string } = {}): Promise<string> {
  const { rows } = await app.query(
    `INSERT INTO integration_connection (${CONNECTION_COLUMNS})
     VALUES (gen_random_uuid(), app_tenant_id(), $1::integration_provider, $2, $3, '2026-01-01', app_current_user_id(), now()) RETURNING id`,
    [overrides.provider ?? "STRIPE", label, overrides.account ?? W.bank],
  );
  return rows[0].id as string;
}
async function credential(connectionId: string, hex = SECRET_HEX): Promise<string> {
  const { rows } = await app.query(
    "INSERT INTO integration_credential (id, company_id, connection_id, credentials_enc, updated_at) VALUES (gen_random_uuid(), app_tenant_id(), $1, decode($2, 'hex'), now()) RETURNING id",
    [connectionId, hex],
  );
  return rows[0].id as string;
}
const inTx = <T>(ctx: Context, fn: () => Promise<T>) => inContext(app, ctx, fn);
const refused = (ctx: Context, fn: () => Promise<unknown>) => sqlstate(() => inTx(ctx, fn));
const count = async (sql: string, args: unknown[] = []) => (await app.query(`SELECT count(*)::int AS n FROM ${sql}`, args)).rows[0].n as number;

type Txn = { connection: string; account?: string; external?: string; amount?: number; gross?: number | null; fee?: number | null; currency?: string; sourceType?: string | null };
async function transaction(t: Txn): Promise<void> {
  await app.query(
    `INSERT INTO bank_transaction (id, company_id, account_id, txn_date, amount_cents, description, external_id, dedupe_key, connection_id, currency, source_type, gross_cents, fee_cents, updated_at)
     VALUES (gen_random_uuid(), app_tenant_id(), $1, '2026-06-15', $2::bigint, 'Paiement', $3, 'k:' || $3, $4, $5, $6, $7::bigint, $8::bigint, now())`,
    [t.account ?? W.bank, t.amount ?? 9680, t.external ?? "stripe:txn_1", t.connection, t.currency ?? "CAD", t.sourceType === undefined ? "charge" : t.sourceType, t.gross === undefined ? 10000 : t.gross, t.fee === undefined ? 320 : t.fee],
  );
}

describe("who may see and change a connection", () => {
  it("lets only the owner create a connection and its credentials", async () => {
    await inTx(asOwnerA, async () => {
      const id = await connection();
      await credential(id);
      expect(await count("integration_connection WHERE id = $1", [id])).toBe(1);
    });
    for (const ctx of [asAccountant, asReader]) {
      expect(await refused(ctx, () => connection()), JSON.stringify(ctx)).toBe("42501");
    }
  });

  it("lets every member read a connection, but only the owner read its credentials", async () => {
    // committed so that other contexts see it
    await db.query("INSERT INTO integration_connection (id, company_id, provider, label, account_id, import_from, created_by_id, updated_at) VALUES ('00000000-0000-7000-8000-0000000c0a01', $1, 'PAYPAL', 'PayPal visible', $2, '2026-01-01', $3, now())", [W.companyA, W.bank, W.userOwnerA]);
    await db.query("INSERT INTO integration_credential (id, company_id, connection_id, credentials_enc, updated_at) VALUES (gen_random_uuid(), $1, '00000000-0000-7000-8000-0000000c0a01', decode($2, 'hex'), now())", [W.companyA, SECRET_HEX]);
    expect(await inTx(asOwnerA, () => count("integration_credential"))).toBe(1);
    for (const ctx of [asAccountant, asReader]) {
      expect(await inTx(ctx, () => count("integration_connection")), "connection").toBe(1);
      expect(await inTx(ctx, () => count("integration_credential")), "credentials").toBe(0);
    }
    // another company sees nothing of it
    expect(await inTx(asOwnerB, () => count("integration_connection"))).toBe(0);
    expect(await inTx(asOwnerB, () => count("integration_credential"))).toBe(0);
  });

  it("puts a connection on a bank-like account of the same company", async () => {
    expect(await refused(asOwnerA, () => connection("Sur un compte de revenus", { account: W.sales }))).toBe("AL005");
    expect(await refused(asOwnerA, () => connection("Sur le compte clients", { account: W.receivable }))).toBe("AL005");
    expect(await refused(asOwnerA, () => connection("Banque d'une autre entreprise", { account: W.bankB }))).toBe("AL005"); // the account is not found in this company
  });

  it("keeps a label unique per service, and within bounds", async () => {
    expect(await refused(asOwnerA, async () => { await connection("Boutique"); await connection("Boutique"); })).toBe("23505");
    await inTx(asOwnerA, async () => { await connection("Boutique"); await connection("Boutique", { provider: "PAYPAL" }); }); // another service: fine
    for (const label of ["", " ", " Boutique", "Boutique ", "x".repeat(61)]) {
      expect(await refused(asOwnerA, () => connection(label)), JSON.stringify(label)).toBe("23514");
    }
  });
});

describe("what never changes, and what is never deleted", () => {
  it("changes only the label, the status and the synchronization state of a connection", async () => {
    await inTx(asOwnerA, async () => {
      const id = await connection();
      await app.query("UPDATE integration_connection SET label = 'Renommée', status = 'DISABLED', credentials_hint = 'a1b2', last_sync_ok = true, last_imported_count = 4, last_synced_at = now(), sync_cursor = now(), syncing_since = NULL, last_error = NULL WHERE id = $1", [id]);
      expect((await app.query("SELECT label, status FROM integration_connection WHERE id = $1", [id])).rows[0]).toEqual({ label: "Renommée", status: "DISABLED" });
    });
    // the service, the account, the environment and the start date are fixed: a new connection takes their place
    for (const set of ["provider = 'PAYPAL'", `account_id = '${W.undeposited}'`, "sandbox = true", "import_from = '2025-01-01'", `company_id = '${W.companyB}'`]) {
      const state = await refused(asOwnerA, async () => { const id = await connection(); await app.query(`UPDATE integration_connection SET ${set} WHERE id = $1`, [id]); });
      expect(["42501", "AL010"], set).toContain(state);
    }
  });

  it("never deletes a connection or its credentials, even for the table owner", async () => {
    expect(await refused(asOwnerA, async () => { const id = await connection(); await app.query("DELETE FROM integration_connection WHERE id = $1", [id]); })).toBe("42501");
    expect(await refused(asOwnerA, async () => { const id = await connection(); await credential(id); await app.query("DELETE FROM integration_credential WHERE connection_id = $1", [id]); })).toBe("42501");
    await db.query("BEGIN");
    try {
      expect(await sqlstate(() => db.query("DELETE FROM integration_connection"))).toBe("AL010");
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("lets only the credentials of a connection change, and clears them without deleting", async () => {
    await inTx(asOwnerA, async () => {
      const id = await connection();
      const credentialId = await credential(id);
      await app.query("UPDATE integration_credential SET credentials_enc = NULL, updated_at = now() WHERE id = $1", [credentialId]);
      expect((await app.query("SELECT credentials_enc FROM integration_credential WHERE id = $1", [credentialId])).rows[0].credentials_enc).toBeNull();
    });
    const other = await refused(asOwnerA, async () => { const id = await connection(); const c = await credential(id); await app.query("UPDATE integration_credential SET connection_id = gen_random_uuid() WHERE id = $1", [c]); });
    expect(["42501", "AL010"]).toContain(other);
  });
});

describe("what the audit trail may hold", () => {
  it("records a connection and its credentials, but never the encrypted secret", async () => {
    await inTx(asOwnerA, async () => {
      const id = await connection("Audité");
      const credentialId = await credential(id);
      await app.query("UPDATE integration_credential SET credentials_enc = decode($2, 'hex'), updated_at = now() WHERE id = $1", [credentialId, "00ff00ff"]);
      await app.query("UPDATE integration_connection SET label = 'Audité 2' WHERE id = $1", [id]);

      const credentialRows = (await app.query("SELECT action, before, after FROM audit_log WHERE entity_type = 'integration_credential' AND entity_id = $1 ORDER BY id", [credentialId])).rows;
      expect(credentialRows.map((row) => row.action)).toEqual(["row.insert", "row.update"]);
      expect(credentialRows[0].after).not.toHaveProperty("credentials_enc");
      expect(credentialRows[1].after).toMatchObject({ _secrets_changed: ["credentials_enc"] });
      const connectionRows = (await app.query("SELECT action, after FROM audit_log WHERE entity_type = 'integration_connection' AND entity_id = $1 ORDER BY id", [id])).rows;
      expect(connectionRows.map((row) => row.action)).toEqual(["row.insert", "row.update"]);
      expect(connectionRows[1].after).toEqual({ label: "Audité 2" });
      // nowhere, in any encoding
      for (const needle of [SECRET_HEX, "00ff00ff", "SECRET-MARKER"]) {
        expect(await count("audit_log WHERE before::text ILIKE $1 OR after::text ILIKE $1", [`%${needle}%`]), needle).toBe(0);
      }
    });
  });

  it("leaves the synchronization bookkeeping out of the trail", async () => {
    await inTx(asOwnerA, async () => {
      const id = await connection("Synchronisée");
      const before = await count("audit_log WHERE entity_id = $1", [id]);
      await app.query("UPDATE integration_connection SET syncing_since = now() WHERE id = $1", [id]);
      await app.query("UPDATE integration_connection SET syncing_since = NULL, last_synced_at = now(), sync_cursor = now(), last_sync_ok = false, last_error = 'integrations.unauthorized', last_imported_count = 0 WHERE id = $1", [id]);
      expect(await count("audit_log WHERE entity_id = $1", [id])).toBe(before);
    });
  });
});

describe("what a connection may record", () => {
  it("keeps only a code as the last error, only a few characters of a hint, and sane counts", async () => {
    const update = (set: string) => refused(asOwnerA, async () => { const id = await connection(); await app.query(`UPDATE integration_connection SET ${set} WHERE id = $1`, [id]); });
    expect(await update("last_error = 'integrations.unauthorized'")).toBeNull();
    expect(await update("last_error = 'Invalid API Key provided: sk_live_abc'")).toBe("23514"); // the service's own text could quote a secret
    expect(await update(`last_error = 'a${"b".repeat(64)}'`)).toBe("23514"); // 65 characters
    expect(await update("credentials_hint = '12345678'")).toBeNull();
    expect(await update("credentials_hint = 'sk_live_abcdefgh'")).toBe("23514"); // a secret does not fit
    expect(await update("last_imported_count = -1")).toBe("23514");
  });
});

describe("imported transactions", () => {
  it("lands on the account of its connection with gross, fee and net that agree", async () => {
    await inTx(asOwnerA, async () => {
      const id = await connection();
      await transaction({ connection: id, amount: 9680, gross: 10000, fee: 320 });
      await transaction({ connection: id, external: "stripe:txn_2", amount: -5000, gross: -5000, fee: 0, sourceType: "payout" });
      await transaction({ connection: id, external: "stripe:txn_3", amount: -9680, gross: -10000, fee: -320, sourceType: "refund" }); // fee returned
      expect(await count("bank_transaction WHERE connection_id = $1", [id])).toBe(3);
    });
  });

  it("refuses gross − fee ≠ net, a lone gross or fee, and a missing source type or external id", async () => {
    const attempt = (t: Partial<Txn>) => refused(asOwnerA, async () => { const id = await connection(); await transaction({ connection: id, ...t }); });
    expect(await attempt({ amount: 9680, gross: 10000, fee: 320 })).toBeNull();
    expect(await attempt({ amount: 9681, gross: 10000, fee: 320 })).toBe("23514");
    expect(await attempt({ gross: 10000, fee: null })).toBe("23514");
    expect(await attempt({ gross: null, fee: 320 })).toBe("23514");
    expect(await attempt({ sourceType: null })).toBe("23514");
    expect(await attempt({ currency: "cad" })).toBe("23514");
    expect(await attempt({ currency: "CADD" })).toBe("22001");
  });

  it("refuses a transaction on another account than its connection's", async () => {
    expect(await refused(asOwnerA, async () => { const id = await connection(); await transaction({ connection: id, account: W.undeposited }); })).toBe("AL005");
    // an account of the same kind but not the connection's
    await db.query("INSERT INTO account (id, company_id, code, name_fr, name_en, type, subtype, updated_at) VALUES ('00000000-0000-7000-8000-00000000a101', $1, '1010', 'Banque 2', 'Bank 2', 'ASSET', 'BANK', now()) ON CONFLICT DO NOTHING", [W.companyA]);
    expect(await refused(asOwnerA, async () => { const id = await connection(); await transaction({ connection: id, account: "00000000-0000-7000-8000-00000000a101" }); })).toBe("AL010");
  });

  it("refuses an import through a disabled connection", async () => {
    expect(await refused(asOwnerA, async () => {
      const id = await connection();
      await app.query("UPDATE integration_connection SET status = 'DISABLED' WHERE id = $1", [id]);
      await transaction({ connection: id });
    })).toBe("AL010");
  });

  it("imports a transaction once per account (the same external id is refused)", async () => {
    expect(await refused(asOwnerA, async () => { const id = await connection(); await transaction({ connection: id }); await transaction({ connection: id }); })).toBe("23505");
  });

  it("keeps an imported transaction as it came: only its status changes, and it is never deleted", async () => {
    await inTx(asOwnerA, async () => {
      const id = await connection();
      await transaction({ connection: id });
      await app.query("UPDATE bank_transaction SET status = 'EXCLUDED', updated_at = now() WHERE connection_id = $1", [id]);
      expect((await app.query("SELECT status FROM bank_transaction WHERE connection_id = $1", [id])).rows[0].status).toBe("EXCLUDED");
    });
    const change = await refused(asOwnerA, async () => { const id = await connection(); await transaction({ connection: id }); await app.query("UPDATE bank_transaction SET amount_cents = 1 WHERE connection_id = $1", [id]); });
    expect(["42501", "AL010"]).toContain(change);
    expect(await refused(asOwnerA, async () => { const id = await connection(); await transaction({ connection: id }); await app.query("DELETE FROM bank_transaction WHERE connection_id = $1", [id]); })).toBe("42501");
  });

  it("is invisible to another company", async () => {
    await db.query("INSERT INTO integration_connection (id, company_id, provider, label, account_id, import_from, created_by_id, updated_at) VALUES ('00000000-0000-7000-8000-0000000c0b01', $1, 'STRIPE', 'Stripe visible', $2, '2026-01-01', $3, now()) ON CONFLICT DO NOTHING", [W.companyA, W.bank, W.userOwnerA]);
    await db.query(
      `INSERT INTO bank_transaction (id, company_id, account_id, txn_date, amount_cents, description, external_id, dedupe_key, connection_id, source_type, updated_at)
       VALUES ('00000000-0000-7000-8000-0000000d0b01', $1, $2, '2026-06-15', 100, 'Visible', 'stripe:visible', 'k:visible', '00000000-0000-7000-8000-0000000c0b01', 'charge', now()) ON CONFLICT DO NOTHING`,
      [W.companyA, W.bank],
    );
    expect(await inTx(asOwnerA, () => count("bank_transaction WHERE external_id = 'stripe:visible'"))).toBe(1);
    expect(await inTx(asOwnerB, () => count("bank_transaction WHERE external_id = 'stripe:visible'"))).toBe(0);
  });
});
