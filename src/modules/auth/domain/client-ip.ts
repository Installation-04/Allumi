// Client address as seen by the trusted reverse proxy (no I/O).

const GROUP = /^[0-9a-f]{1,4}$/i;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** First 64 bits of an IPv6 address: a whole /64 belongs to one subscriber, so it shares one budget. */
function ipv6Prefix(address: string): string | null {
  const [bare = ""] = address.split("%"); // drop a zone id
  const halves = bare.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    if (head.length + tail.length > 7) return null;
    groups = [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8 || !groups.every((group) => GROUP.test(group))) return null;
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().padStart(4, "0"))
    .join(":")}::/64`;
}

/**
 * Picks the client from an X-Forwarded-For header. Each proxy appends the address it saw, so only
 * the entry appended by the last trusted proxy can be believed: count `trustedHops` from the right.
 * Anything to the left may have been written by the client.
 */
export function clientIpFromForwardedFor(header: string | null | undefined, trustedHops: number): string {
  const entries = (header ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const entry = entries[entries.length - trustedHops];
  if (!entry || entry.length > 64) return "unknown";
  const mapped = IPV4_MAPPED.exec(entry);
  if (mapped?.[1]) return mapped[1];
  return entry.includes(":") ? (ipv6Prefix(entry) ?? entry.toLowerCase()) : entry;
}
