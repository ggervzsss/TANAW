import type { ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { ModalPortal } from "./ModalPortal";

type ConfirmationDialogVariant = "danger" | "default";

type ConfirmationDialogProps = {
  cancelLabel?: string;
  children: ReactNode;
  confirmLabel: string;
  icon?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  variant?: ConfirmationDialogVariant;
};

const variantStyles: Record<ConfirmationDialogVariant, { accent: string; button: string; icon: string }> = {
  danger: {
    accent: "border-tanaw-red",
    button: "bg-[#a40e0e] hover:bg-[#7f0b0b]",
    icon: "text-tanaw-red",
  },
  default: {
    accent: "border-[#065f46]",
    button: "bg-[#065f46] hover:bg-[#044a36]",
    icon: "text-[#065f46]",
  },
};

export function ConfirmationDialog({ cancelLabel = "Cancel", children, confirmLabel, icon, onCancel, onConfirm, title, variant = "default" }: ConfirmationDialogProps) {
  const styles = variantStyles[variant];

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-[#111827]/70 p-4 backdrop-blur-md" onPointerDown={onCancel}>
        <div className={`animate-in fade-in w-full max-w-md rounded-2xl border-t-4 ${styles.accent} bg-white p-6 shadow-2xl`} onPointerDown={(event) => event.stopPropagation()}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <h3 className="flex items-center gap-2 text-lg font-bold text-[#111827]">
              <span className={styles.icon}>{icon ?? <AlertTriangle size={20} />}</span>
              {title}
            </h3>
            <button onClick={onCancel} className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#111827]" aria-label="Close dialog">
              <X size={18} />
            </button>
          </div>

          <div className="mb-6 text-sm leading-relaxed text-gray-600">{children}</div>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button onClick={onCancel} className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-[#111827] transition-colors hover:bg-gray-50">
              {cancelLabel}
            </button>
            <button onClick={onConfirm} className={`rounded-xl px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors ${styles.button}`}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
