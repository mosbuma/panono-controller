import { PanonoClient, type ConnectionState } from "@/lib/panono";
import type { CameraOption, CameraStatus, UpfInfo } from "@/lib/types";
import { el, fmtBytes, fmtDate, resolveCameraUrl } from "@/lib/util";
import { openUpfViewer } from "@/components/viewer";
import { downloadPtGuiZip } from "@/lib/export-stitcher-zip-client";
import { downloadAllUpfs, downloadUpfBlob } from "@/lib/download-upf-client";
import { APP_VERSION } from "@/lib/app-version";
import {
  enqueueFlatPreviews,
  loadCachedFlatPreviewUrl,
  onFlatPreviewReady,
  onFlatPreviewStart,
  stopFlatPreviewGeneration,
} from "@/lib/flat-preview";
import {
  deletePreviewCacheEntry,
  getPreviewUpfBuffer,
  pruneFlatPreviewCache,
} from "@/lib/flat-preview-cache";
import { showTypedConfirmDialog } from "@/lib/typed-confirm-dialog";

const DEFAULT_URL = "ws://192.168.80.80:42345/";
const STORAGE_KEY = "panono.lastUrl";
const SHOW_PREVIEW_KEY = "panono.showPreview";
const SHOW_RPC_LOG = process.env.NODE_ENV === "development";

function readShowPreview(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(SHOW_PREVIEW_KEY) === "true";
}

const client = new PanonoClient();
let status: CameraStatus = { capture_available: false };
let authed = false;
let currentUpfs: UpfInfo[] = [];
const thumbRefs = new Map<string, HTMLDivElement>();
const thumbObjectUrls = new Map<string, string>();
let previewsDone = 0;
let previewsTotal = 0;
let previewHydrateGen = 0;
let previewProgressHideTimer = 0;

