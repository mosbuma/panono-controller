#!/usr/bin/env node
// Optional SSDP discovery helper. Browsers can't send UDP multicast, so run
// this from Node (on the same WiFi as the camera) to find its WebSocket URL.
//
// Usage: npm run discover
//
// Mirrors florianl/panonoctl: M-SEARCH for "panono:ball-camera" and reads the
// LOCATION header from the camera's reply.

import dgram from "node:dgram";
import os from "node:os";

const MCAST_ADDR = "239.255.255.250";
const MCAST_PORT = 1900;
const TIMEOUT_MS = 12000;

// All external IPv4 interface addresses — the camera's NOTIFY is multicast and
// a multi-homed host (docker bridges, ethernet, wifi…) needs membership on the
// interface actually connected to the camera, so we join on every one.
function ipv4Interfaces() {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) addrs.push(i.address);
    }
  }
  return addrs;
}

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

const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
const seen = new Set();

function parseHeaders(text) {
  const headers = {};
  for (const line of text.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toUpperCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

sock.on("message", (msg, rinfo) => {
  const text = msg.toString("utf8");
  if (!/panono/i.test(text) && !/LOCATION/i.test(text)) return;
  const h = parseHeaders(text);
  const location = h["LOCATION"];
  if (!location || seen.has(location)) return;
  seen.add(location);
  console.log("\nFound a Panono camera:");
  console.log(`  Address:    ${rinfo.address}`);
  if (location) console.log(`  WebSocket:  ${location}`);
  if (h["APIVERSION"]) console.log(`  API:        ${h["APIVERSION"]}`);
  if (h["USN"]) console.log(`  USN:        ${h["USN"]}`);
  if (h["SERVER"]) console.log(`  Server:     ${h["SERVER"]}`);
  console.log(`\nPaste the WebSocket URL into the webapp's Connection field.`);
});

sock.on("error", (err) => {
  console.error("Socket error:", err.message);
  sock.close();
  process.exit(1);
});

sock.bind(MCAST_PORT, () => {
  const ifaces = ipv4Interfaces();
  for (const addr of ifaces) {
    try {
      sock.addMembership(MCAST_ADDR, addr);
    } catch {
      /* membership may fail on some interfaces; that's fine */
    }
  }
  sock.setMulticastTTL(2);
  console.log("Searching for Panono camera via SSDP (make sure you're on its WiFi)…");
  const buf = Buffer.from(search);
  // Send the active search from each interface; the camera also broadcasts
  // NOTIFY on its own, which we'll receive while listening.
  for (const addr of ifaces) {
    try {
      sock.setMulticastInterface(addr);
    } catch {
      /* ignore */
    }
    sock.send(buf, 0, buf.length, MCAST_PORT, MCAST_ADDR);
  }
});

setTimeout(() => {
  if (seen.size === 0) {
    console.log(
      "\nNo camera found. Confirm you're connected to the Panono's WiFi, then retry.\n" +
        "If discovery keeps failing, the default URL is usually ws://192.168.80.80:12345/8086"
    );
  }
  sock.close();
  process.exit(0);
}, TIMEOUT_MS);
