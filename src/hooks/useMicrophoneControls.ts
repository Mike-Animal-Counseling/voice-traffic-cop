import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Axis, LaneControl, MicSnapshot } from '../game/types';

const MIN_VOLUME = 0.032;
const LOUD_VOLUME = 0.22;
const LOW_PITCH_MIN = 110;
const HIGH_PITCH_MAX = 520;
const LOW_CENTER = 170;
const HIGH_CENTER = 315;
const BAND_TOLERANCE = 95;
const SWITCH_COMMIT_MS = 55;
const AXIS_LOCK_MS = 90;
const STEADY_VARIANCE_HZ = 22;
const STEADY_TRIGGER_MS = 420;
const COMMAND_HOLD_MS = 1800;
const EMERGENCY_HOLD_MS = 850;
const STOP_SPIKE_DELTA = 0.11;

const initialSnapshot: MicSnapshot = {
  permission: 'idle',
  volume: 0,
  pitch: null,
  smoothedPitch: null,
  command: 'none',
  transcript: 'Mic asleep',
  stableMs: 0,
};

const autoCorrelate = (buffer: Float32Array, sampleRate: number): number | null => {
  let rms = 0;
  for (let i = 0; i < buffer.length; i += 1) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.01) return null;

  let bestOffset = -1;
  let bestCorrelation = 0;
  const maxSamples = Math.floor(buffer.length / 2);
  const firstOffset = Math.max(24, Math.floor(sampleRate / HIGH_PITCH_MAX));
  const lastOffset = Math.min(maxSamples - 1, Math.ceil(sampleRate / LOW_PITCH_MIN));
  const peaks: { offset: number; correlation: number }[] = [];
  let before = 0;
  let previous = 0;

  for (let offset = firstOffset - 1; offset <= lastOffset + 1; offset += 1) {
    let correlation = 0;
    for (let i = 0; i < maxSamples; i += 1) correlation += Math.abs(buffer[i] - buffer[i + offset]);
    correlation = 1 - correlation / maxSamples;
    if (offset >= firstOffset && offset <= lastOffset && correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
    if (offset > firstOffset && previous >= before && previous > correlation) {
      peaks.push({ offset: offset - 1, correlation: previous });
    }
    before = previous;
    previous = correlation;
  }

  if (bestCorrelation <= 0.88 || bestOffset < 0) return null;
  // A multiple of the true period can align better with the sampled frames.
  const minimumPeak = Math.max(0.88, bestCorrelation - Math.min(0.04, rms * 0.2));
  const fundamental = peaks.find((peak) => peak.correlation >= minimumPeak);
  return sampleRate / (fundamental?.offset ?? bestOffset);
};

const getVolume = (buffer: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
};

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const average = (values: number[]) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const pitchSpread = (values: number[]) => {
  if (values.length < 2) return 999;
  return Math.max(...values) - Math.min(...values);
};

const bandConfidence = (pitch: number, center: number) => Math.max(0, 1 - Math.abs(pitch - center) / BAND_TOLERANCE);

