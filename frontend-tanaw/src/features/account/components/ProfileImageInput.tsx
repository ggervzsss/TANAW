import { Upload } from "lucide-react";
import type { ChangeEvent } from "react";
import type { UserRole } from "@/shared/types";

export function ProfileImageInput({
  displayImageDataUrl,
  initials,
  onChange,
  role,
}: {
  displayImageDataUrl: string | null;
  initials: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  role: UserRole;
}) {
  return (
    <label
      htmlFor={`profile-image-${role}`}
      className="group hover:border-tanaw-green relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-slate-300 bg-slate-50 shadow-sm transition"
    >
      {displayImageDataUrl ? (
        <img src={displayImageDataUrl} alt="Profile preview" className="h-full w-full object-cover" />
      ) : (
        <span className="font-display text-tanaw-navy text-2xl font-bold transition-opacity group-hover:opacity-0">{initials || "TU"}</span>
      )}
      <span className="bg-tanaw-green/85 absolute inset-0 flex items-center justify-center text-white opacity-0 transition-opacity group-hover:opacity-100">
        <Upload size={20} />
      </span>
      <input id={`profile-image-${role}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={onChange} className="sr-only" />
    </label>
  );
}
