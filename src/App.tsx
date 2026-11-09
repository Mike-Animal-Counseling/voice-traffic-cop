import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_CONGESTION } from './game/constants';
import { createInitialState, startGame, updateGame } from './game/logic';
import { JunctionViewport } from './game/JunctionViewport';
import { signalAspect } from './game/signals';
import { useManualControls } from './hooks/useManualControls';
import { useMicrophoneControls } from './hooks/useMicrophoneControls';
import { useTownMusic } from './hooks/useTownMusic';
import type { Axis, GameState, MicSnapshot } from './game/types';

type ControlMode = 'voice' | 'manual';
type PipPose = 'idle' | 'wave' | 'jam' | 'stop' | 'cheer';

const axisLabel = (axis: Axis) => (axis === 'northSouth' ? 'North–South' : 'East–West');
const axisShortLabel = (axis: Axis) => (axis === 'northSouth' ? 'N · S' : 'E · W');

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

const getStoredBest = () => {
  try {
    return Number(window.localStorage.getItem('voice-traffic-cop:best-score')) || 0;
  } catch {
    return 0;
  }
};

const preventNativeDrag = (event: React.DragEvent<HTMLElement>) => event.preventDefault();

interface HelpDialogProps {
  onClose: () => void;
}

const HelpDialog = ({ onClose }: HelpDialogProps) => (
  <div className="overlay overlay--help" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <div className="help-card">
      <button className="close-button" type="button" onClick={onClose} aria-label="Close help">×</button>
      <p className="card__eyebrow">Dispatch handbook</p>
      <h2 id="help-title">Four cues. One happy city.</h2>
      <div className="help-grid">
        <div><span className="cue-icon">↓</span><strong>Low hum</strong><p>Give North–South traffic the green light.</p></div>
        <div><span className="cue-icon">↑</span><strong>High hum</strong><p>Open East–West and release that queue.</p></div>
        <div><span className="cue-icon">■</span><strong>Loud burst</strong><p>Stop every lane for a quick recovery.</p></div>
        <div><span className="cue-icon">✦</span><strong>Steady tone</strong><p>Hold your pitch to earn a flow boost.</p></div>
      </div>
      <div className="help-note">
        <strong>No microphone? No problem.</strong>
        Arrow or WASD keys choose a lane, Space stops traffic, Shift boosts, and P pauses.
      </div>
      <button className="primary-button" type="button" onClick={onClose}>Got it</button>
    </div>
  </div>
);

const MicReadout = ({ snapshot }: { snapshot: MicSnapshot }) => (
  <>
    <div className="listening-row">
      <span className={`permission-dot permission-dot--${snapshot.permission}`} />
      <span>{snapshot.permission === 'granted' ? 'Live mic' : 'Microphone off'}</span>
      <strong>{snapshot.smoothedPitch ? `${Math.round(snapshot.smoothedPitch)} Hz` : '—'}</strong>
    </div>
    <meter className="input-meter" min={0} max={1} value={snapshot.volume} aria-label="Microphone level" />
    <p className="input-reading">{snapshot.permission === 'granted' ? snapshot.transcript : 'Waiting for microphone'}</p>
  </>
);

interface TitleScreenProps {
  highScore: number;
  showHelp: boolean;
  onVoiceStart: () => void;
  onManualStart: () => void;
  onOpenHelp: () => void;
  onCloseHelp: () => void;
  onCheckMic: () => void;
  micCheck: React.ReactNode;
}

