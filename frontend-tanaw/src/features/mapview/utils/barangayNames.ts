/* Barangay name matching shared by the map and the screens that group enterprises by barangay. */

const barangayFilterAliases: Record<string, string> = {
  brgypacitai: "pacita1",
  brgypacitaii: "pacita2",
  pacitai: "pacita1",
  pacitaone: "pacita1",
  pacitaii: "pacita2",
  pacitatwo: "pacita2",
  sanlorenzoruiz: "sanlorenzo",
};

/** A key that ignores case, accents, "Barangay"/"Brgy" and spelling variants such as "Pacita I" and "Pacita 1". */
export function normalizeBarangayName(value: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bbarangay\b/g, "")
    .replace(/\bbrgy\b/g, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]/g, "");

  return barangayFilterAliases[normalized] ?? normalized;
}