export function mountPanonoApp(container: HTMLElement): () => void {
  const app = container;
  app.innerHTML = "";

  const stateDot = el("span", { class: "dot disconnected" });
  const stateText = el("span", {}, ["Disconnected"]);
  const statusPill = el("div", { class: "status-pill" }, [stateDot, stateText]);

  app.append(
    el("div", { class: "topbar" }, [
      el("div", { class: "logo" }),
      el("div", { class: "title" }, [
        el("h1", {}, ["Panono Control"]),
        el("p", {}, [`Panono 360 camera control · v${APP_VERSION}`]),
      ]),
      statusPill,
    ])
  );

  const grid = el("div", { class: "grid" });
  app.append(grid);

  const urlInput = el("input", {
    type: "text",
    value: localStorage.getItem(STORAGE_KEY) || DEFAULT_URL,
    placeholder: "ws://<camera-ip>:<port>/<path>",
    spellcheck: false,
  }) as HTMLInputElement;
  const connectBtn = el("button", { class: "primary" }, ["Connect"]) as HTMLButtonElement;
  const disconnectBtn = el("button", {}, ["Disconnect"]) as HTMLButtonElement;
  disconnectBtn.disabled = true;

  grid.append(
    el("div", { class: "card span-2" }, [
      el("h2", {}, ["Connection"]),
      el("div", { class: "row" }, [urlInput, connectBtn, disconnectBtn]),
      el("p", { class: "hint" }, [
        "Join the camera's WiFi first. On ",
        el("strong", {}, ["HTTPS"]),
        " (Add to Home Screen / production URL), allow ",
        el("strong", {}, ["local network access"]),
        " when the browser asks — required for ",
        el("code", {}, ["ws://"]),
        " to the camera. Port can change on reboot; try ",
        el("code", {}, [DEFAULT_URL]),
        " or run ",
        el("code", {}, ["npm run discover"]),
        " on the same network.",
      ]),
    ])
  );

  const statBattery = stat("Battery");
  const statCapture = stat("Capture ready");
  const statFirmware = stat("Firmware");
  const statDevice = stat("Device ID");
  const batteryBar = el("span", {}, []);
  statBattery.value.append(el("div", { class: "bar" }, [batteryBar]));
  const storageWrap = el("div", { class: "stat-grid", style: "margin-top:12px" });
  const refreshStatusBtn = el("button", {}, ["Refresh"]) as HTMLButtonElement;

  grid.append(
    el("div", { class: "card" }, [
      el("h2", {}, ["Status"]),
      el("div", { class: "stat-grid" }, [
        statBattery.box,
        statCapture.box,
        statFirmware.box,
        statDevice.box,
      ]),
      storageWrap,
      el("div", { class: "section-actions", style: "margin-top:14px" }, [refreshStatusBtn]),
    ])
  );

  const captureBtn = el("button", { class: "primary capture-btn" }, [
    "Capture panorama",
  ]) as HTMLButtonElement;
  grid.append(
    el("div", { class: "card" }, [
      el("h2", {}, ["Capture"]),
      captureBtn,
      el("p", { class: "hint" }, [
        "Triggers a 360° shot. The new image appears in the gallery below once the camera finishes the preview.",
      ]),
    ])
  );

  const optionsList = el("div", { class: "options-list" });
  const loadOptionsBtn = el("button", {}, ["Load options"]) as HTMLButtonElement;
  grid.append(
    el("div", { class: "card span-2" }, [
      el("h2", {}, ["Camera options"]),
      el("div", { class: "section-actions" }, [loadOptionsBtn]),
      optionsList,
    ])
  );

  const gallery = el("div", { class: "gallery" });
  const refreshUpfBtn = el("button", {}, ["Refresh"]) as HTMLButtonElement;
  const downloadAllBtn = el("button", {}, ["Download all UPFs"]) as HTMLButtonElement;
  downloadAllBtn.disabled = true;
  downloadAllBtn.title = "Downloads each full UPF one by one; allow multiple downloads in the browser";
  const deleteAllBtn = el("button", { class: "danger section-actions-end" }, ["Delete all"]) as HTMLButtonElement;
  deleteAllBtn.disabled = true;
  deleteAllBtn.title = "Permanently remove every panorama from the camera";
  const showPreviewCheck = el("input", { type: "checkbox" }) as HTMLInputElement;
  showPreviewCheck.checked = readShowPreview();
  const showPreviewToggle = el("label", { class: "preview-toggle" }, [
    showPreviewCheck,
    " Show preview",
  ]);
  showPreviewCheck.onchange = () => {
    localStorage.setItem(SHOW_PREVIEW_KEY, showPreviewCheck.checked ? "true" : "false");
    stopFlatPreviewGeneration();
    if (currentUpfs.length) renderUpfs(currentUpfs);
  };
  const previewProgressWrap = el("div", { class: "preview-progress hidden" });
  const previewProgressLabel = el("div", { class: "preview-progress-label" }, [""]);
  const previewProgressFill = el("span", { style: "width:0%" });
  previewProgressWrap.append(
    previewProgressLabel,
    el("div", { class: "bar preview-progress-bar" }, [previewProgressFill])
  );
  grid.append(
    el("div", { class: "card span-2" }, [
      el("h2", {}, ["Panoramas (UPF)"]),
      el("div", { class: "section-actions" }, [
        refreshUpfBtn,
        downloadAllBtn,
        showPreviewToggle,
        deleteAllBtn,
      ]),
      el("p", { class: "hint" }, [
        "Enable ",
        el("strong", {}, ["Show preview"]),
        " for flat stitched gallery thumbnails (cached in the browser). Use ",
        el("strong", {}, ["View 360°"]),
        " to open the mesh viewer anytime.",
      ]),
      previewProgressWrap,
      gallery,
    ])
  );

  const logEl = SHOW_RPC_LOG ? el("div", { class: "log" }) : null;
  if (SHOW_RPC_LOG && logEl) {
    grid.append(
      el("div", { class: "card span-2" }, [
        el("h2", {}, ["JSON-RPC log"]),
        logEl,
      ])
    );
  }

  const toastEl = el("div", { class: "toast" });
  document.body.append(toastEl);
  let toastTimer = 0;
  function toast(msg: string, bad = false): void {
    toastEl.textContent = msg;
    toastEl.className = `toast show${bad ? " bad" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.className = "toast"), 3200);
  }

  function stat(label: string) {
    const value = el("div", { class: "value" }, ["—"]);
    const box = el("div", { class: "stat" }, [
      el("div", { class: "label" }, [label]),
      value,
    ]);
    return { box, value };
  }

  function log(direction: "in" | "out" | "info" | "err", text: string): void {
    if (!logEl) return;
    const line = el("div", { class: direction }, [
      `${direction === "out" ? "→" : direction === "in" ? "←" : "•"} ${text}`,
    ]);
    logEl.append(line);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.childElementCount > 200) logEl.firstElementChild?.remove();
  }

  function setGalleryBulkEnabled(on: boolean): void {
    const enabled = on && currentUpfs.length > 0;
    downloadAllBtn.disabled = !enabled;
    deleteAllBtn.disabled = !enabled;
  }

  function setControlsEnabled(on: boolean): void {
    captureBtn.disabled = !on;
    refreshStatusBtn.disabled = !on;
    loadOptionsBtn.disabled = !on;
    refreshUpfBtn.disabled = !on;
    setGalleryBulkEnabled(on);
  }
  setControlsEnabled(false);

  function renderStatus(): void {
    const raw =
      typeof status.battery_value === "number" ? Math.round(status.battery_value) : undefined;
    const charging =
      raw === -1 ||
      (status.charging_status != null && status.charging_status !== "not_charging");
    const pct = raw != null && raw >= 0 ? raw : undefined;
    statBattery.value.firstChild!.textContent = charging
      ? pct != null
        ? `${pct}% ⚡`
        : "Charging ⚡"
      : pct != null
        ? `${pct}%`
        : "—";
    batteryBar.parentElement?.classList.toggle("charging", charging && pct == null);
    batteryBar.setAttribute("style", `width:${pct ?? (charging ? 100 : 0)}%`);

    statCapture.value.textContent = "";
    statCapture.value.append(
      el("span", { class: `badge ${status.capture_available ? "ok" : "no"}` }, [
        status.capture_available ? "Ready" : "Busy",
      ])
    );
    statFirmware.value.firstChild!.textContent = status.firmware_version || "—";
    statDevice.value.firstChild!.textContent =
      status.serial_number || status.device_id || "—";

    storageWrap.innerHTML = "";
    for (const [name, s] of Object.entries(status.storage ?? {})) {
      const usedPct = s.total ? Math.round((s.usage / s.total) * 100) : 0;
      storageWrap.append(
        el("div", { class: "stat" }, [
          el("div", { class: "label" }, [`Storage: ${name}`]),
          el("div", { class: "value" }, [`${fmtBytes(s.usage)} / ${fmtBytes(s.total)}`]),
          el("div", { class: "bar" }, [el("span", { style: `width:${usedPct}%` })]),
        ])
      );
    }
  }

  function revokeThumbObjectUrl(imageId: string): void {
    const url = thumbObjectUrls.get(imageId);
    if (url) {
      URL.revokeObjectURL(url);
      thumbObjectUrls.delete(imageId);
    }
  }

  function revokeAllThumbObjectUrls(): void {
    for (const url of thumbObjectUrls.values()) URL.revokeObjectURL(url);
    thumbObjectUrls.clear();
  }

  function updatePreviewProgress(): void {
    clearTimeout(previewProgressHideTimer);
    if (previewsTotal <= 0) {
      previewProgressWrap.classList.add("hidden");
      return;
    }

    const pct = Math.min(100, Math.round((previewsDone / previewsTotal) * 100));
    previewProgressFill.setAttribute("style", `width:${pct}%`);
    previewProgressWrap.classList.remove("hidden");

    if (previewsDone >= previewsTotal) {
      previewProgressLabel.textContent = `All ${previewsTotal} thumbnail${previewsTotal === 1 ? "" : "s"} ready`;
      previewProgressHideTimer = window.setTimeout(() => {
        previewProgressWrap.classList.add("hidden");
      }, 1200);
      return;
    }

    const building = previewsTotal - previewsDone;
    previewProgressLabel.textContent = `Thumbnails ${previewsDone} / ${previewsTotal} · ${building} remaining`;
  }

  function setThumbLoading(imgwrap: HTMLDivElement): void {
    imgwrap.classList.remove("has-preview", "is-building");
    imgwrap.style.backgroundImage = "";
    imgwrap.textContent = "loading…";
  }

  function setThumbBuilding(imgwrap: HTMLDivElement): void {
    imgwrap.classList.remove("has-preview");
    imgwrap.classList.add("is-building");
    imgwrap.style.backgroundImage = "";
    imgwrap.textContent = "";
  }

  function setThumbPreview(imgwrap: HTMLDivElement, imageId: string, objectUrl: string): void {
    revokeThumbObjectUrl(imageId);
    thumbObjectUrls.set(imageId, objectUrl);
    imgwrap.classList.remove("is-building");
    imgwrap.classList.add("has-preview");
    imgwrap.style.backgroundImage = `url("${objectUrl}")`;
    imgwrap.textContent = "";
  }

  async function hydrateFlatPreviews(
    sorted: UpfInfo[],
    jobs: { imageId: string; previewUrl: string }[]
  ): Promise<void> {
    const gen = ++previewHydrateGen;
    await pruneFlatPreviewCache(new Set(sorted.map((u) => u.image_id)));

    if (!readShowPreview()) {
      previewProgressWrap.classList.add("hidden");
      return;
    }

    const missing: { imageId: string; previewUrl: string }[] = [];

    for (const job of jobs) {
      if (gen !== previewHydrateGen) return;
      const imgwrap = thumbRefs.get(job.imageId);
      if (!imgwrap) continue;
      const objectUrl = await loadCachedFlatPreviewUrl(job.imageId, job.previewUrl);
      if (objectUrl) {
        setThumbPreview(imgwrap, job.imageId, objectUrl);
      } else {
        missing.push(job);
      }
    }

    if (gen !== previewHydrateGen) return;

    if (!missing.length) {
      previewProgressWrap.classList.add("hidden");
      return;
    }

    previewsTotal = missing.length;
    previewsDone = 0;
    previewProgressLabel.textContent = `Building thumbnails… 0 / ${missing.length}`;
    previewProgressFill.setAttribute("style", "width:0%");
    previewProgressWrap.classList.remove("hidden");
    enqueueFlatPreviews(missing);
  }

  function renderUpfs(upfs: UpfInfo[]): void {
    currentUpfs = upfs;
    thumbRefs.clear();
    revokeAllThumbObjectUrls();
    stopFlatPreviewGeneration();
    clearTimeout(previewProgressHideTimer);
    gallery.innerHTML = "";
    previewsDone = 0;
    previewsTotal = 0;

    if (!upfs.length) {
      gallery.append(el("div", { class: "empty" }, ["No panoramas on the camera yet."]));
      previewProgressWrap.classList.add("hidden");
      setGalleryBulkEnabled(client.isConnected);
      return;
    }

    const sorted = [...upfs].sort((a, b) =>
      (b.capture_date || "").localeCompare(a.capture_date || "")
    );
    const buildPreviews = readShowPreview();
    const jobs: { imageId: string; previewUrl: string }[] = [];

    for (const upf of sorted) {
      const preview = resolveCameraUrl(upf.preview_url, client.url);
      const download = resolveCameraUrl(upf.upf_url, client.url);

      const view360Btn = el("button", {}, ["View 360°"]) as HTMLButtonElement;
      view360Btn.disabled = !preview;
      view360Btn.onclick = () => {
        if (!preview) return;
        void openPreviewViewer(upf.image_id, preview, fmtDate(upf.capture_date));
      };

      const thumbParts: HTMLElement[] = [];
      if (buildPreviews) {
        const imgwrap = el("div", { class: "imgwrap" }, ["loading…"]);
        thumbRefs.set(upf.image_id, imgwrap);
        if (preview) jobs.push({ imageId: upf.image_id, previewUrl: preview });
        else setThumbLoading(imgwrap);

        imgwrap.style.cursor = preview ? "pointer" : "default";
        imgwrap.onclick = () => {
          if (!preview) return;
          void openPreviewViewer(upf.image_id, preview, fmtDate(upf.capture_date));
        };
        thumbParts.push(imgwrap);
      }

      const downloadUpfBtn = el("button", { class: "primary" }, ["Download UPF"]) as HTMLButtonElement;
      downloadUpfBtn.disabled = !download;
      downloadUpfBtn.onclick = () => {
        if (!download) return;
        void downloadUpfBlob(download, `${upf.image_id}.upf`).catch((err) =>
          toast(`Download failed: ${err instanceof Error ? err.message : err}`, true)
        );
      };

      const zipBtn = el("button", {}, ["PTGui ZIP"]) as HTMLButtonElement;
      zipBtn.title = "Full-res 36 JPEGs + manifest for PTGui (built in browser)";
      zipBtn.disabled = !download;
      zipBtn.onclick = () => void onExportPtGuiZip(upf.image_id, download, fmtDate(upf.capture_date));

      const delBtn = el("button", { class: "danger" }, ["Delete"]) as HTMLButtonElement;
      delBtn.onclick = () => onDelete(upf.image_id);

      gallery.append(
        el("div", { class: buildPreviews ? "thumb" : "thumb no-preview" }, [
          ...thumbParts,
          el("div", { class: "meta" }, [
            el("div", { class: "date" }, [fmtDate(upf.capture_date)]),
            el("div", {}, [`${fmtBytes(upf.upf_size ?? upf.size)} · full UPF`]),
            el("div", { class: "actions", style: "margin-top:8px" }, [
              ...(buildPreviews ? [] : [view360Btn]),
              downloadUpfBtn,
              zipBtn,
            ]),
            el("div", { class: "actions", style: "margin-top:6px" }, [delBtn]),
          ]),
        ])
      );
    }

    if (jobs.length && buildPreviews) {
      previewProgressWrap.classList.add("hidden");
      void hydrateFlatPreviews(sorted, jobs);
    } else {
      previewProgressWrap.classList.add("hidden");
    }
    setGalleryBulkEnabled(client.isConnected);
  }

  function renderOptions(options: CameraOption[], values: Record<string, unknown>): void {
    optionsList.innerHTML = "";
    if (!options.length) {
      optionsList.append(el("div", { class: "empty" }, ["No options reported."]));
      return;
    }
    for (const opt of options) {
      const current = values[opt.name];
      optionsList.append(
        el("div", { class: "option-row" }, [
          el("label", {}, [opt.name]),
          buildOptionControl(opt, current),
        ])
      );
    }
  }

  function buildOptionControl(opt: CameraOption, current: unknown): HTMLElement {
    const valuesC = opt.constraints.find((c) => c.constraint === "values");
    if (opt.type === "Boolean" || (valuesC && Array.isArray(valuesC.value))) {
      const select = el("select") as HTMLSelectElement;
      const vals = opt.type === "Boolean" ? [true, false] : (valuesC!.value as unknown[]);
      for (const v of vals) {
        const o = el("option", { value: String(v) }, [String(v)]) as HTMLOptionElement;
        if (String(v) === String(current)) o.selected = true;
        select.append(o);
      }
      select.onchange = () => {
        let v: string | number | boolean = select.value;
        if (opt.type === "Boolean") v = select.value === "true";
        else if (opt.type === "Integer" || opt.type === "Number") v = Number(select.value);
        onSetOption(opt.name, v);
      };
      return select;
    }

    const input = el("input", {
      type: "text",
      value: current != null ? String(current) : "",
    }) as HTMLInputElement;
    const min = opt.constraints.find((c) => c.constraint === "min")?.value;
    const max = opt.constraints.find((c) => c.constraint === "max")?.value;
    if (min != null || max != null) input.placeholder = `min ${min ?? "?"} · max ${max ?? "?"}`;
    input.onchange = () => {
      const v =
        opt.type === "Integer" || opt.type === "Number" ? Number(input.value) : input.value;
      onSetOption(opt.name, v);
    };
    return input;
  }

  async function onConnect(): Promise<void> {
    const url = urlInput.value.trim();
    if (!url) return;
    connectBtn.disabled = true;
    try {
      await client.connect(url);
      localStorage.setItem(STORAGE_KEY, url);
      const res = await client.auth();
      authed = Boolean((res as CameraStatus)?.is_auth ?? true);
      status = { ...status, ...(res as CameraStatus) };
      renderStatus();
      setControlsEnabled(true);
      disconnectBtn.disabled = false;
      toast(
        authed
          ? "Connected & authenticated"
          : "Connected (auth pending — tap the button on the camera)"
      );
      await refreshStatus();
      await refreshUpfs();
    } catch (err) {
      log("err", String(err instanceof Error ? err.message : err));
      toast(`Connect failed: ${err instanceof Error ? err.message : err}`, true);
      connectBtn.disabled = false;
    }
  }

  function onDisconnect(): void {
    client.disconnect();
    authed = false;
    setControlsEnabled(false);
    disconnectBtn.disabled = true;
    connectBtn.disabled = false;
  }

  async function refreshStatus(): Promise<void> {
    try {
      const res = await client.getStatus();
      status = { ...status, ...res };
      renderStatus();
    } catch (err) {
      toast(`Status failed: ${err instanceof Error ? err.message : err}`, true);
    }
  }

  async function refreshUpfs(): Promise<void> {
    try {
      const res = await client.getUpfInfos();
      renderUpfs(res?.upf_infos ?? []);
    } catch (err) {
      toast(`UPF list failed: ${err instanceof Error ? err.message : err}`, true);
    }
  }

  async function onCapture(): Promise<void> {
    captureBtn.disabled = true;
    try {
      await client.capture();
      toast("Capture triggered");
      window.setTimeout(refreshUpfs, 2500);
    } catch (err) {
      toast(`Capture failed: ${err instanceof Error ? err.message : err}`, true);
    } finally {
      captureBtn.disabled = !client.isConnected;
    }
  }

  async function onLoadOptions(): Promise<void> {
    try {
      const list = await client.getOptionList();
      let values: Record<string, unknown> = {};
      try {
        values = await client.getOptions();
      } catch {
        /* optional on some firmware */
      }
      renderOptions(list?.options ?? [], values);
    } catch (err) {
      toast(`Options failed: ${err instanceof Error ? err.message : err}`, true);
    }
  }

  async function onSetOption(name: string, value: string | number | boolean): Promise<void> {
    try {
      await client.setOption(name, value);
      toast(`Set ${name} = ${value}`);
    } catch (err) {
      toast(`Set ${name} failed: ${err instanceof Error ? err.message : err}`, true);
    }
  }

  async function onExportPtGuiZip(
    imageId: string,
    upfUrl: string | undefined,
    label: string
  ): Promise<void> {
    if (!upfUrl) return;
    const sizeHint = currentUpfs.find((u) => u.image_id === imageId);
    const size = fmtBytes(sizeHint?.upf_size ?? sizeHint?.size);
    if (!confirm(`Build PTGui ZIP from full UPF (${size}) in the browser? May take a minute.`))
      return;
    toast("Building PTGui ZIP…");
    try {
      await downloadPtGuiZip(upfUrl, imageId);
      toast(`PTGui ZIP — ${label}`);
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : err}`, true);
    }
  }

  async function openPreviewViewer(
    imageId: string,
    previewUrl: string,
    label: string
  ): Promise<void> {
    const preloaded = await getPreviewUpfBuffer(imageId, previewUrl);
    await openUpfViewer(previewUrl, label, {
      resolution: "preview",
      preloaded: preloaded ?? undefined,
    });
  }

  async function onDownloadAllUpfs(): Promise<void> {
    const items = currentUpfs
      .map((upf) => ({
        imageId: upf.image_id,
        upfUrl: resolveCameraUrl(upf.upf_url, client.url),
        label: fmtDate(upf.capture_date),
      }))
      .filter((item): item is typeof item & { upfUrl: string } => Boolean(item.upfUrl));

    if (!items.length) return;

    const totalBytes = currentUpfs.reduce((sum, u) => sum + (u.upf_size ?? u.size ?? 0), 0);
    if (
      !confirm(
        `Download ${items.length} full UPF file${items.length === 1 ? "" : "s"} (${fmtBytes(totalBytes)}) one by one?\n\nYour browser may ask you to allow multiple downloads.`
      )
    ) {
      return;
    }

    setGalleryBulkEnabled(false);
    clearTimeout(previewProgressHideTimer);
    previewProgressWrap.classList.remove("hidden");
    previewProgressFill.setAttribute("style", "width:0%");

    try {
      const { ok, failed } = await downloadAllUpfs(items, ({ done, total, currentLabel }) => {
        const pct = total ? Math.round((done / total) * 100) : 0;
        previewProgressFill.setAttribute("style", `width:${pct}%`);
        previewProgressLabel.textContent =
          done >= total
            ? "Finishing downloads…"
            : `Downloading ${Math.min(done + 1, total)}/${total}: ${currentLabel}`;
      });

      previewProgressLabel.textContent =
        failed > 0
          ? `Downloaded ${ok}/${items.length} · ${failed} failed`
          : `Downloaded ${ok} UPF file${ok === 1 ? "" : "s"}`;
      previewProgressFill.setAttribute("style", "width:100%");
      toast(
        failed > 0 ? `Downloaded ${ok}, ${failed} failed` : `Downloaded ${ok} UPF file${ok === 1 ? "" : "s"}`,
        failed > 0
      );
      previewProgressHideTimer = window.setTimeout(() => {
        previewProgressWrap.classList.add("hidden");
      }, 2000);
    } catch (err) {
      toast(`Bulk download failed: ${err instanceof Error ? err.message : err}`, true);
      previewProgressWrap.classList.add("hidden");
    } finally {
      setGalleryBulkEnabled(client.isConnected);
    }
  }

  async function onDeleteAllUpfs(): Promise<void> {
    if (!currentUpfs.length) return;

    const count = currentUpfs.length;
    const confirmed = await showTypedConfirmDialog({
      title: "Delete all panoramas",
      message: `This permanently removes all ${count} panorama${count === 1 ? "" : "s"} from the camera. This cannot be undone.`,
      confirmLabel: "Delete all",
    });
    if (!confirmed) return;

    const imageIds = currentUpfs.map((u) => u.image_id);
    setGalleryBulkEnabled(false);
    refreshUpfBtn.disabled = true;
    clearTimeout(previewProgressHideTimer);
    previewProgressWrap.classList.remove("hidden");
    previewProgressFill.setAttribute("style", "width:0%");

    let ok = 0;
    let failed = 0;

    try {
      for (let i = 0; i < imageIds.length; i++) {
        const imageId = imageIds[i]!;
        const pct = Math.round((i / imageIds.length) * 100);
        previewProgressFill.setAttribute("style", `width:${pct}%`);
        previewProgressLabel.textContent = `Deleting ${i + 1}/${imageIds.length}…`;

        try {
          await client.deleteUpf(imageId);
          await deletePreviewCacheEntry(imageId);
          ok++;
        } catch (err) {
          failed++;
          log(
            "err",
            `delete_upf ${imageId}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      previewProgressFill.setAttribute("style", "width:100%");
      previewProgressLabel.textContent =
        failed > 0 ? `Deleted ${ok}/${imageIds.length} · ${failed} failed` : `Deleted ${ok} panorama${ok === 1 ? "" : "s"}`;
      toast(
        failed > 0 ? `Deleted ${ok}, ${failed} failed` : `Deleted ${ok} panorama${ok === 1 ? "" : "s"}`,
        failed > 0
      );
      previewProgressHideTimer = window.setTimeout(() => {
        previewProgressWrap.classList.add("hidden");
      }, 2000);
      await refreshUpfs();
    } catch (err) {
      toast(`Delete all failed: ${err instanceof Error ? err.message : err}`, true);
      previewProgressWrap.classList.add("hidden");
    } finally {
      refreshUpfBtn.disabled = !client.isConnected;
      setGalleryBulkEnabled(client.isConnected);
    }
  }

  async function onDelete(imageId: string): Promise<void> {
    if (!confirm("Delete this panorama from the camera?")) return;
    try {
      await client.deleteUpf(imageId);
      await deletePreviewCacheEntry(imageId);
      toast("Deleted");
      await refreshUpfs();
    } catch (err) {
      toast(`Delete failed: ${err instanceof Error ? err.message : err}`, true);
    }
  }

  connectBtn.onclick = onConnect;
  disconnectBtn.onclick = onDisconnect;
  refreshStatusBtn.onclick = refreshStatus;
  captureBtn.onclick = onCapture;
  loadOptionsBtn.onclick = onLoadOptions;
  refreshUpfBtn.onclick = refreshUpfs;
  downloadAllBtn.onclick = () => void onDownloadAllUpfs();
  deleteAllBtn.onclick = () => void onDeleteAllUpfs();
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onConnect();
  });

  client.on("state", (state: ConnectionState, detail) => {
    stateDot.className = `dot ${state}`;
    stateText.textContent =
      state === "connected"
        ? "Connected"
        : state === "connecting"
          ? "Connecting…"
          : state === "error"
            ? "Error"
            : "Disconnected";
    if (state === "disconnected" || state === "error") {
      setControlsEnabled(false);
      disconnectBtn.disabled = true;
      connectBtn.disabled = false;
    }
    if (detail) log("info", `${state}: ${detail}`);
  });

  client.on("log", (direction, text) => log(direction, text));
  client.on("status_update", (params) => {
    status = { ...status, ...params };
    renderStatus();
  });

  onFlatPreviewStart((imageId) => {
    const imgwrap = thumbRefs.get(imageId);
    if (imgwrap) setThumbBuilding(imgwrap);
  });

  onFlatPreviewReady((imageId, objectUrl) => {
    const imgwrap = thumbRefs.get(imageId);
    if (!imgwrap) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    setThumbPreview(imgwrap, imageId, objectUrl);
    previewsDone++;
    updatePreviewProgress();
  });

  return () => {
    clearTimeout(previewProgressHideTimer);
    stopFlatPreviewGeneration();
    revokeAllThumbObjectUrls();
    client.disconnect();
  };
}