const TitleScreen = ({ highScore, showHelp, onVoiceStart, onManualStart, onOpenHelp, onCloseHelp, onCheckMic, micCheck }: TitleScreenProps) => (
  <main className="title-page" onDragStart={preventNativeDrag}>
    <div className="title-layout">
      <section className="intro-copy">
        <div className="intro-brand">
          <span className="intro-brand__mark" aria-hidden="true">〽</span>
          Juniper Junction Dispatch
        </div>
        <div className="intro-heading">
          <h1><span>Voice</span><span>Traffic Cop</span></h1>
          <p className="intro-lead">Hum low to open North–South. Hum high to open East–West. Keep Juniper Junction moving.</p>
        </div>

        <div className="feature-pills" aria-label="Game features">
          <span>Voice controlled</span>
          <span>Audio stays local</span>
          <span>Keyboard friendly</span>
        </div>

        <div className="start-actions">
          <button className="primary-button primary-button--voice" type="button" onClick={onVoiceStart}>
            <span className="button-icon" aria-hidden="true">●</span>
            <span>Play with voice</span>
          </button>
          <button className="secondary-button" type="button" onClick={onManualStart}>Play with keys</button>
        </div>

        <div className="intro-footer">
          <button type="button" className="text-button" onClick={onOpenHelp}>How to play <kbd>H</kbd></button>
          <button type="button" className="text-button" onClick={onCheckMic}>Test microphone</button>
          <span>Personal best <strong>{highScore.toLocaleString()}</strong></span>
        </div>
      </section>

      <section className="intro-art" aria-label="Pip directing traffic in Juniper Junction">
        <img
          src="/images/juniper-arcade-poster.jpg"
          alt="Pixel-art Pip directing traffic at Juniper Junction"
          width={1536}
          height={1024}
          draggable={false}
          decoding="async"
          fetchPriority="high"
        />
        <div className="art-caption">
          <span className="live-dot" />
          <span><small>First assignment</small><strong>Rookie Patrol</strong></span>
        </div>
      </section>
    </div>
    {showHelp && <HelpDialog onClose={onCloseHelp} />}
    {micCheck}
  </main>
);

