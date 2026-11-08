import { randomUUID } from "node:crypto";

const DEFAULT_INPUT_USD_PER_MILLION = 0.30;
const DEFAULT_OUTPUT_USD_PER_MILLION = 1.20;

function usd(value) {
  return Number(Number(value).toFixed(9));
}

function estimateMaximumCost({ messages, maxTokens, inputUsdPerMillion, outputUsdPerMillion }) {
  const serialized = JSON.stringify(messages ?? []);
  // UTF-8 bytes are deliberately treated as two tokens each. This is a
  // conservative upper bound for multilingual prompts and avoids tokenizer drift.
  const estimatedInputTokens = Buffer.byteLength(serialized, "utf8") * 2;
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
}) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A PostgreSQL pool is required");
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new TypeError("capUsd must be positive");
  if (typeof budgetKey !== "string" || !budgetKey.trim()) throw new TypeError("budgetKey is required");

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

  async function reserve({ model, role, messages, maxTokens }) {
    await ensureSchema();
    const estimate = estimateMaximumCost({ messages, maxTokens, inputUsdPerMillion, outputUsdPerMillion });
    const reservationId = randomUUID();
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const account = await db.query(
        "SELECT cap_usd, spent_usd, reserved_usd FROM studio.model_budget_accounts WHERE budget_key = $1 FOR UPDATE",
        [budgetKey],
      );
      const row = account.rows[0];
      const cap = Number(row.cap_usd);
      const spent = Number(row.spent_usd);
      const reserved = Number(row.reserved_usd);
      if (spent + reserved + estimate.amountUsd > cap + 1e-9) {
        const error = Object.assign(new Error("The shared $2 model budget is exhausted"), {
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
      await db.query(`
        UPDATE studio.model_budget_accounts
        SET reserved_usd = reserved_usd + $2, updated_at = now()
        WHERE budget_key = $1
      `, [budgetKey, estimate.amountUsd]);
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
    // Never settle above the amount reserved before the request. The reserve
    // uses deliberately inflated token and price assumptions.
    const actualUsd = usd(Math.min(reservation.amountUsd,
      Number.isFinite(providerCost) && providerCost >= 0 ? providerCost : calculated));
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
      if (result.rowCount) {
        await db.query(`
          UPDATE studio.model_budget_accounts
          SET reserved_usd = GREATEST(0, reserved_usd - $2),
              spent_usd = spent_usd + $3, updated_at = now()
          WHERE budget_key = $1
        `, [budgetKey, result.rows[0].reserved_usd, actualUsd]);
      }
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
    const result = await pool.query(
      "SELECT cap_usd, spent_usd, reserved_usd FROM studio.model_budget_accounts WHERE budget_key = $1",
      [budgetKey],
    );
    const row = result.rows[0];
    return {
      capUsd: Number(row.cap_usd),
      spentUsd: Number(row.spent_usd),
      reservedUsd: Number(row.reserved_usd),
      remainingUsd: Math.max(0, Number(row.cap_usd) - Number(row.spent_usd) - Number(row.reserved_usd)),
    };
  }

  return Object.freeze({ reserve, settle, snapshot, ensureSchema });
}