export const useMicrophoneControls = () => {
  const [snapshot, setSnapshot] = useState<MicSnapshot>(initialSnapshot);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastPitchRef = useRef<number | null>(null);
  const stableForRef = useRef(0);
  const lastClassifiedAxisRef = useRef<Axis>('northSouth');
  const pendingAxisRef = useRef<Axis | null>(null);
  const pendingAxisMsRef = useRef(0);
  const axisLockMsRef = useRef(0);
  const recentPitchRef = useRef<number[]>([]);
  const commandedAxisRef = useRef<Axis>('northSouth');
  const commandHoldMsRef = useRef(0);
  const emergencyStopMsRef = useRef(0);
  const previousVolumeRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const requestVersion = useRef(0);

  const stopMonitoring = useCallback(() => {
    requestVersion.current += 1;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    analyserRef.current?.disconnect();
    analyserRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recentPitchRef.current = [];
    lastPitchRef.current = null;
    stableForRef.current = 0;
    pendingAxisRef.current = null;
    pendingAxisMsRef.current = 0;
    axisLockMsRef.current = 0;
    commandHoldMsRef.current = 0;
    emergencyStopMsRef.current = 0;
    previousVolumeRef.current = 0;
    lastClassifiedAxisRef.current = 'northSouth';
    commandedAxisRef.current = 'northSouth';
  }, []);

  useEffect(() => stopMonitoring, [stopMonitoring]);

  const resetMicrophone = useCallback(() => {
    stopMonitoring();
    setSnapshot(initialSnapshot);
    setErrorMessage(null);
  }, [stopMonitoring]);

  const requestPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setErrorMessage('This browser does not support live microphone controls.');
      setSnapshot((current) => ({ ...current, permission: 'denied', transcript: 'Mic unavailable' }));
      return false;
    }

    if (streamRef.current && audioContextRef.current) return true;
    const version = ++requestVersion.current;

    try {
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (version !== requestVersion.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      streamRef.current = stream;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      analyserRef.current = analyser;
      lastFrameRef.current = performance.now();

      setSnapshot({ ...initialSnapshot, permission: 'granted', transcript: 'Listening for Pip cues' });

      const buffer = new Float32Array(analyser.fftSize);
      const tick = (now: number) => {
        const elapsed = lastFrameRef.current ? now - lastFrameRef.current : 16;
        lastFrameRef.current = now;

        analyser.getFloatTimeDomainData(buffer);
        const volume = getVolume(buffer);
        const pitch = autoCorrelate(buffer, audioContext.sampleRate);
        if (pitch && pitch >= LOW_PITCH_MIN && pitch <= HIGH_PITCH_MAX) {
          recentPitchRef.current.push(pitch);
          if (recentPitchRef.current.length > 6) recentPitchRef.current.shift();
        } else if (recentPitchRef.current.length > 0) {
          recentPitchRef.current.shift();
        }

        const medianPitch = median(recentPitchRef.current);
        const meanPitch = average(recentPitchRef.current);
        const spread = pitchSpread(recentPitchRef.current);
        const referencePitch = meanPitch ?? medianPitch;
        const smoothedPitch = referencePitch
          ? lastPitchRef.current === null
            ? referencePitch
            : lastPitchRef.current + (referencePitch - lastPitchRef.current) * 0.58
          : lastPitchRef.current;

        lastPitchRef.current = smoothedPitch;
        axisLockMsRef.current = Math.max(0, axisLockMsRef.current - elapsed);
        commandHoldMsRef.current = Math.max(0, commandHoldMsRef.current - elapsed);
        emergencyStopMsRef.current = Math.max(0, emergencyStopMsRef.current - elapsed);

        let command: MicSnapshot['command'] = 'none';
        let transcript = 'Hum or sing to guide a lane';
        const volumeRise = Math.max(0, volume - previousVolumeRef.current);
        previousVolumeRef.current = volume;

        if (volume > LOUD_VOLUME && volumeRise > STOP_SPIKE_DELTA) {
          command = 'stop';
          transcript = 'Emergency stop';
          stableForRef.current = 0;
          pendingAxisRef.current = null;
          pendingAxisMsRef.current = 0;
          axisLockMsRef.current = 0;
          emergencyStopMsRef.current = EMERGENCY_HOLD_MS;
        } else if (smoothedPitch && volume > MIN_VOLUME) {
          let candidateAxis: Axis | null = null;
          const lowConfidence = bandConfidence(smoothedPitch, LOW_CENTER);
          const highConfidence = bandConfidence(smoothedPitch, HIGH_CENTER);
          const dominantGap = Math.abs(lowConfidence - highConfidence);

          if (lowConfidence > 0.2 && lowConfidence > highConfidence && dominantGap > 0.035) {
            candidateAxis = 'northSouth';
          } else if (highConfidence > 0.2 && highConfidence > lowConfidence && dominantGap > 0.035) {
            candidateAxis = 'eastWest';
          }

          if (candidateAxis === null) {
            command = 'listening';
            transcript = 'Hold a lower or higher tone';
            pendingAxisRef.current = null;
            pendingAxisMsRef.current = 0;
          } else {
            const canSwitch =
              candidateAxis === lastClassifiedAxisRef.current || axisLockMsRef.current <= 0;

            if (!canSwitch) {
              pendingAxisRef.current = null;
              pendingAxisMsRef.current = 0;
            } else if (candidateAxis !== pendingAxisRef.current) {
              pendingAxisRef.current = candidateAxis;
              pendingAxisMsRef.current = 0;
            } else {
              pendingAxisMsRef.current += elapsed;
            }

            if (pendingAxisMsRef.current >= SWITCH_COMMIT_MS) {
              lastClassifiedAxisRef.current = candidateAxis;
              commandedAxisRef.current = candidateAxis;
              commandHoldMsRef.current = COMMAND_HOLD_MS;
              axisLockMsRef.current = AXIS_LOCK_MS;
            }

            if (lastClassifiedAxisRef.current === 'northSouth') {
              command = 'low';
              transcript = 'North-South flow';
            } else {
              command = 'high';
              transcript = 'East-West flow';
            }
          }

          if (spread <= STEADY_VARIANCE_HZ && volume > 0.05 && candidateAxis === lastClassifiedAxisRef.current) {
            stableForRef.current += elapsed;
          } else {
            stableForRef.current = Math.max(0, stableForRef.current - elapsed * 0.8);
          }

          if (stableForRef.current > STEADY_TRIGGER_MS && (command === 'low' || command === 'high')) {
            command = 'boost';
            transcript = lastClassifiedAxisRef.current === 'northSouth' ? 'North-South boost' : 'East-West boost';
          }
        } else {
          stableForRef.current = Math.max(0, stableForRef.current - elapsed);
          pendingAxisRef.current = null;
          pendingAxisMsRef.current = 0;
          recentPitchRef.current = [];
        }

        setSnapshot({
          permission: 'granted',
          volume: Math.min(1, volume * 3.8),
          pitch,
          smoothedPitch,
          command,
          transcript,
          stableMs: stableForRef.current,
        });

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
      return true;
    } catch (error) {
      if (version !== requestVersion.current) return false;
      stopMonitoring();
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone access was blocked. You can still play with keyboard or touch controls.'
          : 'The microphone could not be started. Try keyboard or touch controls instead.';
      setErrorMessage(message);
      setSnapshot((current) => ({ ...current, permission: 'denied', transcript: 'Microphone blocked' }));
      return false;
    }
  }, [stopMonitoring]);

  const laneControl = useMemo<LaneControl>(() => {
    let activeAxis: Axis =
      commandHoldMsRef.current > 0 ? commandedAxisRef.current : lastClassifiedAxisRef.current;
    let emergencyStop = emergencyStopMsRef.current > 0;
    let boost = 0;
    let inputLabel = snapshot.transcript;

    if (snapshot.command === 'low') activeAxis = commandedAxisRef.current;
    if (snapshot.command === 'high') activeAxis = commandedAxisRef.current;
    if (snapshot.command === 'stop') emergencyStop = emergencyStopMsRef.current > 0;
    if (snapshot.command === 'boost') {
      activeAxis = commandHoldMsRef.current > 0 ? commandedAxisRef.current : lastClassifiedAxisRef.current;
      boost = Math.min(1, snapshot.stableMs / 1800);
    }

    return { activeAxis, emergencyStop, boost, inputLabel };
  }, [snapshot]);

  return { snapshot, laneControl, requestPermission, resetMicrophone, errorMessage };
};
