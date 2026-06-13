#!/usr/bin/env node
// Exhaustive (or ranged) TCP port scan on a Panono camera, with service probes on
// open ports: TLS, HTTP, ws://, wss:// (paths / and /8086).
//
// Run on the camera WiFi / same LAN:
//   npm run scan-ports
//   npm run scan-ports -- 192.168.80.80
//   npm run scan-ports -- 192.168.80.80 --range 1-65535 --concurrency 200
//   npm run scan-ports -- --quick
//
// Default is a full 1–65535 TCP scan (~1–3 min on a typical LAN).

import { discoverPanono } from "./ssdp-discover.mjs";
import {
  probeAllWebSocketPaths,
  probeHttp,
  probeTcp,
  probeTls,
  WS_PATHS,
} from "./camera-probes.mjs";

const DEFAULT_RANGE = [1, 65535];
const DEFAULT_CONCURRENCY = 150;
const TCP_TIMEOUT_MS = 600;

function usage() {
  console.log(`Panono camera port scanner

Usage:
  npm run scan-ports
  npm run scan-ports -- <host-or-ws-url>
  npm run scan-ports -- <host> --range 4000-50000
  npm run scan-ports -- --quick

Options:
  --range <start-end>   Port range to scan (default: 1-65535, full exhaustive scan)
  --concurrency <n>     Parallel TCP probes (default: ${DEFAULT_CONCURRENCY})
  --timeout <ms>        TCP connect timeout per port (default: ${TCP_TIMEOUT_MS})
  --quick               Scan common ports + SSDP WebSocket port only (~2s)
  --no-deep             TCP scan only; skip TLS/HTTP/WebSocket on open ports
  -h, --help            Show this help

Examples:
  npm run scan-ports
  npm run scan-ports -- ws://192.168.80.80:42345/
  npm run scan-ports -- 192.168.80.80 --range 1-1024`);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(0);
  }

  const opts = {
    host: null,
    range: [...DEFAULT_RANGE],
    concurrency: DEFAULT_CONCURRENCY,
    tcpTimeoutMs: TCP_TIMEOUT_MS,
    quick: false,
    deep: true,
    ssdpLocation: null,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quick") opts.quick = true;
    else if (a === "--no-deep") opts.deep = false;
    else if (a === "--range") {
      const r = parseRange(argv[++i]);
      if (!r) {
        console.error(`Invalid --range (use start-end, e.g. 1-65535)`);
        process.exit(1);
      }
      opts.range = r;
    } else if (a === "--concurrency") {
      opts.concurrency = Number(argv[++i]);
    } else if (a === "--timeout") {
      opts.tcpTimeoutMs = Number(argv[++i]);
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }

  if (positional[0]) {
    opts.host = hostFromArg(positional[0]);
    if (/^wss?:\/\//i.test(positional[0])) opts.ssdpLocation = positional[0];
  }

  return opts;
}

/** @param {string} s */
function hostFromArg(s) {
  if (/^wss?:\/\//i.test(s)) {
    return new URL(s).hostname;
  }
  return s.replace(/^\[/, "").replace(/\]$/, "").split(":")[0];
}

/** @param {string | undefined} s @returns {[number, number] | null} */
function parseRange(s) {
  if (!s) return null;
  const m = /^(\d+)-(\d+)$/.exec(s.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start < 1 || end > 65535 || start > end) return null;
  return [start, end];
}

/** @param {number[]} ports @param {number} concurrency */
async function scanTcp(host, ports, concurrency, timeoutMs, onProgress) {
  /** @type {number[]} */
  const open = [];
  let done = 0;

  /** @type {Promise<void>[]} */
  const workers = [];
  let index = 0;

  async function worker() {
    while (index < ports.length) {
      const i = index++;
      const port = ports[i];
      if (await probeTcp(host, port, timeoutMs)) open.push(port);
      done++;
      if (done % 500 === 0 || done === ports.length) onProgress(done, ports.length, open.length);
    }
  }

  for (let w = 0; w < Math.min(concurrency, ports.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  open.sort((a, b) => a - b);
  return open;
}

/** @param {number} ssdpPort */
function quickPortList(ssdpPort) {
  const set = new Set([
    80,
    443,
    8080,
    8443,
    1900,
    42345,
    12345,
    ssdpPort,
    ssdpPort - 1,
    ssdpPort + 1,
  ]);
  for (let p = Math.max(1, ssdpPort - 20); p <= Math.min(65535, ssdpPort + 20); p++) {
    set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}

/** @param {string} host @param {number} port */
async function deepProbe(host, port) {
  const [tls, http, wsResults] = await Promise.all([
    probeTls(host, port),
    probeHttp(host, port),
    probeAllWebSocketPaths(host, port),
  ]);

  return { tls, http, wsResults };
}

function formatPortReport(host, port, { tls, http, wsResults }) {
  const lines = [`Port ${port}`];
  lines.push(`  TCP       open`);
  lines.push(
    `  TLS       ${tls.ok ? `yes (${tls.protocol ?? "?"}, ${tls.cipher ?? "?"})` : `no (${tls.error ?? "n/a"})`}`
  );
  lines.push(
    `  HTTP      ${http.ok ? `yes — ${http.statusLine}${http.server ? `, Server: ${http.server}` : ""}` : `no (${http.error ?? "n/a"})`}`
  );

  const wsHits = wsResults.filter((r) => r.ok);
  if (wsHits.length === 0) {
    lines.push(`  WebSocket no (${WS_PATHS.map((p) => `ws/wss${p}`).join(", ")} tried)`);
  } else {
    for (const w of wsHits) {
      const scheme = w.secure ? "wss" : "ws";
      lines.push(
        `  WebSocket ${scheme}://${host}:${port}${w.path} — ${w.jsonRpc ? "JSON-RPC (Panono API)" : w.detail ?? "open"}`
      );
    }
  }
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log("Panono camera port scan");
  console.log("=======================\n");

  let host = opts.host;
  let ssdpPort = null;

  if (!host) {
    console.log("Discovering camera via SSDP…");
    const found = await discoverPanono({ timeoutMs: 12000 });
    if (!found) {
      console.error("No camera found. Pass host or ws:// URL, e.g.:\n  npm run scan-ports -- 192.168.80.80\n");
      process.exit(1);
    }
    host = found.address;
    opts.ssdpLocation = found.location;
    try {
      ssdpPort = Number(new URL(found.location).port) || 80;
    } catch {
      /* ignore */
    }
    console.log(`Camera:     ${host}`);
    console.log(`SSDP WS:    ${found.location}`);
    if (found.apiVersion) console.log(`API:        ${found.apiVersion}`);
    if (found.server) console.log(`Firmware:   ${found.server}`);
  } else if (opts.ssdpLocation) {
    try {
      ssdpPort = Number(new URL(opts.ssdpLocation).port) || 80;
    } catch {
      /* ignore */
    }
    console.log(`Target:     ${host}`);
    console.log(`From URL:   ${opts.ssdpLocation}`);
  } else {
    console.log(`Target:     ${host}`);
  }

  const [rangeStart, rangeEnd] = opts.quick
    ? [null, null]
    : opts.range;
  const ports = opts.quick
    ? quickPortList(ssdpPort ?? 42345)
    : Array.from({ length: rangeEnd - rangeStart + 1 }, (_, i) => rangeStart + i);

  console.log(
    opts.quick
      ? `\nQuick scan: ${ports.length} ports (common + SSDP port neighborhood)`
      : `\nExhaustive TCP scan: ports ${rangeStart}–${rangeEnd} (${ports.length} ports, concurrency ${opts.concurrency})`
  );
  console.log(`This may take a few minutes. Only scan hardware you own.\n`);

  const started = Date.now();
  const openPorts = await scanTcp(host, ports, opts.concurrency, opts.tcpTimeoutMs, (done, total, openCount) => {
    const pct = ((done / total) * 100).toFixed(1);
    process.stdout.write(`\r  Progress: ${done}/${total} (${pct}%) — ${openCount} open so far   `);
  });
  console.log(`\n\nTCP scan finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`Open ports: ${openPorts.length ? openPorts.join(", ") : "(none)"}\n`);

  if (openPorts.length === 0) {
    console.log("No open TCP ports in range. Check host / WiFi.");
    process.exit(1);
  }

  if (!opts.deep) {
    console.log("Skipping deep probes (--no-deep).");
    process.exit(0);
  }

  console.log("Deep probe on open ports (TLS, HTTP, ws://, wss://)…\n");

  /** @type {Array<{ port: number, wss: boolean, wsJsonRpc: boolean }>} */
  const summary = [];

  for (const port of openPorts) {
    const result = await deepProbe(host, port);
    console.log(formatPortReport(host, port, result));
    console.log("");

    const wss = result.wsResults.some((r) => r.secure && r.ok);
    const wsJsonRpc = result.wsResults.some((r) => !r.secure && r.ok && r.jsonRpc);
    summary.push({ port, wss, wsJsonRpc, tls: result.tls.ok, http: result.http.ok });
  }

  console.log("--- Summary ---");
  console.log(`  Host ${host}: ${openPorts.length} open TCP port(s)`);
  const jsonRpcPorts = summary.filter((s) => s.wsJsonRpc).map((s) => s.port);
  const wssPorts = summary.filter((s) => s.wss).map((s) => s.port);
  const tlsPorts = summary.filter((s) => s.tls).map((s) => s.port);
  const httpPorts = summary.filter((s) => s.http).map((s) => s.port);

  if (jsonRpcPorts.length) {
    console.log(`  Panono JSON-RPC (ws://): port(s) ${jsonRpcPorts.join(", ")}`);
  } else {
    console.log(`  Panono JSON-RPC (ws://): not found on open ports (unexpected if SSDP port was open)`);
  }
  if (wssPorts.length) {
    console.log(`  WebSocket Secure (wss://): port(s) ${wssPorts.join(", ")}`);
  } else {
    console.log(`  WebSocket Secure (wss://): not found on any open port`);
  }
  if (tlsPorts.length) {
    console.log(`  TLS: port(s) ${tlsPorts.join(", ")}`);
  }
  if (httpPorts.length) {
    console.log(`  HTTP: port(s) ${httpPorts.join(", ")}`);
  }

  console.log(
    "\nNote: A full 1–65535 scan is the exhaustive default. Use --quick for a fast re-check.\n"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
