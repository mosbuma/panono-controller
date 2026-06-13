"use client";

import { useEffect, useRef } from "react";
import { mountPanonoApp } from "@/lib/mount-app";

export function PanonoApp() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    return mountPanonoApp(el);
  }, []);

  return <div id="app" ref={rootRef} />;
}
