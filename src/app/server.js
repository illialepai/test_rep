/**
 * Local HTTP server for the desktop window. Listens on 127.0.0.1 only and exposes the Username
 * Transformation Engine plus two browser-assistance actions (open TikTok, copy to clipboard).
 *
 * It never handles TikTok credentials: there is no login, cookie, token or TikTok API call anywhere.
 * The per-launch token below only stops other websites in the same browser from calling this server.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { InputError, LIMITS } from "../engine/engine.js";
import { PLATFORM_RULES } from "../engine/scoring.js";
import { submissionUrl } from "./tiktok.js";
import { system as defaultSystem } from "./system.js";

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");
const MAX_BODY = 16 * 1024;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function send(res, status, body, type = TYPES[".json"]) {
  res.writeHead(status, { "Content-Type": type, ...SECURITY_HEADERS });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "Expected application/json.");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Malformed JSON.");
  }
}

/**
 * @param {object} options
 * @param {import("../engine/engine.js").UsernameTransformationEngine} options.engine
 * @param {{openExternal: Function, copyText: Function}} [options.system]  OS actions (mocked in tests)
 * @param {string} [options.token]
 * @param {Function} [options.onQuit]
 */
export function createMachineServer({ engine, system = defaultSystem, token = randomBytes(24).toString("hex"), onQuit = () => {} }) {
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (error instanceof InputError) return send(res, 400, { error: { message: error.message, field: error.field, code: error.code } });
      if (error instanceof HttpError) return send(res, error.status, { error: { message: error.message, ...error.extra } });
      console.error(error);
      send(res, 500, { error: { message: "Internal error. See the terminal for details." } });
    });
  });

  function ownOrigins() {
    const { port } = server.address();
    return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  }

  async function handle(req, res) {
    // DNS-rebinding guard: only answer requests addressed to this machine by name.
    const hosts = ownOrigins();
    if (!hosts.includes(req.headers.host)) throw new HttpError(403, "Unexpected Host header.");
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (req.method === "GET" || req.method === "HEAD") {
      if (path === "/" || path === "/index.html") {
        const html = await readFile(join(UI_DIR, "index.html"), "utf8");
        return send(res, 200, html.replace("%%MACHINE_TOKEN%%", token), TYPES[".html"]);
      }
      if (path === "/api/info") return send(res, 200, info());
      if (path.startsWith("/ui/")) return serveStatic(res, path.slice(4));
      throw new HttpError(404, "Not found.");
    }

    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const origin = req.headers.origin;
    if (origin && !hosts.map((h) => `http://${h}`).includes(origin)) throw new HttpError(403, "Cross-origin request refused.");
    if (req.headers["x-machine-token"] !== token) throw new HttpError(403, "Missing or wrong session token.");
    const body = await readJson(req);

    switch (path) {
      case "/api/transform":
        return send(res, 200, engine.transform(body.desired, { existing: body.existing, count: body.count, depth: body.depth }));
      case "/api/analyze":
        return send(res, 200, engine.analyze(body.desired));
      case "/api/open": {
        const purpose = body.purpose === "verify" ? "verify" : "edit";
        const existing = body.existing ? engine.validateExisting(body.existing).value : "";
        let username = "";
        if (purpose === "verify") username = engine.validateDesired(body.username).value;
        const target = submissionUrl({ purpose, existing, username });
        const result = await system.openExternal(target);
        return send(res, 200, { url: target, opened: result.opened, error: result.error ?? null });
      }
      case "/api/clipboard": {
        if (typeof body.text !== "string" || !body.text || body.text.length > 20000) throw new HttpError(400, "Nothing to copy.");
        return send(res, 200, await system.copyText(body.text));
      }
      case "/api/quit":
        send(res, 200, { ok: true });
        setImmediate(onQuit);
        return;
      default:
        throw new HttpError(404, "Not found.");
    }
  }

  async function serveStatic(res, rel) {
    const file = normalize(join(UI_DIR, rel));
    if (!file.startsWith(UI_DIR + sep) || !TYPES[extname(file)]) throw new HttpError(404, "Not found.");
    try {
      return send(res, 200, await readFile(file), TYPES[extname(file)]);
    } catch {
      throw new HttpError(404, "Not found.");
    }
  }

  function info() {
    return {
      app: "Username Transformation Machine",
      engine: engine.stats(),
      limits: { maxDesiredLength: LIMITS.maxDesiredLength, maxDepth: LIMITS.maxDepth, defaultCount: LIMITS.defaultCount },
      platformRules: { minLength: PLATFORM_RULES.minLength, maxLength: PLATFORM_RULES.maxLength, characters: "a–z, 0–9, _ and ." },
    };
  }

  server.machine = { token };
  return server;
}
