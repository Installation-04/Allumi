// A query-string value as Next hands it over: a string, or an array when the parameter is repeated (?a=1&a=2).
// Pages read the first one, drop control characters (PostgreSQL refuses NUL) and cap the length.
export function searchText(value: string | string[] | undefined, max = 200): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const cleaned = (first ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return cleaned === "" ? undefined : cleaned;
}
