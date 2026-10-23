'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Mic, Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { Language } from '@/lib/types';
import {
  SENTENCE_PAUSE_MS, appendTranscript, applyPunctuation, composeTranscript, ensureSentenceEnd, splitTranscript
} from '@/lib/voice/transcript';
import { useI18n } from './I18nProvider';
import './voice-textarea.css';

/**
 * A textarea with inline voice typing.
 *
 * The form only puts this on the two fields a worker would rather speak than type:
 * "Description of incident" and "Immediate action taken". Everything else is typed.
 *
 * The feel it targets is the one people already know from WhatsApp and Gboard: press start, and
 * the words appear *while* they are spoken. Two pieces of text are kept apart at all times:
 *
 *  • `committedRef` — what the engine marked `isFinal`. Only this is ever appended.
 *  • `pendingRef`   — the result the engine is still refining. It is replaced on every event,
 *                     painted grey under the solid text, and never appended to itself.
 *
 * Chrome ends a recognition session on every short silence and the next instance re-hears the
 * last few seconds, so nothing is joined by hand: `lib/voice/transcript.ts` trims the overlap,
 * collapse stutters, closes sentences on a 2–3 second pause and adds the punctuation the engine
 * never returns. That is what turns
 *
 *   ट्रांसपोर्ट ट्रांसपोर्ट ट्रांसपोर्ट पार्क …
 *
 * into the sentence the worker actually said.
 *
 * Speech recognition is the browser's own (Chrome on Android / desktop). Where the API does not
 * exist the microphone is simply not rendered — there is no fake recorder.
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

/** What the worker is speaking. `auto` follows the app language; the other two force one. */
type SpokenLang = 'auto' | 'en' | 'hi';

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
  /** True between the engine's `start` and `end`; drives the live dot. */
  const [engineLive, setEngineLive] = useState(false);
  /** The two states the field paints: confirmed text, then the words being recognised now. */
  const [preview, setPreview] = useState({ head: '', tail: '' });
  const [spoken, setSpoken] = useState<SpokenLang>('auto');

  const phaseRef = useRef<Phase>('idle');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** What the field held when the session started — Clear returns to exactly this. */
  const originalRef = useRef('');
  /** Spoken words that are already final. Nothing is appended here without overlap trimming. */
  const committedRef = useRef('');
  /** Interim words of the current result: shown live, replaced by their final on the next event. */
  const pendingRef = useRef('');
  /** Restart timer after Chrome ends a session on silence. */
  const restartRef = useRef<number | null>(null);
  /** Silence timer that closes the sentence with a full stop. */
  const silenceRef = useRef<number | null>(null);
  /** Last time any result arrived; the watchdog uses it to notice a silently dead session. */
  const lastResultAtRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const liveRef = useRef<HTMLDivElement | null>(null);
  const elapsedRef = useRef(0);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const noRestartRef = useRef(false);
  /** Consecutive failed `start()` calls; a transient Android error must not stop the dictation. */
  const restartFailuresRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const languageRef = useRef(language);
  languageRef.current = language;
  const spokenRef = useRef<SpokenLang>('auto');

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

  const clearSilenceTimer = useCallback(() => {
    if (silenceRef.current !== null) {
      window.clearTimeout(silenceRef.current);
      silenceRef.current = null;
    }
  }, []);

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
    clearSilenceTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    try {
      (recognition.abort ?? recognition.stop).call(recognition);
    } catch {
      // Already stopped by the browser.
    }
  }, [clearSilenceTimer]);

  /**
   * Write what the field should show. The only place the transcript is sent upward, and the only
   * place the solid/interim split is recomputed.
   */
  const emit = useCallback((length: number) => {
    const parts = {
      original: originalRef.current,
      committed: committedRef.current,
      pending: pendingRef.current
    };
    setPreview(splitTranscript(parts, length));
    onChangeRef.current(composeTranscript(parts, length));
  }, []);

  /** Is the spoken text the beginning of a sentence? Only then is a Latin capital added. */
  const startsSentence = useCallback(() => {
    const original = originalRef.current.trim();
    return !original || /[.!?।]$/u.test(original);
  }, []);

  /** Close a sentence: overlap-safe merge has already happened, add the full stop and commas. */
  const closeSentence = useCallback(
    (text: string) => applyPunctuation(ensureSentenceEnd(text), startsSentence()),
    [startsSentence]
  );

  /**
   * The engine ended (or the worker stopped): whatever is still interim becomes final, and the
   * sentence is closed with a full stop — the same punctuation Gboard adds on a pause.
   */
  const commitPending = useCallback((close: boolean) => {
    const pending = pendingRef.current.trim();
    pendingRef.current = '';
    if (!pending) return;
    const merged = appendTranscript(committedRef.current, pending);
    committedRef.current = close ? closeSentence(merged) : merged;
  }, [closeSentence]);

  /**
   * 2–3 seconds of silence: the sentence is finished. The text stays in the field, the grey
   * interim becomes solid, and a full stop appears exactly where the worker paused.
   */
  const finishSentence = useCallback(() => {
    if (phaseRef.current !== 'listening') return;
    const pending = pendingRef.current.trim();
    if (!pending) return;
    pendingRef.current = '';
    committedRef.current = closeSentence(appendTranscript(committedRef.current, pending));
    emit(maxLength);
  }, [closeSentence, emit, maxLength]);

  /**
   * Android Chrome can reject a `start()` that lands too soon after the previous `end()`. One
   * failed restart must not end the dictation: the watchdog retries, and only a microphone that
   * refuses three times hands the field back.
   */
  const restartFailed = useCallback(() => {
    restartFailuresRef.current += 1;
    if (restartFailuresRef.current < 3) return;
    noRestartRef.current = true;
    stopClock(false);
    setCurrentPhase('captured');
  }, [setCurrentPhase, stopClock]);

  const scheduleSilence = useCallback(() => {
    clearSilenceTimer();
    silenceRef.current = window.setTimeout(() => {
      silenceRef.current = null;
      finishSentence();
    }, SENTENCE_PAUSE_MS);
  }, [clearSilenceTimer, finishSentence]);

  const startRecognition = useCallback((): boolean => {
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      onErrorRef.current?.('Voice typing is unavailable in this browser. You can still type your report.');
      return false;
    }
    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Recognition();
    } catch {
      onErrorRef.current?.('Microphone could not be started. You can still type this field.');
      return false;
    }
    recognitionRef.current = recognition;
    noRestartRef.current = false;
    const chosen: Language = spokenRef.current === 'auto' ? languageRef.current : spokenRef.current;
    recognition.lang = VOICE_LANG[chosen];
    recognition.continuous = true;
    recognition.interimResults = true;
    // One alternative: "best guess" is what the worker sees, never a list to choose from.
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      restartFailuresRef.current = 0;
      setEngineLive(true);
      lastResultAtRef.current = Date.now();
    };

    recognition.onresult = (event) => {
      lastResultAtRef.current = Date.now();
      restartFailuresRef.current = 0;
      setEngineLive(true);
      // Only the results this event brought are read. Chrome keeps every result for the life of
      // the instance, so walking the whole list would re-commit words that are already final.
      const from = Math.max(0, Number(event.resultIndex) || 0);
      const results = event.results ?? [];
      const interims: string[] = [];
      let sawFinal = false;
      for (let index = from; index < results.length; index += 1) {
        const result = results[index];
        const transcript = (result?.[0]?.transcript ?? '').trim();
        if (!transcript) continue;
        if (result?.isFinal) {
          // A final replaces the interim it grew out of, and overlap trimming makes it safe if
          // this instance (or the one before it) already spoke the same words.
          sawFinal = true;
          interims.length = 0;
          committedRef.current = appendTranscript(committedRef.current, transcript);
        } else {
          interims.push(transcript);
        }
      }
      // Interim text is *replaced*, never appended, so the field can never grow duplicates.
      if (sawFinal || interims.length) pendingRef.current = interims.join(' ');
      emit(maxLength);
      // Words are still arriving, so the sentence is not finished: push the pause deadline out.
      scheduleSilence();
    };

    recognition.onerror = (event) => {
      if (event?.error === 'no-speech' || event?.error === 'aborted') return;
      setEngineLive(false);
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        abortRecognition();
        commitPending(true);
        stopClock(false);
        setCurrentPhase('idle');
        onErrorRef.current?.('Microphone permission is blocked. Allow the microphone and try again.');
        return;
      }
      abortRecognition();
      commitPending(true);
      emit(maxLength);
      stopClock(false);
      setCurrentPhase('captured');
      onErrorRef.current?.('Voice input stopped. Check microphone permission and try again.');
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setEngineLive(false);
      if (noRestartRef.current || phaseRef.current !== 'listening') return;
      // The words on screen stay: the interim is committed, the sentence closed, and the next
      // instance trims whatever it hears again. A short delay keeps the microphone from
      // thrashing when Chrome ends the session on every pause in speech.
      commitPending(true);
      emit(maxLength);
      if (restartRef.current !== null) window.clearTimeout(restartRef.current);
      restartRef.current = window.setTimeout(() => {
        restartRef.current = null;
        if (noRestartRef.current || phaseRef.current !== 'listening' || recognitionRef.current) return;
        if (!startRecognition()) restartFailed();
      }, 60);
    };

    try {
      recognition.start();
      lastResultAtRef.current = Date.now();
      return true;
    } catch {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      onErrorRef.current?.('Microphone could not be started. You can still type this field.');
      return false;
    }
  }, [abortRecognition, commitPending, emit, maxLength, restartFailed, scheduleSilence, setCurrentPhase, stopClock]);

  /**
   * While listening, watch the session itself. Android Chrome sometimes stops transcribing
   * without firing `end`: the screen still says "Listening…" and nothing is written until the
   * worker presses Stop. A re-start timer Chrome forgot and a dead-but-silent engine are both
   * picked up here, so the words keep appearing as they are spoken.
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
        if (!startRecognition()) restartFailed();
        return;
      }
      if (recognitionRef.current && Date.now() - lastResultAtRef.current > 8000) {
        // Nothing for eight seconds: the engine stopped transcribing without saying so.
        abortRecognition();
        commitPending(true);
        emit(maxLength);
        restartFailuresRef.current = 0;
        if (!startRecognition()) restartFailed();
      }
    }, 1000);
    return stopWatchdog;
  }, [phase, abortRecognition, commitPending, emit, maxLength, restartFailed, startRecognition, stopWatchdog]);

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    setSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
  }, []);

  const dictating = phase === 'listening' || phase === 'paused';

  // Keep the newest words visible while they are being dictated. The live layer scrolls itself;
  // the textarea is scrolled too so the caret is in view the moment dictation stops.
  useEffect(() => {
    if (!dictating) return;
    const field = textareaRef.current;
    if (field) field.scrollTop = field.scrollHeight;
    const layer = liveRef.current;
    if (layer) layer.scrollTop = layer.scrollHeight;
  }, [value, preview, dictating]);

  // Switching language mid-sentence restarts in the new language; the words already captured
  // stay in the field and the running timer is not reset.
  const langKeyRef = useRef(`${language}|${spoken}`);
  useEffect(() => {
    const key = `${language}|${spoken}`;
    if (langKeyRef.current === key) return;
    langKeyRef.current = key;
    spokenRef.current = spoken;
    if (phaseRef.current !== 'listening') return;
    abortRecognition();
    commitPending(true);
    emit(maxLength);
    startRecognition();
  }, [abortRecognition, commitPending, emit, language, maxLength, spoken, startRecognition]);

  useEffect(() => () => {
    noRestartRef.current = true;
    abortRecognition();
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (restartRef.current !== null) window.clearTimeout(restartRef.current);
    if (silenceRef.current !== null) window.clearTimeout(silenceRef.current);
  }, [abortRecognition]);

  function resetTranscript() {
    committedRef.current = '';
    pendingRef.current = '';
    // The words typed before the microphone stay on screen while the first result is awaited.
    setPreview({ head: originalRef.current, tail: '' });
  }

  function begin() {
    abortRecognition();
    // What was typed stays where it is; the microphone only owns the words it adds after it.
    originalRef.current = value.trim();
    resetTranscript();
    restartFailuresRef.current = 0;
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
    commitPending(true);
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
    commitPending(true);
    emit(maxLength);
    stopClock(true);
    setCurrentPhase('captured');
  }

  function clear() {
    abortRecognition();
    stopClock(false);
    elapsedRef.current = 0;
    resetTranscript();
    onChangeRef.current(originalRef.current);
    setSeconds(0);
    setCurrentPhase('idle');
  }

  function useText() {
    abortRecognition();
    stopClock(false);
    elapsedRef.current = 0;
    commitPending(true);
    emit(maxLength);
    setCurrentPhase('idle');
  }

  function recordAgain() {
    const current = value.trim();
    abortRecognition();
    stopClock(false);
    originalRef.current = current;
    resetTranscript();
    elapsedRef.current = 0;
    setSeconds(0);
    setCurrentPhase('listening');
    startClock();
    if (!startRecognition()) {
      stopClock(false);
      setCurrentPhase('captured');
    }
  }

  function chooseLanguage(next: SpokenLang) {
    spokenRef.current = next;
    setSpoken(next);
  }

  function handleChange(next: string) {
    // The field is read-only while the microphone is on, so this is an ordinary edit made
    // after Stop (or before recording started).
    onChangeRef.current(next);
  }

  const canSpeak = voiceEnabled && supported;
  const isActive = phase !== 'idle';
  const languageOptions: { id: SpokenLang; label: string }[] = [
    { id: 'auto', label: T('Auto') },
    { id: 'hi', label: 'हिन्दी' },
    { id: 'en', label: 'English' }
  ];

  return <div className={`voice-shell${isActive ? ` is-${phase}` : ''}`}>
    {isActive && <div className="voice-status" role="status" aria-live="polite">
      <span className={`voice-status-icon ${phase}`} aria-hidden="true">
        {phase === 'captured'
          ? <Check size={16} />
          : <span className={`voice-rec-dot${phase === 'listening' && engineLive ? ' is-live' : ''}`} />}
      </span>
      <b>{T(phase === 'captured' ? 'Voice captured' : phase === 'paused' ? 'Paused' : 'Listening…')}</b>
      <span className="voice-timer">{clock(seconds)}</span>
    </div>}

    <div className={`voice-field${dictating ? ' is-dictating' : ''}`}>
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
        readOnly={dictating}
        aria-readonly={dictating}
      />
      {dictating && <div className="voice-live" ref={liveRef} aria-hidden="true">
        {!preview.head && !preview.tail && <span className="voice-live-hint">{T('Speak now…')}</span>}
        {preview.head && <span className="voice-live-final">{preview.head}</span>}
        {preview.tail && <span className="voice-pending">{preview.head ? ` ${preview.tail}` : preview.tail}</span>}
        {phase === 'listening' && <i className="voice-caret" />}
      </div>}
    </div>

    {canSpeak && <div className={`voice-actions${isActive ? '' : ' is-idle'}`}>
      {phase === 'idle' && <button type="button" className="voice-action voice-start" onClick={begin}>
        <Mic size={15} /> {T('Start Recording')}
      </button>}
      {phase === 'listening' && <>
        <button type="button" className="voice-action voice-stop" onClick={stop}>
          <Square size={13} /> {T('Stop Recording')}
        </button>
        <button type="button" className="voice-action" onClick={pause}>
          <Pause size={14} /> {T('Pause')}
        </button>
        <button type="button" className="voice-action voice-clear" onClick={clear}>
          <Trash2 size={14} /> {T('Clear')}
        </button>
      </>}
      {phase === 'paused' && <>
        <button type="button" className="voice-action voice-start" onClick={resume}>
          <Play size={14} /> {T('Resume')}
        </button>
        <button type="button" className="voice-action voice-stop" onClick={stop}>
          <Square size={13} /> {T('Stop Recording')}
        </button>
        <button type="button" className="voice-action voice-clear" onClick={clear}>
          <Trash2 size={14} /> {T('Clear')}
        </button>
      </>}
      {phase === 'captured' && <>
        <button type="button" className="voice-action" onClick={recordAgain}>
          <RotateCcw size={14} /> {T('Record Again')}
        </button>
        <button type="button" className="voice-action voice-use" onClick={useText}>
          <Check size={15} /> {T('Use Text')}
        </button>
        <button type="button" className="voice-action voice-clear" onClick={clear}>
          <Trash2 size={14} /> {T('Clear')}
        </button>
      </>}
      <span className="voice-langs" role="group" aria-label={T('Voice language')}>
        {languageOptions.map((option) => <button
          key={option.id}
          type="button"
          className={`voice-lang${spoken === option.id ? ' is-on' : ''}`}
          aria-pressed={spoken === option.id}
          onClick={() => chooseLanguage(option.id)}
        >{option.label}</button>)}
      </span>
    </div>}
  </div>;
}
