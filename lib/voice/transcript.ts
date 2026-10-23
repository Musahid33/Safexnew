/**
 * Transcript assembly for the microphone.
 *
 * Web Speech on Android Chrome does not deliver one clean stream. It ends the session on every
 * short silence and the next instance re-transcribes a few seconds of audio it already emitted,
 * so naively appending each result produces exactly what workers complained about:
 *
 *   ट्रांसपोर्ट ट्रांसपोर्ट ट्रांसपोर्ट ट्रांसपोर्ट पार्क ट्रांसपोर्ट पार्क …     (duplicates)
 *
 * The component keeps two separate pieces of text, and this module is the only place they meet:
 *
 *  • **final** — results the engine marked `isFinal`. Appended through `appendTranscript`, which
 *    trims the re-heard overlap so a restart can never write the same words twice.
 *  • **interim** — the words of the result the engine is still refining. They are *replaced* on
 *    every event, never appended, so the worker watches the sentence being written live.
 *
 * Everything here is pure and word-based, so it can be unit-tested against real transcript
 * sequences instead of hoping the phone behaves.
 */

/** Longest prefix/suffix overlap considered when a segment is joined onto the transcript. */
export const MAX_OVERLAP_WORDS = 16;
/** Longest repeated block collapsed inside one segment ("पार्क में पार्क में"). */
export const MAX_REPEAT_BLOCK = 6;
/** Silence after which a spoken sentence is closed with a full stop (2–3 s, as requested). */
export const SENTENCE_PAUSE_MS = 2600;

/** Split on any whitespace, keeping the spoken words as they arrived. */
export function words(text: string): string[] {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.split(' ') : [];
}

/**
 * The comparison key of one word: case and surrounding punctuation do not matter, the letters do.
 * Devanagari, Bengali, Odia, Gurmukhi and Latin words are all handled the same way because the
 * comparison is purely on the word as a string after trimming its edges.
 */
export function wordKey(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[.,!?;:।॥"'“”‘’()[\]{}…—–-]+/u, '')
    .replace(/[.,!?;:।॥"'“”‘’()[\]{}…—–-]+$/u, '');
}

function keysMatch(left: string, right: string): boolean {
  const a = wordKey(left);
  const b = wordKey(right);
  return a.length > 0 && a === b;
}

/** How many times the block starting at `start` repeats immediately, 1 when it does not. */
function repeatCount(tokens: string[], start: number, size: number): number {
  let count = 1;
  for (;;) {
    const next = start + count * size;
    if (next + size > tokens.length) return count;
    let same = true;
    for (let index = 0; index < size; index += 1) {
      if (!keysMatch(tokens[start + index], tokens[next + index])) { same = false; break; }
    }
    if (!same) return count;
    count += 1;
  }
}

/**
 * Collapse text the recogniser repeated verbatim inside one segment.
 *
 * Only *immediate* repetition is touched: `पार्क पार्क पार्क` becomes `पार्क`, and
 * `गाड़ी पलट गाड़ी पलट` becomes `गाड़ी पलट`. A word used again later in the sentence, with
 * anything in between, is left alone.
 */
export function collapseRepeats(tokens: string[]): string[] {
  const output: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    let collapsed = false;
    for (let size = 1; size <= MAX_REPEAT_BLOCK && size * 2 <= tokens.length - index; size += 1) {
      const count = repeatCount(tokens, index, size);
      if (count >= 2) {
        for (let offset = 0; offset < size; offset += 1) output.push(tokens[index + offset]);
        index += size * count;
        collapsed = true;
        break;
      }
    }
    if (!collapsed) {
      output.push(tokens[index]);
      index += 1;
    }
  }
  return output;
}

/** Words that continue a sentence even after the engine closed one: they never start a new one. */
const CONTINUATION_WORDS = new Set([
  'and', 'but', 'then', 'so', 'because', 'also', 'plus', 'however', 'while', 'when', 'which',
  'और', 'फिर', 'लेकिन', 'पर', 'मगर', 'क्योंकि', 'इसलिए', 'जबकि', 'हालांकि', 'तो', 'जो', 'जब'
]);

/** Full stop characters: one Latin set, one danda used by Devanagari, Bengali, Odia, Gurmukhi. */
const SENTENCE_END = /[.!?।॥]$/u;
const TRAILING_PUNCTUATION = /[\s.,!?;:।॥…]+$/u;
const INDIC_SCRIPT = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0B00-\u0B7F]/u;

/** Remove a full stop the engine (or we) put at the very end, to continue the same sentence. */
export function stripSentenceEnd(text: string): string {
  return text.replace(TRAILING_PUNCTUATION, '');
}

/** True when the text already reads as a closed sentence. */
export function hasSentenceEnd(text: string): boolean {
  return SENTENCE_END.test(text.replace(/\s+$/, ''));
}

/**
 * The full stop that belongs to this text: `।` for Devanagari, Bengali, Odia and Gurmukhi,
 * `.` for English and other Latin-script dictation.
 */
export function sentenceTerminatorFor(text: string): '.' | '।' {
  const list = words(text);
  const last = list.length ? list[list.length - 1] : '';
  return INDIC_SCRIPT.test(last) ? '।' : '.';
}

/** Close the sentence if it is not closed yet. Idempotent. */
export function ensureSentenceEnd(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed) return '';
  return hasSentenceEnd(trimmed) ? trimmed : trimmed + sentenceTerminatorFor(trimmed);
}

