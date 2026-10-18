/** `J-00042`: a prefix, then the number padded with zeros. Display only: the stored number is the integer. */
export function formatNumber(prefix: string, padding: number, value: bigint): string {
  return `${prefix}${value.toString().padStart(padding, "0")}`;
}
