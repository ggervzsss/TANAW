export function wrappedPdfLines(text: string, maxWidth: number, size: number) {
  const approximateChars = Math.max(4, Math.floor(maxWidth / (size * 0.52)));
  return wrapText(sanitizePdfText(text), approximateChars);
}

export function escapePdfText(value: string) {
  return Array.from(sanitizePdfText(value), (character) => {
    if (character === "\\") return "\\\\";
    if (character === "(") return "\\(";
    if (character === ")") return "\\)";
    const code = character.charCodeAt(0);
    return code > 0x7e ? `\\${code.toString(8).padStart(3, "0")}` : character;
  }).join("");
}

export function sanitizePdfText(value: string) {
  return value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFC")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

function wrapText(text: string, maxChars: number) {
  return text.split("\n").flatMap((line) => {
    const lines: string[] = [];
    let remaining = line.trim();
    while (remaining.length > maxChars) {
      const candidate = remaining.slice(0, maxChars);
      const breakIndex = Math.max(candidate.search(/\s+\S*$/), candidate.lastIndexOf("-") + 1);
      if (breakIndex > 0) {
        lines.push(remaining.slice(0, breakIndex).trimEnd());
        remaining = remaining.slice(breakIndex).trimStart();
      } else {
        lines.push(remaining.slice(0, maxChars));
        remaining = remaining.slice(maxChars);
      }
    }
    if (remaining) lines.push(remaining);
    return lines.length ? lines : [""];
  });
}