/**
 * Markers that read better after a comma. Deliberately a short list: a comma in the wrong place
 * is worse than no comma, so only words that essentially always open a new clause are used.
 */
const COMMA_MARKERS = [
  'but', 'however', 'because', 'although', 'though', 'whereas',
  'लेकिन', 'क्योंकि', 'इसलिए', 'जबकि', 'हालांकि', 'परंतु', 'मगर', 'ताकि'
];

/**
 * Insert a comma before clause openers when they appear mid-sentence. Never at the start of the
 * text and never twice, so running it repeatedly is safe.
 */
export function insertCommas(text: string): string {
  let output = text;
  for (const marker of COMMA_MARKERS) {
    const pattern = new RegExp(`([^\\s,.;:!?।॥…])\\s+(${marker})(?=\\s|$)`, 'giu');
    output = output.replace(pattern, '$1, $2');
  }
  return output;
}

/**
 * Start every sentence with a capital for Latin text; Devanagari has no case and is untouched.
 * `atStart` is false when the text continues words the worker had already typed.
 */
export function capitalizeSentences(text: string, atStart = true): string {
  const pattern = atStart ? /(^|[.!?]\s+)([a-z])/g : /([.!?]\s+)([a-z])/g;
  return text.replace(pattern, (_match: string, lead: string, letter: string) => lead + letter.toUpperCase());
}

/**
 * The final polish applied once a sentence is closed: commas where they clearly belong and a
 * capital letter after every full stop. Word content is never changed.
 */
export function applyPunctuation(text: string, startsSentence = true): string {
  const spaced = text.replace(/\s+/g, ' ').trim();
  return spaced ? capitalizeSentences(insertCommas(spaced), startsSentence) : '';
}

/**
 * Join a new spoken segment onto the committed transcript.
 *
 * The longest suffix of `committed` that is also a prefix of `segment` is dropped from the
 * segment, so restarts and re-sent finals cannot duplicate words. When the join turns out to be
 * mid-sentence, a full stop that was already placed is taken back out.
 *
 * Returns the cleaned transcript; callers keep the original formatting of what they already had.
 */
export function appendTranscript(committed: string, segment: string, maxOverlap = MAX_OVERLAP_WORDS): string {
  const base = committed.replace(/\s+$/, '');
  const segmentWords = collapseRepeats(words(segment));
  if (!segmentWords.length) return base;

  const baseWords = words(base);
  if (!baseWords.length) return segmentWords.join(' ');

  // The engine revised an interim *downwards*: the final is a subset of words already written.
  // Nothing new to add, and appending would duplicate what is on screen.
  if (segmentWords.length <= baseWords.length) {
    const offset = baseWords.length - segmentWords.length;
    let contained = true;
    for (let index = 0; index < segmentWords.length; index += 1) {
      if (!keysMatch(baseWords[offset + index], segmentWords[index])) { contained = false; break; }
    }
    if (contained) return base;
  }

  const limit = Math.max(0, Math.min(maxOverlap, baseWords.length, segmentWords.length));
  for (let overlap = limit; overlap >= 1; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (!keysMatch(baseWords[baseWords.length - overlap + index], segmentWords[index])) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const rest = segmentWords.slice(overlap);
      // The engine re-sent words that are already written: nothing new, keep the text as it is.
      if (!rest.length) return base;
      // The new words continue the sentence that the full stop had already closed.
      return `${stripSentenceEnd(base)} ${rest.join(' ')}`;
    }
  }

  // A fresh sentence that starts with a connector is a continuation, not a new sentence.
  if (hasSentenceEnd(base) && CONTINUATION_WORDS.has(wordKey(segmentWords[0]))) {
    return `${stripSentenceEnd(base)} ${segmentWords.join(' ')}`;
  }

  return `${base} ${segmentWords.join(' ')}`;
}

/**
 * What the textarea shows: what was there before the microphone, what has been confirmed, and
 * the interim words still being recognised. Interims sit at the end and are replaced by their
 * final on the next event, never appended twice.
 */
export function composeTranscript(parts: { original?: string; committed?: string; pending?: string }, maxLength: number): string {
  const text = [parts.original, parts.committed, parts.pending]
    .map((part) => (part ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  if (text.length <= maxLength) return text;
  // Cut on a word boundary so the field never ends in half a word.
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd();
}

/**
 * The same transcript split for display: `head` is confirmed text (typed before the microphone
 * plus every final result), `tail` is the interim the engine is still working on. The field
 * renders the head solid and the tail greyed, which is what makes the live state obvious.
 */
export function splitTranscript(
  parts: { original?: string; committed?: string; pending?: string },
  maxLength: number
): { head: string; tail: string } {
  const head = composeTranscript({ original: parts.original, committed: parts.committed }, maxLength);
  const full = composeTranscript(parts, maxLength);
  if (!head) return { head: '', tail: full };
  if (!full.startsWith(head)) return { head: full, tail: '' };
  return { head, tail: full.slice(head.length).trimStart() };
}
