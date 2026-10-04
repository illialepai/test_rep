/**
 * Copies text exactly as given. The async Clipboard API needs a secure
 * context (https or localhost), so there is a fallback for plain http or
 * older browsers using a hidden textarea and execCommand("copy").
 * Resolves true on success and false on failure, and never throws.
 */
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or document not focused, so try the fallback.
    }
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
