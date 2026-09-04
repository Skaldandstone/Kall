export type SearchGroup = { id: string; label: string; terms: string[] };

/** Preserve every part of the generated query, including exclusions outside
 * parentheses. Rebuilding only the OR groups silently discarded exclusions. */
export function parseQuery(value: string): SearchGroup[] {
  const groups: SearchGroup[] = [];
  const tokens = value.matchAll(/\(([^()]*)\)|(-?)(?:"([^"]*)"|([^\s()]+))/g);
  for (const token of tokens) {
    const grouped = token[1] !== undefined;
    const raw = grouped ? token[1] : token[3] ?? token[4];
    const terms = [...new Set((grouped ? raw.split(/\s+OR\s+/i) : [raw])
      .map((term) => term.trim().replace(/^(?:site|intitle):/i, '').replace(/^['"]|['"]$/g, '').trim()).filter(Boolean))];
    if (!terms.length) continue;
    const isSites = grouped ? /^\s*site:/i.test(raw) : /^site:/i.test(raw);
    // intitle: (see build_search_intent) restricts a title match to a page's
    // own title rather than its body text -- a Google search operator, not
    // something anyone typed or should see quoted back at them as a term.
    const isTitles = grouped ? /^\s*intitle:/i.test(raw) : /^intitle:/i.test(raw);
    const label = token[2] === '-' ? 'Excluded terms' : isSites ? 'Sites' : isTitles ? 'Job titles' : 'Search terms';
    groups.push({ id: `query-${groups.length}`, label, terms });
  }
  return groups;
}

export function buildQuery(groups: SearchGroup[]): string {
  return groups.filter((group) => group.terms.length).map((group) => {
    const terms = group.terms.map((term) => {
      const clean = term.replace(/"/g, '');
      if (group.label === 'Sites') return `site:${clean}`;
      if (group.label === 'Job titles') return `intitle:"${clean}"`;
      return `${group.label === 'Excluded terms' ? '-' : ''}"${clean}"`;
    });
    return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
  }).join(' ');
}
