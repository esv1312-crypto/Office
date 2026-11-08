import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresModelBudget } from "./postgres-model-budget.js";

function fakePool({ capUsd = 1, staleCounters = false } = {}) {
  const account = {
    cap_usd: capUsd,
    spent_usd: staleCounters ? 0.9 : 0,
    reserved_usd: staleCounters ? 0.9 : 0,
  };
  const reservations = [];
  function ledger() {
    return {
      spent_usd: reservations
        .filter(item => item.status === "settled")
        .reduce((sum, item) => sum + Number(item.actual_usd || 0), 0),
      reserved_usd: reservations
        .filter(item => item.status === "reserved")
        .reduce((sum, item) => sum + Number(item.reserved_usd || 0), 0),
    };
  }
  async function query(sql, params = []) {
    if (sql.includes("LEFT JOIN studio.model_budget_reservations")) {
      return { rows: [{ cap_usd: account.cap_usd, ...ledger() }] };
    }
    if (sql.includes("CREATE TABLE")) return { rows: [] };
    if (sql.includes("INSERT INTO studio.model_budget_accounts")) {
      account.cap_usd = Math.min(account.cap_usd, Number(params[1]));
      return { rows: [] };
    }
    throw new Error("Unexpected pool query: " + sql);
  }
  return {
    reservations,
    account,
    async query(sql, params) { return query(sql, params); },
    async connect() {
      return {
        async query(sql, params = []) {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
          if (sql.includes("SELECT cap_usd FROM studio.model_budget_accounts")) {
            return { rows: [{ cap_usd: account.cap_usd }] };
          }
          if (sql.includes("UPDATE studio.model_budget_reservations") &&
              sql.includes("actual_usd = reserved_usd") && sql.includes("created_at <")) {
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes("SELECT") && sql.includes("SUM(actual_usd) FILTER")) {
            return { rows: [ledger()] };
          }
          if (sql.includes("INSERT INTO studio.model_budget_reservations")) {
            reservations.push({
              id: params[0], budget_key: params[1], model: params[2], role: params[3],
              reserved_usd: Number(params[4]), actual_usd: null, status: "reserved",
            });
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("UPDATE studio.model_budget_accounts") && sql.includes("SET spent_usd = $2")) {
            account.spent_usd = Number(params[1]);
            account.reserved_usd = Number(params[2]);
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("UPDATE studio.model_budget_reservations") &&
              sql.includes("actual_input_tokens = $3")) {
            const row = reservations.find(item => item.id === params[0] && item.status === "reserved");
            if (!row) return { rowCount: 0, rows: [] };
            row.status = "settled";
            row.actual_usd = Number(params[1]);
            return { rowCount: 1, rows: [{ reserved_usd: row.reserved_usd }] };
          }
          if (sql.includes("UPDATE studio.model_budget_reservations") &&
              sql.includes("actual_usd = reserved_usd") && sql.includes("WHERE id = $1")) {
            const row = reservations.find(item => item.id === params[0] &&
              item.budget_key === params[1] && item.status === "reserved");
            if (!row) return { rowCount: 0, rows: [] };
            row.status = "settled";
            row.actual_usd = row.reserved_usd;
            return { rowCount: 1, rows: [{ reserved_usd: row.reserved_usd }] };
          }
          throw new Error("Unexpected client query: " + sql);
        },
        release() {},
      };
    },
  };
}

test("budget snapshot trusts the reservation ledger rather than drifted account counters", async () => {
  const pool = fakePool({ staleCounters: true });
  pool.reservations.push({
    id: "prior", budget_key: "test", status: "settled",
    reserved_usd: 0.3, actual_usd: 0.07,
  });
  const budget = createPostgresModelBudget({ pool, capUsd: 1, budgetKey: "test" });
  const snapshot = await budget.snapshot();
  assert.equal(snapshot.spentUsd, 0.07);
  assert.equal(snapshot.reservedUsd, 0);
  assert.equal(snapshot.remainingUsd, 0.93);
});

test("budget ledger records actual provider cost even when it exceeds the estimate", async () => {
  const pool = fakePool();
  const budget = createPostgresModelBudget({ pool, capUsd: 1, budgetKey: "test" });
  const reservation = await budget.reserve({
    model: "deepseek/flash", role: "worker",
    messages: [{ role: "user", content: "small task" }], maxTokens: 8,
  });
  await budget.settle(reservation, { usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.4 } });
  const snapshot = await budget.snapshot();
  assert.equal(snapshot.spentUsd, 0.4);
  assert.equal(snapshot.reservedUsd, 0);
  assert.equal(snapshot.remainingUsd, 0.6);
});

test("failed requests are conservatively settled at their reservation instead of leaking pending budget", async () => {
  const pool = fakePool();
  const budget = createPostgresModelBudget({ pool, capUsd: 1, budgetKey: "test" });
  const reservation = await budget.reserve({
    model: "deepseek/flash", role: "worker",
    messages: [{ role: "user", content: "small task" }], maxTokens: 8,
  });
  await budget.settleFailure(reservation);
  const snapshot = await budget.snapshot();
  assert.equal(snapshot.spentUsd, reservation.amountUsd);
  assert.equal(snapshot.reservedUsd, 0);
});
