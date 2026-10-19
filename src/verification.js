const VALID_CLASSIFICATIONS = new Set(["FACT", "INFERENCE", "ASSUMPTION", "UNPROVEN"]);

function normalizeRequirement(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function enforceVerificationEvidence(verification, checklist = []) {
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
    const safeToPass = check?.passed === true
      && evidenceComplete
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

    return {
      ...check,
      name: String(check?.name || "Unnamed check " + (index + 1)),
      requirement: matchedRequirement || requirement || "UNASSIGNED",
      passed: safeToPass,
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
