// The screenshot scenes behind ?shot=cover|street|mission|night. Each one
// sets the world to a real moment of play — a fixed seed, a fixed place, a
// fixed wanted level and a fixed mission — then drives it forward for a few
// seconds with a scripted autopilot, so the frame is what a short game
// really looks like and the same seed always gives the same frame.
//
// The autopilot works through the same input the player uses: it returns the
// keys to hold this frame, and main.js feeds them to the game. Combat scenes
// refresh their tracer fire every step so the shootout is visible.

import { CARS, GRID, ROADS_X, ROADS_Y } from './config.js';
import { dist, wrapAngle } from './random.js';
import { makeCar } from './cars.js';
import { makePedestrian } from './people.js';
import { startMission } from './missions.js';

const SHOT_SECONDS = { cover: 5, street: 5, mission: 4, night: 5 };

function clearField(world) {
  world.cops = [];
  world.rivals = [];
  world.heli = null;
  world.particles = [];
  world.tracers = [];
  world.pickups = [];
  world.raining = false;
  world.banner = '';
  world.bannerTimer = 0;
  world.hurtFlash = 0;
  world.player.health = 100;
  world.player.armor = 50;
  world.combat.wanted = 0;
  world.combat.heat = 0;
  world.combat.ammo.pistol = 12;
  world.combat.reserve.pistol = 48;
  world.combat.weapon = 'pistol';
  world.taxi = null;
}

function putPlayerInCar(world, defKey, x, y, angle, color) {
  const def = CARS[defKey];
  const car = makeCar(defKey, x, y, angle, color ?? def.colors[0], { driver: 'player' });
  car.speed = 120;
  world.cars.push(car);
  world.playerCar = car;
  world.player.onFoot = false;
  world.player.x = x;
  world.player.y = y;
  world.player.angle = angle;
  return car;
}

function addPoliceChase(world, count) {
  for (let i = 0; i < count; i += 1) {
    const behind = world.player.angle + Math.PI + (i === 0 ? 0.15 : -0.15);
    const x = world.player.x + Math.cos(behind) * (260 + i * 90);
    const y = world.player.y + Math.sin(behind) * (260 + i * 90);
    const car = makeCar('police', x, y, world.player.angle, '#1b2631', { driver: 'police' });
    car.speed = 200;
    car.siren = true;
    world.cars.push(car);
  }
}

function addTrafficNear(world, count, cx, cy) {
  const keys = ['sedan', 'coupe', 'taxi', 'van', 'sedan'];
  for (let i = 0; i < count; i += 1) {
    const roadY = ROADS_Y[(i * 2 + 1) % ROADS_Y.length];
    const x = cx + (i - count / 2) * 260;
    const def = CARS[keys[i % keys.length]];
    const car = makeCar(keys[i % keys.length], x, roadY, i % 2 === 0 ? 0 : Math.PI, def.colors[i % def.colors.length], { driver: 'traffic' });
    car.speed = 150;
    world.cars.push(car);
  }
  void cy;
}

function addPedsNear(world, count, cx, cy) {
  for (let i = 0; i < count; i += 1) {
    const ped = makePedestrian(world.random, cx + (i - count / 2) * 90, cy + ((i % 3) - 1) * 70);
    world.peds.push(ped);
  }
}

function setWanted(world, stars) {
  world.combat.wanted = stars;
  world.combat.heat = stars * 20;
  world.combat.lastCrime = world.time;
}

/** Set the world to the named scene and return how to drive it. */
export function setupShot(name, world, random) {
  clearField(world);
  world.mission.active = false;
  world.mission.targetCar = null;
  world.mission.done = 0;

  if (name === 'street') {
    world.timeOfDay = 12;
    world.player.x = 1300;
    world.player.y = 900;
    world.player.angle = Math.PI / 2;
    world.player.onFoot = true;
    world.playerCar = null;
    startMission(world.mission, 0, world.time);
    addPedsNear(world, 10, 1300, 900);
    addTrafficNear(world, 6, 1300, 900);
    return { seconds: SHOT_SECONDS.street, mode: 'walk', waypoint: { x: 2900, y: 300 } };
  }

  if (name === 'mission') {
    world.timeOfDay = 15.5;
    world.player.x = 2550;
    world.player.y = 700;
    world.player.angle = 0;
    world.player.onFoot = true;
    world.playerCar = null;
    startMission(world.mission, 4, world.time);
    world.mission.step = 1; // the 'clear' step at the docks
    for (let i = 0; i < 6; i += 1) {
      world.rivals.push({
        x: 2700 + random.range(-140, 140),
        y: 700 + random.range(-120, 120),
        angle: random.range(0, Math.PI * 2),
        health: 50,
        skin: '#c68642',
        color: '#8e2f5f',
        shootTimer: random.range(0.4, 1.2),
      });
    }
    setWanted(world, 1);
    addTrafficNear(world, 3, 2700, 700);
    return { seconds: SHOT_SECONDS.mission, mode: 'combat', waypoint: { x: 2700, y: 700 } };
  }

  if (name === 'night') {
    world.timeOfDay = 22;
    putPlayerInCar(world, 'coupe', 1400, 1160, 0, '#ff2e63');
    setWanted(world, 2);
    addPoliceChase(world, 1);
    addTrafficNear(world, 6, 1400, 1160);
    addPedsNear(world, 6, 1400, 1160);
    startMission(world.mission, 1, world.time);
    return { seconds: SHOT_SECONDS.night, mode: 'drive', waypoint: { x: 3100, y: 1160 } };
  }

  // cover (the default): dusk, a chase downtown, three stars.
  world.timeOfDay = 18.2;
  putPlayerInCar(world, 'sports', 1160, 1160, 0, '#ff2e63');
  setWanted(world, 3);
  addPoliceChase(world, 2);
  addTrafficNear(world, 8, 1160, 1160);
  addPedsNear(world, 8, 1160, 1160);
  startMission(world.mission, 1, world.time);
  return { seconds: SHOT_SECONDS.cover, mode: 'drive', waypoint: { x: 3100, y: 1160 } };
}

