import { allCountries } from "country-region-data";

// The same dataset the web onboarding uses (country-region-data, ~340 KB),
// so both apps post the same display names for countries and regions --
// matching.location_out_of_scope compares those strings against postings
// verbatim, and a code on one platform and a name on the other would split
// the same profile's results. The web's city autocomplete comes from a
// separate 8 MB dataset that is not worth shipping in the app bundle;
// cities stay free-text here.

export const countryNames: string[] = allCountries
  .map(([name]) => name)
  .sort((a, b) => a.localeCompare(b));

export function regionsForCountries(countries: string[]): string[] {
  const wanted = new Set(countries.map((name) => name.toLocaleLowerCase()));
  const regions = new Set<string>();
  for (const [name, , countryRegions] of allCountries) {
    if (!wanted.has(name.toLocaleLowerCase())) continue;
    for (const [regionName] of countryRegions) regions.add(regionName);
  }
  return Array.from(regions).sort((a, b) => a.localeCompare(b));
}
