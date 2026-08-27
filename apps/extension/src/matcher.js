/**
 * Decides which field of an employer's application form each Kall value belongs in.
 *
 * Deliberately dependency-free and DOM-shape-agnostic: it takes plain
 * descriptors, not live elements, so it can be reasoned about and tested
 * without a browser. The content script is responsible for reading
 * descriptors out of the page and writing values back.
 *
 * Two rules that are not negotiable, because they are the difference between
 * a helpful tool and one that puts words in someone's mouth on a legal form:
 *
 * 1. A field is only filled on a confident match. An unrecognised input is
 *    left alone and reported, never guessed at.
 * 2. `requires_confirmation` values (EEO, work authorization) are matched but
 *    never written automatically. They are returned as proposals for the user
 *    to accept, because Kall must not attest to legal questions for them.
 */

/** Tokens that identify a form control, in rough order of trustworthiness. */
const SIGNAL_KEYS = ['autocomplete', 'name', 'id', 'label', 'placeholder', 'ariaLabel'];

/**
 * What each Kall field path looks like in the wild.
 *
 * `autocomplete` entries match the HTML autocomplete token exactly and win
 * outright -- when a form declares `autocomplete="email"` there is no
 * ambiguity left to resolve. Everything else is matched on normalized text
 * fragments, requiring `any` to hit and no `never` token to appear.
 */
const RULES = {
  'identity.legal_name': {
    autocomplete: ['name'],
    any: ['full name', 'legal name', 'your name', 'candidate name', 'name'],
    // "company name", "school name" and friends are not the applicant's name.
    // 'given' and 'family' matter as much as 'first'/'last': the autocomplete
    // tokens are "given-name" and "family-name", both of which contain "name"
    // and would otherwise attract the whole name into half a field.
    never: ['user', 'company', 'employer', 'school', 'university', 'reference', 'file',
            'first', 'last', 'middle', 'given', 'family'],
  },
  // Greenhouse, Lever, Workday and Ashby all split the name in two rather than
  // asking for it whole. Checked against a live Greenhouse form: the controls
  // declare autocomplete="given-name"/"family-name" and are labelled "First
  // Name"/"Last Name". Without these the most universal field on the form went
  // unfilled, which is the sort of gap only a real form reveals.
  'identity.first_name': {
    autocomplete: ['given-name'],
    any: ['first name', 'given name', 'forename'],
    never: ['last', 'family', 'company', 'employer', 'school', 'reference'],
  },
  'identity.last_name': {
    autocomplete: ['family-name'],
    any: ['last name', 'family name', 'surname'],
    never: ['first', 'given', 'company', 'employer', 'school', 'reference'],
  },
  'identity.email': {
    autocomplete: ['email'],
    any: ['email', 'e-mail'],
    never: ['confirm', 'verify', 'reference', 'manager'],
    type: 'email',
  },
  'identity.phone': {
    autocomplete: ['tel'],
    any: ['phone', 'mobile', 'telephone', 'cell'],
    never: ['reference', 'emergency', 'country code', 'extension'],
    type: 'tel',
  },
  'identity.address': {
    autocomplete: ['street-address', 'address-line1'],
    any: ['street address', 'address line 1', 'address1', 'street'],
    never: ['email', 'line 2', 'address2', 'city', 'state', 'zip', 'postal', 'country'],
  },
  'identity.postal_code': {
    autocomplete: ['postal-code'],
    any: ['postal code', 'postcode', 'zip code', 'zip'],
    never: [],
  },
  'identity.city': {
    autocomplete: ['address-level2'],
    any: ['city', 'town', 'locality'],
    never: ['citizen'],
  },
  'identity.state_region': {
    autocomplete: ['address-level1'],
    any: ['state', 'province', 'region', 'county'],
    // "state" appears inside "veteran status" and "disability status".
    never: ['status', 'united states'],
  },
  'identity.country': {
    autocomplete: ['country', 'country-name'],
    any: ['country'],
    never: ['code', 'citizenship'],
  },
  'identity.linkedin_url': { autocomplete: [], any: ['linkedin'], never: [] },
  'identity.github_url': { autocomplete: [], any: ['github', 'git hub'], never: [] },
  'identity.portfolio_urls': {
    autocomplete: [],
    any: ['portfolio', 'website', 'personal site', 'blog'],
    never: ['company'],
  },
  'employment.current_employer': {
    autocomplete: ['organization'],
    any: ['current employer', 'current company', 'most recent employer', 'employer', 'company'],
    never: ['school', 'university', 'reference'],
  },
  'employment.current_title': {
    autocomplete: ['organization-title'],
    any: ['current title', 'job title', 'most recent title', 'position title', 'title'],
    never: ['school', 'degree', 'mr', 'mrs', 'ms'],
  },
  'education.most_recent': {
    autocomplete: [],
    any: ['school', 'university', 'college', 'institution', 'education'],
    never: ['degree', 'major', 'gpa'],
  },
  'work_authorization.authorization_type': {
    autocomplete: [],
    any: ['work authorization', 'authorized to work', 'right to work', 'work permit'],
    never: [],
  },
  'work_authorization.citizenship': {
    autocomplete: [],
    any: ['citizenship', 'citizen'],
    never: [],
  },
  'work_authorization.requires_current_sponsorship': {
    autocomplete: [],
    any: ['require sponsorship', 'need sponsorship', 'sponsorship now', 'currently require'],
    never: ['future'],
  },
  'work_authorization.requires_future_sponsorship': {
    autocomplete: [],
    any: ['future sponsorship', 'will you require sponsorship', 'in the future'],
    never: [],
  },
  'eeo.veteran_status': { autocomplete: [], any: ['veteran', 'protected veteran'], never: [] },
  'eeo.disability_status': { autocomplete: [], any: ['disability', 'disabled'], never: [] },
  'eeo.race_ethnicity': { autocomplete: [], any: ['race', 'ethnicity', 'hispanic'], never: [] },
  'eeo.gender_identity': { autocomplete: [], any: ['gender', 'sex '], never: [] },
};

