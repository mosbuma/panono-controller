#!/usr/bin/env node
// Probe whether a Panono camera accepts wss:// in addition to ws://.
//
// Run on the same WiFi as the camera:
//   npm run test-wss
//   npm run test-wss -- ws://192.168.80.80:42345/
//
// Tests:
//   1. TLS handshake on the WebSocket port (does anything speak TLS there?)
//   2. ws:// WebSocket + JSON-RPC get_status
//   3. wss:// on the same host/port/path as SSDP LOCATION
//   4. wss:// on port 443 (common alternate, usually fails on embedded devices)

import net from "node:net";
import tls from "node:tls";
import WebSocket from "ws";
import { discoverPanono } from "./ssdp-discover.mjs";

const CONNECT_TIMEOUT_MS = 8000;
const RPC_TIMEOUT_MS = 10000;

function usage() {
  console.log(`Usage:
  npm run test-wss
  npm run test-wss -- ws://192.168.80.80:42345/

Requires the Panono WiFi (or same LAN). Installs \`ws\` as a devDependency.`);
}

function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(0);
  }
  const positional = argv.filter((a) => !a.startsWith("-"));
  return positional[0] ?? null;
}

/** @param {string} wsUrl */
function wssUrlFromWs(wsUrl) {
  const u = new URL(wsUrl);
  u.protocol = "wss:";
  return u.toString();
}

/** @param {string} wsUrl */
function wssUrlOnPort(wsUrl, port) {
  const u = new URL(wsUrl);
  u.protocol = "wss:";
  u.port = String(port);
  return u.toString();
}

/**
 * @param {string} host
 * @param {number} port
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
function probeTls(host, port) {
  return new Promise((resolve) => {
    const tlsOpts = {
      host,
      port,
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    };
    // Avoid RFC 6066 deprecation when host is a literal IP.
    if (!net.isIP(host)) tlsOpts.servername = host;

    const socket = tls.connect(tlsOpts, () => {
        const proto = socket.getProtocol?.() ?? "unknown";
        const cipher = socket.getCipher?.()?.name ?? "unknown";
        socket.end();
        resolve({ ok: true, detail: `TLS responded (${proto}, ${cipher})` });
      }
    );

    const done = (ok, detail) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ok, detail });
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false, "timeout"));
    socket.on("error", (err) => done(false, err.message));
  });
}

/**
 * Raw TCP connect — confirms the port is open even if not TLS/WebSocket.
 * @param {string} host
 * @param {number} port
 */
function probeTcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve({ ok: true, detail: "TCP port open" });
    });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy();
      resolve({ ok: false, detail: "timeout" });
    });
    socket.on("error", (err) => resolve({ ok: false, detail: err.message }));
  });
}

/**
 * @param {string} url
 * @param {{ secure?: boolean, label?: string }} opts
 * @returns {Promise<{ ok: boolean, detail: string, rpcOk?: boolean }>}
 */
function probeWebSocket(url, { secure = false } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, {
      handshakeTimeout: CONNECT_TIMEOUT_MS,
      rejectUnauthorized: false,
    });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, detail: "timeout waiting for open/response" }),
      RPC_TIMEOUT_MS
    );

    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "get_status", jsonrpc: "2.0" }));
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === 1) {
          finish({
            ok: true,
            rpcOk: true,
            detail: msg.error
              ? `WebSocket open; JSON-RPC replied (auth may be required: ${msg.error.code} ${msg.error.message ?? ""})`.trim()
              : "WebSocket open; get_status JSON-RPC OK",
          });
          return;
        }
      } catch {
        finish({ ok: true, rpcOk: false, detail: "WebSocket open; non-JSON response" });
      }
    });

    ws.on("error", (err) => {
      const hint =
        secure && /invalid char|packet length|wrong version|ECONNRESET|EPROTO/i.test(err.message)
          ? " (port likely speaks plain TCP/WebSocket, not TLS)"
          : "";
      finish({ ok: false, detail: `${err.message}${hint}` });
    });

    ws.on("unexpected-response", (_req, res) => {
      finish({
        ok: false,
        detail: `HTTP ${res.statusCode} during WebSocket upgrade`,
      });
    });
  });
}

function printResult(label, { ok, detail }) {
  const mark = ok ? "OK" : "FAIL";
  console.log(`  [${mark}] ${label}`);
  console.log(`        ${detail}`);
}

async function main() {
  let wsUrl = parseArgs(process.argv.slice(2));

  console.log("Panono WebSocket / WSS probe");
  console.log("============================\n");

  if (!wsUrl) {
    console.log("No URL given — searching via SSDP (join the camera WiFi first)…");
    const found = await discoverPanono({ timeoutMs: 12000 });
    if (!found) {
      console.error(
        "\nNo camera found. Pass a URL explicitly, e.g.:\n" +
          "  npm run test-wss -- ws://192.168.80.80:42345/\n"
      );
      process.exit(1);
    }
    wsUrl = found.location;
    console.log(`Found: ${wsUrl}`);
    if (found.apiVersion) console.log(`API:   ${found.apiVersion}`);
    if (found.server) console.log(`Server: ${found.server}`);
  } else if (!/^wss?:\/\//i.test(wsUrl)) {
    console.error("URL must start with ws:// or wss://");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = new URL(wsUrl);
  } catch {
    console.error(`Invalid URL: ${wsUrl}`);
    process.exit(1);
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    console.error("URL must use ws:// or wss:// scheme");
    process.exit(1);
  }

  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "wss:" ? 443 : 80;
  const wsBaseline = parsed.protocol === "ws:" ? wsUrl : wsUrl.replace(/^wss:/i, "ws:");
  const wssSame = wssUrlFromWs(wsBaseline);
  const wss443 = wssUrlOnPort(wsBaseline, 443);

  console.log(`\nHost: ${host}  Port: ${port}  Path: ${parsed.pathname}${parsed.search}\n`);

  console.log("1. TCP reachability");
  printResult(`${host}:${port}`, await probeTcp(host, port));

  console.log("\n2. TLS handshake on WebSocket port");
  printResult(`TLS ${host}:${port}`, await probeTls(host, port));

  console.log("\n3. WebSocket ws:// (baseline)");
  const wsResult = await probeWebSocket(wsBaseline, { secure: false });
  printResult(wsBaseline, wsResult);

  console.log("\n4. WebSocket wss:// (same host/port/path as camera URL)");
  const wssResult = await probeWebSocket(wssSame, { secure: true });
  printResult(wssSame, wssResult);

  if (port !== 443) {
    console.log("\n5. WebSocket wss:// on port 443");
    printResult(wss443, await probeWebSocket(wss443, { secure: true }));
  }

  console.log("\n--- Summary ---");
  if (wsResult.ok && wsResult.rpcOk) {
    console.log("  ws:// works and the camera speaks JSON-RPC on that port.");
  } else if (wsResult.ok) {
    console.log("  ws:// connects but get_status did not return a normal JSON-RPC response.");
  } else {
    console.log("  ws:// did not connect — check WiFi and URL.");
  }

  if (wssResult.ok) {
    console.log("  wss:// IS available on the same endpoint — HTTPS-hosted clients may work via wss.");
  } else {
    console.log("  wss:// is NOT available on the same endpoint (expected for Panono).");
    console.log(`  Reason: ${wssResult.detail}`);
  }

  console.log(
    "\nNote: Browsers still require wss:// from https:// pages. Without camera wss://,\n" +
      "      use an http:// self-hosted app or a LAN WebSocket proxy.\n"
  );

  process.exit(wssResult.ok ? 0 : wsResult.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
