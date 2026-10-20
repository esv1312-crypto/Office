export function extractEvidenceIndex(text) {
  const lines = String(text || "").split(/\r?\n/);

  // Accept an inline index row even when a model wraps the header in prose or
  // Markdown, but require pipe-delimited fields so incidental prose mentions
  // cannot satisfy the mandatory evidence-index check.
  const inlineStart = lines.findIndex(line => {
    const match = line.match(/EVIDENCE INDEX\s*:?\s*(.*)$/i);
    const row = String(match?.[1] || "").replace(/^\*\*\s*/, "").replace(/^(?:—|-)\s*/, "").trim();
    return (row.match(/\|/g) || []).length >= 3;
  });
  if (inlineStart >= 0) {
    const match = lines[inlineStart].match(/EVIDENCE INDEX\s*:?\s*(.*)$/i);
    const inlineEvidence = String(match?.[1] || "")
      .replace(/^\*\*\s*/, "")
      .replace(/^(?:—|-)\s*/, "")
      .trim();
    const followingEvidence = lines.slice(inlineStart + 1)
      .filter(line => line.trim())
      .map(line => line.trim());
    return [inlineEvidence, ...followingEvidence].slice(0, 80);
  }

  // For a multiline index, accept a standalone header, including common
  // Markdown heading/bullet/bold wrappers, then collect its non-empty rows.
  const headerPattern = /^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:\*\*)?EVIDENCE INDEX(?:\*\*)?\s*:?\s*$/i;
  const start = lines.findIndex(line => headerPattern.test(line));
  if (start < 0) return [];

  return lines.slice(start + 1)
    .filter(line => line.trim())
    .map(line => line.trim())
    .slice(0, 80);
}
