function variants(value: string): string[] {
  const lower = value.toLocaleLowerCase("de-DE").trim();
  return [lower, lower.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss"),
    lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss")];
}

export function matchesRegionSearch(text: string, query: string): boolean {
  const haystacks = variants(text);
  return query.trim().split(/\s+/).filter(Boolean).every((token) =>
    variants(token).some((needle) => haystacks.some((haystack) => haystack.includes(needle))));
}
