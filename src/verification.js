const VALID_CLASSIFICATIONS = new Set(["FACT", "INFERENCE", "ASSUMPTION", "UNPROVEN"]);

export function enforceVerificationEvidence(verification, checklist = []) {
  if (!verification || !["PASS", "FAIL"].includes(verification.status) || !Array.isArray(verification.checks)) {
    return null;
  }

  const checks = verification.checks.map((check, index) => {
    const source = String(check?.source ?? "").trim();
    const locator = String(check?.locator ?? "").trim();
    const evidence = String(check?.evidence ?? "").trim();
    const classification = String(check?.classification ?? "").trim().toUpperCase();
    const classificationValid = VALID_CLASSIFICATIONS.has(classification);
    const evidenceComplete = Boolean(source && locator && evidence && classificationValid);
    const safeToPass = check?.passed === true
      && evidenceComplete
      && (classification === "FACT" || classification === "INFERENCE");

    let reason = "";
    if (!source) reason = "Missing source.";
    else if (!locator) reason = "Missing locator.";
    else if (!evidence) reason = "Missing evidence.";
    else if (!classificationValid) reason = "Missing or invalid evidence classification.";
    else if (classification === "ASSUMPTION" || classification === "UNPROVEN") reason = "Evidence is not established fact or supported inference.";

    return {
      ...check,
      name: String(check?.name || "Unnamed check " + (index + 1)),
      passed: safeToPass,
      source: source || "UNPROVEN",
      locator: locator || "UNPROVEN",
      evidence: reason ? [evidence, reason].filter(Boolean).join(" ") : evidence,
      classification: classificationValid ? classification : "UNPROVEN"
    };
  });

  const requiredCount = Array.isArray(checklist) ? checklist.length : 0;
  if (checks.length < requiredCount) {
    checks.push({
      name: "Checklist coverage",
      passed: false,
      source: "verification input",
      locator: "verifyRootTask()",
      evidence: "Verifier returned " + checks.length + " checks for " + requiredCount + " checklist items; coverage is incomplete.",
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