function App() {
  const [game, setGame] = useState<GameState>(createInitialState);
  const [controlMode, setControlMode] = useState<ControlMode>('voice');
  const [highScore, setHighScore] = useState(getStoredBest);
  const [showHelp, setShowHelp] = useState(false);
  const [micCheck, setMicCheck] = useState<'closed' | 'idle' | 'requesting' | 'ready' | 'unavailable'>('closed');
  const micDialogRef = useRef<HTMLDialogElement>(null);
  const startingRef = useRef(false);
  const [pipIdlePose, setPipIdlePose] = useState<PipPose>('idle');
  const [musicEnabled, setMusicEnabled] = useState(true);
  const {
    snapshot,
    laneControl: microphoneControl,
    requestPermission,
    resetMicrophone,
    errorMessage,
  } = useMicrophoneControls();
  const { play: playTownMusic, pause: pauseTownMusic, stop: stopTownMusic } = useTownMusic();
  const manual = useManualControls(game.phase === 'running' && controlMode === 'manual' && !showHelp);
  const lastFrameRef = useRef<number | null>(null);
  const baselineBestRef = useRef(highScore);

  const laneControl = controlMode === 'voice' ? microphoneControl : manual.laneControl;
  const laneControlRef = useRef(laneControl);
  const micCheckOpen = micCheck !== 'closed';

  useEffect(() => {
    laneControlRef.current = laneControl;
  }, [laneControl]);

  useEffect(() => {
    const dialog = micDialogRef.current;
    if (micCheckOpen && dialog && !dialog.open) dialog.showModal();
  }, [micCheckOpen]);

  useEffect(() => {
    let animationFrame = 0;
    const tick = (now: number) => {
      const last = lastFrameRef.current ?? now;
      const delta = Math.min(0.033, (now - last) / 1000);
      lastFrameRef.current = now;
      setGame((current) => updateGame(current, laneControlRef.current, delta));
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (game.score <= highScore) return;
    setHighScore(game.score);
    try {
      window.localStorage.setItem('voice-traffic-cop:best-score', String(game.score));
    } catch {
      // The game still works when storage is unavailable.
    }
  }, [game.score, highScore]);

  const togglePause = useCallback(() => {
    setGame((current) => {
      if (current.phase === 'running') {
        return { ...current, phase: 'paused', announcement: 'Shift paused' };
      }
      if (current.phase === 'paused') {
        lastFrameRef.current = performance.now();
        return { ...current, phase: 'running', announcement: 'Back on duty' };
      }
      return current;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'KeyP' || event.code === 'Escape') {
        if (game.phase === 'running' || game.phase === 'paused') {
          event.preventDefault();
          togglePause();
        }
      }
      if (event.code === 'KeyH' && !event.repeat) setShowHelp((current) => !current);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        setGame((current) =>
          current.phase === 'running'
            ? { ...current, phase: 'paused', announcement: 'Shift paused while you were away' }
            : current,
        );
      }
    };

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [game.phase, togglePause]);


  useEffect(() => {
    if (game.phase === 'running' && musicEnabled) playTownMusic();
    else if (game.phase === 'paused') pauseTownMusic();
    else if (game.phase === 'running') pauseTownMusic();
    else stopTownMusic();
  }, [game.phase, musicEnabled, pauseTownMusic, playTownMusic, stopTownMusic]);

  useEffect(() => {
    if (game.phase !== 'running') {
      setPipIdlePose('idle');
      return undefined;
    }

    let timeoutId = 0;
    const scheduleReaction = () => {
      timeoutId = window.setTimeout(() => {
        setPipIdlePose(Math.random() > 0.64 ? 'wave' : 'idle');
        scheduleReaction();
      }, 2800 + Math.random() * 3200);
    };

    scheduleReaction();
    return () => window.clearTimeout(timeoutId);
  }, [game.phase]);

  const startRun = async (mode: ControlMode) => {
    if (startingRef.current) return;
    startingRef.current = true;
    // Start from the button gesture so browsers allow Web Audio playback.
    if (musicEnabled) playTownMusic();
    let selectedMode = mode;
    if (mode === 'voice') {
      const permissionGranted = await requestPermission();
      if (!permissionGranted) selectedMode = 'manual';
    } else {
      resetMicrophone();
    }
    micDialogRef.current?.close();
    setMicCheck('closed');
    setControlMode(selectedMode);
    baselineBestRef.current = highScore;
    lastFrameRef.current = performance.now();
    setGame(startGame());
    startingRef.current = false;
  };

  const switchControlMode = async (mode: ControlMode) => {
    if (mode === 'voice') {
      const permissionGranted = await requestPermission();
      if (!permissionGranted) return;
    } else {
      resetMicrophone();
    }
    setControlMode(mode);
  };

  const restart = () => {
    if (musicEnabled) playTownMusic();
    baselineBestRef.current = highScore;
    lastFrameRef.current = performance.now();
    setGame(startGame());
  };

  const returnToTitle = () => {
    resetMicrophone();
    setGame(createInitialState());
  };

  const checkMicrophone = async () => {
    setMicCheck('requesting');
    setMicCheck(await requestPermission() ? 'ready' : 'unavailable');
  };

  const closeMicCheck = () => {
    if (micCheck === 'requesting') return;
    resetMicrophone();
    micDialogRef.current?.close();
    setMicCheck('closed');
  };

  const toggleTownMusic = () => {
    if (musicEnabled) {
      setMusicEnabled(false);
      pauseTownMusic();
      return;
    }

    setMusicEnabled(true);
    if (game.phase === 'running') playTownMusic();
  };

  if (game.phase === 'title') {
    return (
      <TitleScreen
        highScore={highScore}
        showHelp={showHelp}
        onVoiceStart={() => void startRun('voice')}
        onManualStart={() => void startRun('manual')}
        onOpenHelp={() => setShowHelp(true)}
        onCloseHelp={() => setShowHelp(false)}
        onCheckMic={() => setMicCheck('idle')}
        micCheck={micCheckOpen && (
          <dialog
            ref={micDialogRef}
            className="mic-check"
            aria-labelledby="mic-check-title"
            onCancel={(event) => { event.preventDefault(); closeMicCheck(); }}
          >
            <h2 id="mic-check-title">Microphone check</h2>
            <p>Your audio is analyzed in this browser. Try one low hum, then one high hum.</p>
            {micCheck === 'ready' && <MicReadout snapshot={snapshot} />}
            {micCheck === 'unavailable' && <p className="control-error" role="alert">{errorMessage} Check site permissions or continue with keys and touch.</p>}
            <div className="start-actions">
              {micCheck === 'ready' ? (
                <button className="primary-button" type="button" onClick={() => void startRun('voice')}>Start voice patrol</button>
              ) : (
                <button className="primary-button" type="button" disabled={micCheck === 'requesting'} onClick={() => void checkMicrophone()}>
                  {micCheck === 'requesting' ? 'Waiting for permission…' : 'Enable microphone'}
                </button>
              )}
              <button className="secondary-button" type="button" disabled={micCheck === 'requesting'} onClick={() => void startRun('manual')}>Play with keys</button>
              <button className="text-button" type="button" disabled={micCheck === 'requesting'} onClick={closeMicCheck}>Close</button>
            </div>
          </dialog>
        )}
      />
    );
  }

  const trafficMood =
    game.congestion < 28 ? 'Gliding' : game.congestion < 58 ? 'Building' : game.congestion < 82 ? 'Tense' : 'Critical';
  const levelName =
    game.difficultyLevel === 1 ? 'Rookie Patrol' : game.difficultyLevel === 2 ? 'Cadet Crossing' : 'Captain Rush';
  const progressToNext = game.difficultyLevel >= 3 ? 100 : Math.min(100, (game.score / game.levelGoal) * 100);
  const congestionLevel = Math.min(MAX_CONGESTION, Math.max(0, game.congestion));
  const queueNS = game.vehicles.filter((vehicle) => vehicle.axis === 'northSouth').length;
  const queueEW = game.vehicles.filter((vehicle) => vehicle.axis === 'eastWest').length;
  const currentQueue = game.activeAxis === 'northSouth' ? queueNS : queueEW;
  const laneOpen = signalAspect(game, game.activeAxis) === 'green';
  const currentInput =
    controlMode === 'voice'
      ? snapshot.command === 'none'
        ? 'Listening'
        : snapshot.transcript
      : manual.laneControl.inputLabel;
  const isPlaying = game.phase === 'running' || game.phase === 'paused';
  const pipPose: PipPose = game.emergencyStop
    ? 'stop'
    : !laneOpen
      ? 'stop'
      : game.congestion >= 70
        ? 'jam'
        : game.delightFlash > 0.18
          ? 'cheer'
          : game.boostTimer > 0.5
            ? 'wave'
            : pipIdlePose;
  const pipMessage = game.emergencyStop
    ? 'All paws — stop!'
    : game.signalPhase === 'yellow'
      ? 'Easy now — lights changing.'
      : !laneOpen
        ? 'Clearing the junction…'
        : game.congestion >= 70
          ? 'Queue building — hold steady!'
          : game.delightFlash > 0.18
            ? 'Clear roads — lovely work!'
            : currentInput;

  const controlButtonProps = (axis: Axis) => ({
    className: `lane-button ${signalAspect(game, axis) === 'green' ? 'lane-button--active' : ''}`,
    onClick: () => manual.chooseAxis(axis),
    'aria-pressed': signalAspect(game, axis) === 'green',
  });

  return (
    <main className="app-shell" onDragStart={preventNativeDrag}>
      <div className="scene">
        <div className="scene-frame">
          <div
            className={`scene-stage ${game.phase === 'running' ? 'scene--live' : ''} ${game.phase === 'paused' ? 'scene--paused' : ''} ${game.dangerFlash > 0.1 ? 'scene--danger' : ''}`}
            style={
              {
                '--danger-flash': game.dangerFlash,
                '--delight-flash': game.delightFlash,
                '--boost-flash': Math.min(1, game.boostTimer / 4),
              } as React.CSSProperties
            }
          >

            <header className="hud">
              <div className="brand-chip">
                <span className="brand-mark" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <span className="brand-chip__eyebrow">Juniper Junction</span>
                  <strong>Voice Traffic Cop</strong>
                </span>
              </div>

              <div className="status-panel" aria-label="Shift stats">
                <div className="metric metric--score">
                  <span className="metric__label">Score</span>
                  <strong>{game.score.toLocaleString()}</strong>
                </div>
                <div className="metric">
                  <span className="metric__label">Streak</span>
                  <strong>×{game.streak}</strong>
                </div>
                <div className="metric">
                  <span className="metric__label">Level</span>
                  <strong>{game.difficultyLevel}</strong>
                </div>
                <div className="metric">
                  <span className="metric__label">Best</span>
                  <strong>{highScore.toLocaleString()}</strong>
                </div>
                {isPlaying && (
                  <>
                    <button
                      className={`icon-button music-toggle ${musicEnabled ? 'music-toggle--on' : ''}`}
                      type="button"
                      onClick={toggleTownMusic}
                      aria-label={musicEnabled ? 'Mute town music' : 'Play town music'}
                      aria-pressed={musicEnabled}
                      title={musicEnabled ? 'Town music on' : 'Town music off'}
                    >
                      <span aria-hidden="true">♪</span>
                    </button>
                    <button className="icon-button" type="button" onClick={togglePause} aria-label={game.phase === 'paused' ? 'Resume game' : 'Pause game'}>
                      {game.phase === 'paused' ? '▶' : 'Ⅱ'}
                    </button>
                  </>
                )}
              </div>
            </header>

            <div className="street-stage">
              <div className="objective-strip" data-open={laneOpen}>
                <span className="objective-strip__label" aria-hidden="true">
                  {laneOpen ? (game.activeAxis === 'northSouth' ? '↕' : '↔') : '■'}
                </span>
                <strong>{laneOpen ? `${axisLabel(game.activeAxis)} open` : 'All lanes holding'}</strong>
                <span className="objective-strip__queue">
                  {laneOpen ? `${currentQueue} in route` : game.emergencyStop ? 'Emergency stop' : 'Changing lights'}
                </span>
              </div>
              <JunctionViewport game={game} />
              <div className="intersection-center">
                <div className="roundabout-bloom" />
                <div className={`voice-wave voice-wave--${game.activeAxis} ${!laneOpen ? 'voice-wave--stop' : ''} ${game.boostTimer > 0.5 ? 'voice-wave--boost' : ''}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="pip">
                  <div className={`speech-ribbon ${laneControl.inputLabel ? 'speech-ribbon--live' : ''}`}>{pipMessage}</div>
                  <div className={`pip-avatar pip-avatar--${game.activeAxis} ${game.congestion > 70 ? 'pip-avatar--urgent' : ''} ${!laneOpen ? 'pip-avatar--stop' : ''}`}>
                    <span className="pip-avatar__glow" />
                    <img
                      key={pipPose}
                      className={`pip-avatar__pose pip-avatar__pose--${pipPose}`}
                      src={`/images/pip/pip-${pipPose}-v2.png`}
                      alt="Pip Bristle directing the intersection"
                      draggable={false}
                      decoding="async"
                    />
                  </div>
                </div>
              </div>

            </div>

            <aside className="control-dock" aria-label="Traffic controls">
              <div className="control-dock__header">
                <div>
                  <span className="panel-kicker">Controller</span>
                  <strong>{controlMode === 'voice' ? 'Voice pilot' : 'Hands-on patrol'}</strong>
                </div>
                <div className="mode-switch">
                  <button type="button" className={controlMode === 'voice' ? 'is-active' : ''} onClick={() => void switchControlMode('voice')} aria-pressed={controlMode === 'voice'}>
                    Voice
                  </button>
                  <button type="button" className={controlMode === 'manual' ? 'is-active' : ''} onClick={() => void switchControlMode('manual')} aria-pressed={controlMode === 'manual'}>
                    Keys
                  </button>
                </div>
              </div>

              {controlMode === 'voice' ? (
                <>
                  <MicReadout snapshot={snapshot} />
                  {snapshot.permission !== 'granted' && (
                    <button className="dock-action" type="button" onClick={() => void switchControlMode('voice')}>
                      Enable microphone
                    </button>
                  )}
                  <p className="control-hint">Low hum = N–S · High hum = E–W · Loud = Stop</p>
                </>
              ) : (
                <>
                  <div className="lane-controls">
                    <button type="button" {...controlButtonProps('northSouth')}>
                      <span>↑↓</span>
                      <strong>N–S</strong>
                      <small>W / S / 1</small>
                    </button>
                    <button type="button" {...controlButtonProps('eastWest')}>
                      <span>↔</span>
                      <strong>E–W</strong>
                      <small>A / D / 2</small>
                    </button>
                    <button type="button" className={`lane-button lane-button--stop ${game.emergencyStop ? 'lane-button--active' : ''}`} onClick={manual.triggerStop}>
                      <span>■</span>
                      <strong>Stop</strong>
                      <small>Space</small>
                    </button>
                    <button
                      type="button"
                      className={`lane-button lane-button--boost ${manual.boosting ? 'lane-button--active' : ''}`}
                      onPointerDown={() => manual.setBoost(true)}
                      onPointerUp={() => manual.setBoost(false)}
                      onPointerLeave={() => manual.setBoost(false)}
                      onPointerCancel={() => manual.setBoost(false)}
                      onKeyDown={(event) => {
                        if (event.key === ' ' || event.key === 'Enter') {
                          event.preventDefault();
                          event.stopPropagation();
                          manual.setBoost(true);
                        }
                      }}
                      onKeyUp={(event) => {
                        if (event.key === ' ' || event.key === 'Enter') manual.setBoost(false);
                      }}
                      onBlur={() => manual.setBoost(false)}
                    >
                      <span>✦</span>
                      <strong>Boost</strong>
                      <small>Hold Shift</small>
                    </button>
                  </div>
                </>
              )}
              {errorMessage && <p className="control-error" role="status">{errorMessage} Check site permissions to use voice, or continue with keys and touch.</p>}
            </aside>

            <aside className="shift-panel" aria-label="Traffic health">
              <div className="shift-panel__top">
                <div>
                  <span className="panel-kicker">Congestion · {Math.round(congestionLevel)}%</span>
                  <strong>{trafficMood}</strong>
                </div>
                <span className={`mood-orb mood-orb--${trafficMood.toLowerCase()}`} />
              </div>
              <div
                className="congestion-meter"
                role="progressbar"
                aria-label="Congestion"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(congestionLevel)}
              >
                <span style={{ width: `${congestionLevel}%` }} />
              </div>
              <div className="shift-stats">
                <span><b>{game.carsCleared}</b> cleared</span>
                <span><b>{formatTime(game.elapsed)}</b> shift</span>
                <span>{laneOpen ? <><b>{axisShortLabel(game.activeAxis)}</b> open</> : 'All lanes held'}</span>
              </div>
              <div className="level-progress">
                <span style={{ width: `${Math.max(4, progressToNext)}%` }} />
              </div>
              <small>{game.difficultyLevel >= 3 ? 'Maximum traffic level' : `${game.levelGoal - game.score} points to next patrol`}</small>
            </aside>

            <div className="announcement-bar" role="status" aria-live="polite">
              <span aria-hidden="true">✦</span>
              {game.announcement}
            </div>

            {game.phase === 'paused' && (
              <div className="overlay overlay--pause">
                <div className="pause-card">
                  <span className="pause-card__icon" aria-hidden="true">Ⅱ</span>
                  <p className="card__eyebrow">Pip is holding the crossing</p>
                  <h2>Shift paused</h2>
                  <p>Your score and traffic are safe. Take a breath.</p>
                  <button className="primary-button" type="button" onClick={togglePause}>Resume patrol</button>
                  <button className="text-button" type="button" onClick={returnToTitle}>Return to title</button>
                </div>
              </div>
            )}

            {game.phase === 'gameOver' && (
              <div className="overlay overlay--gameover">
                <div className="results-card">
                  <div className="results-card__header">
                    <span className="results-badge">Shift report</span>
                    <p>{game.score > baselineBestRef.current ? 'New personal best' : 'Juniper Junction tangled up'}</p>
                    <h2>{game.score.toLocaleString()}</h2>
                    <span>final score</span>
                  </div>
                  <div className="gameover-stats">
                    <div><span>Cars cleared</span><strong>{game.carsCleared}</strong></div>
                    <div><span>Best streak</span><strong>×{game.bestStreak}</strong></div>
                    <div><span>Patrol reached</span><strong>{game.difficultyLevel}</strong></div>
                    <div><span>Time on duty</span><strong>{formatTime(game.elapsed)}</strong></div>
                  </div>
                  <div className="results-actions">
                    <button className="primary-button" type="button" onClick={restart}>Try another shift</button>
                    <button className="secondary-button" type="button" onClick={returnToTitle}>Back to title</button>
                  </div>
                </div>
              </div>
            )}

            {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
