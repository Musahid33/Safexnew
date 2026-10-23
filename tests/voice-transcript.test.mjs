import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

/**
 * Web Speech on Android Chrome restarts on every short silence and the next instance re-hears
 * the tail of what it already said. Workers got the same sentence written three times:
 *
 *   ट्रांसपोर्ट ट्रांसपोर्ट ट्रांसपोर्ट ट्रांसपोर्ट पार्क ट्रांसपोर्ट पार्क …
 *
 * `lib/voice/transcript.ts` is the only place spoken words are joined, and these tests replay
 * real event sequences against it instead of trusting the phone to behave.
 */

const code = stripTypeScriptTypes(readFileSync(new URL('../lib/voice/transcript.ts', import.meta.url), 'utf8'));
const {
  appendTranscript, applyPunctuation, collapseRepeats, composeTranscript, ensureSentenceEnd,
  hasSentenceEnd, insertCommas, splitTranscript, wordKey
} = await import(`data:text/javascript,${encodeURIComponent(code)}`);

/**
 * Mirror of the component's handler: only new results are read, a final replaces the interim
 * it grew out of, and the field shows committed + interim while the worker is still speaking.
 */
function simulate(events, maxLength = 1200) {
  let committed = '';
  let pending = '';
  for (const event of events) {
    if (event.final !== undefined) {
      pending = '';
      committed = appendTranscript(committed, event.final);
    } else {
      pending = event.interim ?? '';
    }
  }
  return { committed, display: composeTranscript({ committed, pending }, maxLength) };
}

test('a restart that re-hears the tail does not duplicate the sentence', () => {
  // Exactly the shape Chrome produced on the phone: each instance starts a couple of words
  // earlier than the last one ended.
  const { committed, display } = simulate([
    { interim: 'ट्रांस', final: 'ट्रांसपोर्ट' },
    { final: 'ट्रांसपोर्ट पार्क' },
    { final: 'पार्क में' },
    { final: 'में गाड़ी' },
    { final: 'गाड़ी पलट गया' }
  ]);
  assert.equal(committed, 'ट्रांसपोर्ट पार्क में गाड़ी पलट गया');
  assert.equal(display, 'ट्रांसपोर्ट पार्क में गाड़ी पलट गया');
});

test('the English report from the earlier screenshot stays clean too', () => {
  const { display } = simulate([
    { interim: 'one worker' },
    { final: 'one worker' },
    { interim: 'one worker work' },
    { final: 'worker work' },
    { final: 'work without gloves' }
  ]);
  assert.equal(display, 'one worker work without gloves');
});

test('repeating the exact same final changes nothing', () => {
  let text = appendTranscript('', 'गाड़ी पलट गया');
  text = appendTranscript(text, 'गाड़ी पलट गया');
  text = appendTranscript(text, 'गाड़ी पलट गया');
  assert.equal(text, 'गाड़ी पलट गया');
});

test('a final that is shorter than the interim already on screen adds nothing', () => {
  // The sentence was closed on the pause, then the engine finalised the words it had already
  // shown as interim. Appending them would print the same phrase twice.
  assert.equal(appendTranscript('गाड़ी पलट गई थी।', 'पलट गई थी'), 'गाड़ी पलट गई थी।');
  assert.equal(appendTranscript('one worker was working', 'worker was working'), 'one worker was working');
});

test('a genuinely new sentence is still appended', () => {
  const text = appendTranscript('ट्रांसपोर्ट पार्क में गाड़ी पलट गया', 'कोई घायल नहीं हुआ');
  assert.equal(text, 'ट्रांसपोर्ट पार्क में गाड़ी पलट गया कोई घायल नहीं हुआ');
});

test('an interim that later becomes a final is not written twice', () => {
  const { committed, display } = simulate([
    { final: 'ट्रांसपोर्ट पार्क में गाड़ी' },
    { interim: 'गाड़ी पलट' },
    { interim: 'गाड़ी पलट गया' },
    { final: 'गाड़ी पलट गया' }
  ]);
  assert.equal(committed, 'ट्रांसपोर्ट पार्क में गाड़ी पलट गया');
  assert.equal(display, committed);
});

