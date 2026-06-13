#!/usr/bin/env node
// SSDP discovery for Panono ball cameras (shared by discover.mjs and test-wss.mjs).
// Mirrors florianl/panonoctl: M-SEARCH for "panono:ball-camera".

import dgram from "node:dgram";
import os from "node:os";

const MCAST_ADDR = "239.255.255.250";
const MCAST_PORT = 1900;

function ipv4Interfaces() {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) addrs.push(i.address);
    }
  }
  return addrs;
}

function parseHeaders(text) {
  const headers = {};
  for (const line of text.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toUpperCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

/**
 * @param {{ timeoutMs?: number }} opts
 * @returns {Promise<{ location: string, address: string, apiVersion?: string, usn?: string, server?: string } | null>}
 */
export function discoverPanono({ timeoutMs = 12000 } = {}) {
  const search = [
    "M-SEARCH * HTTP/1.1",
    `HOST: ${MCAST_ADDR}:${MCAST_PORT}`,
    'MAN: "ssdp:discover"',
    "MX: 5",
    "NT: panono:ball-camera",
    "ST: panono:ball-camera",
    "",
    "",
  ].join("\r\n");

  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const seen = new Set();
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    }

    sock.on("message", (msg, rinfo) => {
      const text = msg.toString("utf8");
      // Require Panono SSDP target (ignore other UPnP devices on the LAN).
      if (!/panono:ball-camera/i.test(text)) return;
      const h = parseHeaders(text);
      const location = h["LOCATION"];
      if (!location || seen.has(location)) return;
      seen.add(location);
      finish({
        location,
        address: rinfo.address,
        apiVersion: h["APIVERSION"],
        usn: h["USN"],
        server: h["SERVER"],
      });
    });

    sock.on("error", () => finish(null));

    const timer = setTimeout(() => finish(null), timeoutMs);

    sock.bind(MCAST_PORT, () => {
      const ifaces = ipv4Interfaces();
      for (const addr of ifaces) {
        try {
          sock.addMembership(MCAST_ADDR, addr);
        } catch {
          /* ignore */
        }
      }
      sock.setMulticastTTL(2);
      const buf = Buffer.from(search);
      for (const addr of ifaces) {
        try {
          sock.setMulticastInterface(addr);
        } catch {
          /* ignore */
        }
        sock.send(buf, 0, buf.length, MCAST_PORT, MCAST_ADDR);
      }
    });
  });
}
