const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

export function formatDecimal(value: string | null, fallback = "Not recorded") {
  if (value === null) return fallback;
  const parsed = parseDecimal(value);
  if (!parsed) return "Invalid recorded value";
  const grouped = parsed.integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${parsed.negative ? "-" : ""}${grouped}${parsed.fraction ? `.${parsed.fraction}` : ""}`;
}

export function sumDecimals(values: Array<string | null>) {
  const parsed = values.map((value) => (value === null ? null : parseDecimal(value)));
  if (parsed.some((value) => value === null)) return null;
  const exact = parsed as ParsedDecimal[];
  const scale = exact.reduce((maximum, value) => Math.max(maximum, value.fraction.length), 0);
  const total = exact.reduce((sum, value) => {
    const digits = BigInt(`${value.integer}${value.fraction.padEnd(scale, "0")}`);
    return sum + (value.negative ? -digits : digits);
  }, 0n);
  return decimalFromScaledInteger(total, scale);
}

export function decimalToChartNumber(value: string | null) {
  if (value === null || !parseDecimal(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

type ParsedDecimal = {
  negative: boolean;
  integer: string;
  fraction: string;
};

function parseDecimal(value: string): ParsedDecimal | null {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) return null;
  return {
    negative: match[1] === "-",
    integer: (match[2] ?? "0").replace(/^0+(?=\d)/, ""),
    fraction: match[3] ?? "",
  };
}

function decimalFromScaledInteger(value: bigint, scale: number) {
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const integer = scale === 0 ? absolute : absolute.slice(0, -scale);
  const fraction = scale === 0 ? "" : absolute.slice(-scale);
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}
