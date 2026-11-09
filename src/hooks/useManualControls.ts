import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Axis, LaneControl } from '../game/types';

const STOP_DURATION_MS = 850;

export const useManualControls = (enabled: boolean) => {
  const [activeAxis, setActiveAxis] = useState<Axis>('northSouth');
  const [emergencyStop, setEmergencyStop] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [inputLabel, setInputLabel] = useState('Keyboard ready');
  const stopTimerRef = useRef<number | null>(null);

  const chooseAxis = useCallback((axis: Axis) => {
    setActiveAxis(axis);
    setEmergencyStop(false);
    setInputLabel(axis === 'northSouth' ? 'North–South flow' : 'East–West flow');
  }, []);

  const triggerStop = useCallback(() => {
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    setEmergencyStop(true);
    setInputLabel('Emergency stop');
    stopTimerRef.current = window.setTimeout(() => {
      setEmergencyStop(false);
      setInputLabel('Roads ready');
    }, STOP_DURATION_MS);
  }, []);

  const setBoost = useCallback((active: boolean) => {
    setBoosting(active);
    setInputLabel(active ? 'Flow boost' : 'Roads ready');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabled || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.repeat && event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') return;

      if (['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'Digit1'].includes(event.code)) {
        event.preventDefault();
        chooseAxis('northSouth');
      }
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Digit2'].includes(event.code)) {
        event.preventDefault();
        chooseAxis('eastWest');
      }
      if (event.code === 'Space') {
        event.preventDefault();
        triggerStop();
      }
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        event.preventDefault();
        setBoost(true);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') setBoost(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const onBlur = () => setBoosting(false);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [chooseAxis, enabled, setBoost, triggerStop]);

  useEffect(() => () => {
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
  }, []);

  const laneControl = useMemo<LaneControl>(
    () => ({
      activeAxis,
      emergencyStop,
      boost: boosting ? 1 : 0,
      inputLabel,
    }),
    [activeAxis, boosting, emergencyStop, inputLabel],
  );

  return { laneControl, chooseAxis, triggerStop, setBoost, boosting };
};
