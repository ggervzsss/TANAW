import { AlertTriangle } from "lucide-react";

type CameraValidationWarningsProps = {
  warnings: string[];
};

export function CameraValidationWarnings({ warnings }: CameraValidationWarningsProps) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((warning) => (
        <div key={warning} className="flex items-start gap-2 rounded-tanaw-md border border-(--tanaw-warning-line) bg-(--tanaw-warning-bg) p-2.5 text-(--tanaw-warning-text)">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs leading-relaxed font-medium">{warning}</p>
        </div>
      ))}
    </div>
  );
}
