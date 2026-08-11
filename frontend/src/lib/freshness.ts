/** Shared clock formatting for market dashboard freshness labels. */

export function formatClock(
  at: Date | number | string | null | undefined,
  opts: { withSeconds?: boolean; refreshing?: boolean; empty?: string } = {},
): string {
  const { withSeconds = true, refreshing = false, empty = "—" } = opts;
  if (refreshing && (at == null || at === "")) return "更新中…";
  if (at == null || at === "") return empty;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return empty;
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  });
}

/** Relative age hint for scanability (e.g. "12s 前"). */
export function formatAge(at: Date | number | null | undefined, now: Date = new Date()): string | null {
  if (at == null) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const sec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (sec < 5) return "刚刚";
  if (sec < 60) return `${sec}s 前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m 前`;
  return formatClock(d, { withSeconds: false });
}
