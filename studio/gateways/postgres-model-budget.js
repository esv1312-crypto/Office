import { randomUUID } from "node:crypto";

const DEFAULT_INPUT_USD_PER_MILLION = 0.30;
const DEFAULT_OUTPUT_USD_PER_MILLION = 1.20;

function usd(value) {
  return Number(Number(value).toFixed(9));
}

function estimateMaximumCost({ messages, maxTokens, inputUsdPerMillion, outputUsdPerMillion }) {
  const serialized = JSON.stringify(messages ?? []);
  // A conservative tokenizer-independent estimate: one token per two UTF-8
  // bytes. The old two-tokens-per-byte rule reserved up to 8x more than
  // ordinary English/JSON prompts and starved useful work before the cap.
  const estimatedInputTokens = Math.ceil(Buffer.byteLength(serialized, "utf8") / 2);
  const inputCost = estimatedInputTokens * inputUsdPerMillion / 1_000_000;
  const outputCost = maxTokens * outputUsdPerMillion / 1_000_000;
  return {
    estimatedInputTokens,
    maximumOutputTokens: maxTokens,
    amountUsd: usd((inputCost + outputCost) * 1.25),
  };
}

export function createPostgresModelBudget({
  pool,
  capUsd = 2,
  budgetKey = "owner-master-build-universal-ai-studio-2026-11-08-v1",
  inputUsdPerMillion = DEFAULT_INPUT_USD_PER_MILLION,
  outputUsdPerMillion = DEFAULT_OUTPUT_USD_PER_MILLION,
  reservationTtlMs = 15 * 60 * 1000,
}) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A PostgreSQL pool is required");
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new TypeError("capUsd must be positive");
  if (typeof budgetKey !== "string" || !budgetKey.trim()) throw new TypeError("budgetKey is required");
  if (!Number.isInteger(reservationTtlMs) || reservationTtlMs < 60_000) {
    throw new TypeError("reservationTtlMs must be at least 60000");
  }

  let schemaReady;
  async function ensureSchema() {
    if (!schemaReady) {
      schemaReady = (async () => {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS studio.model_budget_accounts (
            budget_key text PRIMARY KEY,
            cap_usd numeric(14,9) NOT NULL,
            spent_usd numeric(14,9) NOT NULL DEFAULT 0,
            reserved_usd numeric(14,9) NOT NULL DEFAULT 0,
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS studio.model_budget_reservations (
            id uuid PRIMARY KEY,
            budget_key text NOT NULL REFERENCES studio.model_budget_accounts(budget_key),
            model text NOT NULL,
            role text NOT NULL,
            reserved_usd numeric(14,9) NOT NULL,
            actual_usd numeric(14,9),
            status text NOT NULL CHECK (status IN ('reserved', 'settled')),
            estimated_input_tokens bigint NOT NULL,
            max_output_tokens integer NOT NULL,
            actual_input_tokens bigint,
            actual_output_tokens bigint,
            created_at timestamptz NOT NULL DEFAULT now(),
            settled_at timestamptz
          )
        `);
        await pool.query(`
          INSERT INTO studio.model_budget_accounts (budget_key, cap_usd)
          VALUES ($1, $2)
          ON CONFLICT (budget_key) DO UPDATE
            SET cap_usd = LEAST(studio.model_budget_accounts.cap_usd, EXCLUDED.cap_usd),
                updated_at = now()
        `, [budgetKey, capUsd]);
      })().catch(error => {
        schemaReady = null;
        throw error;
      });
    }
    return schemaReady;
  }

  async function refreshAccountFromLedger(db) {
    const ledger = await db.query(`
      SELECT
        COALESCE(SUM(actual_usd) FILTER (WHERE status = 'settled'), 0) AS spent_usd,
        COALESCE(SUM(reserved_usd) FILTER (WHERE status = 'reserved'), 0) AS reserved_usd
      FROM studio.model_budget_reservations
      WHERE budget_key = $1
    `, [budgetKey]);
    const spent = Number(ledger.rows?.[0]?.spent_usd || 0);
    const reserved = Number(ledger.rows?.[0]?.reserved_usd || 0);
    await db.query(`
      UPDATE studio.model_budget_accounts
      SET spent_usd = $2, reserved_usd = $3, updated_at = now()
      WHERE budget_key = $1
    `, [budgetKey, spent, reserved]);
    return { spent, reserved };
  }

  async function reserve({ model, role, messages, maxTokens }) {
    await ensureSchema();
    const estimate = estimateMaximumCost({ messages, maxTokens, inputUsdPerMillion, outputUsdPerMillion });
    const reservationId = randomUUID();
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const account = await db.query(
        "SELECT cap_usd FROM studio.model_budget_accounts WHERE budget_key = $1 FOR UPDATE",
        [budgetKey],
      );
      const cap = Number(account.rows?.[0]?.cap_usd);
      if (!Number.isFinite(cap)) throw new Error("Model budget account is missing");

      // A crashed process may leave a reservation behind. Since the provider
      // may have accepted the request before the crash, expire it conservatively
      // as fully spent instead of silently releasing money that may be charged.
      await db.query(`
        UPDATE studio.model_budget_reservations
        SET status = 'settled', actual_usd = reserved_usd, settled_at = now()
        WHERE budget_key = $1 AND status = 'reserved'
          AND created_at < now() - ($2 * interval '1 millisecond')
      `, [budgetKey, reservationTtlMs]);

      const ledger = await db.query(`
        SELECT
          COALESCE(SUM(actual_usd) FILTER (WHERE status = 'settled'), 0) AS spent_usd,
          COALESCE(SUM(reserved_usd) FILTER (WHERE status = 'reserved'), 0) AS reserved_usd
        FROM studio.model_budget_reservations
        WHERE budget_key = $1
      `, [budgetKey]);
      const spent = Number(ledger.rows?.[0]?.spent_usd || 0);
      const reserved = Number(ledger.rows?.[0]?.reserved_usd || 0);
      if (spent + reserved + estimate.amountUsd > cap + 1e-9) {
        const error = Object.assign(new Error("The shared model budget is exhausted"), {
          code: "MODEL_BUDGET_EXHAUSTED",
          status: 402,
          budget: { capUsd: cap, spentUsd: spent, reservedUsd: reserved, requestedUsd: estimate.amountUsd },
        });
        throw error;
      }
      await db.query(`
        INSERT INTO studio.model_budget_reservations
          (id, budget_key, model, role, reserved_usd, status, estimated_input_tokens, max_output_tokens)
        VALUES ($1, $2, $3, $4, $5, 'reserved', $6, $7)
      `, [reservationId, budgetKey, model, role, estimate.amountUsd, estimate.estimatedInputTokens, maxTokens]);
      await refreshAccountFromLedger(db);
      await db.query("COMMIT");
      return { id: reservationId, ...estimate };
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async function settle(reservation, { usage, response } = {}) {
    if (!reservation?.id) return;
    await ensureSchema();
    const promptTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0;
    const outputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0;
    const providerCost = Number(usage?.cost ?? response?.cost);
    const calculated = (promptTokens * inputUsdPerMillion + outputTokens * outputUsdPerMillion) / 1_000_000;
    // Record the provider's reported cost even if it exceeds the estimate.
    // Hiding an overrun by clamping to the reservation would corrupt the ledger.
    const actualUsd = usd(
      Number.isFinite(providerCost) && providerCost >= 0 ? providerCost : calculated
    );
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const result = await db.query(`
        UPDATE studio.model_budget_reservations
        SET status = 'settled', actual_usd = $2,
            actual_input_tokens = $3, actual_output_tokens = $4, settled_at = now()
        WHERE id = $1 AND status = 'reserved'
        RETURNING reserved_usd
      `, [reservation.id, actualUsd, promptTokens, outputTokens]);
      if (result.rowCount) await refreshAccountFromLedger(db);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async function settleFailure(reservation) {
    if (!reservation?.id) return;
    await ensureSchema();
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const result = await db.query(`
        UPDATE studio.model_budget_reservations
        SET status = 'settled', actual_usd = reserved_usd, settled_at = now()
        WHERE id = $1 AND budget_key = $2 AND status = 'reserved'
        RETURNING reserved_usd
      `, [reservation.id, budgetKey]);
      if (result.rowCount) await refreshAccountFromLedger(db);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async function snapshot() {
    await ensureSchema();
    const result = await pool.query(`
      SELECT
        a.cap_usd,
        COALESCE(SUM(r.actual_usd) FILTER (WHERE r.status = 'settled'), 0) AS spent_usd,
        COALESCE(SUM(r.reserved_usd) FILTER (WHERE r.status = 'reserved'), 0) AS reserved_usd
      FROM studio.model_budget_accounts a
      LEFT JOIN studio.model_budget_reservations r ON r.budget_key = a.budget_key
      WHERE a.budget_key = $1
      GROUP BY a.cap_usd
    `, [budgetKey]);
    const row = result.rows[0];
    const capUsd = Number(row.cap_usd);
    const spentUsd = Number(row.spent_usd);
    const reservedUsd = Number(row.reserved_usd);
    return {
      capUsd,
      spentUsd,
      reservedUsd,
      remainingUsd: Math.max(0, capUsd - spentUsd - reservedUsd),
    };
  }

  return Object.freeze({ reserve, settle, settleFailure, snapshot, ensureSchema });
}
