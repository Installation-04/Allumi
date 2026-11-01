export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export function inspectFile(name: string, data: Uint8Array): { name: string; mime: string } | null {
  if (!data.length || data.length > MAX_ATTACHMENT_BYTES) return null;
  const clean = name.normalize("NFC").replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 160);
  const mime = data.length >= 33 && [137,80,78,71,13,10,26,10].every((v,i)=>data[i]===v) ? "image/png"
    : data.length >= 12 && data[data.length-2]===255 && data[data.length-1]===217 && data[0]===255 && data[1]===216 && data[2]===255 ? "image/jpeg"
    : data.length >= 12 && /^%PDF-(1\.[0-9]|2\.0)/.test(String.fromCharCode(...data.slice(0,8))) && String.fromCharCode(...data.slice(-1024)).includes("%%EOF") ? "application/pdf" : null;
  const ext = mime === "image/png" ? /\.png$/i : mime === "image/jpeg" ? /\.jpe?g$/i : /\.pdf$/i;
  return mime && clean && ext.test(clean) ? { name: clean, mime } : null;
}
