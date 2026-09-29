export function categoryForUrl(url: string): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "root";
  }
  return segments[0].toLowerCase();
}

export function groupUrlsByCategory(urls: string[]): Record<string, { category: string; count: number; urls: string[] }> {
  const grouped: Record<string, { category: string; count: number; urls: string[] }> = {};
  for (const url of urls) {
    const category = categoryForUrl(url);
    if (!grouped[category]) {
      grouped[category] = { category, count: 0, urls: [] };
    }
    grouped[category].urls.push(url);
    grouped[category].count += 1;
  }
  for (const bucket of Object.values(grouped)) {
    bucket.urls.sort();
  }
  return grouped;
}
