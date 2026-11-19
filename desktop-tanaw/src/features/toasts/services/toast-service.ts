import toast, { type ToastOptions } from "react-hot-toast";

type ToastTone = "success" | "error" | "warning" | "info";

const durations: Record<ToastTone, number> = { success: 4500, error: 9500, warning: 7500, info: 5000 };

function notify(tone: ToastTone, message: string, id: string = `${tone}:${message}`) {
  const options: ToastOptions = {
    id,
    className: `tanaw-toast tanaw-toast--${tone}`,
    duration: durations[tone],
    removeDelay: 400,
    ariaProps: tone === "error" ? { role: "alert", "aria-live": "assertive" } : { role: "status", "aria-live": "polite" },
  };
  return tone === "success" ? toast.success(message, options) : tone === "error" ? toast.error(message, options) : toast(message, options);
}

export const notifySuccess = (message: string, id?: string) => notify("success", message, id);
export const notifyError = (message: string, id?: string) => notify("error", message, id);
export const notifyWarning = (message: string, id?: string) => notify("warning", message, id);
export const notifyInfo = (message: string, id?: string) => notify("info", message, id);