/** The keys to hold this frame, for the scene's mode. */
export function autopilotKeys(world, scene) {
  const player = world.player;
  const wp = scene.waypoint;
  if (scene.mode === 'walk') {
    const keys = ['ShiftLeft'];
    const dx = wp.x - player.x;
    const dy = wp.y - player.y;
    if (dx > 12) keys.push('KeyD');
    else if (dx < -12) keys.push('KeyA');
    if (dy > 12) keys.push('KeyS');
    else if (dy < -12) keys.push('KeyW');
    return { keys, fire: false };
  }
  if (scene.mode === 'combat') {
    // Walk toward the rivals and face the nearest one.
    const nearest = nearestRival(world);
    if (nearest) {
      player.angle = Math.atan2(nearest.y - player.y, nearest.x - player.x);
    }
    const keys = [];
    const dx = wp.x - player.x;
    const dy = wp.y - player.y;
    if (dist(player.x, player.y, wp.x, wp.y) > 220) {
      if (dx > 12) keys.push('KeyD');
      else if (dx < -12) keys.push('KeyA');
      if (dy > 12) keys.push('KeyS');
      else if (dy < -12) keys.push('KeyW');
      keys.push('ShiftLeft');
    }
    return { keys, fire: !!nearest };
  }
  // drive: follow the road toward the waypoint, one road at a time. The
  // lane is picked once (the road the car starts on) and stuck to, so the
  // car never chases a nearer road across a block and wedges on a corner.
  const dx = wp.x - player.x;
  const dy = wp.y - player.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (scene.laneY === undefined) scene.laneY = nearestRoadY(player.y);
    const tx = player.x + Math.sign(dx) * 400;
    const ty = scene.laneY;
    const want = Math.atan2(ty - player.y, tx - player.x);
    const turn = wrapAngle(want - player.angle);
    const keys = ['KeyW'];
    if (turn < -0.12) keys.push('KeyA');
    else if (turn > 0.12) keys.push('KeyD');
    return { keys, fire: false };
  }
  if (scene.laneX === undefined) scene.laneX = nearestRoadX(player.x);
  const tx = scene.laneX;
  const ty = player.y + Math.sign(dy) * 400;
  const want = Math.atan2(ty - player.y, tx - player.x);
  const turn = wrapAngle(want - player.angle);
  const keys = ['KeyW'];
  if (turn < -0.12) keys.push('KeyA');
  else if (turn > 0.12) keys.push('KeyD');
  return { keys, fire: false };
}

function nearestRoadX(x) {
  let best = ROADS_X[0];
  for (const rx of ROADS_X) if (Math.abs(rx - x) < Math.abs(best - x)) best = rx;
  return best;
}

function nearestRoadY(y) {
  let best = ROADS_Y[0];
  for (const ry of ROADS_Y) if (Math.abs(ry - y) < Math.abs(best - y)) best = ry;
  return best;
}

function nearestRival(world) {
  let best = null;
  let bestD = Infinity;
  for (const rival of world.rivals) {
    if (rival.health <= 0) continue;
    const d = dist(world.player.x, world.player.y, rival.x, rival.y);
    if (d < bestD) {
      bestD = d;
      best = rival;
    }
  }
  return best;
}

/** Refresh the shootout's visible fire: a tracer from the player at the
 * nearest rival, plus a muzzle flash. Called every step in combat scenes. */
export function combatFx(world) {
  const rival = nearestRival(world);
  if (!rival) return;
  const angle = Math.atan2(rival.y - world.player.y, rival.x - world.player.x);
  const mx = world.player.x + Math.cos(angle) * 20;
  const my = world.player.y + Math.sin(angle) * 20;
  world.tracers.push({ x1: mx, y1: my, x2: rival.x, y2: rival.y, life: 0.5, maxLife: 0.5 });
  world.particles.push({
    x: mx, y: my, vx: 0, vy: 0, life: 0.3, maxLife: 0.3, size: 5, color: '#ffd76a',
  });
}
