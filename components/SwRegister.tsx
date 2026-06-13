"use client";

import { SerwistProvider } from "@serwist/next/react";

/** Registers the service worker (HTTPS / secure context required). */
export function SwRegister() {
  return <SerwistProvider swUrl="/sw.js" />;
}
