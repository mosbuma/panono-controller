#!/usr/bin/env node
// Shared TCP/TLS/HTTP/WebSocket probes for Panono camera scripts.

import net from "node:net";
import tls from "node:tls";
import WebSocket from "ws";

/**
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 */
export function probeTcp(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, protocol?: string, cipher?: string, error?: string }>}
 */
export function probeTls(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    /** @type {tls.ConnectionOptions} */
    const opts = {
      host,
      port,
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    };
    if (!net.isIP(host)) opts.servername = host;

    const socket = tls.connect(opts, () => {
      const result = {
        ok: true,
        protocol: socket.getProtocol?.() ?? undefined,
        cipher: socket.getCipher?.()?.name ?? undefined,
      };
      socket.end();
      resolve(result);
    });

    const fail = (error) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ok: false, error });
    };

    socket.setTimeout(timeoutMs, () => fail("timeout"));
    socket.on("error", (err) => fail(err.message));
  });
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, statusLine?: string, server?: string, error?: string }>}
 */
export function probeHttp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req =
      `GET / HTTP/1.0\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: panono-port-scan\r\n\r\n`;
    const socket = net.connect({ host, port }, () => {
      socket.write(req);
    });

    let data = "";
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => finish({ ok: false, error: "timeout" }));
    socket.on("error", (err) => finish({ ok: false, error: err.message }));
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.includes("\r\n\r\n") || data.length > 8192) {
        const lines = data.split("\r\n");
        const statusLine = lines[0] ?? "";
        const server = lines.find((l) => /^server:/i.test(l))?.replace(/^server:\s*/i, "");
        finish({
          ok: /^HTTP\/\d\.\d\s+\d+/i.test(statusLine),
          statusLine: statusLine || undefined,
          server,
        });
      }
    });
    socket.on("end", () => {
      if (data) {
        const lines = data.split("\r\n");
        const statusLine = lines[0] ?? "";
        const server = lines.find((l) => /^server:/i.test(l))?.replace(/^server:\s*/i, "");
        finish({
          ok: /^HTTP\/\d\.\d\s+\d+/i.test(statusLine),
          statusLine: statusLine || undefined,
          server,
        });
      } else {
        finish({ ok: false, error: "empty response" });
      }
    });
  });
}

const WS_PATHS = ["/", "/8086"];

/**
 * @param {string} host
 * @param {number} port
 * @param {string} path
 * @param {boolean} secure
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, jsonRpc?: boolean, detail?: string }>}
 */
export function probeWebSocket(host, port, path, secure, timeoutMs = 4000) {
  const scheme = secure ? "wss" : "ws";
  const url = `${scheme}://${host}:${port}${path.startsWith("/") ? path : `/${path}`}`;

  return new Promise((resolve) => {
    const ws = new WebSocket(url, {
      handshakeTimeout: timeoutMs,
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

    const timer = setTimeout(() => finish({ ok: false, detail: "timeout" }), timeoutMs + 500);

    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "get_status", jsonrpc: "2.0" }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === 1) {
          finish({
            ok: true,
            jsonRpc: true,
            detail: msg.error ? `JSON-RPC error ${msg.error.code}` : "JSON-RPC OK",
          });
          return;
        }
      } catch {
        finish({ ok: true, detail: "non-JSON WebSocket" });
      }
    });

    ws.on("error", (err) => finish({ ok: false, detail: err.message }));
    ws.on("unexpected-response", (_req, res) =>
      finish({ ok: false, detail: `HTTP ${res.statusCode} upgrade rejected` })
    );
  });
}

/** @returns {Promise<Array<{ path: string, secure: boolean, ok: boolean, jsonRpc?: boolean, detail?: string }>>} */
export async function probeAllWebSocketPaths(host, port, timeoutMs = 4000) {
  const jobs = [];
  for (const path of WS_PATHS) {
    jobs.push(
      probeWebSocket(host, port, path, false, timeoutMs).then((r) => ({
        path,
        secure: false,
        ...r,
      }))
    );
    jobs.push(
      probeWebSocket(host, port, path, true, timeoutMs).then((r) => ({
        path,
        secure: true,
        ...r,
      }))
    );
  }
  return Promise.all(jobs);
}

export { WS_PATHS };
