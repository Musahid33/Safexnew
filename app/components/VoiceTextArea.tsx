'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Mic, Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { Language } from '@/lib/types';
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

function join(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(' ');
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
  /** Everything already spoken in this session. Each new recognition instance appends to it. */
  const baseRef = useRef('');
  /** Finals and interim text of the current recognition instance. */
  const finalRef = useRef('');
  const interimRef = useRef('');
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

  const abortRecognition = useCallback(() => {
    noRestartRef.current = true;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    try {
      (recognition.abort ?? recognition.stop).call(recognition);
    } catch {
      // Already stopped by the browser.
    }
  }, []);

  /** Fold the current instance into `baseRef` so a restart never repeats or loses words. */
  const flatten = useCallback(() => {
    baseRef.current = join(baseRef.current, finalRef.current, interimRef.current);
    finalRef.current = '';
    interimRef.current = '';
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

    recognition.onresult = (event) => {
      // Rebuild this instance's transcript from all of its results, so a re-sent final can
      // never duplicate words. Everything from earlier instances lives in `baseRef`.
      let finals = '';
      let interim = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = (result?.[0]?.transcript ?? '').trim();
        if (!transcript) continue;
        if (result?.isFinal) finals = join(finals, transcript);
        else interim = join(interim, transcript);
      }
      finalRef.current = finals;
      interimRef.current = interim;
      const next = join(baseRef.current, finals, interim).slice(0, maxLength);
      onChangeRef.current(next);
    };

    recognition.onerror = (event) => {
      if (event?.error === 'no-speech' || event?.error === 'aborted') return;
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        abortRecognition();
        flatten();
        stopClock(false);
        setCurrentPhase('idle');
        onError?.('Microphone permission is blocked. Allow the microphone and try again.');
        return;
      }
      abortRecognition();
      flatten();
      stopClock(false);
      setCurrentPhase('captured');
      onError?.('Voice input stopped. Check the microphone and try again.');
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (noRestartRef.current || phaseRef.current !== 'listening') return;
      // Chrome ends a continuous session on silence; keep the same session and timer going.
      flatten();
      try {
        startRecognition();
      } catch {
        stopClock(false);
        setCurrentPhase('captured');
      }
    };

    try {
      recognition.start();
      return true;
    } catch {
      onError?.('Microphone could not be started. You can still type this field.');
      return false;
    }
  }, [abortRecognition, flatten, language, maxLength, onError, setCurrentPhase, stopClock]);

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    setSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
  }, []);

  useEffect(() => () => {
    noRestartRef.current = true;
    abortRecognition();
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
  }, [abortRecognition]);

  function begin() {
    abortRecognition();
    const start = value.trim();
    originalRef.current = start;
    baseRef.current = start;
    finalRef.current = '';
    interimRef.current = '';
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
    flatten();
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
    flatten();
    stopClock(true);
    setCurrentPhase('captured');
  }

  function clear() {
    abortRecognition();
    stopClock(false);
    elapsedRef.current = 0;
    finalRef.current = '';
    interimRef.current = '';
    baseRef.current = originalRef.current;
    onChangeRef.current(originalRef.current);
    setSeconds(0);
    setCurrentPhase('idle');
  }

  function useText() {
    abortRecognition();
    stopClock(false);
    elapsedRef.current = 0;
    flatten();
    setCurrentPhase('idle');
  }

  function recordAgain() {
    const current = value.trim();
    abortRecognition();
    stopClock(false);
    originalRef.current = current;
    baseRef.current = current;
    finalRef.current = '';
    interimRef.current = '';
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
