// Types derived from the Panono JSON-RPC API (API v4.23 / firmware 4.2.873),
// cross-referenced with florianl/panonoctl and trumank/panonoctl-rs.

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message?: string;
  details?: unknown;
  request?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: JsonRpcError;
  warning?: { code: number; message: string };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface StorageInfo {
  total: number;
  usage: number;
}

// Field names confirmed against firmware 4.2.873 / API 4.23.
export interface CameraStatus {
  auth_token?: string;
  api_version?: string;
  capture_available: boolean;
  current_time?: string;
  device_id?: string;
  firmware_update_url?: string;
  firmware_version?: string;
  is_auth?: boolean;
  serial_number?: string;
  /** Battery charge 0–100; -1 means on external power (percentage unknown). */
  battery_value?: number;
  /** e.g. "charging", "not_charging". */
  charging_status?: string;
  auto_poweroff_count_down?: number;
  storage?: Record<string, StorageInfo>;
  update_ready?: boolean;
  [key: string]: unknown;
}

export interface UpfInfo {
  capture_date: string;
  image_id: string;
  preview_url: string;
  preview_status?: string;
  /** Size of the preview .upf in bytes. */
  size: number;
  /** Size of the full-resolution .upf in bytes. */
  upf_size?: number;
  upf_url: string;
  upf_status?: string;
  serial_number?: string;
  trigger?: string;
  location?: { lat: number; lng: number };
}

export interface GetUpfInfosResult {
  is_full: boolean;
  upf_infos: UpfInfo[];
}

export type OptionConstraint<T = unknown> =
  | { constraint: "values"; value: T[] }
  | { constraint: "min"; value: T }
  | { constraint: "max"; value: T };

export interface CameraOption {
  name: string;
  type: "Boolean" | "Enumeration" | "Number" | "Integer";
  constraints: OptionConstraint[];
}

export interface GetOptionListResult {
  options: CameraOption[];
}

export type OptionValue = string | number | boolean;
