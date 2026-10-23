import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The report form speaks only where it helps: the incident description and the immediate
 * action. Everything else stays typed, and a browser without speech recognition simply shows
 * a plain textarea.
 */

test('the microphone is only on the description and the action taken', () => {
  const workflow = readFileSync('app/components/ReportWorkflow.tsx', 'utf8');

  assert.equal((workflow.match(/<VoiceTextArea/g) ?? []).length, 2, 'exactly two fields speak');
  assert.ok(workflow.includes('id="report-description"'));
  assert.ok(workflow.includes('id="report-action"'));

  // The old one-shot mic and its inline handler are gone.
  assert.equal(workflow.includes('handleVoice'), false);
  assert.equal(workflow.includes('mic-button'), false);
  assert.equal(workflow.includes('SpeechRecognition'), false);
  assert.equal(workflow.includes('recognitionRef'), false);

  // Location, department, date and severity stay typed fields.
  for (const typed of ['report-location', 'report-department', 'report-datetime', 'report-severity']) {
    assert.ok(workflow.includes(typed));
  }

  // The field component is enabled from the same feature flag as before.
  assert.ok(workflow.includes('voiceEnabled={voiceEnabled}'));
});

test('voice input has listening, capture and the controls from the mock', () => {
  const voice = readFileSync('app/components/VoiceTextArea.tsx', 'utf8');

  for (const piece of [
    'Listening…', 'Voice captured', 'Paused',
    'Clear', 'Pause', 'Resume', 'Stop', 'Record Again', 'Use Text'
  ]) {
    assert.ok(voice.includes(piece), `${piece} must exist`);
  }

  // Live transcription, not a one-shot blob.
  assert.ok(voice.includes('recognition.continuous = true'));
  assert.ok(voice.includes('recognition.interimResults = true'));
  assert.ok(voice.includes('recognition.onresult'));
  assert.ok(voice.includes('VOICE_LANG[language]'));
  assert.ok(voice.includes('setInterval'));
  assert.ok(voice.includes('setSeconds(Math.floor(elapsed / 1000))'));

  // Silence ends a session on Chrome; the same session keeps listening, and a restart can never
  // write the same words twice (the merge lives in lib/voice/transcript.ts, tested separately).
  assert.ok(voice.includes("phaseRef.current !== 'listening'"));
  assert.ok(voice.includes('const commitPending = useCallback'));
  assert.ok(voice.includes('appendTranscript(committedRef.current, transcript)'));
  assert.equal(voice.includes('baseRef'), false, 'no naive concatenation');

  // Pause and stop must not leave the microphone open.
  assert.ok(voice.includes('abortRecognition'));
  assert.ok(voice.includes('noRestartRef'));

  // No browser support means no microphone button, never a fake recorder.
  assert.ok(voice.includes('const canSpeak = voiceEnabled && supported'));
  assert.ok(voice.includes('webkitSpeechRecognition'));
  assert.ok(voice.includes('aria-live="polite"'));
});

test('the voice controls are styled and mobile friendly', () => {
  const css = readFileSync('app/components/voice-textarea.css', 'utf8');
  assert.ok(css.includes('.voice-shell.is-listening'));
  assert.ok(css.includes('.voice-shell.is-captured'));
  assert.ok(css.includes('.voice-stop'));
  assert.ok(css.includes('.voice-use'));
  assert.ok(css.includes('@media (max-width: 420px)'));
  assert.ok(css.includes('prefers-reduced-motion'));
});
