import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clientIpFromForwardedFor } from "@/modules/auth/domain/client-ip";

describe("client address behind a reverse proxy", () => {
  it("believes the entry appended by the trusted proxy, not what the client wrote", () => {
    expect(clientIpFromForwardedFor("203.0.113.7", 1)).toBe("203.0.113.7");
    // the client sent "6.6.6.6"; the proxy appended the address it really saw
    expect(clientIpFromForwardedFor("6.6.6.6, 203.0.113.7", 1)).toBe("203.0.113.7");
    // two trusted hops (CDN then proxy): skip the entry the CDN appended
    expect(clientIpFromForwardedFor("6.6.6.6, 203.0.113.7, 198.51.100.2", 2)).toBe("203.0.113.7");
  });

  it("falls back to one shared key when the header is missing or too short", () => {
    expect(clientIpFromForwardedFor(null, 1)).toBe("unknown");
    expect(clientIpFromForwardedFor("", 1)).toBe("unknown");
    expect(clientIpFromForwardedFor("203.0.113.7", 2)).toBe("unknown");
    expect(clientIpFromForwardedFor("x".repeat(100), 1)).toBe("unknown");
  });

  it("gives a whole IPv6 /64 one budget, and unwraps IPv4-mapped addresses", () => {
    expect(clientIpFromForwardedFor("2001:db8:1:2:aaaa:bbbb:cccc:dddd", 1)).toBe("2001:0db8:0001:0002::/64");
    expect(clientIpFromForwardedFor("2001:DB8:1:2::1", 1)).toBe("2001:0db8:0001:0002::/64");
    expect(clientIpFromForwardedFor("2001:db8::1", 1)).toBe("2001:0db8:0000:0000::/64");
    expect(clientIpFromForwardedFor("::ffff:192.0.2.5", 1)).toBe("192.0.2.5");
    expect(clientIpFromForwardedFor("not:an:address", 1)).toBe("not:an:address");
  });

  it("property: addresses of one /64 share a key, other prefixes do not", () => {
    const group = fc.integer({ min: 0, max: 0xffff }).map((n) => n.toString(16));
    fc.assert(
      fc.property(fc.array(group, { minLength: 4, maxLength: 4 }), fc.array(group, { minLength: 4, maxLength: 4 }), fc.array(group, { minLength: 4, maxLength: 4 }), (prefix, a, b) => {
        const first = clientIpFromForwardedFor([...prefix, ...a].join(":"), 1);
        const second = clientIpFromForwardedFor([...prefix, ...b].join(":"), 1);
        expect(first).toBe(second);
      }),
      { numRuns: 200 },
    );
  });
});
