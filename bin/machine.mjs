#!/usr/bin/env node
/**
 * Desktop launcher for the Username Transformation Machine.
 *
 *   npm start                  open the machine in its own window (Chrome / Edge / Chromium / Brave app mode)
 *   npm start -- --browser-tab open it as a tab in the default browser instead
 *   npm start -- --no-window   only start the local server and print its address
 *   npm start -- --port 4321   use a fixed port (default: a free one)
 *
 * The window closes → the machine stops. In tab mode, use the Quit button or Ctrl+C.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getEngine } from "../src/engine/engine.js";
import { createMachineServer } from "../src/app/server.js";
import { appDataDir, appWindowArgs, findAppBrowser, openCommand } from "../src/app/system.js";

const HELP = `Username Transformation Machine

Usage: npm start [-- options]

  --browser-tab   open in a tab of your default browser instead of an app window
  --no-window     start the local server only and print its address
  --port <n>      listen on a fixed port (default: any free port)
  --help          show this help
`;

function parseArgs(argv) {
  const opts = { window: true, tab: false, port: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--no-window") opts.window = false;
    else if (a === "--browser-tab") opts.tab = true;
    else if (a === "--port") opts.port = Number(argv[++i]);
    else if (a.startsWith("--port=")) opts.port = Number(a.slice(7));
    else throw new Error(`Unknown option: ${a}`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw new Error("--port must be a number from 0 to 65535");
  return opts;
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message + "\n\n" + HELP);
  process.exit(2);
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

console.log("Loading the Unicode database…");
const started = performance.now();
const engine = getEngine();
const stats = engine.stats();
console.log(
  `Username Transformation Engine ready: Unicode ${stats.unicodeVersion}, ${stats.variantEntries.toLocaleString("en")} variant mappings ` +
    `(${Math.round(performance.now() - started)} ms).`,
);

let windowProcess = null;
const server = createMachineServer({ engine, onQuit: () => shutdown("Quit from the app.") });

function shutdown(reason) {
  if (reason) console.log(reason);
  if (windowProcess && windowProcess.exitCode === null) windowProcess.kill();
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", () => shutdown("Stopped."));
process.on("SIGTERM", () => shutdown("Stopped."));

server.listen(opts.port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Running at ${url}`);
  if (!opts.window) {
    console.log("Open that address in a browser. Press Ctrl+C to stop.");
    return;
  }
  const browser = opts.tab ? null : findAppBrowser();
  if (browser) openAppWindow(browser, url);
  else openTab(url, opts.tab ? null : "No Chrome, Edge, Chromium or Brave found for an app window.");
});

function openAppWindow(browser, url) {
  const profile = join(appDataDir(), "window-profile");
  mkdirSync(profile, { recursive: true });
  const launchedAt = Date.now();
  windowProcess = spawn(browser, appWindowArgs(url, profile), { stdio: "ignore" });
  windowProcess.on("error", (error) => {
    windowProcess = null;
    openTab(url, `Could not start ${browser}: ${error.message}.`);
  });
  windowProcess.on("exit", (code) => {
    // A quick clean exit means an already-running app window took over the request; keep serving.
    if (code === 0 && Date.now() - launchedAt < 4000) {
      console.log("The app window was handed to an already open window. Press Ctrl+C to stop.");
      return;
    }
    shutdown("App window closed.");
  });
  console.log(`Opened the app window (${browser}). Close it to stop the machine.`);
}

function openTab(url, why) {
  if (why) console.log(why);
  const { command, args } = openCommand(url);
  const child = spawn(command, args, { stdio: "ignore", detached: process.platform !== "win32" });
  child.on("error", () => console.log(`Open ${url} in your browser.`));
  child.unref();
  console.log("Opened in your default browser. Use the Quit button or press Ctrl+C to stop.");
}
