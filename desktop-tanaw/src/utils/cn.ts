type ClassValue = string | false | null | undefined;

export const cn = (...inputs: ClassValue[]) => inputs.filter(Boolean).join(" ");
