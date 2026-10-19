export function boundedIntegerSetting(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}
