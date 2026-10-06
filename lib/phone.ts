export function normalizePhone(input: string): string | null {
  let d = input.replace(/[^\d]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && /^[6-9]/.test(d)) d = "91" + d;
  else if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d[1])) d = "91" + d.slice(1);
  return /^91[6-9]\d{9}$/.test(d) ? "+" + d : null;
}
