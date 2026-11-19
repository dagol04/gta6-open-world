// Vehicles: the arcade driving model, the traffic that fills the streets,
// and the police cars that chase the player. A car is a position, a heading
// and a speed; its velocity eases toward its heading, which is what makes
// it feel like driving instead of sliding. Traffic follows the street grid:
// pick a road, drive to the next intersection, turn or go straight.

import { CARS, GRID, ROADS_X, ROADS_Y, WORLD } from './config.js';
import { angleDelta, clamp, dist, wrapAngle } from './random.js';
import { hitsBuilding, randomRoadPoint, resolveBuildings } from './city.js';

export function makeCar(defKey, x, y, angle, color, opts = {}) {
  const def = CARS[defKey];
  return {
    defKey,
    def,
    x, y,
    angle,
    speed: 0,
    color: color ?? def.colors[0],
    health: 100,
    police: defKey === 'police',
    taxi: defKey === 'taxi',
    driver: opts.driver ?? null, // 'player' | 'traffic' | 'police' | null (parked)
    target: null,
    stuck: 0,
    brakeLight: false,
    siren: false,
    id: opts.id ?? Math.random().toString(36).slice(2, 8),
  };
}

/** Arcade driving: throttle, steering and a handbrake, with drift. */
export function driveCar(car, input, dt, city) {
  const def = car.def;
  const throttle = input.y < 0 ? 1 : input.y > 0 ? -0.6 : 0;
  const steering = input.x;
  const reversing = car.speed < -5;
  const speedRatio = clamp(Math.abs(car.speed) / def.top, 0, 1);
  const steerRate = 2.6 * (1 - speedRatio * 0.55) * (input.handbrake ? 1.5 : 1);
  // Screen coordinates: y grows downward, so a positive angle turns
  // clockwise; steering right while moving forward turns clockwise, and
  // reversing flips the steering, as in a real car.
  const speedFactor = clamp(Math.abs(car.speed) / 60, 0, 1);
  car.angle = wrapAngle(car.angle + steering * steerRate * dt * speedFactor * (reversing ? -1 : 1));

  if (throttle !== 0) {
    car.speed += throttle * def.accel * dt;
  } else {
    car.speed -= Math.sign(car.speed) * 260 * dt;
    if (Math.abs(car.speed) < 8) car.speed = 0;
  }
  if (input.handbrake) {
    car.speed -= Math.sign(car.speed) * 520 * dt;
  }
  car.speed = clamp(car.speed, -def.top * 0.45, def.top);
  car.brakeLight = throttle < 0 || input.handbrake;

  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const vx = fx * car.speed;
  const vy = fy * car.speed;
  // Grip eases the velocity toward the heading: low grip (handbrake) drifts.
  const grip = input.handbrake ? 1.6 : def.grip;
  car.vx = (car.vx ?? vx) + (vx - (car.vx ?? vx)) * Math.min(1, grip * dt);
  car.vy = (car.vy ?? vy) + (vy - (car.vy ?? vy)) * Math.min(1, grip * dt);
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.x = clamp(car.x, 40, WORLD.width - 40);
  car.y = clamp(car.y, 40, WORLD.height - 40);
  // Driven cars cannot pass through buildings: push out and scrub speed.
  // The radius is generous (half the car's length) so the nose and tail
  // stay out of the walls too, not just the centre.
  if (city && resolveBuildings(city, car, 34)) car.speed *= 0.55;
  return { sliding: Math.abs(car.speed) > 120 && input.handbrake };
}

/** Traffic: follow the grid. Each car drives along its current road toward
 * a target intersection, then picks a new one. Slow down for the car ahead. */
