import {
  CENTER_X,
  CENTER_Y,
  DEFAULT_CONTROL,
  DESPAWN_MARGIN,
  INTERSECTION_SIZE,
  LANE_ACCELERATION,
  MAX_CONGESTION,
  SAFE_DISTANCE,
  VEHICLE_PALETTES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './constants';
import { signalAspect } from './signals';
import type { Axis, DifficultyTier, Direction, GameState, Vehicle } from './types';

interface DifficultyConfig {
  tier: DifficultyTier;
  level: number;
  label: string;
  goal: number;
  spawnNs: number;
  spawnEw: number;
  congestionGrace: number;
  backlogPenalty: number;
  laneStarvePenalty: number;
  smoothBonus: number;
  conflictPenalty: number;
}

const DIFFICULTY_STEPS: DifficultyConfig[] = [
  {
    tier: 'rookie',
    level: 1,
    label: 'Rookie Patrol',
    goal: 160,
    spawnNs: 4.6,
    spawnEw: 5.1,
    congestionGrace: 8.6,
    backlogPenalty: 1.8,
    laneStarvePenalty: 1.2,
    smoothBonus: 3.3,
    conflictPenalty: 10,
  },
  {
    tier: 'cadet',
    level: 2,
    label: 'Cadet Crossing',
    goal: 360,
    spawnNs: 3.6,
    spawnEw: 4,
    congestionGrace: 7.1,
    backlogPenalty: 2.8,
    laneStarvePenalty: 1.9,
    smoothBonus: 2.7,
    conflictPenalty: 13,
  },
  {
    tier: 'captain',
    level: 3,
    label: 'Captain Rush',
    goal: 620,
    spawnNs: 2.9,
    spawnEw: 3.2,
    congestionGrace: 5.9,
    backlogPenalty: 3.9,
    laneStarvePenalty: 2.8,
    smoothBonus: 2.2,
    conflictPenalty: 16,
  },
];

const configForLevel = (level: number) => DIFFICULTY_STEPS[Math.min(DIFFICULTY_STEPS.length - 1, level - 1)];

const YELLOW_DURATION = 0.36;
const ALL_RED_DURATION = 0.12;
const STOP_LINE_MARGIN = 14;
const MIN_BUMPER_GAP = 20;

const axisForDirection = (direction: Direction): Axis =>
  direction === 'northbound' || direction === 'southbound' ? 'northSouth' : 'eastWest';

const randomFrom = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

const createVehicle = (id: number, direction: Direction): Vehicle => {
  const laneOffset = direction === 'northbound' || direction === 'eastbound' ? -34 : 34;
  const kind = randomFrom(['bubble', 'beetle', 'snail', 'hopper'] as const);
  const lengthMap = { bubble: 78, beetle: 80, snail: 96, hopper: 94 };
  const widthMap = { bubble: 42, beetle: 44, snail: 46, hopper: 48 };

  let position = 0;
  if (direction === 'northbound') position = WORLD_HEIGHT + 120;
  if (direction === 'southbound') position = -120;
  if (direction === 'eastbound') position = -120;
  if (direction === 'westbound') position = WORLD_WIDTH + 120;

  return {
    id,
    direction,
    axis: axisForDirection(direction),
    laneOffset,
    position,
    speed: 0,
    acceleration: 0,
    waitingTime: 0,
    length: lengthMap[kind],
    width: widthMap[kind],
    color: randomFrom(VEHICLE_PALETTES),
    kind,
    wobbleSeed: Math.random() * Math.PI * 2,
  };
};

const spawnIntervalForState = (state: GameState, axis: Axis): number => {
  const config = configForLevel(state.difficultyLevel);
  const base = axis === 'northSouth' ? config.spawnNs : config.spawnEw;
  const withinLevelPressure = Math.max(0.94, 1 - (state.score % config.goal) / (config.goal * 7));
  return base * withinLevelPressure;
};

const distanceToStopLine = (vehicle: Vehicle): number => {
  const halfLength = vehicle.length / 2;
  if (vehicle.direction === 'northbound') return vehicle.position - (CENTER_Y + INTERSECTION_SIZE / 2) - halfLength - STOP_LINE_MARGIN;
  if (vehicle.direction === 'southbound') return CENTER_Y - INTERSECTION_SIZE / 2 - vehicle.position - halfLength - STOP_LINE_MARGIN;
  if (vehicle.direction === 'eastbound') return CENTER_X - INTERSECTION_SIZE / 2 - vehicle.position - halfLength - STOP_LINE_MARGIN;
  return vehicle.position - (CENTER_X + INTERSECTION_SIZE / 2) - halfLength - STOP_LINE_MARGIN;
};

const axisHasGreen = (vehicle: Vehicle, state: GameState) =>
  signalAspect(state, vehicle.axis) === 'green';

const desiredSpeed = (vehicle: Vehicle, state: GameState): number => {
  if (state.emergencyStop) return 0;

  const activeForAxis = axisHasGreen(vehicle, state);
  const boost = activeForAxis ? state.boostTimer * 20 : 0;
  const base = 58 + (vehicle.kind === 'hopper' ? -4 : 6) + boost;

  if (activeForAxis) return base;

  const clearance = distanceToStopLine(vehicle);
  if (clearance < -2) return base;
  return Math.min(26, Math.sqrt(Math.max(0, clearance) * 52));
};

const clampVehicleToStopLine = (vehicle: Vehicle) => {
  const halfLength = vehicle.length / 2;
  if (vehicle.direction === 'northbound') vehicle.position = CENTER_Y + INTERSECTION_SIZE / 2 + halfLength + STOP_LINE_MARGIN;
  if (vehicle.direction === 'southbound') vehicle.position = CENTER_Y - INTERSECTION_SIZE / 2 - halfLength - STOP_LINE_MARGIN;
  if (vehicle.direction === 'eastbound') vehicle.position = CENTER_X - INTERSECTION_SIZE / 2 - halfLength - STOP_LINE_MARGIN;
  if (vehicle.direction === 'westbound') vehicle.position = CENTER_X + INTERSECTION_SIZE / 2 + halfLength + STOP_LINE_MARGIN;
};

const vehicleNeedsClearance = (vehicle: Vehicle, clearingAxis: Axis) => {
  if (vehicle.axis !== clearingAxis) return false;
  const center = vehicle.axis === 'northSouth' ? CENTER_Y : CENTER_X;
  const insideIntersection = Math.abs(vehicle.position - center) < INTERSECTION_SIZE / 2 + vehicle.length / 2;
  return insideIntersection && distanceToStopLine(vehicle) < -2;
};

const hasSafeSpawnGap = (candidate: Vehicle, vehicles: Vehicle[]) =>
  vehicles.every((vehicle) => {
    if (vehicle.direction !== candidate.direction) return true;
    const minimumCenterGap = (vehicle.length + candidate.length) / 2 + MIN_BUMPER_GAP;
    return Math.abs(vehicle.position - candidate.position) >= minimumCenterGap;
  });

const sortForLane = (vehicles: Vehicle[], direction: Direction) => {
  const list = vehicles.filter((vehicle) => vehicle.direction === direction);
  list.sort((a, b) => {
    if (direction === 'northbound' || direction === 'westbound') return a.position - b.position;
    return b.position - a.position;
  });
  return list;
};

const updateVehiclePosition = (vehicle: Vehicle, delta: number) => {
  if (vehicle.direction === 'northbound') vehicle.position -= vehicle.speed * delta;
  if (vehicle.direction === 'southbound') vehicle.position += vehicle.speed * delta;
  if (vehicle.direction === 'eastbound') vehicle.position += vehicle.speed * delta;
  if (vehicle.direction === 'westbound') vehicle.position -= vehicle.speed * delta;
};

const hasExited = (vehicle: Vehicle) => {
  if (vehicle.direction === 'northbound') return vehicle.position < -DESPAWN_MARGIN;
  if (vehicle.direction === 'southbound') return vehicle.position > WORLD_HEIGHT + DESPAWN_MARGIN;
  if (vehicle.direction === 'eastbound') return vehicle.position > WORLD_WIDTH + DESPAWN_MARGIN;
  return vehicle.position < -DESPAWN_MARGIN;
};

const computeBacklog = (vehicles: Vehicle[], axis: Axis) =>
  vehicles.reduce((sum, vehicle) => {
    if (vehicle.axis !== axis) return sum;
    const distance =
      vehicle.direction === 'northbound'
        ? vehicle.position - CENTER_Y
        : vehicle.direction === 'southbound'
          ? CENTER_Y - vehicle.position
          : vehicle.direction === 'eastbound'
            ? CENTER_X - vehicle.position
            : vehicle.position - CENTER_X;
    return sum + Math.max(0, 1 - distance / 380);
  }, 0);

export const createInitialState = (): GameState => ({
  phase: 'title',
  difficultyTier: 'rookie',
  difficultyLevel: 1,
  levelGoal: DIFFICULTY_STEPS[0].goal,
  justLeveledUp: false,
  vehicles: [],
  score: 0,
  streak: 0,
  bestStreak: 0,
  carsCleared: 0,
  congestion: 10,
  conflictCooldown: 0,
  graceTimer: 20,
  dangerFlash: 0,
  delightFlash: 0,
  activeAxis: DEFAULT_CONTROL.activeAxis,
  signalPhase: 'green',
  pendingAxis: null,
  clearanceAxis: null,
  signalTimer: 0,
  emergencyStop: DEFAULT_CONTROL.emergencyStop,
  boostTimer: 0,
  elapsed: 0,
  spawnTimerNS: 1.2,
  spawnTimerEW: 2,
  nextVehicleId: 1,
  tutorialText: 'Hum low for North-South, sing high for East-West, clap or go loud to stop all.',
  announcement: 'Pip Bristle reporting for intersection duty.',
});

export const startGame = (): GameState => ({
  ...createInitialState(),
  phase: 'running',
  announcement: 'Rookie Patrol: nice and easy. Keep both lanes gently moving.',
});

export const updateGame = (previous: GameState, input: { activeAxis: Axis; emergencyStop: boolean; boost: number; inputLabel: string }, delta: number): GameState => {
  if (previous.phase === 'paused' || previous.phase === 'gameOver') return previous;

  if (previous.phase === 'title') {
    return {
      ...previous,
      activeAxis: input.activeAxis,
      signalPhase: 'green',
      pendingAxis: null,
      clearanceAxis: null,
      signalTimer: 0,
      emergencyStop: input.emergencyStop,
      announcement: input.inputLabel,
      boostTimer: Math.max(0, previous.boostTimer - delta),
    };
  }

  const next: GameState = {
    ...previous,
    elapsed: previous.elapsed + delta,
    activeAxis: previous.activeAxis,
    signalPhase: previous.signalPhase,
    pendingAxis: previous.pendingAxis,
    clearanceAxis: previous.clearanceAxis,
    signalTimer: Math.max(0, previous.signalTimer - delta),
    emergencyStop: input.emergencyStop,
    boostTimer: Math.max(0, previous.boostTimer - delta),
    announcement: input.inputLabel,
    conflictCooldown: Math.max(0, previous.conflictCooldown - delta),
    dangerFlash: Math.max(0, previous.dangerFlash - delta * 2.2),
    delightFlash: Math.max(0, previous.delightFlash - delta * 1.8),
    justLeveledUp: false,
    graceTimer: Math.max(0, previous.graceTimer - delta),
    spawnTimerNS: previous.spawnTimerNS - delta,
    spawnTimerEW: previous.spawnTimerEW - delta,
    vehicles: previous.vehicles.map((vehicle) => ({ ...vehicle })),
  };

  if (input.emergencyStop) {
    next.signalPhase = 'allRed';
    next.pendingAxis = input.activeAxis;
    next.clearanceAxis = null;
    next.signalTimer = 0;
  } else if (previous.emergencyStop) {
    next.signalPhase = 'allRed';
    next.pendingAxis = input.activeAxis;
    next.clearanceAxis = null;
    next.signalTimer = ALL_RED_DURATION;
  } else if (next.signalPhase === 'green' && input.activeAxis !== next.activeAxis && next.clearanceAxis === null) {
    next.signalPhase = 'yellow';
    next.pendingAxis = input.activeAxis;
    next.signalTimer = YELLOW_DURATION;
  } else if (next.signalPhase === 'yellow') {
    if (input.activeAxis === next.activeAxis) {
      next.signalPhase = 'green';
      next.pendingAxis = null;
      next.clearanceAxis = null;
      next.signalTimer = 0;
    } else {
      next.pendingAxis = input.activeAxis;
      if (next.signalTimer <= 0) {
        next.signalPhase = 'allRed';
        next.signalTimer = ALL_RED_DURATION;
      }
    }
  } else if (next.signalPhase === 'allRed') {
    next.pendingAxis = input.activeAxis;
  }

  if (input.boost > 0.35) next.boostTimer = Math.min(4.5, next.boostTimer + delta * 1.4);

  const laneDirections: Direction[] = ['northbound', 'southbound', 'eastbound', 'westbound'];
  for (const direction of laneDirections) {
    const laneVehicles = sortForLane(next.vehicles, direction);
    laneVehicles.forEach((vehicle, index) => {
      const previousSpeed = vehicle.speed;
      const stopLineClearanceBeforeMove = distanceToStopLine(vehicle);
      const targetSpeed = desiredSpeed(vehicle, next);
      vehicle.speed += (targetSpeed - vehicle.speed) * Math.min(1, delta * LANE_ACCELERATION[direction] * 0.05);

      const leader = laneVehicles[index - 1];
      if (leader) {
        const minimumCenterGap = Math.max(SAFE_DISTANCE * 0.72, (leader.length + vehicle.length) / 2 + MIN_BUMPER_GAP);
        const gap = Math.abs(leader.position - vehicle.position);
        if (gap < minimumCenterGap) vehicle.speed = Math.min(vehicle.speed, Math.max(0, leader.speed - (minimumCenterGap - gap) * 0.9));
      }

      vehicle.acceleration = (vehicle.speed - previousSpeed) / Math.max(delta, 0.001);
      vehicle.waitingTime =
        vehicle.speed < 7
          ? Math.min(12, vehicle.waitingTime + delta)
          : Math.max(0, vehicle.waitingTime - delta * 2.5);
      updateVehiclePosition(vehicle, delta);

      if (!axisHasGreen(vehicle, next) && !next.emergencyStop && stopLineClearanceBeforeMove >= -2 && distanceToStopLine(vehicle) < 0) {
        clampVehicleToStopLine(vehicle);
        vehicle.speed = 0;
      }

      if (leader) {
        const minimumCenterGap = Math.max(SAFE_DISTANCE * 0.72, (leader.length + vehicle.length) / 2 + MIN_BUMPER_GAP);
        const gap = Math.abs(leader.position - vehicle.position);
        if (gap < minimumCenterGap) {
          const increasing = direction === 'southbound' || direction === 'eastbound';
          vehicle.position = leader.position + (increasing ? -minimumCenterGap : minimumCenterGap);
          vehicle.speed = Math.min(vehicle.speed, leader.speed);
        }
      }
    });
  }

  const beforeCount = next.vehicles.length;
  next.vehicles = next.vehicles.filter((vehicle) => !hasExited(vehicle));
  const cleared = beforeCount - next.vehicles.length;
  if (cleared > 0) {
    const comboMultiplier = 1 + next.streak * 0.08;
    next.score += Math.round(cleared * 12 * comboMultiplier);
    next.streak += cleared;
    next.bestStreak = Math.max(next.bestStreak, next.streak);
    next.carsCleared += cleared;
    next.delightFlash = Math.min(1, next.delightFlash + 0.26);
  }

  const clearanceAxis = next.clearanceAxis;
  if (clearanceAxis !== null && !next.vehicles.some((vehicle) => vehicleNeedsClearance(vehicle, clearanceAxis))) {
    next.clearanceAxis = null;
  }

  if (
    !next.emergencyStop &&
    next.signalPhase === 'allRed' &&
    next.signalTimer <= 0
  ) {
    const clearingAxis = next.activeAxis;
    next.activeAxis = next.pendingAxis ?? input.activeAxis;
    next.pendingAxis = null;
    next.clearanceAxis = next.vehicles.some((vehicle) => vehicleNeedsClearance(vehicle, clearingAxis))
      ? clearingAxis
      : null;
    next.signalPhase = 'green';
  }

  const currentConfig = configForLevel(next.difficultyLevel);
  const backlogNS = computeBacklog(next.vehicles, 'northSouth');
  const backlogEW = computeBacklog(next.vehicles, 'eastWest');
  const forgiveness = next.graceTimer > 0 ? 0.35 : 1;
  const backlogPenalty =
    Math.max(0, backlogNS + backlogEW - currentConfig.congestionGrace) * delta * currentConfig.backlogPenalty * forgiveness;
  const smoothBonus = next.emergencyStop ? -delta * 1.4 : delta * currentConfig.smoothBonus;
  next.congestion = Math.min(
    MAX_CONGESTION,
    Math.max(0, previous.congestion + backlogPenalty - smoothBonus - next.boostTimer * delta * 2.2),
  );

  if (next.activeAxis === 'northSouth' && backlogEW > currentConfig.congestionGrace + 0.8) {
    next.congestion = Math.min(MAX_CONGESTION, next.congestion + delta * currentConfig.laneStarvePenalty * forgiveness);
  }
  if (next.activeAxis === 'eastWest' && backlogNS > currentConfig.congestionGrace + 0.8) {
    next.congestion = Math.min(MAX_CONGESTION, next.congestion + delta * currentConfig.laneStarvePenalty * forgiveness);
  }

  const crossingConflict = next.vehicles.some((vehicleA, index) =>
    next.vehicles.slice(index + 1).some((vehicleB) => {
      if (vehicleA.axis === vehicleB.axis) return false;
      const nearCenterA = Math.abs((vehicleA.direction === 'eastbound' || vehicleA.direction === 'westbound' ? vehicleA.position - CENTER_X : vehicleA.position - CENTER_Y)) < 42;
      const nearCenterB = Math.abs((vehicleB.direction === 'eastbound' || vehicleB.direction === 'westbound' ? vehicleB.position - CENTER_X : vehicleB.position - CENTER_Y)) < 42;
      return nearCenterA && nearCenterB;
    }),
  );

  if (crossingConflict && next.conflictCooldown <= 0) {
    next.congestion = Math.min(MAX_CONGESTION, next.congestion + currentConfig.conflictPenalty);
    next.conflictCooldown = 1.2;
    next.dangerFlash = 1;
    next.streak = 0;
    next.announcement = 'Too close! Pip throws the intersection into a fluster.';
  }

  if (next.spawnTimerNS <= 0) {
    const candidate = createVehicle(next.nextVehicleId, Math.random() > 0.5 ? 'northbound' : 'southbound');
    if (hasSafeSpawnGap(candidate, next.vehicles)) {
      next.vehicles.push(candidate);
      next.nextVehicleId += 1;
      next.spawnTimerNS = spawnIntervalForState(next, 'northSouth');
    } else {
      next.spawnTimerNS = 0.45;
    }
  }
  if (next.spawnTimerEW <= 0) {
    const candidate = createVehicle(next.nextVehicleId, Math.random() > 0.55 ? 'eastbound' : 'westbound');
    if (hasSafeSpawnGap(candidate, next.vehicles)) {
      next.vehicles.push(candidate);
      next.nextVehicleId += 1;
      next.spawnTimerEW = spawnIntervalForState(next, 'eastWest');
    } else {
      next.spawnTimerEW = 0.45;
    }
  }

  if (next.emergencyStop) {
    next.congestion = Math.min(MAX_CONGESTION, next.congestion + delta * 1.2);
    next.streak = 0;
  }

  const nextConfig = DIFFICULTY_STEPS[next.difficultyLevel];
  if (nextConfig && next.score >= currentConfig.goal) {
    next.difficultyTier = nextConfig.tier;
    next.difficultyLevel = nextConfig.level;
    next.levelGoal = nextConfig.goal;
    next.justLeveledUp = true;
    next.delightFlash = 1;
    next.congestion = Math.max(0, next.congestion - 16);
    next.graceTimer = 8;
    next.announcement = `${nextConfig.label} unlocked. Juniper Junction picks up a little speed.`;
  }

  if (next.congestion >= MAX_CONGESTION) {
    next.phase = 'gameOver';
    next.announcement = 'Juniper Junction tangled into a full snarl.';
  } else if (next.justLeveledUp) {
    next.announcement = `${configForLevel(next.difficultyLevel).label} unlocked. Juniper Junction picks up a little speed.`;
  } else if (next.dangerFlash > 0.2) {
    next.announcement = 'That was messy. Steady the rhythm.';
  } else if (next.delightFlash > 0.25) {
    next.announcement = next.boostTimer > 0.6 ? 'Pip catches a perfect rhythm.' : 'Traffic glides like a parade.';
  } else if (next.congestion < 26) {
    next.announcement = next.graceTimer > 0 ? 'Easy does it. Pip has the junction nicely under control.' : 'Juniper Junction is humming beautifully.';
  } else if (next.congestion < 58) {
    next.announcement = 'Busy, but still graceful.';
  }

  return next;
};
