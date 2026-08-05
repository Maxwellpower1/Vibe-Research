import { storageGet, storageSet } from "@/lib/storage";

export const ACCENT_IDS = ["orange", "amber", "blue", "teal", "rose", "slate", "black", "gold"] as const;
export type AccentId = (typeof ACCENT_IDS)[number];

export const ACCENTS: { id: AccentId; label: string; swatch: string }[] = [
  { id: "orange", label: "暖橙", swatch: "#F35D2B" },
  { id: "amber", label: "琥珀", swatch: "#F59E0B" },
  { id: "blue", label: "霁蓝", swatch: "#3B82F6" },
  { id: "teal", label: "青碧", swatch: "#14B8A6" },
  { id: "rose", label: "玫红", swatch: "#F43F5E" },
  { id: "slate", label: "钢青", swatch: "#64748B" },
  { id: "black", label: "墨黑", swatch: "#1A1A1A" },
  { id: "gold", label: "黑金", swatch: "#C9A227" },
];

const STORAGE_KEY = "vr-accent";

export function isAccentId(v: string | null | undefined): v is AccentId {
  return !!v && (ACCENT_IDS as readonly string[]).includes(v);
}

export function readAccent(): AccentId {
  const saved = storageGet(STORAGE_KEY);
  return isAccentId(saved) ? saved : "orange";
}

/** Apply accent class on <html> before paint when possible. */
export function applyAccent(id: AccentId) {
  document.documentElement.setAttribute("data-accent", id);
  storageSet(STORAGE_KEY, id);
}
