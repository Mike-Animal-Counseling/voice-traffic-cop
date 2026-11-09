import type { Axis, GameState } from './types';

export type SignalAspect = 'red' | 'amber' | 'green';

export function signalAspect(game: GameState, axis: Axis): SignalAspect {
  if (game.emergencyStop || game.clearanceAxis !== null || game.signalPhase === 'allRed' || game.activeAxis !== axis) {
    return 'red';
  }
  return game.signalPhase === 'yellow' ? 'amber' : 'green';
}
