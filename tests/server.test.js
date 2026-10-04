import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { getEngine } from "../src/engine/engine.js";
import { createMachineServer } from "../src/app/server.js";

const opened = [];
const copied = [];
const fakeSystem = {
  async openExternal(url) {
    opened.push(url);
    return { opened: true };
  },
  async copyText(text) {
    copied.push(text);
    return { copied: true, method: "fake" };
  },
};
let quitCalls = 0;
const server = createMachineServer({
  engine: getEngine(),
  system: fakeSystem,
  token: "test-token",
  onQuit: () => quitCalls++,
});
let port;

before(() => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((port = server.address().port)))));
after(() => new Promise((resolve) => server.close(resolve)));

function call(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...(data !== undefined
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on("error", reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

const post = (path, body, headers = {}) =>
  call("POST", path, { body, headers: { "X-Machine-Token": "test-token", ...headers } });

test("serves the UI with the session token and a strict CSP", async () => {
  const r = await call("GET", "/");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.match(r.text, /<meta name="machine-token" content="test-token"/);
  assert.match(r.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  for (const asset of ["/ui/app.js", "/ui/styles.css", "/ui/icon.svg"])
    assert.equal((await call("GET", asset)).status, 200, asset);
});

test("static files cannot escape the UI folder", async () => {
  for (const path of ["/ui/../engine/engine.js", "/ui/%2e%2e/%2e%2e/package.json", "/ui/missing.js", "/package.json"]) {
    assert.equal((await call("GET", path)).status, 404, path);
  }
});

test("info reports the engine database", async () => {
  const r = await call("GET", "/api/info");
  assert.equal(r.status, 200);
  assert.equal(r.json.engine.unicodeVersion, "16.0.0");
  assert.ok(r.json.engine.variantEntries > 9000);
});

test("transform returns ranked candidates", async () => {
  const r = await post("/api/transform", { desired: "alex", existing: "old.name", count: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.json.desired, "alex");
  assert.equal(r.json.existing, "old.name");
  assert.equal(r.json.candidates.length, 5);
  assert.equal(r.json.candidates[0].rank, 1);
  assert.ok(r.json.analysis.characters.length === 4);
});

test("transform validation errors are 400 with the field", async () => {
  const r = await post("/api/transform", { desired: "" });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.field, "desired");
  assert.match(r.json.error.message, /Enter the username/);
  const r2 = await post("/api/transform", { desired: "ok", existing: "bad name" });
  assert.equal(r2.status, 400);
  assert.equal(r2.json.error.field, "existing");
});

test("POST requires the session token", async () => {
  const r = await call("POST", "/api/transform", { body: { desired: "alex" } });
  assert.equal(r.status, 403);
  const r2 = await post("/api/transform", { desired: "alex" }, { "X-Machine-Token": "wrong" });
  assert.equal(r2.status, 403);
});

test("cross-origin requests and foreign Host headers are refused", async () => {
  const r = await post("/api/transform", { desired: "alex" }, { Origin: "https://evil.example" });
  assert.equal(r.status, 403);
  const r2 = await call("GET", "/api/info", { headers: { Host: "evil.example" } });
  assert.equal(r2.status, 403);
  const ok = await post("/api/transform", { desired: "alex" }, { Origin: `http://127.0.0.1:${port}` });
  assert.equal(ok.status, 200);
});

test("POST bodies must be JSON objects of limited size", async () => {
  assert.equal(
    (
      await call("POST", "/api/transform", {
        body: "desired=alex",
        headers: { "X-Machine-Token": "test-token", "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.equal((await post("/api/transform", "{not json")).status, 400);
  assert.equal((await post("/api/transform", "[1,2]")).status, 400);
  assert.equal((await post("/api/transform", { desired: "a".repeat(20000) })).status, 413);
});

test("open builds the TikTok URL on the server", async () => {
  opened.length = 0;
  let r = await post("/api/open", { purpose: "edit", existing: "@old.name" });
  assert.equal(r.status, 200);
  assert.equal(r.json.url, "https://www.tiktok.com/@old.name");
  assert.equal(r.json.opened, true);
  r = await post("/api/open", { purpose: "edit" });
  assert.equal(r.json.url, "https://www.tiktok.com/");
  r = await post("/api/open", { purpose: "verify", username: "аlex" });
  assert.equal(r.json.url, "https://www.tiktok.com/@%D0%B0lex");
  // A URL supplied by the page is ignored: only usernames are accepted.
  r = await post("/api/open", { purpose: "edit", url: "https://evil.example/" });
  assert.equal(r.json.url, "https://www.tiktok.com/");
  assert.deepEqual(opened, [
    "https://www.tiktok.com/@old.name",
    "https://www.tiktok.com/",
    "https://www.tiktok.com/@%D0%B0lex",
    "https://www.tiktok.com/",
  ]);
  r = await post("/api/open", { purpose: "edit", existing: "../../evil" });
  assert.equal(r.json.url, "https://www.tiktok.com/@..%2F..%2Fevil");
});

test("clipboard fallback copies through the system helper", async () => {
  const r = await post("/api/clipboard", { text: "аlex" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { copied: true, method: "fake" });
  assert.equal(copied.at(-1), "аlex");
  assert.equal((await post("/api/clipboard", { text: "" })).status, 400);
});

test("quit calls the shutdown hook", async () => {
  const r = await post("/api/quit", {});
  assert.equal(r.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quitCalls, 1);
});

test("unknown routes and methods", async () => {
  assert.equal((await call("GET", "/api/nope")).status, 404);
  assert.equal((await post("/api/nope", {})).status, 404);
  assert.equal((await call("PUT", "/api/transform")).status, 405);
});

test("never asks for or accepts credentials", async () => {
  const html = (await call("GET", "/")).text;
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(
    inputs.map((tag) => tag.match(/id="([^"]+)"/)[1]),
    ["existing", "desired", "show-codepoints"],
    "the only inputs are the two usernames and a display toggle",
  );
  assert.ok(inputs.every((tag) => !/type="password"/.test(tag)));
});