/** Lowercase, collapse whitespace, and strip the punctuation forms differ on. */
export function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_\-*:]+/g, ' ')
    .replace(/[^a-z0-9+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The searchable text for a control, most trustworthy signals first. */
function signalsOf(field) {
  return SIGNAL_KEYS.map((key) => normalize(field[key])).filter(Boolean);
}

/**
 * Score how well `field` matches `rule`, or 0 for no match.
 *
 * Higher is better. An exact autocomplete token scores far above any text
 * match, so a form that declares its semantics is always believed over one we
 * are inferring from labels.
 */
function score(field, rule) {
  const autocomplete = normalize(field.autocomplete);
  if (autocomplete && rule.autocomplete.includes(autocomplete)) return 1000;

  const signals = signalsOf(field);
  if (signals.some((text) => rule.never.some((token) => text.includes(token)))) return 0;

  let best = 0;
  for (const text of signals) {
    for (const token of rule.any) {
      if (!text.includes(token)) continue;
      // Prefer the longest matching token: "current employer" beating
      // "employer" is what keeps a two-employer form from filling both the
      // same way. Prefer an exact label over a substring for the same reason.
      const weight = token.length + (text === token ? 50 : 0);
      if (weight > best) best = weight;
    }
  }
  if (best && rule.type && field.type && field.type !== rule.type) {
    // A declared input type that disagrees is a strong negative signal, but
    // not fatal: plenty of forms use type="text" for everything.
    best = Math.max(1, best - 10);
  }
  return best;
}

/**
 * Match Kall's autofill pack against the form controls found on a page.
 *
 * Returns:
 *   `fill`     - confident matches safe to write immediately.
 *   `confirm`  - confident matches the user must approve first (EEO, work
 *                authorization). Never written automatically.
 *   `unmatched`- pack values with nowhere obvious to go, reported so a
 *                half-filled form is explainable rather than mysterious.
 *
 * Each form control receives at most one value, and each value goes to at
 * most one control: a contested control goes to whichever value matched it
 * more strongly, and the loser is reported as unmatched.
 */
/**
 * Split a full name into the first/last parts a two-field form wants.
 *
 * The first token is the first name and everything after it is the last, which
 * is the same convention the mobile sign-up uses. It is wrong for some names,
 * which is exactly why the value stays visible for the user to correct rather
 * than being submitted on their behalf.
 */
function splitName(packField) {
  const parts = String(packField.value ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [];
  return [
    { ...packField, path: 'identity.first_name', label: 'First name', value: parts[0] },
    { ...packField, path: 'identity.last_name', label: 'Last name', value: parts.slice(1).join(' ') },
  ];
}

export function matchFields(packFields, formFields) {
  const whole = packFields.find((f) => f.path === 'identity.legal_name');
  const derived = whole ? splitName(whole) : [];
  packFields = [...packFields, ...derived];

  const candidates = [];
  for (const packField of packFields) {
    const rule = RULES[packField.path];
    if (!rule) continue;
    for (const formField of formFields) {
      const value = score(formField, rule);
      if (value > 0) candidates.push({ packField, formField, score: value });
    }
  }

  // Strongest matches win first, so a weaker claim on the same control loses
  // rather than overwriting it.
  candidates.sort((a, b) => b.score - a.score);

  const usedControls = new Set();
  const matchedPaths = new Set();
  const fill = [];
  const confirm = [];

  for (const candidate of candidates) {
    const controlKey = candidate.formField.ref;
    if (usedControls.has(controlKey) || matchedPaths.has(candidate.packField.path)) continue;
    usedControls.add(controlKey);
    matchedPaths.add(candidate.packField.path);

    const entry = {
      path: candidate.packField.path,
      label: candidate.packField.label,
      value: candidate.packField.value,
      ref: controlKey,
      score: candidate.score,
    };
    // The pack marks these; the extension must not decide it knows better.
    if (candidate.packField.requires_confirmation) confirm.push(entry);
    else fill.push(entry);
  }

  // A form asks for the name one way or the other. If both somehow matched,
  // keep whichever scored higher and drop the other, so a single name is never
  // written into two different shapes of field.
  const SPLIT = new Set(['identity.first_name', 'identity.last_name']);
  const wholeEntry = fill.find((entry) => entry.path === 'identity.legal_name');
  const splitEntries = fill.filter((entry) => SPLIT.has(entry.path));
  if (wholeEntry && splitEntries.length) {
    const bestSplit = Math.max(...splitEntries.map((entry) => entry.score));
    const drop = wholeEntry.score >= bestSplit ? SPLIT : new Set(['identity.legal_name']);
    for (let i = fill.length - 1; i >= 0; i -= 1) {
      if (drop.has(fill[i].path)) {
        matchedPaths.delete(fill[i].path);
        fill.splice(i, 1);
      }
    }
  }

  // The name counts as handled whichever shape the form asked for it in.
  const nameHandled =
    matchedPaths.has('identity.legal_name') || [...SPLIT].some((path) => matchedPaths.has(path));

  const unmatched = packFields
    // A derived part is never reported: the user cannot act on "First name has
    // nowhere to go" -- the honest absence is the whole name, reported once.
    .filter((packField) => !SPLIT.has(packField.path))
    .filter((packField) => !(packField.path === 'identity.legal_name' && nameHandled))
    .filter((packField) => !matchedPaths.has(packField.path))
    .map((packField) => ({
      path: packField.path,
      label: packField.label,
      reason: RULES[packField.path]
        ? 'No matching field found on this form.'
        : 'Kall does not know how to place this field yet.',
    }));

  return { fill, confirm, unmatched };
}

export const __testing = { RULES, score };
