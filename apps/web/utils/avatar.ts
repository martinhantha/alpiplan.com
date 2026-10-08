const AVATAR_COLORS = ["#7c6cf0", "#e0805c", "#3fa58a", "#d4598f", "#4f8fd9", "#c9a03a", "#8b5fbf", "#4aa3b5"];

export function avatarInitials(name: string): string {
  const parts = name.replace(/^Ohne\s+/i, "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Chosen color if set, otherwise a stable palette color derived from the id. */
export function avatarColor(id: string, color?: string | null): string {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}
