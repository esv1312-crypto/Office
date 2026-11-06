/**
 * Coordinates the approved-plan vertical slice:
 * dispatch -> Worker execution -> independent QA.
 *
 * All gateways, durable stores, and authorization remain injected. This
 * coordinator does not connect to infrastructure or create model calls itself.
 */
function eligibleReviewer(candidate, task, producerId) {
  return candidate.id !== producerId &&
    candidate.status === "active" &&
    candidate.organizationId === task.organizationId &&
    (candidate.competencies || []).includes("qa.review") &&
    (!candidate.projectIds?.length || candidate.projectIds.includes(task.projectId));
}

export function createPlanExecutionWorkflow({
  dispatch, workerPool, qa, directory,
}) {
  if (!dispatch || typeof dispatch.dispatch !== "function") throw new TypeError("Director dispatch is required");
  if (!workerPool || typeof workerPool.executeAssignments !== "function") throw new TypeError("Worker Pool is required");
  if (!qa || typeof qa.review !== "function") throw new TypeError("QA Runtime is required");
  if (!directory || typeof directory.getTask !== "function" ||
      typeof directory.getSpecialist !== "function" ||
      typeof directory.getLatestArtifactForTask !== "function" ||
      typeof directory.listActiveSpecialists !== "function") {
    throw new TypeError("A task, artifact, and specialist directory is required");
  }

  return Object.freeze({
    async run({ planId, actor }) {
      const dispatchReport = await dispatch.dispatch({ planId, actor });
      const report = {
        planId, dispatch: dispatchReport, executions: [], qaReviews: [],
        blocked: [...dispatchReport.blocked],
      };

      const workerResults = await workerPool.executeAssignments(dispatchReport.assigned);
      for (const workerResult of workerResults) {
        report.executions.push({
          taskId: workerResult.taskId, executionId: workerResult.executionId,
          status: workerResult.status, errorCode: workerResult.errorCode || null,
        });
        if (workerResult.status !== "qa") {
          if (workerResult.status !== "qa") {
            report.blocked.push({
              taskId: workerResult.taskId, code: workerResult.errorCode || "WORKER_FAILED",
              reason: workerResult.error || "Worker execution failed",
            });
          }
          continue;
        }

        const task = await directory.getTask({ taskId: workerResult.taskId });
        const specialist = await directory.getSpecialist({ specialistId: workerResult.specialistId });
        if (!task || !specialist) {
          report.blocked.push({ taskId: workerResult.taskId, code: "QA_DIRECTORY_LOOKUP_FAILED" });
          continue;
        }
        const specialists = await directory.listActiveSpecialists({ organizationId: task.organizationId });
        const reviewer = specialists
          .filter(candidate => eligibleReviewer(candidate, task, specialist.id))
          .sort((a, b) => a.id.localeCompare(b.id))[0];
        if (!reviewer) {
          report.blocked.push({
            taskId: task.id, code: "QA_REVIEWER_UNAVAILABLE",
            reason: "No independent active QA specialist with project access and qa.review competency",
          });
          continue;
        }
        const artifact = {
          id: workerResult.artifactId,
          type: "text",
          name: `${task.title} — результат работы`,
          content: workerResult.output,
          specialistId: specialist.id,
        };
        const qaResult = await qa.review({ task, artifact, reviewer, actor });
        report.qaReviews.push(qaResult);
      }

      // Resume QA hand-offs left by a previous interrupted workflow run.
      for (const skipped of dispatchReport.skipped.filter(item => item.status === "qa")) {
        const task = await directory.getTask({ taskId: skipped.taskId });
        if (!task || task.status !== "qa") continue;
        const artifact = await directory.getLatestArtifactForTask({ taskId: task.id });
        if (!artifact) {
          report.blocked.push({ taskId: task.id, code: "QA_ARTIFACT_MISSING",
            reason: "Task is awaiting QA but has no persisted artifact" });
          continue;
        }
        const specialist = await directory.getSpecialist({ specialistId: task.assigneeSpecialistId });
        if (!specialist) {
          report.blocked.push({ taskId: task.id, code: "QA_PRODUCER_LOOKUP_FAILED" });
          continue;
        }
        const specialists = await directory.listActiveSpecialists({ organizationId: task.organizationId });
        const reviewer = specialists
          .filter(candidate => eligibleReviewer(candidate, task, specialist.id))
          .sort((a, b) => a.id.localeCompare(b.id))[0];
        if (!reviewer) {
          report.blocked.push({ taskId: task.id, code: "QA_REVIEWER_UNAVAILABLE",
            reason: "No independent active QA specialist with project access and qa.review competency" });
          continue;
        }
        const qaResult = await qa.review({ task, artifact, reviewer, actor });
        report.qaReviews.push(qaResult);
      }

      const hasBlocked = report.blocked.length > 0;
      const hasFailures = report.executions.some(item => item.status !== "qa");
      const hasRevisions = report.qaReviews.some(item => item.verdict === "revision_required");
      const allAssignedProcessed = report.executions.length === dispatchReport.assigned.length;
      report.status = hasBlocked || hasFailures || hasRevisions || !allAssignedProcessed
        ? "needs_attention"
        : dispatchReport.status === "blocked" || dispatchReport.status === "partially_dispatched"
          ? "partially_completed"
          : "completed";
      return report;
    },
  });
}
