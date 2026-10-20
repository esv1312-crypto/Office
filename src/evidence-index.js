export function extractEvidenceIndex(text) {
  const lines = String(text || "").split(/\r?\n/);
  const start = lines.findIndex(line => /EVIDENCE INDEX/i.test(line));
  if (start < 0) return [];

  const match = lines[start].match(/EVIDENCE INDEX\s*:?\s*(.*)$/i);
  const inlineEvidence = String(match?.[1] || "").trim();
  const followingEvidence = lines.slice(start + 1)
    .filter(line => line.trim())
    .map(line => line.trim());

  return [...(inlineEvidence ? [inlineEvidence] : []), ...followingEvidence].slice(0, 80);
}
