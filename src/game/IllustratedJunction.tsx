import type { CSSProperties } from 'react';
import { CENTER_X, CENTER_Y, WORLD_HEIGHT, WORLD_WIDTH } from './constants';
import { signalAspect } from './signals';
import type { GameState, Vehicle } from './types';

const HORIZONTAL_ROAD_MOUTH_LEFT = 245;
const HORIZONTAL_ROAD_MOUTH_RIGHT = 925;
const HORIZONTAL_MOOD_LEFT = 320;
const HORIZONTAL_MOOD_RIGHT = 880;

const vehicleStyle = (vehicle: Vehicle) => {
  const axisCenter = vehicle.axis === 'northSouth' ? CENTER_Y : CENTER_X;
  const centerDelta = vehicle.position - axisCenter;
  const distanceFromCenter = Math.abs(centerDelta);
  const routeProgress = Math.max(0, Math.min(1, 1 - distanceFromCenter / 205));
  const smoothRouteProgress = routeProgress * routeProgress * (3 - 2 * routeProgress);
  const laneSide = vehicle.laneOffset < 0 ? -1 : 1;
  const routedLaneOffset = vehicle.laneOffset + laneSide * 64 * smoothRouteProgress;
  const routeSlope =
    centerDelta === 0
      ? 0
      : laneSide * 64 * (-Math.sign(centerDelta) / 205) * 6 * routeProgress * (1 - routeProgress);
  const steeringAngle = Math.atan(routeSlope) * (180 / Math.PI) * (vehicle.axis === 'northSouth' ? -1 : 1);
  const centerX =
    vehicle.direction === 'northbound' || vehicle.direction === 'southbound'
      ? CENTER_X + routedLaneOffset
      : vehicle.position;
  const centerY =
    vehicle.direction === 'eastbound' || vehicle.direction === 'westbound'
      ? CENTER_Y + routedLaneOffset
      : vehicle.position;
  const rigSize = vehicle.length * 0.84;

  const baseRotation =
    vehicle.direction === 'northbound'
      ? 180
      : vehicle.direction === 'southbound'
        ? 0
        : vehicle.direction === 'eastbound'
          ? -90
          : 90;

  const screenY = vehicle.axis === 'northSouth' ? vehicle.position : CENTER_Y + routedLaneOffset;
  const perspectiveScale = Math.max(0.86, Math.min(1.12, 0.86 + (screenY / WORLD_HEIGHT) * 0.26));
  const accelerationTilt = Math.max(-3.5, Math.min(3.5, -vehicle.acceleration * 0.08));
  const speedLevel = Math.max(0, Math.min(1, vehicle.speed / 88));

  return {
    left: `${((centerX - rigSize / 2) / WORLD_WIDTH) * 100}%`,
    top: `${((centerY - rigSize / 2) / WORLD_HEIGHT) * 100}%`,
    width: `${((rigSize / WORLD_WIDTH) * 100).toFixed(3)}%`,
    aspectRatio: '1',
    zIndex: 12 + Math.round((screenY / WORLD_HEIGHT) * 8),
    '--vehicle-rotation': `${(baseRotation + steeringAngle).toFixed(2)}deg`,
    '--vehicle-scale': perspectiveScale.toFixed(3),
    '--accel-tilt': `${accelerationTilt.toFixed(2)}deg`,
    '--speed-level': speedLevel.toFixed(3),
    '--motion-duration': `${Math.max(0.42, 1.3 - speedLevel * 0.7).toFixed(2)}s`,
    '--wobble-delay': `${(-vehicle.wobbleSeed).toFixed(2)}s`,
  } as CSSProperties;
};

interface TrafficSignalProps {
  position: 'far-left' | 'far-right' | 'near-left' | 'near-right';
  state: 'red' | 'amber' | 'green';
}

const TrafficSignal = ({ position, state }: TrafficSignalProps) => (
  <div className={`signal-cluster signal-cluster--${position}`} aria-hidden="true">
    <img
      key={state}
      className="signal-cluster__body"
      src={`/images/signals/juniper-signal-${state}-v3.png`}
      alt=""
      draggable={false}
      decoding="async"
    />
  </div>
);

