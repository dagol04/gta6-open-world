// Combat and the wanted level. Shooting is hitscan with a spread and a
// tracer; damage applies to pedestrians, cops, rival crew and cars. Crimes
// raise the wanted level; staying out of sight and out of trouble lets it
// fall again. The police response scales with the stars: more cars, foot
// cops from two stars, roadblocks from four, the helicopter at five.

import { WANTED, WEAPONS } from './config.js';
import { clamp, dist } from './random.js';

export function createCombat() {
  return {
    weapon: 'pistol',
    ammo: { pistol: 24, smg: 0 },
    reserve: { pistol: 48, smg: 90 },
    reloading: 0,
    cooldown: 0,
    wanted: 0,
    heat: 0,          // 0..100 inside the current star level
    lastCrime: -100,
    decayTimer: 0,
    time: 0,
  };
}

export function addHeat(combat, amount, now) {
  combat.heat = Math.min(100, combat.heat + amount);
  combat.lastCrime = now;
  combat.decayTimer = 0;
  // 20 heat is one star, 40 two, up to 100 for five stars.
  const stars = combat.heat < 20 ? 0 : Math.min(WANTED.maxStars, Math.floor(combat.heat / 20));
  combat.wanted = Math.max(combat.wanted, stars);
}

export function updateWanted(combat, dt, now, seenByPolice, inSprayShop) {
  combat.time = now;
  if (inSprayShop) {
    combat.wanted = 0;
    combat.heat = 0;
    return;
  }
  if (combat.wanted === 0) {
    combat.heat = Math.max(0, combat.heat - dt * 4);
    return;
  }
  const quiet = now - combat.lastCrime > WANTED.decayDelay && !seenByPolice;
  if (quiet) {
    combat.decayTimer += dt;
    if (combat.decayTimer >= WANTED.decayInterval) {
      combat.decayTimer = 0;
      combat.wanted -= 1;
      combat.heat = Math.max(0, combat.wanted * 20);
    }
  } else {
    combat.decayTimer = 0;
  }
}

/** Fire the current weapon from (x, y) toward an angle. Returns a shot
 * record (or null when on cooldown / reloading / out of ammo). */
export function tryFire(combat, x, y, angle, dt, random) {
  combat.cooldown -= dt;
  if (combat.reloading > 0) {
    combat.reloading -= dt;
    if (combat.reloading <= 0) {
      const def = WEAPONS[combat.weapon];
      const need = def.ammo - combat.ammo[combat.weapon];
      const take = Math.min(need, combat.reserve[combat.weapon]);
      combat.ammo[combat.weapon] += take;
      combat.reserve[combat.weapon] -= take;
    }
    return null;
  }
  if (combat.cooldown > 0) return null;
  const def = WEAPONS[combat.weapon];
  if (combat.weapon === 'fists') {
    combat.cooldown = def.rate;
    return { kind: 'melee', x, y, angle, range: def.range, damage: def.damage };
  }
  if (combat.ammo[combat.weapon] <= 0) {
    if (combat.reserve[combat.weapon] > 0) {
      combat.reloading = def.reload;
    }
    return { kind: 'empty' };
  }
  combat.ammo[combat.weapon] -= 1;
  combat.cooldown = def.rate;
  const spread = (random.next() - 0.5) * 2 * def.spread;
  return {
    kind: 'bullet',
    x, y,
    angle: angle + spread,
    range: def.range,
    damage: def.damage,
  };
}

export function startReload(combat) {
  const def = WEAPONS[combat.weapon];
  if (combat.weapon === 'fists' || combat.reloading > 0) return;
  if (combat.ammo[combat.weapon] >= def.ammo) return;
  if (combat.reserve[combat.weapon] <= 0) return;
  combat.reloading = def.reload;
}

/** Resolve a bullet against the world: the first thing it hits. Returns
 * { hit: 'ped'|'cop'|'rival'|'car'|'wall', target, x, y } or { hit: null }. */
export function traceBullet(shot, city, peds, cops, rivals, cars, playerCar) {
  const endX = shot.x + Math.cos(shot.angle) * shot.range;
  const endY = shot.y + Math.sin(shot.angle) * shot.range;
  let best = { hit: null, t: 1, x: endX, y: endY, target: null };

  function considerPoint(px, py, radius, kind, target) {
    const dx = px - shot.x;
    const dy = py - shot.y;
    const along = dx * Math.cos(shot.angle) + dy * Math.sin(shot.angle);
    if (along <= 0 || along > shot.range) return;
    const across = Math.abs(dx * -Math.sin(shot.angle) + dy * Math.cos(shot.angle));
    if (across > radius) return;
    const t = along / shot.range;
    if (t < best.t) best = { hit: kind, t, x: shot.x + Math.cos(shot.angle) * along, y: shot.y + Math.sin(shot.angle) * along, target };
  }

  for (const ped of peds) if (ped.state !== 'down') considerPoint(ped.x, ped.y, 14, 'ped', ped);
  for (const cop of cops) if (cop.health > 0) considerPoint(cop.x, cop.y, 14, 'cop', cop);
  for (const rival of rivals) if (rival.health > 0) considerPoint(rival.x, rival.y, 14, 'rival', rival);
  for (const car of cars) {
    if (car === playerCar) continue;
    const dx = car.x - shot.x;
    const dy = car.y - shot.y;
    const along = dx * Math.cos(shot.angle) + dy * Math.sin(shot.angle);
    if (along <= 0 || along > shot.range) continue;
    const across = Math.abs(dx * -Math.sin(shot.angle) + dy * Math.cos(shot.angle));
    const half = Math.max(car.def.w, car.def.l) / 2;
    if (across > half * 0.6) continue;
    const t = along / shot.range;
    if (t < best.t) best = { hit: 'car', t, x: shot.x + Math.cos(shot.angle) * along, y: shot.y + Math.sin(shot.angle) * along, target: car };
  }
  // Buildings stop bullets: march along the ray in steps.
  for (let d = 0; d < shot.range; d += 24) {
    const px = shot.x + Math.cos(shot.angle) * d;
    const py = shot.y + Math.sin(shot.angle) * d;
    if (cityBuildingAt(city, px, py)) {
      const t = d / shot.range;
      if (t < best.t) best = { hit: 'wall', t, x: px, y: py, target: null };
      break;
    }
  }
  return best;
}

function cityBuildingAt(city, x, y) {
  for (const b of city.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
  }
  return false;
}

/** How many police cars the wanted level asks for, and which extras. */
export function policeDemand(wanted) {
  return {
    cars: WANTED.copsPerStar[wanted] ?? 0,
    footCops: wanted >= 2 ? wanted - 1 : 0,
    roadblock: wanted >= 4,
    heli: wanted >= 5,
  };
}

export { clamp, dist };
