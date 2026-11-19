// The people of Solmar: pedestrians who walk the sidewalks and run from
// trouble, and the Solmar PD — foot cops and the helicopter — who answer the
// wanted level. Pedestrians are simple state machines: walk, idle, flee.
// Cops chase the player on foot; the helicopter circles overhead and keeps
// the player lit, which stops the wanted level from decaying.

import { ROADS_X, ROADS_Y, WORLD } from './config.js';
import { angleDelta, clamp, dist, wrapAngle } from './random.js';
import { randomSidewalkPoint, resolveBuildings } from './city.js';

const PED_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1', '#fd79a8'];
const PED_SHIRTS = ['#c0392b', '#2471a3', '#b7950b', '#7d3c98', '#148f77', '#ca6f1e', '#d5dbdb', '#af7ac5'];

export function makePedestrian(random, x, y) {
  return {
    x, y,
    angle: random.range(0, Math.PI * 2),
    speed: 0,
    state: 'walk', // walk | idle | flee | down
    target: null,
    wait: random.range(0, 3),
    color: random.pick(PED_SHIRTS),
    skin: random.pick(['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac']),
    panic: 0,
    taxi: random.chance(0.08),
  };
}

export function updatePedestrian(ped, dt, city, danger, random) {
  if (ped.state === 'down') return;
  if (danger && dist(ped.x, ped.y, danger.x, danger.y) < 260) {
    ped.state = 'flee';
    ped.panic = 3;
  }
  if (ped.panic > 0) {
    ped.panic -= dt;
    if (ped.panic <= 0 && ped.state === 'flee') ped.state = 'walk';
  }
  if (ped.state === 'flee' && danger) {
    const away = Math.atan2(ped.y - danger.y, ped.x - danger.x);
    ped.angle = away;
    ped.speed = 250;
  } else if (ped.state === 'walk') {
    if (!ped.target || dist(ped.x, ped.y, ped.target.x, ped.target.y) < 20) {
      if (ped.wait > 0) {
        ped.wait -= dt;
        ped.speed = 0;
        return;
      }
      ped.target = randomSidewalkPoint(random);
      ped.wait = random.range(1, 5);
    }
    const want = Math.atan2(ped.target.y - ped.y, ped.target.x - ped.x);
    ped.angle = wrapAngle(ped.angle + clamp(angleDelta(ped.angle, want), -3 * dt, 3 * dt));
    ped.speed = 55 + Math.sin(ped.x * 0.01 + ped.y * 0.013) * 12;
  } else {
    ped.speed = 0;
  }
  ped.x += Math.cos(ped.angle) * ped.speed * dt;
  ped.y += Math.sin(ped.angle) * ped.speed * dt;
  ped.x = clamp(ped.x, 30, WORLD.width - 30);
  ped.y = clamp(ped.y, 30, WORLD.height - 30);
  resolveBuildings(city, ped, 12);
}

export function makeCop(random, x, y) {
  return {
    x, y,
    angle: random.range(0, Math.PI * 2),
    speed: 0,
    health: 60,
    state: 'chase',
    attackCooldown: 0,
  };
}

export function updateCop(cop, dt, player, city) {
  if (cop.health <= 0) return;
  const d = dist(cop.x, cop.y, player.x, player.y);
  const want = Math.atan2(player.y - cop.y, player.x - cop.x);
  cop.angle = wrapAngle(cop.angle + clamp(angleDelta(cop.angle, want), -4 * dt, 4 * dt));
  if (d > 26) {
    cop.speed = 235;
  } else {
    cop.speed = 0;
    cop.attackCooldown -= dt;
    if (cop.attackCooldown <= 0) {
      cop.attackCooldown = 0.7;
      cop.melee = true;
    }
  }
  cop.x += Math.cos(cop.angle) * cop.speed * dt;
  cop.y += Math.sin(cop.angle) * cop.speed * dt;
  cop.x = clamp(cop.x, 30, WORLD.width - 30);
  cop.y = clamp(cop.y, 30, WORLD.height - 30);
  resolveBuildings(city, cop, 12);
}

export function makeHeli(x, y) {
  return { x, y, angle: 0, radius: 260, height: 1 };
}

export function updateHeli(heli, dt, player) {
  heli.angle += dt * 0.35;
  heli.x = player.x + Math.cos(heli.angle) * heli.radius;
  heli.y = player.y + Math.sin(heli.angle) * heli.radius * 0.7;
}

/** Where to spawn a cop car: on a road a little way from the player. */
export function policeSpawnPoint(random, player) {
  const angle = random.range(0, Math.PI * 2);
  const distance = random.range(420, 620);
  const x = clamp(player.x + Math.cos(angle) * distance, 120, WORLD.width - 120);
  const y = clamp(player.y + Math.sin(angle) * distance, 120, WORLD.height - 120);
  // Snap onto the nearest road so the car does not appear inside a building.
  let bestX = ROADS_X[0];
  for (const rx of ROADS_X) if (Math.abs(rx - x) < Math.abs(bestX - x)) bestX = rx;
  let bestY = ROADS_Y[0];
  for (const ry of ROADS_Y) if (Math.abs(ry - y) < Math.abs(bestY - y)) bestY = ry;
  if (Math.abs(bestX - x) < Math.abs(bestY - y)) return { x: bestX, y };
  return { x, y: bestY };
}

/** A pedestrian near a point, for taxi fares and mission crowds. */
export function nearestPed(peds, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    const d = dist(ped.x, ped.y, x, y);
    if (d < bestD) {
      bestD = d;
      best = ped;
    }
  }
  return best;
}
