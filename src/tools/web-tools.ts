import { execSync } from "node:child_process";

export function webSearch(query: string): string {
  try {
    // Use curl to hit DuckDuckGo's lite HTML endpoint
    const result = execSync(
      `curl -s "https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}" | grep -oP '(?<=<a rel="nofollow" class="result__a" href=")[^"]*' | head -5`,
      { stdio: "pipe", timeout: 10000 }
    ).toString();
    return result || "No search results found.";
  } catch {
    return "Search unavailable.";
  }
}

export function webFetch(url: string): string {
  try {
    const result = execSync(`curl -sL --max-time 10 "${url}" | head -c 2000`, {
      stdio: "pipe",
      timeout: 15000,
    }).toString();
    return result || "Empty response.";
  } catch {
    return "Fetch failed.";
  }
}
