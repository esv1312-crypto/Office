/**
 * Run deterministic lease recovery before the one-shot owner-task claim.
 *
 * Recovery is maintenance only: this helper never dispatches work or calls a
 * model gateway. The caller remains responsible for the explicit owner-task
 * claim and for deciding whether execution may proceed.
 */
export async function recoverBeforeOwnerTaskClaim({
  recovery,
  actor,
  claim,
}) {
  if (!recovery || typeof recovery.recover !== "function") {
    throw new TypeError("An authorized execution recovery capability is required");
  }
  if (typeof claim !== "function") {
    throw new TypeError("An owner-task claim operation is required");
  }

  const recoveryReport = await recovery.recover({ actor, limit: 50 });
  const claimResult = await claim();
  return Object.freeze({
    recovery: recoveryReport,
    claim: claimResult,
    alreadyClaimed: !claimResult?.rowCount,
  });
}
