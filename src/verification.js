import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const VALID_CLASSIFICATIONS = new Set(["FACT", "INFERENCE", "ASSUMPTION", "UNPROVEN"]);

function normalizeReference(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function readLocalSource(source, repoRoot = process.cwd()) {
  const pathText=String(source || "").replace(/\\/g,"/");
  const allowed=/^(src|test|docs|\.github)\//i.test(pathText) || /^(README(?:\.[^/]+)?|package\.json|render\.yaml)$/i.test(pathText);
  if(!allowed) return { recognized:false, content:"" };
  const root=resolve(repoRoot);
  const target=resolve(root,pathText);
  const rel=relative(root,target);
  if(rel.startsWith("..") || isAbsolute(rel) || !existsSync(target)) return { recognized:true, content:"" };
  try { return { recognized:true, content:readFileSync(target,"utf8") }; }
  catch { return { recognized:true, content:"" }; }
}

function referenceIsGrounded(check, context = {}) {
  const source=String(check?.source || "").trim();
  const locator=String(check?.locator || "").trim();
  const locatorKey=normalizeReference(locator);
  if(!source || !locator || !locatorKey || /^n\/?a$/i.test(locator)) return false;

  const local=readLocalSource(source,context.repoRoot);
  if(local.recognized) {
    return Boolean(local.content) && normalizeReference(local.content).includes(locatorKey);
  }

  const workerResults=Array.isArray(context.workerResults)?context.workerResults:[];
  const eventEvidence=Array.isArray(context.eventEvidence)?context.eventEvidence:[];
  const corpus=normalizeReference(JSON.stringify({
    workerResults,
    eventEvidence,
    finalResult:String(context.finalResult || "")
  }));
  const sourceKey=normalizeReference(source);

  if(/^https?:\/\//i.test(source)) {
    return Boolean(sourceKey && corpus.includes(sourceKey) && corpus.includes(locatorKey));
  }

  if(/runtime|event|gateway|preflight|browser|worker|provider|postgres|database/i.test(source)) {
    const eventMatch=eventEvidence.some(event=>{
      const typeKey=normalizeReference(event?.type || "");
      const serialized=normalizeReference(JSON.stringify(event));
      return Boolean(typeKey && locatorKey.includes(typeKey)) || Boolean(locatorKey && serialized.includes(locatorKey));
    });
    const workerMatch=workerResults.some(worker=>normalizeReference(JSON.stringify(worker)).includes(locatorKey));
    return eventMatch || workerMatch;
  }

  return false;
}

function detectRuntimeContradiction(check, context = {}) {
  const claimText = [
    check?.name || "",
    check?.requirement || "",
    check?.evidence || "",
    check?.source || "",
    check?.locator || ""
  ].join(" ");
  const claimsSuccess = /\b(completed|complete|passed|pass|succeeded|success|successful|finished|verified)\b/i.test(claimText);
  if (!claimsSuccess) return "";

  const workerResults = Array.isArray(context.workerResults) ? context.workerResults : [];
  const eventEvidence = Array.isArray(context.eventEvidence) ? context.eventEvidence : [];
  const taskIds = [...new Set(claimText.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi) || [])];

  for (const taskId of taskIds) {
    const snapshot = workerResults.find(item => String(item?.taskId || "").toLowerCase() === taskId.toLowerCase());
    let status = snapshot?.status ? String(snapshot.status).toLowerCase() : "";
    if (!status) {
      const matchingEvents = eventEvidence
        .filter(event => String(event?.taskId || "").toLowerCase() === taskId.toLowerCase())
        .slice()
        .sort((a, b) => Date.parse(a?.ts || a?.createdAt || 0) - Date.parse(b?.ts || b?.createdAt || 0));
      for (const event of matchingEvents) {
        if (event?.type === "task.state_changed" && event?.status) status = String(event.status).toLowerCase();
        else if (event?.type === "task.completed") status = "completed";
        else if (event?.type === "task.failed") status = "failed";
        else if (event?.type === "task.cancelled") status = "cancelled";
      }
    }
    if (status && status !== "completed") {
      return "Claim conflicts with authoritative runtime status for task " + taskId + ": " + status + ".";
    }
  }

  const claimsAllWorkersSucceeded = /\b(all|every|each)\b.{0,45}\b(workers?|subtasks?|roles?)\b.{0,60}\b(completed|finished|succeeded|passed)\b/i.test(claimText);
  if (claimsAllWorkersSucceeded && workerResults.length) {
    const recoveredTaskIds = new Set(workerResults
      .filter(item => String(item?.status || "").toLowerCase() === "completed" && item?.replacesTaskId)
      .map(item => String(item.replacesTaskId)));
    const unresolved = workerResults.find(item =>
      String(item?.status || "").toLowerCase() !== "completed" &&
      !recoveredTaskIds.has(String(item?.taskId || ""))
    );
    if (unresolved) {
      return "Claim that all workers completed conflicts with worker result " +
        String(unresolved.taskId || "without task ID") + " in status " +
        String(unresolved.status || "unknown") + ".";
    }
  }
  return "";
}

