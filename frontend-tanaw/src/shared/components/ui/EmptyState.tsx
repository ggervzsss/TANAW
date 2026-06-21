import type { LucideIcon } from "lucide-react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  minHeightClassName?: string;
};

export function EmptyState({ icon: Icon, title, description, minHeightClassName = "min-h-55" }: EmptyStateProps) {
  return (
    <div className={`flex ${minHeightClassName} flex-col items-center justify-center px-6 py-10 text-center`}>
      <span className="bg-tgreen-dark/10 text-tgreen-dark flex h-12 w-12 items-center justify-center rounded-xl">
        <Icon size={22} />
      </span>
      <p className="mt-4 text-base font-bold text-gray-900">{title}</p>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-gray-500">{description}</p>
    </div>
  );
}