export function IllustratedJunction({ game }: { game: GameState }) {
  return (
    <>
      <img className="game-world-art" src="/images/juniper-junction-world-no-signals-v2.png" alt="" aria-hidden="true" draggable={false} decoding="async" />
      <div className="world-lighting" aria-hidden="true" />
      <div className="ambient-particles" aria-hidden="true">
        {new Array(14).fill(null).map((_, index) => <i key={index} />)}
      </div>
      <div className="city-block city-block--top-left">
        <div className="building cluster-a">
          <span className="awning" />
          <span className="window window--round" />
          <span className="window window--tall" />
        </div>
        <div className="tiny-lane tiny-lane--left" />
      </div>
      <div className="city-block city-block--top-right">
        <div className="building cluster-b">
          <span className="sign sign--tram">Tram</span>
          <span className="window window--wide" />
        </div>
      </div>
      <div className="city-block city-block--bottom-left">
        <div className="building cluster-c">
          <span className="sign sign--tea">Berry Tea</span>
          <span className="planter" />
        </div>
      </div>
      <div className="city-block city-block--bottom-right">
        <div className="building cluster-d">
          <span className="sign sign--mail">Snail Mail</span>
          <span className="bench" />
        </div>
      </div>

      <TrafficSignal position="far-left" state={signalAspect(game, 'northSouth')} />
      <TrafficSignal position="far-right" state={signalAspect(game, 'eastWest')} />
      <TrafficSignal position="near-left" state={signalAspect(game, 'eastWest')} />
      <TrafficSignal position="near-right" state={signalAspect(game, 'northSouth')} />

      <div className="vehicle-layer">
        {game.vehicles.map((vehicle) => {
          const isClearOfSideBuildings =
            vehicle.axis === 'northSouth' ||
            (vehicle.position >= HORIZONTAL_ROAD_MOUTH_LEFT && vehicle.position <= HORIZONTAL_ROAD_MOUTH_RIGHT);
          if (!isClearOfSideBuildings) return null;

          const waiting = vehicle.speed < 7 && vehicle.waitingTime > 0.6;
          const braking = vehicle.acceleration < -18;
          const boosted = vehicle.axis === game.activeAxis && game.signalPhase === 'green' && game.boostTimer > 0.5 && vehicle.speed > 25;
          const mood = game.congestion > 70 ? '!' : vehicle.id % 2 === 0 ? '…' : '♪';
          const showMood =
            waiting &&
            (vehicle.axis === 'northSouth' ||
              (vehicle.position >= HORIZONTAL_MOOD_LEFT && vehicle.position <= HORIZONTAL_MOOD_RIGHT));

          return (
            <div
              className={`vehicle vehicle--${vehicle.kind} ${vehicle.axis === game.activeAxis ? 'vehicle--favored' : ''} ${vehicle.speed > 7 ? 'vehicle--moving' : ''} ${waiting ? 'vehicle--waiting' : ''} ${braking ? 'vehicle--braking' : ''} ${boosted ? 'vehicle--boosted' : ''}`}
              style={vehicleStyle(vehicle)}
              key={vehicle.id}
              aria-hidden="true"
            >
              <div className="vehicle__rig">
                <span className="vehicle__ground-shadow" />
                <span className="vehicle__speed-trail"><i /><i /></span>
                <span className="vehicle__exhaust"><i /><i /><i /></span>
                <img
                  className="vehicle__sprite"
                  src={`/images/vehicles/${vehicle.kind}-top.webp`}
                  alt=""
                  draggable={false}
                  decoding="async"
                />
                <span className="vehicle__headlight vehicle__headlight--one" />
                <span className="vehicle__headlight vehicle__headlight--two" />
                <span className="vehicle__brake-light vehicle__brake-light--one" />
                <span className="vehicle__brake-light vehicle__brake-light--two" />
              </div>
              {showMood && <span className="vehicle__mood">{mood}</span>}
            </div>
          );
        })}
      </div>

      <div className="building-occlusion" aria-hidden="true">
        <img
          className="building-occlusion__image building-occlusion__image--left"
          src="/images/juniper-junction-world-no-signals-v2.png"
          alt=""
          draggable={false}
          decoding="async"
        />
      </div>
    </>
  );
}
