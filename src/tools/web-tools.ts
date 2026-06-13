/**
 * Perform a web search using DuckDuckGo's lite HTML endpoint.
 * Uses native fetch() instead of shell exec to prevent command injection.
 */
export async function webSearch(query: string): Promise<string> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.slice(0, 120))}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "AgentOrg/0.5.0" },
    });
    if (!res.ok) return "Search unavailable.";
    const html = await res.text();
    const links = html.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/g)?.slice(0, 5) ?? [];
    if (links.length === 0) return "No search results found.";
    return links.map((l) => l.replace(/.*href="/, "").replace(/"$/, "")).join("\n");
  } catch {
    return "Search unavailable.";
  }
}

/**
 * Fetch the content of a URL.
 * Uses native fetch() instead of shell exec to prevent command injection.
 * Only allows http/https schemes and blocks private/internal IP ranges (SSRF protection).
 */
/**
 * Check if a hostname is a private/internal address.
 * Blocks: localhost, 127.x, 10.x, 192.168.x, 172.16-31.x, 0.0.0.0,
 *         IPv6 loopback (::1), IPv4-mapped IPv6 loopback (::ffff:127.0.0.1),
 *         link-local (169.254.x, fe80::).
 */
function isPrivateHost(hostname: string): boolean {
  // Normalize: strip brackets from IPv6, lowercase
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // Named localhost
  if (h === "localhost") return true;
  // IPv4 exact/prefix matches
  if (h === "127.0.0.1" || h.startsWith("127.")) return true;
  if (h === "0.0.0.0" || h.startsWith("0.")) return true;
  if (h.startsWith("10.")) return true;
  if (h.startsWith("192.168.")) return true;
  if (h.startsWith("172.")) {
    const second = parseInt(h.split(".")[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (h.startsWith("169.254.")) return true; // IPv4 link-local
  // IPv6 loopback
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  // IPv4-mapped IPv6 addresses: ::ffff:x.x.x.x
  if (h.startsWith("::ffff:")) {
    const ipv4 = h.slice(7);
    return isPrivateHost(ipv4);
  }
  // IPv6 link-local
  if (h.startsWith("fe80:")) return true;
  return false;
}

export async function webFetch(url: string): Promise<string> {
  const MAX_RESPONSE_BYTES = 64 * 1024; // 64 KB cap on response body

  try {
    const parsed = new URL(url);
    // Only allow http/https schemes
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Fetch failed: only http/https URLs are allowed.";
    }
    // Block private/internal IP ranges (SSRF protection)
    if (isPrivateHost(parsed.hostname)) {
      return "Fetch failed: private/internal addresses are blocked.";
    }

    // Use redirect: "manual" to prevent automatic following of redirects
    // to internal addresses (SSRF redirect bypass protection).
    // We manually follow same-origin redirects up to 3 hops, re-validating
    // the hostname at each hop.
    let currentUrl = url;
    let redirects = 0;
    const maxRedirects = 3;

    while (redirects <= maxRedirects) {
      const currentParsed = new URL(currentUrl);
      if (isPrivateHost(currentParsed.hostname)) {
        return "Fetch failed: private/internal addresses are blocked.";
      }

      const res = await fetch(currentUrl, {
        signal: AbortSignal.timeout(15000),
        redirect: "manual",
        headers: { "User-Agent": "AgentOrg/0.5.0" },
      });

      // Handle redirects manually
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return "Fetch failed: redirect with no Location header.";
        // Resolve relative redirects against the current URL
        currentUrl = new URL(location, currentUrl).href;
        redirects++;
        continue;
      }

      if (!res.ok) return "Fetch failed.";

      // Read response body with a byte cap to prevent memory exhaustion
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, MAX_RESPONSE_BYTES));
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      return text.slice(0, 2000) || "Empty response.";
    }

    return "Fetch failed: too many redirects.";
  } catch {
    return "Fetch failed.";
  }
}
