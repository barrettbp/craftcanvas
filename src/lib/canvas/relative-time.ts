/** "just now", "3m ago", "2h ago", "5d ago", or a short date for older values. */
export function relativeTime(input: string | number | Date, now: number = Date.now()): string {
  const date = input instanceof Date ? input : new Date(input);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return "";
  const diff = Math.max(0, now - ms);
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const sameYear = new Date(now).getFullYear() === date.getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}
