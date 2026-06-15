import { buildDownloadBasename, formatCaptureTimestamp, sanitizeSubject } from "@/lib/panorama-filename";
import type { LastSubjects, PanoramaRegistryRecord } from "@/lib/panorama-registry";
import type { PanoramaGeo } from "@/lib/panorama-registry";
import { el } from "@/lib/util";

export interface RegisterInfoResult {
  mainSubject: string;
  detailSubject?: string;
  geo?: PanoramaGeo;
  includeGeo: boolean;
}

function geoAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "geolocation" in navigator;
}

function fetchBrowserGeo(timeoutMs = 5000): Promise<PanoramaGeo | undefined> {
  return new Promise((resolve) => {
    if (!geoAvailable()) {
      resolve(undefined);
      return;
    }
    const timer = window.setTimeout(() => resolve(undefined), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: "browser",
        });
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

function updatePreview(
  previewEl: HTMLElement,
  mainInput: HTMLInputElement,
  detailInput: HTMLInputElement
): void {
  const main = sanitizeSubject(mainInput.value);
  if (!main) {
    previewEl.textContent = `${formatCaptureTimestamp(new Date().toISOString())}@…`;
    return;
  }
  const base = buildDownloadBasename(new Date().toISOString(), {
    mainSubject: mainInput.value,
    detailSubject: detailInput.value || undefined,
  });
  previewEl.textContent = base ? `${base}.upf` : "…";
}

/** Modal: main subject (required), optional detail, optional geo. Returns null if cancelled. */
export function showRegisterInfoDialog(
  initial: LastSubjects,
  opts?: { title?: string; confirmLabel?: string; captureDate?: string }
): Promise<RegisterInfoResult | null> {
  return new Promise((resolve) => {
    const title = opts?.title ?? "Register panorama info";
    const confirmLabel = opts?.confirmLabel ?? "Capture";

    const mainInput = el("input", {
      type: "text",
      class: "register-input",
      autocomplete: "off",
      spellcheck: false,
      placeholder: "Main subject (required)",
      value: initial.mainSubject,
    }) as HTMLInputElement;

    const detailInput = el("input", {
      type: "text",
      class: "register-input",
      autocomplete: "off",
      spellcheck: false,
      placeholder: "Detail subject (optional)",
      value: initial.detailSubject,
    }) as HTMLInputElement;

    const geoCheck = el("input", { type: "checkbox" }) as HTMLInputElement;
    geoCheck.checked = initial.includeGeo && geoAvailable();
    geoCheck.disabled = !geoAvailable();

    const geoLabel = el("label", { class: "preview-toggle register-geo" }, [
      geoCheck,
      geoAvailable() ? " Include location" : " Location unavailable",
    ]);

    const previewEl = el("div", { class: "filename-preview" }, [""]);
    const geoHint = el("p", { class: "confirm-hint hidden" }, [""]);

    const confirmBtn = el("button", { class: "primary" }, [confirmLabel]) as HTMLButtonElement;
    confirmBtn.disabled = !mainInput.value.trim();

    const syncConfirm = (): void => {
      confirmBtn.disabled = !mainInput.value.trim();
      updatePreview(previewEl, mainInput, detailInput);
    };

    mainInput.addEventListener("input", syncConfirm);
    detailInput.addEventListener("input", syncConfirm);
    syncConfirm();

    let settled = false;
    const finish = (value: RegisterInfoResult | null): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };

    const cancelBtn = el("button", {}, ["Cancel"]) as HTMLButtonElement;
    cancelBtn.onclick = () => finish(null);

    confirmBtn.onclick = () => {
      const mainSubject = mainInput.value.trim();
      if (!mainSubject) return;
      const detailSubject = detailInput.value.trim() || undefined;
      const includeGeo = geoCheck.checked;

      confirmBtn.disabled = true;
      cancelBtn.disabled = true;

      void (async () => {
        let geo: PanoramaGeo | undefined;
        if (includeGeo) {
          geo = await fetchBrowserGeo();
          if (!geo) {
            geoHint.textContent = "Could not get location — continuing without it.";
            geoHint.classList.remove("hidden");
          }
        }
        finish({
          mainSubject,
          detailSubject,
          geo,
          includeGeo,
        });
      })();
    };

    const dialog = el("div", { class: "confirm-dialog register-dialog", role: "dialog" }, [
      el("h3", { class: "confirm-title" }, [title]),
      el("p", { class: "confirm-message" }, [
        "Names are used for downloaded files and stored locally with this panorama.",
      ]),
      el("div", { class: "register-form" }, [
        el("label", { class: "register-label" }, ["Main subject"]),
        mainInput,
        el("label", { class: "register-label" }, ["Detail subject"]),
        detailInput,
        geoLabel,
        geoHint,
        el("p", { class: "confirm-hint" }, ["Download filename preview:"]),
        previewEl,
      ]),
      el("div", { class: "confirm-actions" }, [cancelBtn, confirmBtn]),
    ]);
    dialog.setAttribute("aria-modal", "true");

    const overlay = el("div", { class: "confirm-overlay" }, [dialog]);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
    });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") finish(null);
    };
    document.addEventListener("keydown", onKeyDown);

    document.body.append(overlay);
    mainInput.focus();
    mainInput.select();
  });
}