function normalizeRequirement(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function enforceVerificationEvidence(verification, checklist = [], evidenceContext = {}) {
  if (!verification || !["PASS", "FAIL"].includes(verification.status) || !Array.isArray(verification.checks)) {
    return null;
  }

  const requiredItems = [...new Map(
    (Array.isArray(checklist) ? checklist : [])
      .map(item => String(item ?? "").trim())
      .filter(Boolean)
      .map(item => [normalizeRequirement(item), item])
  ).values()];
  const requiredByKey = new Map(requiredItems.map(item => [normalizeRequirement(item), item]));
  const covered = new Set();

  const checks = verification.checks.map((check, index) => {
    const source = String(check?.source ?? "").trim();
    const locator = String(check?.locator ?? "").trim();
    const evidence = String(check?.evidence ?? "").trim();
    const classification = String(check?.classification ?? "").trim().toUpperCase();
    const requirement = String(check?.requirement ?? "").trim();
    const requirementKey = normalizeRequirement(requirement);
    const matchedRequirement = requiredByKey.get(requirementKey);
    const duplicateCoverage = Boolean(matchedRequirement && covered.has(requirementKey));
    const coverageValid = requiredItems.length === 0 || Boolean(matchedRequirement && !duplicateCoverage);
    if (matchedRequirement && !duplicateCoverage) covered.add(requirementKey);

    const classificationValid = VALID_CLASSIFICATIONS.has(classification);
    const evidenceComplete = Boolean(source && locator && evidence && classificationValid);
    const referenceGrounded = evidenceComplete && referenceIsGrounded(check,evidenceContext);
    const runtimeContradiction = detectRuntimeContradiction(check,evidenceContext);
    const safeToPass = check?.passed === true
      && evidenceComplete
      && referenceGrounded
      && !runtimeContradiction
      && coverageValid
      && (classification === "FACT" || classification === "INFERENCE");

    let reason = "";
    if (!source) reason = "Missing source.";
    else if (!locator) reason = "Missing locator.";
    else if (!evidence) reason = "Missing evidence.";
    else if (!classificationValid) reason = "Missing or invalid evidence classification.";
    else if (classification === "ASSUMPTION" || classification === "UNPROVEN") reason = "Evidence is not established fact or supported inference.";
    else if (requiredItems.length > 0 && !requirement) reason = "Missing checklist requirement mapping.";
    else if (requiredItems.length > 0 && !matchedRequirement) reason = "Check does not map to a required checklist item.";
    else if (duplicateCoverage) reason = "Duplicate coverage for checklist item: " + matchedRequirement + ".";
    else if (!referenceGrounded) reason = "Source/locator does not match supplied code or runtime evidence.";
    else if (runtimeContradiction) reason = runtimeContradiction;

    return {
      ...check,
      name: String(check?.name || "Unnamed check " + (index + 1)),
      requirement: matchedRequirement || requirement || "UNASSIGNED",
      passed: safeToPass,
      referenceGrounded,
      source: source || "UNPROVEN",
      locator: locator || "UNPROVEN",
      evidence: reason ? [evidence, reason].filter(Boolean).join(" ") : evidence,
      classification: classificationValid ? classification : "UNPROVEN"
    };
  });

  for (const item of requiredItems) {
    if (covered.has(normalizeRequirement(item))) continue;
    checks.push({
      name: "Checklist coverage",
      requirement: item,
      passed: false,
      source: "verification input",
      locator: "enforceVerificationEvidence()",
      evidence: "No unique verifier check covers required checklist item: " + item,
      classification: "UNPROVEN"
    });
  }

  const allChecksPassed = checks.length > 0 && checks.every(check => check.passed === true);
  const status = verification.status === "PASS" && allChecksPassed ? "PASS" : "FAIL";
  const warnings = checks.filter(check => !check.passed).map(check => check.name);
  const summary = String(verification.summary || "");
  return {
    ...verification,
    status,
    checks,
    summary: warnings.length
      ? [summary, "Evidence validation failed for: " + warnings.join(", ") + "."].filter(Boolean).join(" ")
      : summary
  };
}
