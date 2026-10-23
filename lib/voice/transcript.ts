/**
 * Transcript assembly for the microphone.
 *
 * Web Speech on Android Chrome does not deliver one clean stream. It ends the session on every
 * short silence and the next instance re-transcribes a few seconds of audio it already emitted,
 * so naively appending each result produces exactly what workers complained about:
 *
 *   ट्रांसपोर्ट ट्रांसपोर्ट ट्रांसपोर्ट ट्रांसपोर्ट पार्क ट्रांसपोर्ट पार्क …
 *
 * This module owns the only place where spoken text is joined. Two rules keep it honest:
 *
 *  1. **Overlap, not append.** A new segment whose first words are the tail of what is already
 *     committed is trimmed by that many words before it is added. A segment already contained at
 *     the end adds nothing. That makes a restart idempotent, whichever point the browser resumes
 *     from.
 *  2. **Stutter collapse.** A word or a short phrase repeated back-to-back in one result — the
 *     other shape Chrome returns — is written once.
 *
 * Everything is pure and word-based, so it can be unit-tested against real transcript sequences
 * instead of hoping the phone behaves.
 */

/** Longest prefix/suffix overlap considered when a segment is joined onto the transcript. */
const MAX_OVERLAP_WORDS = 16;
/** Longest repeated block collapsed inside one segment ("पार्क में पार्क में"). */
const MAX_REPEAT_BLOCK = 6;

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

/**
 * Join a new spoken segment onto the committed transcript.
 *
 * The longest suffix of `committed` that is also a prefix of `segment` is dropped from the
 * segment, so restarts and re-sent finals cannot duplicate words. Returns the cleaned
 * transcript; callers keep the original formatting of what they already had.
 */
export function appendTranscript(committed: string, segment: string, maxOverlap = MAX_OVERLAP_WORDS): string {
  const base = committed.replace(/\s+$/, '');
  const segmentWords = collapseRepeats(words(segment));
  if (!segmentWords.length) return base;

  const baseWords = words(base);
  if (!baseWords.length) return segmentWords.join(' ');

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
      return rest.length ? `${base} ${rest.join(' ')}` : base;
    }
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
