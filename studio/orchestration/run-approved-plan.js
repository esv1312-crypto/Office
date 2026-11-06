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
  dispatch, worker, qa, directory, createWorkerId,
}) {
  if (!dispatch || typeof dispatch.dispatch !== "function") throw new TypeError("Director dispatch is required");
  if (!worker || typeof worker.execute !== "function") throw new TypeError("Worker Runtime is required");
  if (!qa || typeof qa.review !== "function") throw new TypeError("QA Runtime is required");
  if (!directory || typeof directory.getTask !== "function" ||
      typeof directory.getSpecialist !== "function" ||
      typeof directory.listActiveSpecialists !== "function") {
    throw new TypeError("A task and specialist directory is required");
  }
  if (typeof createWorkerId !== "function") throw new TypeError("createWorkerId is required");

  return Object.freeze({
    async run({ planId, actor }) {
      const dispatchReport = await dispatch.dispatch({ planId, actor });
      const report = {
        planId, dispatch: dispatchReport, executions: [], qaReviews: [],
        blocked: [...dispatchReport.blocked],
      };

      for (const assignment of dispatchReport.assigned) {
        const task = await directory.getTask({ taskId: assignment.taskId });
        const specialist = await directory.getSpecialist({ specialistId: assignment.specialistId });
        if (!task || !specialist) {
          report.blocked.push({ taskId: assignment.taskId, code: "DISPATCH_DIRECTORY_LOOKUP_FAILED" });
          continue;
        }
        const workerResult = await worker.execute({
          taskId: task.id, specialist, workerId: createWorkerId(),
        });
        report.executions.push({
          taskId: task.id, executionId: workerResult.executionId,
          status: workerResult.status, errorCode: workerResult.errorCode || null,
        });
        if (workerResult.status !== "qa") continue;

        const qaTask = await directory.getTask({ taskId: task.id });
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
        const qaResult = await qa.review({
          task: qaTask, artifact, reviewer, actor,
        });
        report.qaReviews.push(qaResult);
      }

      const hasBlocked = report.blocked.length > 0;
      const hasFailures = report.executions.some(item => item.status === "failed");
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
