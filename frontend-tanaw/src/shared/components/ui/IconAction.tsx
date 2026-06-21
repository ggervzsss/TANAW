import type { ReactNode } from "react";

type IconActionProps = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
};

export function IconAction({ label, icon, onClick, disabled = false, disabledReason }: IconActionProps) {
  return (
    <button
      type="button"
      title={disabled ? (disabledReason ?? label) : label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="hover:border-tgreen-dark hover:text-tgreen-dark rounded-lg border border-gray-200 bg-white p-2 text-gray-500 transition disabled:cursor-not-allowed disabled:border-gray-100 disabled:bg-gray-50 disabled:text-gray-300 disabled:hover:border-gray-100 disabled:hover:text-gray-300"
    >
      {icon}
    </button>
  );
}
