export function fmtBytes(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDate(s: string | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], "style">> & {
    class?: string;
    style?: string;
  } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, style, ...rest } = props as Record<string, unknown>;
  if (className) node.className = className as string;
  if (style) node.setAttribute("style", style as string);
  Object.assign(node, rest);
  for (const c of children) {
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

/**
 * Resolve a possibly-relative URL the camera reports (preview_url / upf_url)
 * against the WebSocket URL so links work regardless of how they're returned.
 */
export function resolveCameraUrl(
  raw: string | undefined,
  wsUrl: string | null
): string | undefined {
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!wsUrl) return raw;
  const httpBase = wsUrl.replace(/^ws/i, "http");
  try {
    return new URL(raw, httpBase).toString();
  } catch {
    return raw;
  }
}
