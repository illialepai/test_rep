// Small DOM helpers. All text goes through textContent, never innerHTML.

/** h("div", { class: "x", onclick }, child, "text", [more]) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export const pct = (x) => `${Math.round(x * 100)}%`;

export function compatClass(label) {
  return "compat-" + label.toLowerCase().replace(/\s+/g, "-");
}

/** A 0–1 bar. Width is set through CSSOM, which the page's CSP allows. */
export function bar(value, cls = "") {
  const fill = h("span", { class: "bar-fill" });
  fill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  return h("span", { class: `bar ${cls}`, role: "presentation" }, fill);
}

export function codePointLabel(ch) {
  return "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
}
