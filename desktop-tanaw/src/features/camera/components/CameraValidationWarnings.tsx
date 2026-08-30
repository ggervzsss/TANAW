import { AlertTriangle } from "lucide-react";

type CameraValidationWarningsProps = {
  warnings: string[];
};

export function CameraValidationWarnings({ warnings }: CameraValidationWarningsProps) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((warning) => (
        <div key={warning} className="flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 p-2.5 shadow-inner dark:border-orange-300/20 dark:bg-orange-300/8 dark:text-orange-100">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange-600" />
          <p className="text-[11px] leading-relaxed font-medium text-orange-800">{warning}</p>
        </div>
      ))}
    </div>
  );
}
