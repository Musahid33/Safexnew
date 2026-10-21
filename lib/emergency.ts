/**
 * The company emergency number.
 *
 * The SOS button used to open a dialog that said no number was configured, because the site
 * row in the database has no `sos_number`. This is the number the site operates, so it is
 * the fallback whenever a site has not been given its own contact yet. A real per-site value
 * still wins — see `selectableSites()`.
 */
export const SOS_NUMBER = '+91 7070705925';

/** E.164 without spaces, for `tel:` links. */
export const SOS_DIAL = '+917070705925';

/** A `tel:` href for any display number, falling back to the company SOS line. */
export function telHref(number: string | null | undefined): string {
  const digits = (number ?? '').replace(/[^\d+]/g, '');
  return `tel:${digits || SOS_DIAL}`;
}