test('stutter inside one result is collapsed to one word or phrase', () => {
  assert.equal(collapseRepeats(['पार्क', 'पार्क', 'पार्क']).join(' '), 'पार्क');
  assert.equal(collapseRepeats(['गाड़ी', 'पलट', 'गाड़ी', 'पलट', 'गया']).join(' '), 'गाड़ी पलट गया');
  assert.equal(
    appendTranscript('', 'ट्रांसपोर्ट ट्रांसपोर्ट ट्रांसपोर्ट ट्रांसपोर्ट पार्क में गाड़ी पलट गया'),
    'ट्रांसपोर्ट पार्क में गाड़ी पलट गया'
  );
});

test('a word used again later in the sentence is left alone', () => {
  assert.equal(collapseRepeats(['गाड़ी', 'एक', 'गाड़ी']).join(' '), 'गाड़ी एक गाड़ी');
  // No shared boundary here, so both mentions survive — only real overlap is trimmed.
  assert.equal(appendTranscript('गाड़ी पार्क में', 'गाड़ी चल रही थी'), 'गाड़ी पार्क में गाड़ी चल रही थी');
});

test('punctuation and case do not defeat the overlap check', () => {
  assert.equal(appendTranscript('Safety Report', 'report: worker slipped'), 'Safety Report worker slipped');
  assert.equal(wordKey('गाड़ी।'), 'गाड़ी');
  assert.equal(wordKey('“Grinder,”'), 'grinder');
});

test('the field shows the interim words while the worker is still speaking', () => {
  const partial = composeTranscript({ original: '', committed: 'ट्रांसपोर्ट पार्क', pending: 'में गाड़ी' }, 1200);
  assert.equal(partial, 'ट्रांसपोर्ट पार्क में गाड़ी');
  // Typed text before the microphone is kept as-is, the microphone only adds after it.
  assert.equal(
    composeTranscript({ original: 'Observed at gate 2.', committed: '', pending: 'worker without helmet' }, 1200),
    'Observed at gate 2. worker without helmet'
  );
});

test('the transcript never exceeds the field limit or cuts a word in half', () => {
  const text = composeTranscript({ committed: 'one two three four five six' }, 14);
  assert.ok(text.length <= 14);
  assert.equal(text, 'one two three');
});

test('the live layer separates confirmed words from the words still being recognised', () => {
  const { head, tail } = splitTranscript({ original: 'Gate 2.', committed: 'गाड़ी पलट गई', pending: 'कोई घायल' }, 1200);
  assert.equal(head, 'Gate 2. गाड़ी पलट गई');
  assert.equal(tail, 'कोई घायल');
  // Typed text plus nothing yet: the whole field is confirmed and nothing is grey.
  assert.deepEqual(splitTranscript({ original: 'Gate 2.', committed: '', pending: '' }, 1200), { head: 'Gate 2.', tail: '' });
  // A field that hits its limit drops the grey tail instead of cutting a word.
  const clipped = splitTranscript({ committed: 'one two three', pending: 'four five' }, 13);
  assert.equal(clipped.head, 'one two three');
  assert.equal(clipped.tail, '');
});

test('a sentence gets the full stop of the language it was spoken in', () => {
  assert.equal(ensureSentenceEnd('गाड़ी पलट गई'), 'गाड़ी पलट गई।');
  assert.equal(ensureSentenceEnd('the car overturned'), 'the car overturned.');
  assert.equal(ensureSentenceEnd('गाड़ी पलट गई।'), 'गाड़ी पलट गई।', 'already closed stays closed');
  assert.equal(ensureSentenceEnd('worker slipped!'), 'worker slipped!');
  assert.equal(hasSentenceEnd('गाड़ी पलट गई।'), true);
  assert.equal(hasSentenceEnd('गाड़ी पलट गई'), false);
});

