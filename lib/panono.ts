import type {
  CameraStatus,
  GetOptionListResult,
  GetUpfInfosResult,
  JsonRpcNotification,
  JsonRpcResponse,
  OptionValue,
  UpfInfo,
} from "@/lib/types";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  method: string;
  timer: number;
};

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface PanonoEvents {
  state: (state: ConnectionState, detail?: string) => void;
  notification: (note: JsonRpcNotification) => void;
  status_update: (params: Partial<CameraStatus>) => void;
  upf_infos_update: (params: { upf_infos: UpfInfo[] }) => void;
  log: (direction: "in" | "out" | "info", text: string) => void;
}

/**
 * Thin JSON-RPC 2.0 client for the Panono ball camera, spoken over the
 * WebSocket the camera exposes on its WiFi network.
 *
 * Protocol reference: florianl/panonoctl and trumank/panonoctl-rs.
 */
export class PanonoClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners: { [K in keyof PanonoEvents]: Set<PanonoEvents[K]> } = {
    state: new Set(),
    notification: new Set(),
    status_update: new Set(),
    upf_infos_update: new Set(),
    log: new Set(),
  };
  private requestTimeoutMs = 15000;

  /** e.g. "ws://192.168.80.80:12345/8086" */
  get url(): string | null {
    return this.ws?.url ?? null;
  }

  on<K extends keyof PanonoEvents>(event: K, cb: PanonoEvents[K]): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  private emit<K extends keyof PanonoEvents>(
    event: K,
    ...args: Parameters<PanonoEvents[K]>
  ): void {
    for (const cb of this.listeners[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }

  connect(url: string): Promise<void> {
    this.disconnect();
    this.emit("state", "connecting", url);
    this.emit("log", "info", `Connecting to ${url}`);

    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        this.emit("state", "error", String(err));
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        settled = true;
        this.emit("state", "connected", url);
        this.emit("log", "info", "WebSocket open");
        resolve();
      };

      ws.onmessage = (ev) => this.handleMessage(ev.data);

      ws.onerror = () => {
        this.emit("state", "error", "WebSocket error");
        this.emit("log", "info", "WebSocket error");
        if (!settled) {
          settled = true;
          reject(new Error(`Could not connect to ${url}`));
        }
      };

      ws.onclose = () => {
        this.emit("state", "disconnected");
        this.emit("log", "info", "WebSocket closed");
        this.failAllPending(new Error("Connection closed"));
      };
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.failAllPending(new Error("Disconnected"));
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    // The camera may pack multiple JSON objects separated by newlines.
    for (const line of data.split("\n")) {
      const text = line.trim();
      if (!text) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(text);
      } catch {
        this.emit("log", "in", text);
        continue;
      }
      this.emit("log", "in", text);
      this.routeMessage(msg as Record<string, unknown>);
    }
  }

  private routeMessage(msg: Record<string, unknown>): void {
    if (typeof msg.id === "number" && ("result" in msg || "error" in msg)) {
      const res = msg as unknown as JsonRpcResponse;
      const pending = this.pending.get(res.id);
      if (!pending) return;
      this.pending.delete(res.id);
      clearTimeout(pending.timer);
      if (res.error) {
        const message =
          res.error.message ?? `Error ${res.error.code} from ${pending.method}`;
        pending.reject(Object.assign(new Error(message), { rpc: res.error }));
      } else {
        pending.resolve(res.result);
      }
      return;
    }

    // Notification (no id), e.g. status_update.
    if (typeof msg.method === "string") {
      const note = msg as unknown as JsonRpcNotification;
      this.emit("notification", note);
      if (note.method === "status_update") {
        this.emit("status_update", (note.params ?? {}) as Partial<CameraStatus>);
      } else if (note.method === "upf_infos_update") {
        const params = (note.params ?? {}) as { upf_infos?: UpfInfo[] };
        this.emit("upf_infos_update", { upf_infos: params.upf_infos ?? [] });
      }
    }
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Not connected"));
    }
    const id = this.nextId++;
    const req = { jsonrpc: "2.0" as const, id, method, ...(params !== undefined ? { params } : {}) };
    const payload = JSON.stringify(req);

    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for "${method}"`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        method,
        timer,
      });

      this.emit("log", "out", payload);
      try {
        this.ws!.send(payload);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ---- High level API ----

  auth(device = "panono-webapp", force = "panono-webapp"): Promise<CameraStatus> {
    return this.call<CameraStatus>("auth", { device, force });
  }

  getStatus(): Promise<CameraStatus> {
    return this.call<CameraStatus>("get_status");
  }

  capture(): Promise<unknown> {
    return this.call("capture");
  }

  getOptionList(): Promise<GetOptionListResult> {
    return this.call<GetOptionListResult>("get_option_list");
  }

  getOptions(): Promise<Record<string, OptionValue>> {
    return this.call<Record<string, OptionValue>>("get_options");
  }

  getOption(name: string): Promise<{ name: string; value: OptionValue }> {
    return this.call("get_option", { name });
  }

  setOption(name: string, value: OptionValue): Promise<unknown> {
    return this.call("set_option", { name, value });
  }

  getUpfInfos(): Promise<GetUpfInfosResult> {
    return this.call<GetUpfInfosResult>("get_upf_infos");
  }

  deleteUpf(imageId: string): Promise<unknown> {
    return this.call("delete_upf", { image_id: imageId });
  }
}
