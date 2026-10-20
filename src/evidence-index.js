export function extractEvidenceIndex(text) {
  const lines = String(text || "").split(/\r?\n/);
  // Match an actual header, not incidental prose that merely mentions the phrase.
  const start = lines.findIndex(line => /^\s*(?:[-*]\s*)?(?:\*\*)?EVIDENCE INDEX(?:\*\*)?\s*:?\s*/i.test(line));
  if (start < 0) return [];

  const match = lines[start].match(/^\s*(?:[-*]\s*)?(?:\*\*)?EVIDENCE INDEX(?:\*\*)?\s*:?\s*(.*)$/i);
  const inlineEvidence = String(match?.[1] || "").trim();
  const followingEvidence = lines.slice(start + 1)
    .filter(line => line.trim())
    .map(line => line.trim());

  return [...(inlineEvidence ? [inlineEvidence] : []), ...followingEvidence].slice(0, 80);
}
