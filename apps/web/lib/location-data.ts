import { allCountries } from 'country-region-data';
import { City } from 'country-state-city';

export type LocationOption = {
  code: string;
  name: string;
};

export const countries: LocationOption[] = allCountries
  .map(([name, code]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function regionsForCountry(countryCode: string): LocationOption[] {
  const country = allCountries.find(([, code]) => code === countryCode);
  if (!country) return [];

  return country[2]
    .map(([name, code]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function countryName(countryCode: string): string | null {
  return allCountries.find(([, code]) => code === countryCode)?.[0] ?? null;
}

/** City names for a country/state pair, for the onboarding city picker's
 * autocomplete list. country-region-data and country-state-city happen to
 * share the same ISO-3166-2 state codes for the countries both cover, so a
 * region's own `code` (not its display name) is what this expects. Returns
 * an empty list for any country/state country-state-city doesn't carry --
 * the city field stays a free-text chip input either way, so a miss here
 * just means no autocomplete, not a blocked field. */
export function citiesForRegion(countryCode: string, regionCode: string): string[] {
  try {
    return City.getCitiesOfState(countryCode, regionCode).map((city) => city.name);
  } catch {
    return [];
  }
}

/** A safety ceiling for how many autocomplete options to hand the browser at
 * once across every selected state/region combined -- not a quality filter.
 * country-state-city carries no population data to rank by, so there is no
 * honest way to keep only "major" cities; truncating early instead of
 * capping generously would silently drop real ones (a first pass at 500
 * cut California's list off before it ever reached Los Angeles or San
 * Francisco, both later alphabetically). This just guards against combining
 * many regions' full lists into one very large DOM datalist. */
export const CITY_SUGGESTION_CEILING = 8000;