export function updateTraffic(car, dt, cars, random) {
  if (!car.target) {
    car.target = pickNextIntersection(car, random);
  }
  const tx = car.target.x;
  const ty = car.target.y;
  const dx = tx - car.x;
  const dy = ty - car.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance < 26) {
    car.target = pickNextIntersection(car, random);
    return;
  }
  const want = Math.atan2(dy, dx);
  const turn = clamp(angleDelta(car.angle, want), -1, 1);
  const ahead = carAhead(car, cars);
  const cruise = ahead ? Math.min(150, ahead * 1.2) : 175;
  const speedErr = cruise - car.speed;
  car.speed += clamp(speedErr, -420 * dt, 300 * dt);
  car.speed = clamp(car.speed, 0, 240);
  car.angle = wrapAngle(car.angle + turn * 2.4 * dt * clamp(Math.abs(car.speed) / 50, 0.3, 1));
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  car.x = clamp(car.x, 60, WORLD.width - 60);
  car.y = clamp(car.y, 60, WORLD.height - 60);
  if (cityRef && hitsBuilding(cityRef, car.x, car.y, 20)) {
    // Nudged into a building by a turn: back up and retarget.
    car.speed = -60;
    car.target = pickNextIntersection(car, random);
  }
}

let cityRef = null;
export function setTrafficCity(city) {
  cityRef = city;
}

function pickNextIntersection(car, random) {
  // From the current road, head to a nearby intersection, then turn.
  const onVertical = Math.abs(car.x - nearestOf(car.x, ROADS_X)) < Math.abs(car.y - nearestOf(car.y, ROADS_Y));
  if (onVertical) {
    const rx = nearestOf(car.x, ROADS_X);
    const ys = ROADS_Y.filter((y) => Math.abs(y - car.y) < 700);
    const ty = random.pick(ys.length ? ys : ROADS_Y);
    return { x: rx + (random.chance(0.5) ? 18 : -18), y: ty };
  }
  const ry = nearestOf(car.y, ROADS_Y);
  const xs = ROADS_X.filter((x) => Math.abs(x - car.x) < 700);
  const tx = random.pick(xs.length ? xs : ROADS_X);
  return { x: tx, y: ry + (random.chance(0.5) ? 18 : -18) };
}

function nearestOf(value, list) {
  let best = list[0];
  for (const item of list) if (Math.abs(item - value) < Math.abs(best - value)) best = item;
  return best;
}

function carAhead(car, cars) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  let nearest = Infinity;
  for (const other of cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const along = dx * fx + dy * fy;
    const across = Math.abs(dx * -fy + dy * fx);
    if (along > 0 && along < 130 && across < 34 && along < nearest) nearest = along;
  }
  return nearest === Infinity ? 0 : nearest;
}

/** Circle-vs-car collision for a point body (player, pedestrian). */
export function carHit(cars, x, y, r) {
  for (const car of cars) {
    const dx = x - car.x;
    const dy = y - car.y;
    const cos = Math.cos(-car.angle);
    const sin = Math.sin(-car.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if (Math.abs(lx) < car.def.l / 2 + r && Math.abs(ly) < car.def.w / 2 + r) return car;
  }
  return null;
}

/** Two cars overlapping: push them apart and trade a little speed. */
export function separateCars(cars) {
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      const a = cars[i];
      const b = cars[j];
      const d = dist(a.x, a.y, b.x, b.y);
      const min = (a.def.l + b.def.l) / 2 - 18;
      if (d > 0.01 && d < min) {
        const push = (min - d) / 2;
        const nx = (b.x - a.x) / d;
        const ny = (b.y - a.y) / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        const tmp = a.speed;
        a.speed = b.speed * 0.5;
        b.speed = tmp * 0.5;
        a.health -= 1;
        b.health -= 1;
      }
    }
  }
}

/** Spawn a parked car on a road edge near a point. */
export function spawnParkedCar(random, x, y, defKey) {
  const point = randomRoadPoint(random);
  const def = CARS[defKey];
  const angle = random.chance(0.5) ? 0 : Math.PI / 2;
  return makeCar(defKey, point.x, point.y, angle, random.pick(def.colors), { driver: null });
}
