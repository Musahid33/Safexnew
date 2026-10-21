/**
 * The private storage bucket report photos live in.
 *
 * One constant, two users: the submission route writes into it and the feed route signs
 * short-lived read URLs out of it. Spelling it twice is how a bucket rename silently breaks
 * one of the two.
 */
export const ATTACHMENT_BUCKET = 'safex-report-attachments';

/** How long a signed photo URL stays valid. Long enough to open a modal, short enough to leak little. */
export const PHOTO_URL_TTL_SECONDS = 600;
