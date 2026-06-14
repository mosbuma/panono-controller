import { el } from "@/lib/util";

/** Uppercase alphanumerics with ambiguous glyphs removed (0/O, 1/l/I, etc.). */
export const UNAMBIGUOUS_CONFIRM_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateConfirmCode(length = 8): string {
  const chars = UNAMBIGUOUS_CONFIRM_CHARS;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i]! % chars.length];
  }
  return out;
}

export interface TypedConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  codeLength?: number;
}

/** Modal dialog: user must type an exact random code to confirm. Resolves true/false. */
export function showTypedConfirmDialog(opts: TypedConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const code = generateConfirmCode(opts.codeLength ?? 8);
    const confirmLabel = opts.confirmLabel ?? "Confirm";

    const input = el("input", {
      type: "text",
      class: "confirm-code-input",
      autocomplete: "off",
      spellcheck: false,
      autocapitalize: "off",
    }) as HTMLInputElement;

    const confirmBtn = el("button", { class: "danger" }, [confirmLabel]) as HTMLButtonElement;
    confirmBtn.disabled = true;

    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };

    const syncConfirm = (): void => {
      confirmBtn.disabled = input.value !== code;
    };

    input.addEventListener("input", () => {
      const upper = input.value.toUpperCase();
      if (upper !== input.value) input.value = upper;
      syncConfirm();
    });

    const cancelBtn = el("button", {}, ["Cancel"]) as HTMLButtonElement;
    cancelBtn.onclick = () => finish(false);
    confirmBtn.onclick = () => {
      if (input.value === code) finish(true);
    };

    const dialog = el("div", { class: "confirm-dialog", role: "dialog" }, [
        el("h3", { class: "confirm-title" }, [opts.title]),
        el("p", { class: "confirm-message" }, [opts.message]),
        el("p", { class: "confirm-hint" }, [
          "Type this code to proceed (letters are uppercase, no ",
          el("code", {}, ["0"]),
          "/",
          el("code", {}, ["O"]),
          ", ",
          el("code", {}, ["1"]),
          "/",
          el("code", {}, ["l"]),
          ", etc.):",
        ]),
        el("div", { class: "confirm-code" }, [code]),
        input,
        el("div", { class: "confirm-actions" }, [cancelBtn, confirmBtn]),
      ]);
    dialog.setAttribute("aria-modal", "true");

    const overlay = el("div", { class: "confirm-overlay" }, [dialog]);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") finish(false);
    };
    document.addEventListener("keydown", onKeyDown);

    document.body.append(overlay);
    input.focus();
  });
}
