export function normalizeSearchQuery(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeSearchText(value) {
  return normalizeSearchQuery(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-AR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function getSearchTerms(value) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

export function getPrimarySearchTerm(value) {
  return getSearchTerms(value).reduce(
    (primary, term) => (term.length > primary.length ? term : primary),
    "",
  );
}

export function matchesEverySearchTerm(value, query) {
  const terms = getSearchTerms(query);
  if (!terms.length) return true;

  const searchableText = normalizeSearchText(value);
  return terms.every((term) => searchableText.includes(term));
}
