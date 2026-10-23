'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Mic, Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { Language } from '@/lib/types';
import { appendTranscript, composeTranscript } from '@/lib/voice/transcript';
import { useI18n } from './I18nProvider';
import './voice-textarea.css';

/**
 * A textarea with an inline microphone.
 *
 * The form only puts this on the two fields a worker would rather speak than type:
 * "Description of incident" and "Immediate action taken". Everything else is typed.
 *
 * Recording shows a live transcript in the field itself, a timer and Clear / Pause / Stop.
 * Stopping keeps the words, marks them captured and offers Clear / Record Again / Use text.
 * The transcript is written through the normal `onChange`, so the field behaves like typing:
 * the report still submits exactly one string, with no separate audio to store.
 *
 * Chrome ends a recognition session on every short silence and the next instance re-hears the
 * last few seconds, so nothing here appends raw results: `lib/voice/transcript.ts` trims the
 * overlap and collapses stutter, which is what stops the same sentence being written three
 * times. Interim words are shown the moment the browser produces them, and the words on screen
 * are kept across a restart — text never disappears and is never written twice.
 *
 * Speech recognition is the browser's own (Chrome on Android / desktop). Where the API does
 * not exist the microphone is simply not rendered — there is no fake recorder.
 */

type SpeechResultLike = { 0?: { transcript?: string }; isFinal?: boolean };
type SpeechEventLike = { resultIndex: number; results: ArrayLike<SpeechResultLike> };
type SpeechErrorEventLike = { error?: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const VOICE_LANG: Record<Language, string> = {
  en: 'en-IN', hi: 'hi-IN', or: 'or-IN', bn: 'bn-IN', pa: 'pa-IN', mr: 'mr-IN'
};

type Phase = 'idle' | 'listening' | 'paused' | 'captured';

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  language: Language;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  required?: boolean;
  voiceEnabled: boolean;
  onError?: (message: string) => void;
};

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function VoiceTextArea({
  id, value, onChange, language, rows = 4, maxLength = 1200, placeholder, required, voiceEnabled, onError
}: Props) {
  const { T } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [supported, setSupported] = useState(false);

  const phaseRef = useRef<Phase>('idle');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** What the field held when the session started — Clear returns to exactly this. */
  const originalRef = useRef('');
  /** Spoken words that are already final. Nothing is appended here without overlap trimming. */
  const committedRef = useRef('');
  /** Interim words of the current instance: shown live, replaced by their final on the next event. */
  const pendingRef = useRef('');
  /** Restart timer after Chrome ends a session on silence. */
  const restartRef = useRef<number | null>(null);
  /** Last time any result arrived; the watchdog uses it to notice a silently dead session. */
  const lastResultAtRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const elapsedRef = useRef(0);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const noRestartRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const setCurrentPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stopClock = useCallback((keepElapsed = true) => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (keepElapsed && startedAtRef.current && phaseRef.current === 'listening') {
      elapsedRef.current += Date.now() - startedAtRef.current;
    }
    startedAtRef.current = 0;
    setSeconds(Math.floor(elapsedRef.current / 1000));
  }, []);

  const startClock = useCallback(() => {
    startedAtRef.current = Date.now();
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => {
      const elapsed = elapsedRef.current + (Date.now() - startedAtRef.current);
      setSeconds(Math.floor(elapsed / 1000));
    }, 250);
  }, []);

  /**
   * Android Chrome sometimes stops transcribing without firing `end`: the screen still says
   * "Listening…" and nothing is written until the worker presses Stop. The watchdog notices a
   * session that has gone quiet and opens a fresh one, so the field keeps filling in while the
   * person is still speaking instead of dumping everything at the end.
   */
  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const abortRecognition = useCallback(() => {
    noRestartRef.current = true;
    if (restartRef.current !== null) {
      window.clearTimeout(restartRef.current);
      restartRef.current = null;
    }
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    try {
      (recognition.abort ?? recognition.stop).call(recognition);
    } catch {
      // Already stopped by the browser.
    }
  }, []);

  /**
   * Keep the interim words that are on screen. They already read as speech to the worker, so a
   * restart must not blank them — and `appendTranscript` trims them again when the browser
   * re-emits the same audio as a final, so keeping them costs nothing.
   */
  const commitPending = useCallback(() => {
    if (pendingRef.current.trim()) {
      committedRef.current = appendTranscript(committedRef.current, pendingRef.current);
    }
    pendingRef.current = '';
  }, []);

  /** Write what the field should show. The only place the transcript is sent upward. */
  const emit = useCallback((length: number) => {
    onChangeRef.current(composeTranscript({
      original: originalRef.current,
      committed: committedRef.current,
      pending: pendingRef.current
    }, length));
  }, []);

  const startRecognition = useCallback((): boolean => {
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      onError?.('Voice typing is unavailable in this browser. You can still type this field.');
      return false;
    }
    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Recognition();
    } catch {
      onError?.('Microphone could not be started. You can still type this field.');
      return false;
    }
    recognitionRef.current = recognition;
    noRestartRef.current = false;
    recognition.lang = VOICE_LANG[language];
    recognition.continuous = true;
    recognition.interimResults = true;
    // One alternative: "best guess" is what the worker sees, never a list to choose from.
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      lastResultAtRef.current = Date.now();
      // Only the results this event brought are read. Chrome keeps every result for the life of
      // the instance, so walking the whole list would re-commit words that are already final.
      const from = Math.max(0, Number(event.resultIndex) || 0);
      const results = event.results ?? [];
      for (let index = from; index < results.length; index += 1) {
        const result = results[index];
        const transcript = (result?.[0]?.transcript ?? '').trim();
        if (!transcript) continue;
        if (result?.isFinal) {
          // A final replaces the interim it grew out of, and overlap trimming makes it safe if
          // this instance (or the one before it) already spoke the same words.
          pendingRef.current = '';
          committedRef.current = appendTranscript(committedRef.current, transcript);
        } else {
          pendingRef.current = transcript;
        }
      }
      emit(maxLength);
    };

    recognition.onerror = (event) => {
      if (event?.error === 'no-speech' || event?.error === 'aborted') return;
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        abortRecognition();
        commitPending();
        stopClock(false);
        setCurrentPhase('idle');
        onError?.('Microphone permission is blocked. Allow the microphone and try again.');
        return;
      }
      abortRecognition();
      commitPending();
      emit(maxLength);
      stopClock(false);
      setCurrentPhase('captured');
      onError?.('Voice input stopped. Check the microphone and try again.');
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (noRestartRef.current || phaseRef.current !== 'listening') return;
      // The words on screen stay: they are moved into the committed text, and the next instance
      // trims whatever it hears again. A short delay keeps the microphone from thrashing when
      // Chrome ends the session on every pause in speech.
      commitPending();
      emit(maxLength);
      if (restartRef.current !== null) window.clearTimeout(restartRef.current);
      restartRef.current = window.setTimeout(() => {
        restartRef.current = null;
        if (noRestartRef.current || phaseRef.current !== 'listening' || recognitionRef.current) return;
        if (!startRecognition()) {
          stopClock(false);
          setCurrentPhase('captured');
        }
      }, 60);
    };

    try {
      recognition.start();
      lastResultAtRef.current = Date.now();
      return true;
    } catch {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      onError?.('Microphone could not be started. You can still type this field.');
      return false;
    }
  }, [abortRecognition, commitPending, emit, language, maxLength, onError, setCurrentPhase, stopClock]);

  /**
   * While listening, watch the session itself. A dead-but-silent engine is reopened, and a
   * restart Chrome forgot to schedule is picked up, so the words keep appearing as they are
   * spoken.
   */
  useEffect(() => {
    if (phase !== 'listening') {
      stopWatchdog();
      return;
    }
    stopWatchdog();
    watchdogRef.current = window.setInterval(() => {
      if (phaseRef.current !== 'listening') return;
      if (recognitionRef.current === null && restartRef.current === null) {
        startRecognition();
        return;
      }
      if (recognitionRef.current && Date.now() - lastResultAtRef.current > 8000) {
        // Nothing for eight seconds: the engine stopped transcribing without saying so.
        abortRecognition();
        commitPending();
        emit(maxLength);
        startRecognition();
      }
    }, 1000);
    return stopWatchdog;
  }, [phase, abortRecognition, commitPending, emit, maxLength, startRecognition, stopWatchdog]);

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    setSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
  }, []);

  // Keep the newest words visible while they are being dictated: a textarea does not scroll to
  // the caret on its own when its value is set from code.
  useEffect(() => {
    if (phase !== 'listening' && phase !== 'paused') return;
    const field = textareaRef.current;
    if (field) field.scrollTop = field.scrollHeight;
  }, [value, phase]);

  // Switching language mid-sentence restarts in the new language; the words already captured
  // stay in the field and the running timer is not reset.
  const languageRef = useRef(language);
  useEffect(() => {
    if (languageRef.current === language) return;
    languageRef.current = language;
    if (phaseRef.current !== 'listening') return;
    abortRecognition();
    commitPending();
    emit(maxLength);
    startRecognition();
  }, [abortRecognition, commitPending, emit, language, maxLength, startRecognition]);

  useEffect(() => () => {
    noRestartRef.current = true;
    abortRecognition();
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (restartRef.current !== null) window.clearTimeout(restartRef.current);
  }, [abortRecognition]);

  function begin() {
    abortRecognition();
    // What was typed stays where it is; the microphone only owns the words it adds after it.
    originalRef.current = value.trim();
    committedRef.current = '';
    pendingRef.current = '';
    elapsedRef.current = 0;
    setSeconds(0);
    setCurrentPhase('listening');
    startClock();
    if (!startRecognition()) {
      stopClock(false);
      setCurrentPhase('idle');
    }
  }

  function pause() {
    abortRecognition();
    commitPending();
    emit(maxLength);
    stopClock(true);
    setCurrentPhase('paused');
  }

  function resume() {
    if (phaseRef.current !== 'paused') return;
    setCurrentPhase('listening');
    startClock();
    noRestartRef.current = false;
    if (!startRecognition()) {
      stopClock(false);
      setCurrentPhase('captured');
    }
  }

  function stop() {
    abortRecognition();
    commitPending();
    emit(maxLength);
    stopClock(true);
    setCurrentPhase('captured');
  }

  function clear() {
    abortRecognition();
    stopClock(false);
    elapsedRef.current = 0;
    committedRef.current = '';
    pendingRef.current = '';
    onChangeRef.current(originalRef.current);
    setSeconds(0);
    setCurrentPhase('idle');
  }

  function useText() {
    abortRecognition();
    stopClock(false);
    elapsedRef.current = 0;
    commitPending();
    emit(maxLength);
    setCurrentPhase('idle');
  }

  function recordAgain() {
    const current = value.trim();
    abortRecognition();
    stopClock(false);
    originalRef.current = current;
    committedRef.current = '';
    pendingRef.current = '';
    elapsedRef.current = 0;
    setSeconds(0);
    setCurrentPhase('listening');
    startClock();
    if (!startRecognition()) {
      stopClock(false);
      setCurrentPhase('captured');
    }
  }

  function handleChange(next: string) {
    // The field is read-only while the microphone is on, so this is an ordinary edit made
    // after Stop (or before recording started).
    onChangeRef.current(next);
  }

  const canSpeak = voiceEnabled && supported;
  const isActive = phase !== 'idle';

  return <div className={`voice-shell${isActive ? ` is-${phase}` : ''}`}>
    {isActive && <div className="voice-status" role="status" aria-live="polite">
      <span className={`voice-status-icon ${phase}`} aria-hidden="true">
        {phase === 'captured' ? <Check size={16} /> : <span className="voice-bars"><i /><i /><i /></span>}
      </span>
      <b>{T(phase === 'captured' ? 'Voice captured' : phase === 'paused' ? 'Paused' : 'Listening…')}</b>
      <span className="voice-timer">{clock(seconds)}</span>
    </div>}

    <div className="text-input-wrap">
      <textarea
        id={id}
        ref={textareaRef}
        className="form-control voice-textarea"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        required={required}
        readOnly={phase === 'listening' || phase === 'paused'}
        aria-readonly={phase === 'listening' || phase === 'paused'}
      />
      {canSpeak && phase === 'idle' && <button
        className="mic-button voice-mic"
        type="button"
        onClick={begin}
        aria-label={T('Speak to fill this field')}
        title={T('Speak to fill')}
      ><Mic size={18} /></button>}
    </div>

    {isActive && <div className="voice-actions">
      <button type="button" className="voice-action voice-clear" onClick={clear}>
        <Trash2 size={14} /> {T('Clear')}
      </button>
      {phase === 'listening' && <>
        <button type="button" className="voice-action" onClick={pause}><Pause size={14} /> {T('Pause')}</button>
        <button type="button" className="voice-action voice-stop" onClick={stop}><Square size={13} /> {T('Stop')}</button>
      </>}
      {phase === 'paused' && <>
        <button type="button" className="voice-action" onClick={resume}><Play size={14} /> {T('Resume')}</button>
        <button type="button" className="voice-action voice-stop" onClick={stop}><Square size={13} /> {T('Stop')}</button>
      </>}
      {phase === 'captured' && <>
        <button type="button" className="voice-action" onClick={recordAgain}><RotateCcw size={14} /> {T('Record Again')}</button>
        <button type="button" className="voice-action voice-use" onClick={useText}>{T('Use Text')}</button>
      </>}
    </div>}
  </div>;
}
