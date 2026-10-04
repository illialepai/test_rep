// Calls to the local machine server. The session token stops other websites from using it.
const token = document.querySelector('meta[name="machine-token"]')?.content ?? "";

export class ApiError extends Error {
  constructor(message, { status, field, code } = {}) {
    super(message);
    this.status = status;
    this.field = field;
    this.code = code;
  }
}

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Machine-Token": token },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError("The machine isn't running. Start it again with npm start.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(data.error?.message ?? `Request failed (${res.status}).`, { status: res.status, ...data.error });
  return data;
}

export const api = {
  async info() {
    const res = await fetch("/api/info");
    if (!res.ok) throw new ApiError("Could not reach the engine.");
    return res.json();
  },
  transform: (body) => post("/api/transform", body),
  open: (body) => post("/api/open", body),
  clipboard: (text) => post("/api/clipboard", { text }),
  quit: () => post("/api/quit", {}),
};
