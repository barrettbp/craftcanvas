/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", or a short date. */
export function formatRelativeTime(value: string | Date | null | undefined, now: number = Date.now()): string {
  if (!value) return "never";
  const time = typeof value === "string" ? Date.parse(value) : value.getTime();
  if (Number.isNaN(time)) return "unknown";
  const diff = now - time;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  const date = new Date(time);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
