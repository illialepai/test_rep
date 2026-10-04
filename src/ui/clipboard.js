/**
 * Copies text, trying in order: the async Clipboard API, a hidden-textarea copy, and the local server's
 * OS clipboard command. Returns { copied, method }.
 */
export async function copyText(text, serverCopy) {
  try {
    await navigator.clipboard.writeText(text);
    return { copied: true, method: "clipboard" };
  } catch {
    // Not permitted here (no focus, insecure context, old engine); try the next way.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "offscreen";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (ok) return { copied: true, method: "execCommand" };
  } catch {
    // fall through
  }
  if (serverCopy) {
    try {
      const result = await serverCopy(text);
      if (result.copied) return { copied: true, method: result.method };
    } catch {
      // fall through
    }
  }
  return { copied: false, method: null };
}
