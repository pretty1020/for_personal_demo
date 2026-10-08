"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    mountCapacityApp?: (
      container: HTMLElement,
      options?: { basename?: string },
    ) => () => void;
  }
}

function ensureCapacityStyles(): void {
  if (document.querySelector('link[data-capacity-embed-css="true"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/capacity/embed.css";
  link.dataset.capacityEmbedCss = "true";
  document.head.appendChild(link);
}

async function loadCapacityEmbed(): Promise<void> {
  if (window.mountCapacityApp) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-capacity-embed="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Capacity embed failed to load")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/capacity/embed.js";
    script.dataset.capacityEmbed = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Capacity embed failed to load"));
    document.head.appendChild(script);
  });
}

export function CapacitySection() {
  const hostRef = useRef<HTMLDivElement>(null);
  const unmountRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        ensureCapacityStyles();
        await loadCapacityEmbed();
        if (cancelled || !hostRef.current || !window.mountCapacityApp) return;
        unmountRef.current = window.mountCapacityApp(hostRef.current, { basename: "/capacity" });
      } catch (error) {
        console.error("Capacity section failed to mount:", error);
      }
    })();

    return () => {
      cancelled = true;
      unmountRef.current?.();
      unmountRef.current = null;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="capacity-embed-root min-h-[calc(100vh-7rem)] w-full bg-[var(--page,#faf5f8)]"
      aria-label="Capacity planning workspace"
    />
  );
}