test('commas are added before clause openers, never at the start or twice', () => {
  assert.equal(insertCommas('the car overturned but nobody was hurt'), 'the car overturned, but nobody was hurt');
  assert.equal(insertCommas('गाड़ी पलट गई लेकिन कोई घायल नहीं हुआ'), 'गाड़ी पलट गई, लेकिन कोई घायल नहीं हुआ');
  assert.equal(insertCommas('but nobody was hurt'), 'but nobody was hurt', 'a sentence may start with it');
  assert.equal(insertCommas(insertCommas('the car overturned but nobody was hurt')), 'the car overturned, but nobody was hurt');
});

test('a closed sentence is capitalised like the worker would type it', () => {
  assert.equal(applyPunctuation('the car overturned. nobody was hurt'), 'The car overturned. Nobody was hurt');
  // Text that continues the worker's own typed words must not be capitalised mid-sentence.
  assert.equal(applyPunctuation('worker slipped.', false), 'worker slipped.');
  // The Hindi sentence keeps its script and gets a danda.
  assert.equal(applyPunctuation(ensureSentenceEnd('गाड़ी पलट गई लेकिन कोई घायल नहीं हुआ')), 'गाड़ी पलट गई, लेकिन कोई घायल नहीं हुआ।');
});

test('the sentence the worker reported becomes one clean punctuated line', () => {
  let text = appendTranscript('', 'Transport Transport Transport Park');
  text = appendTranscript(text, 'Park mein gaadi palat gayi');
  assert.equal(applyPunctuation(ensureSentenceEnd(text)), 'Transport Park mein gaadi palat gayi.');
});

test('speech that continues after a closed sentence does not leave a full stop mid-sentence', () => {
  // Chrome closed the session with a full stop, then re-heard the same tail and went on.
  const continued = appendTranscript('गाड़ी पलट गई।', 'गई और लोग भाग गए');
  assert.equal(continued, 'गाड़ी पलट गई और लोग भाग गए');
  // A connector after the full stop is still the same sentence.
  assert.equal(appendTranscript('गाड़ी पलट गई।', 'और लोग भाग गए'), 'गाड़ी पलट गई और लोग भाग गए');
  // A genuinely new sentence keeps its full stop.
  assert.equal(appendTranscript('गाड़ी पलट गई।', 'कोई घायल नहीं हुआ'), 'गाड़ी पलट गई। कोई घायल नहीं हुआ');
});

test('a silently dead session is reopened instead of waiting for Stop', () => {
  const voice = readFileSync(new URL('../app/components/VoiceTextArea.tsx', import.meta.url), 'utf8');
  assert.match(voice, /lastResultAtRef\.current = Date\.now\(\)/, 'every result stamps the clock');
  assert.match(voice, /Date\.now\(\) - lastResultAtRef\.current > 8000/);
  assert.match(voice, /watchdogRef\.current = window\.setInterval/);
  // The newest words stay visible while dictating.
  assert.match(voice, /field\.scrollTop = field\.scrollHeight/);
});

test('the component keeps interim and final apart and only appends finals', () => {
  const voice = readFileSync(new URL('../app/components/VoiceTextArea.tsx', import.meta.url), 'utf8');
  assert.match(voice, /import \{[^}]*appendTranscript[^}]*composeTranscript[^}]*\} from '@\/lib\/voice\/transcript'/s);
  // A final is the only thing appended, and always through the overlap trimmer.
  assert.match(voice, /committedRef\.current = appendTranscript\(committedRef\.current, transcript\)/);
  // Interim results are replaced, never concatenated onto the transcript.
  assert.match(voice, /pendingRef\.current = interims\.join\(' '\)/);
  assert.equal(voice.includes('baseRef'), false, 'the naive join is gone');
  assert.equal(voice.includes('finalRef'), false);
  assert.equal(voice.includes('pendingRef.current +='), false, 'interim is never appended to itself');
  // Only results this event delivered are read.
  assert.match(voice, /for \(let index = from; index < results\.length; index \+= 1\)/);
  // A pause of 2–3 seconds closes the sentence on its own.
  assert.match(voice, /SENTENCE_PAUSE_MS/);
  assert.match(voice, /silenceRef\.current = window\.setTimeout/);
  // A restart waits a beat instead of thrashing the microphone.
  assert.match(voice, /window\.setTimeout\(\(\) => \{/);
});
