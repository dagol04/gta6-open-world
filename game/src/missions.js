// Mara Voss's six jobs: the story of Solmar. A mission is a list of steps;
// the game asks this module where to go and what counts as done. Steps are:
//   goto    — reach a point
//   steal   — steal the marked car (then deliver it)
//   deliver — drive the marked car to a point
//   wanted  — hold (or lose) a wanted level until the timer runs out
//   clear   — defeat a number of rivals near a point
// The module only tracks progress; the world (main.js) owns the actors.

import { MISSIONS } from './config.js';
import { dist } from './random.js';

export function createMissionState() {
  return {
    index: 0,          // which mission of MISSIONS is active (-1: story done)
    step: 0,           // which step of the mission
    active: false,
    timer: 0,          // seconds left when the mission has a clock
    startedAt: 0,
    done: 0,           // rivals cleared on a 'clear' step
    targetCar: null,   // the car a steal/deliver step wants
    message: '',
    messageTimer: 0,
    completed: [],     // ids of finished missions
    failed: null,
  };
}

export function currentMission(state) {
  if (state.index < 0 || state.index >= MISSIONS.length) return null;
  return MISSIONS[state.index];
}

export function currentStep(state) {
  const mission = currentMission(state);
  if (!mission) return null;
  return mission.steps[state.step] ?? null;
}

export function startMission(state, index, now) {
  state.index = index;
  state.step = 0;
  state.active = true;
  state.failed = null;
  const mission = MISSIONS[index];
  state.timer = mission.time ?? 0;
  state.startedAt = now;
  state.done = 0;
  state.targetCar = null;
  state.message = mission.briefing;
  state.messageTimer = 6;
}

export function missionObjective(state) {
  const mission = currentMission(state);
  const step = currentStep(state);
  if (!mission || !step) return state.index < 0 ? 'Story complete — Solmar is yours. Free roam!' : 'Go to The Rusty Anchor to start work';
  return step.label;
}

/** The world position the waypoint arrow should point at, if any. */
export function missionWaypoint(state) {
  const step = currentStep(state);
  if (!step || !state.active) return null;
  if (step.type === 'goto' || step.type === 'steal' || step.type === 'deliver' || step.type === 'clear') {
    return { x: step.x, y: step.y };
  }
  return null;
}

/**
 * Advance the mission by one frame. `world` carries the player's position,
 * the car they are in, the rivals alive and the wanted level. Returns an
 * event: null, 'step', 'done' or 'failed'.
 */
export function updateMission(state, world, dt) {
  if (!state.active) return null;
  const mission = currentMission(state);
  const step = currentStep(state);
  if (!mission || !step) return null;
  if (state.messageTimer > 0) state.messageTimer -= dt;
  if (mission.time) {
    state.timer -= dt;
    if (state.timer <= 0 && step.type !== 'wanted') {
      return failMission(state, 'Out of time');
    }
  }

  if (step.type === 'goto') {
    if (dist(world.player.x, world.player.y, step.x, step.y) < step.radius) {
      return advanceStep(state);
    }
  } else if (step.type === 'steal') {
    if (world.playerCar && state.targetCar && world.playerCar === state.targetCar) {
      return advanceStep(state);
    }
  } else if (step.type === 'deliver') {
    if (world.playerCar && state.targetCar && world.playerCar === state.targetCar
      && dist(world.playerCar.x, world.playerCar.y, step.x, step.y) < step.radius) {
      return advanceStep(state);
    }
  } else if (step.type === 'wanted') {
    // Lose the heat: the step completes when the wanted level hits zero,
    // and fails when its own clock runs out.
    if (world.wanted === 0) return advanceStep(state);
    if (state.timer <= 0) return failMission(state, 'The SPD caught up with you');
  } else if (step.type === 'clear') {
    if (state.done >= step.count) return advanceStep(state);
    if (state.timer <= 0 && mission.time) return failMission(state, 'Out of time');
  }
  return null;
}

function advanceStep(state) {
  const mission = currentMission(state);
  state.step += 1;
  state.done = 0;
  if (state.step >= mission.steps.length) {
    state.completed.push(mission.id);
    state.active = false;
    state.index = state.index + 1 >= MISSIONS.length ? -1 : state.index + 1;
    state.step = 0;
    return 'done';
  }
  return 'step';
}

function failMission(state, reason) {
  state.active = false;
  state.failed = reason;
  return 'failed';
}

/** After a failure, the same mission can be retried from its start. */
export function retryMission(state, now) {
  const index = state.index < 0 ? MISSIONS.length - 1 : state.index;
  startMission(state, index, now);
}

/** The next mission's start marker: Mara's bar, until the story is done. */
export function startMarker(state) {
  if (state.index < 0) return null;
  if (state.active) return null;
  return { x: 1080, y: 980, label: 'M' };
}
