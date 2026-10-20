function serverUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("Use the server origin only / Utilisez l’adresse du serveur sans chemin.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("HTTPS required / HTTPS requis (sauf localhost).");
  return url.origin;
}
function allowedNavigation(value, origin) {
  try { return new URL(value).origin === origin && ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}
module.exports = { serverUrl, allowedNavigation };
