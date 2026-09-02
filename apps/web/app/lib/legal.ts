/**
 * The facts about the business behind Kall, in one place.
 *
 * Every legal and contact page reads from here. Nothing else should hardcode a
 * mailing address, a support address, a refund term, or a governing-law state.
 *
 * **Do not invent a value in this file.** These are facts about a real company:
 * where it receives mail, which mailbox a privacy request actually reaches, what
 * refund a customer is actually owed. A plausible-looking placeholder that ships
 * is worse than a blank, because a blank is visible and a guess is not. Anything
 * still unknown stays `null`, renders as a loud yellow "not set yet" marker on
 * the page, and shows up in `unresolvedLegalFacts()` so a launch check can fail
 * on it.
 *
 * To fill these in, see docs/LEGAL.md.
 */

/** A fact James has not supplied yet. Renders as a visible gap, never as prose. */
export type Fillable<T> = T | null;

export type RefundStance =
  /** No refunds; cancelling stops the next renewal and access runs out the paid period. */
  | 'no-refunds-cancel-anytime'
  /** A full refund if asked for within N days of a charge, no questions asked. */
  | 'window'
  /** Refunds considered case by case on request. */
  | 'discretionary';

export const LEGAL = {
  /** The product. */
  productName: 'Kall',

  /**
   * The legal entity that operates Kall and is the counterparty on the Terms.
   * Already asserted publicly in the site footer, so it is settled, not a guess.
   */
  operatorLegalName: 'Skald and Stone LLC' as Fillable<string>,

  /**
   * The state the entity is formed in, as it should read in the Terms.
   * Separate from `governingLawState`: they usually match, but that is a choice,
   * not an inference.
   */
  entityFormationState: 'Washington' as Fillable<string>,

  /**
   * Postal address for legal and privacy notices, exactly as it should be
   * printed. A privacy policy that names no address is not a compliant one.
   * Multi-line: one array entry per line.
   *
   * This is the commercial registered agent's Washington address (Registered
   * Agents Inc), deliberately not a residential one: what goes on a legal page
   * is permanently public and indexed, and cannot be quietly taken back down.
   * If this ever needs replacing, replace it with another business address --
   * never with a home address, not even as a placeholder.
   *
   * The pages print `operatorLegalName` on the line above this, so these are
   * the street lines only.
   */
  mailingAddress: ['100 N Howard St Ste R', 'Spokane, WA 99201'] as Fillable<string[]>,

  /**
   * Where a privacy request, access request, or deletion request goes.
   * A Google Workspace group, so the mailbox outlives any one person's account.
   * NOT PROVISIONED YET -- see docs/LEGAL.md before these pages go public.
   */
  privacyContactEmail: 'privacy@skaldandstone.com' as Fillable<string>,

  /**
   * Where a customer with a problem goes. Published in-product and in the footer.
   * Also a Google Workspace group. NOT PROVISIONED YET -- see docs/LEGAL.md.
   */
  supportContactEmail: 'support@skaldandstone.com' as Fillable<string>,

  /**
   * Where formal legal notice goes, if that should not be the support mailbox.
   * Leave as null to fall back to `privacyContactEmail` in the Terms.
   */
  legalNoticesEmail: null as Fillable<string>,

  /**
   * Where a vulnerability report goes. Can be the support mailbox, but a
   * separate one keeps a real report out of the same queue as password resets.
   */
  securityContactEmail: 'security@skaldandstone.com' as Fillable<string>,

  /**
   * How quickly support aims to answer, in business days, as a stated target.
   * State a number Kall can actually meet with one person answering mail.
   */
  supportResponseBusinessDays: 2 as Fillable<number>,

  /** The state whose law governs the Terms, and whose courts hear a dispute. */
  governingLawState: 'Washington' as Fillable<string>,

  /** Which refund stance the Terms state. See docs/LEGAL.md for the three options. */
  refundStance: 'no-refunds-cancel-anytime' as Fillable<RefundStance>,

  /** Only read when `refundStance` is 'window': the length of that window in days. */
  refundWindowDays: null as Fillable<number>,

  /**
   * Whether the three mailboxes above actually exist and are being read.
   *
   * True since 2026-09-02: privacy@, support@ and security@ exist as Google
   * Workspace groups, and a test message to each was sent and received.
   *
   * Publishing a contact address that bounces is worse than publishing none --
   * a regulator reads an undeliverable privacy mailbox as a failure to respond
   * to a request. The test that matters is one sent from *outside* the
   * organization: a new Google group rejects external posts by default, so an
   * internal test passes without exercising the path the public uses. If any of
   * these addresses is ever changed or recreated, set this back to `false`
   * until an external test message has landed again.
   */
  mailboxesProvisioned: true,

  /**
   * Facts below are read out of the running system, not decided here. They are
   * listed so the Terms and the code cannot drift apart silently.
   */
  /** Card processor. Kall never stores card numbers itself. */
  paymentProcessor: 'Stripe',
  /** Authentication provider that holds the sign-in identity. */
  authProvider: 'Clerk',
  /**
   * Hours a failing payment keeps its paid limits before automatic downgrade to
   * Free. Enforced by backend/kall/jobs/billing_grace_period.py; change both.
   */
  paymentGracePeriodHours: 72,
} as const;

/** Facts that must be set before Kall is open to the public. */
const LAUNCH_REQUIRED = [
  'operatorLegalName',
  'entityFormationState',
  'mailingAddress',
  'privacyContactEmail',
  'supportContactEmail',
  'securityContactEmail',
  'supportResponseBusinessDays',
  'governingLawState',
  'refundStance',
] as const;

/**
 * Which required facts are still unset. Empty means the legal pages are ready to
 * be public. A launch check should assert this is empty.
 */
export function unresolvedLegalFacts(): string[] {
  const missing = LAUNCH_REQUIRED.filter((key) => LEGAL[key] === null).map(String);
  if (LEGAL.refundStance === 'window' && LEGAL.refundWindowDays === null) {
    missing.push('refundWindowDays');
  }
  if (!LEGAL.mailboxesProvisioned) {
    missing.push('mailboxesProvisioned');
  }
  return missing;
}

/** Where formal notice goes, with the documented fallback applied. */
export function noticeEmail(): Fillable<string> {
  return LEGAL.legalNoticesEmail ?? LEGAL.privacyContactEmail;
}
