// Solmar — boot and the one loop. The world advances in fixed 1/60 s steps
// and the renderer paints what is there. The game moves between screens:
// title, play, paused, help, wasted, busted and mission-complete.
//
// ?seed=N fixes the city and the traffic. ?shot=cover|street|mission|night
// (with &seed=N) stages that scene instead of running the loop, paints it
// twice and sets window.__shotReady for a screenshot.

import { CARS, DISTRICTS, ECONOMY, GRID, MISSIONS, PLACES, PLAYER, STEP, VIEW, WANTED, WEAPONS, WORLD } from './config.js';
import { clamp, createRandom, dist, lerp, wrapAngle } from './random.js';
import { createCity, groundAt, hitsBuilding, randomRoadPoint, randomSidewalkPoint, resolveBuildings } from './city.js';
import { carHit, driveCar, makeCar, separateCars, setTrafficCity, spawnParkedCar, updateTraffic } from './cars.js';
import { makeCop, makeHeli, makePedestrian, nearestPed, policeSpawnPoint, updateCop, updateHeli, updatePedestrian } from './people.js';
import { addHeat, createCombat, policeDemand, startReload, traceBullet, tryFire, updateWanted } from './combat.js';
import { createMissionState, currentMission, currentStep, missionObjective, missionWaypoint, retryMission, startMarker, startMission, updateMission } from './missions.js';
import { createAudio } from './audio.js';
import { createInput, KEY } from './input.js';
import { blankSave, loadSave, writeSave } from './save.js';
import { SCREEN_BUSTED, SCREEN_COMPLETE, SCREEN_HELP, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED, createRenderer } from './render.js';
import { autopilotKeys, combatFx, setupShot } from './shots.js';

const MAX_FRAME = 0.25;
const AUTOSAVE_EVERY = 15;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const random = createRandom(seed);
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();

/** The whole live world, rebuilt from the seed on every visit. */
function createWorld() {
  const city = createCity(random);
  setTrafficCity(city);
  const player = {
    x: 1080, y: 1060, angle: -Math.PI / 2, speed: 0,
    health: PLAYER.health, armor: 0, skin: '#e0ac69', onFoot: true,
  };
  const world = {
    random, city,
    cityDistricts: DISTRICTS,
    player,
    playerCar: null,
    cars: [],
    peds: [],
    cops: [],
    rivals: [],
    heli: null,
    particles: [],
    tracers: [],
    pickups: [],
    combat: createCombat(),
    mission: createMissionState(),
    cash: ECONOMY.startCash,
    time: 0,
    timeOfDay: 10,
    raining: false,
    rainTimer: 40,
    banner: '',
    bannerTimer: 0,
    hurtFlash: 0,
    bustedTimer: 0,
    stats: { carsStolen: 0, arrests: 0, deaths: 0, earned: 0 },
    save: loadSave(),
    taxi: null,
    taxiCooldown: 0,
    sirenTimer: 0,
    autosave: AUTOSAVE_EVERY,
    cameraShake: 0,
    completePay: 0,
    completeText: '',
    lostCash: 0,
    hasSave: false,
    muted: false,
  };
  world.cash = world.save.cash;
  world.mission.completed = world.save.missionsDone.slice();
  world.mission.index = world.save.missionsDone.length >= MISSIONS.length ? -1 : world.save.missionsDone.length;
  world.hasSave = world.save.missionsDone.length > 0 || world.save.cash !== ECONOMY.startCash;
  world.muted = world.save.muted;
  audio.setMuted(world.muted);

  // Traffic: a mix of sedans, coupes, taxis, vans and trucks on the roads.
  const trafficKeys = ['sedan', 'sedan', 'sedan', 'coupe', 'taxi', 'van', 'truck', 'sedan', 'coupe', 'taxi'];
  for (let i = 0; i < 22; i += 1) {
    const point = randomRoadPoint(random);
    const key = trafficKeys[i % trafficKeys.length];
    const def = CARS[key];
    const car = makeCar(key, point.x, point.y, random.chance(0.5) ? 0 : Math.PI / 2, random.pick(def.colors), { driver: 'traffic' });
    car.speed = random.range(100, 190);
    world.cars.push(car);
  }
  // Parked cars near the bar and around town.
  for (let i = 0; i < 10; i += 1) {
    world.cars.push(spawnParkedCar(random, 0, 0, random.pick(['sedan', 'coupe', 'van', 'sedan'])));
  }
  // Pedestrians on the sidewalks.
  for (let i = 0; i < 42; i += 1) {
    const point = randomSidewalkPoint(random);
    world.peds.push(makePedestrian(random, point.x, point.y));
  }
  return world;
}

const world = createWorld();
let screen = SCREEN_TITLE;
let statusTimer = 0;

function setStatus(text) {
  statusEl.textContent = text;
  statusTimer = 3;
}

function showBanner(text, seconds = 6) {
  world.banner = text;
  world.bannerTimer = seconds;
}

function saveGame() {
  world.save.cash = Math.floor(world.cash);
  world.save.missionsDone = world.mission.completed.slice();
  world.save.bestCash = Math.max(world.save.bestCash, Math.floor(world.cash));
  world.save.carsStolen = world.stats.carsStolen;
  world.save.arrests = world.stats.arrests;
  world.save.deaths = world.stats.deaths;
  world.save.muted = world.muted;
  writeSave(world.save);
}

function addCash(amount) {
  world.cash += amount;
  world.stats.earned += amount;
}

function districtNameAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d.name;
  }
  return 'Solmar';
}

function nearestCar(x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of world.cars) {
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

function spawnParticles(x, y, count, color, speed, life, size) {
  for (let i = 0; i < count; i += 1) {
    const angle = random.range(0, Math.PI * 2);
    const v = random.range(speed * 0.3, speed);
    world.particles.push({
      x, y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      life: random.range(life * 0.5, life),
      maxLife: life,
      size: random.range(size * 0.6, size * 1.4),
      color,
    });
  }
}

function explode(x, y, radius = 130) {
  spawnParticles(x, y, 42, '#ff9a3c', 320, 0.7, 7);
  spawnParticles(x, y, 26, '#5a5a5a', 160, 1.1, 9);
  spawnParticles(x, y, 14, '#ffd23e', 420, 0.4, 5);
  audio.explosion();
  world.cameraShake = 14;
  const d = dist(world.player.x, world.player.y, x, y);
  if (d < radius) hurtPlayer(Math.round(45 * (1 - d / radius)) + 10);
  for (const car of world.cars) {
    if (dist(car.x, car.y, x, y) < radius + 40) car.health -= 60;
  }
}

function hurtPlayer(amount) {
  if (world.player.armor > 0) {
    const absorbed = Math.min(world.player.armor, amount);
    world.player.armor -= absorbed;
    amount -= absorbed;
  }
  world.player.health -= amount;
  world.hurtFlash = 1;
  if (world.player.health <= 0) {
    world.player.health = 0;
    die('wasted');
  }
}

function die(kind) {
  world.stats.deaths += 1;
  const fine = Math.min(Math.floor(world.cash * 0.1), 400);
  world.lostCash = fine;
  world.cash -= fine;
  world.player.health = PLAYER.health;
  world.player.armor = 0;
  world.combat.wanted = 0;
  world.combat.heat = 0;
  world.cops = [];
  world.heli = null;
  if (world.playerCar) {
    world.playerCar.driver = null;
    world.playerCar = null;
    world.player.onFoot = true;
  }
  world.player.x = 840;
  world.player.y = 1480;
  world.player.angle = -Math.PI / 2;
  world.mission.active = false;
  screen = kind === 'wasted' ? SCREEN_WASTED : SCREEN_BUSTED;
  audio.fail();
  saveGame();
}

function enterCar(car) {
  if (car.driver === 'traffic') {
    // Yank the driver out: it is a crime, and the driver runs off.
    const driver = makePedestrian(random, car.x + 30, car.y + 30);
    driver.state = 'flee';
    driver.panic = 4;
    world.peds.push(driver);
    addHeat(world.combat, 25, world.time);
    world.stats.carsStolen += 1;
    showBanner('Car stolen — the SPD is on to you.', 3);
  } else if (car.driver === null) {
    addHeat(world.combat, 10, world.time);
    world.stats.carsStolen += 1;
  }
  car.driver = 'player';
  world.playerCar = car;
  world.player.onFoot = false;
  world.player.x = car.x;
  world.player.y = car.y;
  audio.click();
}

function exitCar() {
  const car = world.playerCar;
  if (!car) return;
  car.driver = null;
  car.speed = 0;
  const side = car.angle + Math.PI / 2;
  world.player.x = car.x + Math.cos(side) * 44;
  world.player.y = car.y + Math.sin(side) * 44;
  world.player.angle = car.angle;
  world.player.onFoot = true;
  world.playerCar = null;
  resolveBuildings(world.city, world.player, PLAYER.radius);
}

function fireWeapon() {
  const combat = world.combat;
  const weapon = combat.weapon;
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  const aim = renderer.screenToWorld(world, input.mouse.x * dpr, input.mouse.y * dpr);
  const fromX = world.player.x;
  const fromY = world.player.y;
  const angle = Math.atan2(aim.y - fromY, aim.x - fromX);
  world.player.angle = angle;
  const shot = tryFire(combat, fromX, fromY, angle, STEP, random);
  if (!shot) return;
  if (shot.kind === 'empty') {
    audio.click();
    return;
  }
  if (shot.kind === 'melee') {
    audio.punch();
    const reach = shot.range;
    const hit = (list, isRival) => {
      for (const target of list) {
        if (target.health !== undefined && target.health <= 0) continue;
        if (target.state === 'down') continue;
        const d = dist(fromX, fromY, target.x, target.y);
        if (d < reach + 14) {
          const ang = Math.atan2(target.y - fromY, target.x - fromX);
          if (Math.abs(wrapAngle(ang - angle)) < 1.1) {
            target.health = (target.health ?? 50) - shot.damage;
            spawnParticles(target.x, target.y, 8, '#d8d8d8', 140, 0.4, 4);
            if (target.health <= 0) killTarget(target, isRival);
            return true;
          }
        }
      }
      return false;
    };
    hit(world.peds, false) || hit(world.cops, false) || hit(world.rivals, true);
    return;
  }
  audio.gunshot();
  addHeat(combat, 4, world.time);
  const muzzleX = fromX + Math.cos(angle) * 20;
  const muzzleY = fromY + Math.sin(angle) * 20;
  const result = traceBullet(shot, world.city, world.peds, world.cops, world.rivals, world.cars, world.playerCar);
  world.tracers.push({ x1: muzzleX, y1: muzzleY, x2: result.x, y2: result.y, life: 0.07, maxLife: 0.07 });
  spawnParticles(muzzleX, muzzleY, 3, '#ffd76a', 120, 0.12, 3);
  if (result.hit === 'ped' || result.hit === 'cop' || result.hit === 'rival') {
    const target = result.target;
    target.health -= shot.damage;
    spawnParticles(result.x, result.y, 8, '#c0392b', 150, 0.4, 4);
    if (target.health <= 0) killTarget(target, result.hit === 'rival');
  } else if (result.hit === 'car') {
    const car = result.target;
    car.health -= shot.damage;
    spawnParticles(result.x, result.y, 6, '#ffb347', 130, 0.35, 4);
    if (car.health <= 0) explode(car.x, car.y);
    else addHeat(combat, 3, world.time);
  } else if (result.hit === 'wall') {
    spawnParticles(result.x, result.y, 4, '#c9c9c9', 110, 0.3, 3);
  }
}

function killTarget(target, isRival) {
  if (target.state !== undefined) {
    target.state = 'down';
    target.speed = 0;
  }
  if (isRival) {
    world.mission.done += 1;
    const cash = random.int(40, 120);
    world.pickups.push({ x: target.x, y: target.y, kind: 'cash', value: cash });
    addHeat(world.combat, 15, world.time);
  } else if (target.health !== undefined && world.cops.includes(target)) {
    addHeat(world.combat, 30, world.time);
    world.pickups.push({ x: target.x, y: target.y, kind: 'cash', value: random.int(20, 60) });
  } else {
    addHeat(world.combat, 25, world.time);
    world.pickups.push({ x: target.x, y: target.y, kind: 'cash', value: random.int(10, 40) });
  }
}

function updatePolice(dt) {
  const demand = policeDemand(world.combat.wanted);
  const activeCars = world.cars.filter((c) => c.police && c.driver === 'police');
  // Spawn police cars up to the demand, near the player.
  while (activeCars.length < demand.cars && world.cars.length < 60) {
    const point = policeSpawnPoint(random, world.player);
    const car = makeCar('police', point.x, point.y, Math.atan2(world.player.y - point.y, world.player.x - point.x), '#1b2631', { driver: 'police' });
    car.siren = true;
    world.cars.push(car);
    activeCars.push(car);
  }
  // Remove police cars far away once the heat is gone.
  for (let i = world.cars.length - 1; i >= 0; i -= 1) {
    const car = world.cars[i];
    if (car.police && car.driver === 'police') {
      const d = dist(car.x, car.y, world.player.x, world.player.y);
      if (world.combat.wanted === 0 && d > 900) {
        world.cars.splice(i, 1);
      } else if (d > 1600) {
        world.cars.splice(i, 1);
      }
    }
  }
  // Chase: police cars drive at the player and ram.
  for (const car of world.cars) {
    if (!car.police || car.driver !== 'police') continue;
    const dx = world.player.x - car.x;
    const dy = world.player.y - car.y;
    const want = Math.atan2(dy, dx);
    const turn = clamp(wrapAngle(want - car.angle), -1, 1);
    const d = Math.sqrt(dx * dx + dy * dy);
    const cruise = d > 300 ? 430 : 380;
    car.speed += clamp(cruise - car.speed, -700 * dt, 620 * dt);
    car.angle = wrapAngle(car.angle + turn * 3.1 * dt * clamp(Math.abs(car.speed) / 60, 0.3, 1));
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    // Police cars cannot drive through buildings: slide along the walls.
    if (resolveBuildings(world.city, car, 34)) car.speed *= 0.7;
    if (d < 70) {
      // Ram: damage the player's car or the player.
      if (world.playerCar) {
        world.playerCar.health -= 22 * dt;
        if (world.playerCar.health <= 0) explode(world.playerCar.x, world.playerCar.y);
      } else if (world.player.onFoot) {
        hurtPlayer(26 * dt);
      }
    }
    if (d < 130 && Math.random() < dt * 0.5) addHeat(world.combat, 1, world.time);
  }
  // Foot cops.
  while (world.cops.length < demand.footCops) {
    const point = policeSpawnPoint(random, world.player);
    world.cops.push(makeCop(random, point.x, point.y));
  }
  for (let i = world.cops.length - 1; i >= 0; i -= 1) {
    const cop = world.cops[i];
    if (cop.health <= 0) {
      world.cops.splice(i, 1);
      continue;
    }
    updateCop(cop, dt, world.player, world.city);
    if (cop.melee) {
      cop.melee = false;
      hurtPlayer(9);
    }
    const d = dist(cop.x, cop.y, world.player.x, world.player.y);
    if (world.combat.wanted === 0 && d > 900) world.cops.splice(i, 1);
  }
  // Helicopter at five stars.
  if (demand.heli && !world.heli) world.heli = makeHeli(world.player.x, world.player.y - 260);
  if (!demand.heli) world.heli = null;
  if (world.heli) updateHeli(world.heli, dt, world.player);
  // Sirens, quietly, when the law is near.
  world.sirenTimer -= dt;
  if (world.combat.wanted > 0 && world.sirenTimer <= 0) {
    world.sirenTimer = 2.4;
    audio.sirenBlip();
  }
}

function updateRivals(dt) {
  for (let i = world.rivals.length - 1; i >= 0; i -= 1) {
    const rival = world.rivals[i];
    if (rival.health <= 0) {
      world.rivals.splice(i, 1);
      continue;
    }
    const d = dist(rival.x, rival.y, world.player.x, world.player.y);
    rival.shootTimer = (rival.shootTimer ?? 1) - dt;
    if (d < 520 && rival.shootTimer <= 0) {
      rival.shootTimer = random.range(0.9, 1.6);
      const angle = Math.atan2(world.player.y - rival.y, world.player.x - rival.x) + random.range(-0.14, 0.14);
      const hit = random.chance(0.32);
      world.tracers.push({
        x1: rival.x, y1: rival.y,
        x2: world.player.x + random.range(-30, 30), y2: world.player.y + random.range(-30, 30),
        life: 0.07, maxLife: 0.07,
      });
      audio.gunshot();
      if (hit) hurtPlayer(random.int(6, 11));
      void angle;
    }
    // Rivals hold their ground and strafe a little.
    rival.x += Math.cos(rival.angle) * 12 * dt;
    rival.y += Math.sin(rival.angle) * 12 * dt;
    rival.angle = Math.atan2(world.player.y - rival.y, world.player.x - rival.x);
  }
}

function spawnRivals(x, y, count) {
  for (let i = 0; i < count; i += 1) {
    const rival = {
      x: x + random.range(-160, 160),
      y: y + random.range(-160, 160),
      angle: random.range(0, Math.PI * 2),
      health: 50,
      skin: '#c68642',
      color: '#8e2f5f',
      shootTimer: random.range(0.4, 1.4),
    };
    resolveBuildings(world.city, rival, 12);
    world.rivals.push(rival);
  }
}

function updateTaxi(dt) {
  world.taxiCooldown -= dt;
  if (!world.playerCar || !world.playerCar.taxi) {
    if (world.taxi) {
      world.taxi = null;
    }
    return;
  }
  if (!world.taxi && world.taxiCooldown <= 0) {
    const ped = nearestPed(world.peds, world.player.x, world.player.y, 500);
    if (ped && ped.taxi) {
      const dest = randomRoadPoint(random);
      world.taxi = { ped, dest, state: 'pickup' };
      showBanner('Taxi fare: pick up the passenger.', 3);
    }
  }
  const fare = world.taxi;
  if (!fare) return;
  if (fare.state === 'pickup') {
    const d = dist(world.player.x, world.player.y, fare.ped.x, fare.ped.y);
    if (d < 70) {
      fare.state = 'drive';
      fare.ped.state = 'down'; // in the cab now
      showBanner('Passenger aboard — drive to the marker.', 3);
    }
  } else if (fare.state === 'drive') {
    if (dist(world.player.x, world.player.y, fare.dest.x, fare.dest.y) < 70) {
      addCash(ECONOMY.taxiFare);
      audio.cash();
      showBanner(`Fare complete: +$${ECONOMY.taxiFare}.`, 3);
      const index = world.peds.indexOf(fare.ped);
      if (index >= 0) world.peds.splice(index, 1);
      world.taxi = null;
      world.taxiCooldown = 8;
    }
  }
}

function updateShops() {
  const p = world.player;
  const near = (place) => dist(p.x, p.y, place.x, place.y) < 70;
  world.nearShop = null;
  if (near(PLACES.gunShop)) world.nearShop = 'guns';
  else if (near(PLACES.clinic)) world.nearShop = 'clinic';
  else if (near(PLACES.spray) && world.playerCar) world.nearShop = 'spray';
  if (world.nearShop === 'spray' && world.combat.wanted > 0 && world.cash >= WANTED.sprayCost) {
    world.cash -= WANTED.sprayCost;
    world.combat.wanted = 0;
    world.combat.heat = 0;
    audio.cash();
    showBanner(`Resprayed at Spray & Go — $${WANTED.sprayCost}. The law lost you.`, 4);
  }
}

function buyFromShop() {
  if (world.nearShop === 'guns') {
    const combat = world.combat;
    if (combat.weapon === 'pistol' && combat.ammo.pistol < WEAPONS.pistol.ammo) {
      if (world.cash < 40) return showBanner('Not enough cash for ammo.', 2);
      world.cash -= 40;
      combat.reserve.pistol += 12;
      audio.cash();
      showBanner('Bought 12 pistol rounds — $40.', 2);
    } else if (combat.weapon === 'fists' || combat.weapon === 'pistol') {
      if (world.cash < WEAPONS.smg.price) return showBanner(`The VK-9 SMG costs $${WEAPONS.smg.price}.`, 2);
      world.cash -= WEAPONS.smg.price;
      combat.weapon = 'smg';
      combat.ammo.smg = WEAPONS.smg.ammo;
      audio.cash();
      showBanner('Bought the VK-9 SMG.', 3);
    } else if (world.cash >= 60) {
      world.cash -= 60;
      combat.reserve.smg += 30;
      audio.cash();
      showBanner('Bought 30 SMG rounds — $60.', 2);
    }
  } else if (world.nearShop === 'clinic') {
    if (world.player.health >= PLAYER.health) return showBanner('You are already patched up.', 2);
    if (world.cash < ECONOMY.clinicCost) return showBanner(`The clinic costs $${ECONOMY.clinicCost}.`, 2);
    world.cash -= ECONOMY.clinicCost;
    world.player.health = PLAYER.health;
    audio.pickup();
    showBanner("Doc's Clinic patched you up.", 3);
  }
}

function updatePickups(dt) {
  for (let i = world.pickups.length - 1; i >= 0; i -= 1) {
    const pk = world.pickups[i];
    if (dist(world.player.x, world.player.y, pk.x, pk.y) < 34) {
      if (pk.kind === 'cash') {
        addCash(pk.value);
        audio.cash();
      } else if (pk.kind === 'health') {
        world.player.health = Math.min(PLAYER.health, world.player.health + 40);
        audio.pickup();
      } else if (pk.kind === 'armor') {
        world.player.armor = Math.min(PLAYER.armor, world.player.armor + 50);
        audio.pickup();
      }
      world.pickups.splice(i, 1);
    }
  }
  // A health pickup wanders in near the clinic now and then.
  if (world.pickups.filter((p) => p.kind === 'health').length < 2 && random.chance(dt * 0.02)) {
    const point = randomSidewalkPoint(random);
    world.pickups.push({ x: point.x, y: point.y, kind: 'health', value: 0 });
  }
}

function tickMission(dt) {
  const mission = world.mission;
  const step = currentStep(mission);
  if (!mission.active) return;
  if (step && step.type === 'steal' && !mission.targetCar) {
    const car = nearestCar(step.x, step.y, 160);
    if (car) {
      mission.targetCar = car;
    } else {
      const def = CARS[step.car || 'sports'];
      const target = makeCar(step.car || 'sports', step.x, step.y, random.range(0, Math.PI * 2), random.pick(def.colors), { driver: null });
      world.cars.push(target);
      mission.targetCar = target;
    }
  }
  if (step && step.type === 'clear' && world.rivals.length === 0 && mission.done < step.count) {
    spawnRivals(step.x, step.y, step.count - mission.done);
  }
  const event = updateMission(mission, {
    player: world.player,
    playerCar: world.playerCar,
    wanted: world.combat.wanted,
  }, dt);
  if (event === 'step') {
    audio.pickup();
    const next = currentStep(mission);
    showBanner(next ? next.label : 'Objective complete.', 5);
  } else if (event === 'done') {
    // The mission that just finished is the last one pushed to completed.
    const done = MISSIONS[mission.completed.length - 1];
    const pay = done ? done.pay : 0;
    addCash(pay);
    audio.missionDone();
    world.completePay = pay;
    world.completeText = done ? `"${done.title}" paid out. Mara is pleased.` : 'Story complete. Solmar is yours.';
    screen = SCREEN_COMPLETE;
    saveGame();
  } else if (event === 'failed') {
    audio.fail();
    showBanner(`Mission failed: ${mission.failed}. Go back to The Rusty Anchor to retry.`, 5);
    mission.failed = null;
    saveGame();
  }
}

function updateWorld(dt) {
  world.time += dt;
  // The clock advances slowly: a full day takes 48 real minutes. Shots set
  // the hour directly, so it advances from wherever it stands.
  world.timeOfDay = (world.timeOfDay + dt / 120) % 24;
  // Weather: rain comes and goes.
  world.rainTimer -= dt;
  if (world.rainTimer <= 0) {
    world.raining = !world.raining;
    world.rainTimer = world.raining ? random.range(18, 35) : random.range(45, 90);
  }
  if (world.bannerTimer > 0) world.bannerTimer -= dt;
  if (world.hurtFlash > 0) world.hurtFlash -= dt * 2.2;
  if (world.cameraShake > 0) world.cameraShake -= dt * 30;
  if (statusTimer > 0) {
    statusTimer -= dt;
    if (statusTimer <= 0) statusEl.textContent = '';
  }

  const move = input.moveVector();
  const player = world.player;

  if (world.playerCar) {
    const car = world.playerCar;
    const result = driveCar(car, { x: move.x, y: move.y, handbrake: input.handbrake() }, dt, world.city);
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    player.speed = Math.abs(car.speed);
    audio.engine(true, Math.abs(car.speed) / car.def.top);
    if (result.sliding && random.chance(dt * 20)) {
      world.particles.push({
        x: car.x - Math.cos(car.angle) * 30, y: car.y - Math.sin(car.angle) * 30,
        vx: 0, vy: 0, life: 2.5, maxLife: 2.5, size: 5, color: 'rgba(200,200,200,0.5)',
      });
    }
    if (input.justPressed(KEY.ENTER)) exitCar();
    // Aim from the car too: shooting out the window is allowed.
    if (input.justClicked() || (input.firing() && world.combat.weapon === 'smg')) fireWeapon();
  } else {
    audio.engine(false, 0);
    const speed = input.sprint() ? PLAYER.runSpeed : PLAYER.walkSpeed;
    let mx = move.x;
    let my = move.y;
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 0) {
      mx /= len;
      my /= len;
      player.angle = Math.atan2(my, mx);
      player.speed = speed;
    } else {
      player.speed = 0;
    }
    player.x += mx * speed * dt;
    player.y += my * speed * dt;
    player.x = clamp(player.x, 30, WORLD.width - 30);
    player.y = clamp(player.y, 30, WORLD.height - 30);
    resolveBuildings(world.city, player, PLAYER.radius);
    // Hit by traffic. A car can only hurt the player once a second: without
    // a cooldown the same car would register a hit every frame and the
    // player would die in a fraction of a second from one touch.
    const hitCar = carHit(world.cars, player.x, player.y, PLAYER.radius);
    if (hitCar && Math.abs(hitCar.speed) > 60 && world.time - (hitCar.hitPlayerAt ?? -99) > 1) {
      hitCar.hitPlayerAt = world.time;
      hurtPlayer(18);
      player.x += Math.cos(hitCar.angle) * 30;
      player.y += Math.sin(hitCar.angle) * 30;
      addHeat(world.combat, 5, world.time);
    }
    if (input.justPressed(KEY.ENTER)) {
      // A generous reach: a traffic car nudging the player a step should
      // not make the car beside them unreachable.
      const car = nearestCar(player.x, player.y, 90);
      if (car) enterCar(car);
      else if (world.nearShop === 'guns' || world.nearShop === 'clinic') buyFromShop();
      else if (!world.mission.active && world.mission.index >= 0 && dist(player.x, player.y, PLACES.anchorBar.x, PLACES.anchorBar.y) < 80) {
        startMission(world.mission, world.mission.index, world.time);
        audio.missionDone();
        showBanner(MISSIONS[world.mission.index].briefing, 7);
      }
    }
    if (input.justPressed(KEY.MELEE)) {
      const previous = world.combat.weapon;
      world.combat.weapon = 'fists';
      fireWeapon();
      world.combat.weapon = previous;
    }
    if (input.justClicked() || (input.firing() && world.combat.weapon === 'smg')) fireWeapon();
  }

  if (input.justPressed(KEY.RELOAD)) startReload(world.combat);
  if (input.justPressed(KEY.MUTE)) {
    world.muted = !world.muted;
    audio.setMuted(world.muted);
    showBanner(world.muted ? 'Sound off.' : 'Sound on.', 2);
  }
  if (input.justPressed(KEY.RADIO)) {
    showBanner(`Radio: ${audio.nextStation()}`, 2);
  }
  if (input.justPressed(['Digit1'])) world.combat.weapon = 'fists';
  if (input.justPressed(['Digit2'])) world.combat.weapon = 'pistol';
  if (input.justPressed(['Digit3']) && world.combat.ammo.smg + world.combat.reserve.smg > 0) world.combat.weapon = 'smg';

  // Traffic, pedestrians, police, rivals.
  for (const car of world.cars) {
    if (car.driver === 'traffic') updateTraffic(car, dt, world.cars, random);
  }
  separateCars(world.cars);
  for (let i = world.cars.length - 1; i >= 0; i -= 1) {
    const car = world.cars[i];
    if (car.health <= 0 && car.driver !== 'player') {
      explode(car.x, car.y);
      world.cars.splice(i, 1);
    } else if (car.health <= 0 && car.driver === 'player') {
      explode(car.x, car.y);
      world.cars.splice(i, 1);
      world.playerCar = null;
      world.player.onFoot = true;
    }
  }
  const danger = world.combat.wanted > 0 ? { x: player.x, y: player.y } : null;
  for (const ped of world.peds) updatePedestrian(ped, dt, world.city, danger, random);
  // Keep the streets populated.
  if (world.peds.length < 38) {
    const point = randomSidewalkPoint(random);
    world.peds.push(makePedestrian(random, point.x, point.y));
  }
  if (world.cars.filter((c) => c.driver === 'traffic').length < 18) {
    const point = randomRoadPoint(random);
    const key = random.pick(['sedan', 'coupe', 'taxi', 'van']);
    const def = CARS[key];
    const car = makeCar(key, point.x, point.y, random.chance(0.5) ? 0 : Math.PI / 2, random.pick(def.colors), { driver: 'traffic' });
    car.speed = random.range(100, 180);
    world.cars.push(car);
  }
  // Police and wanted.
  const seenByPolice = world.cops.some((cop) => dist(cop.x, cop.y, player.x, player.y) < 420)
    || world.cars.some((c) => c.police && c.driver === 'police' && dist(c.x, c.y, player.x, player.y) < 520);
  updateWanted(world.combat, dt, world.time, seenByPolice, false);
  updatePolice(dt);
  updateRivals(dt);
  updateTaxi(dt);
  updateShops();
  updatePickups(dt);
  tickMission(dt);

  // Busted: a foot cop catches the player standing still.
  if (world.combat.wanted > 0 && player.onFoot) {
    const copNear = world.cops.some((cop) => dist(cop.x, cop.y, player.x, player.y) < 26 && player.speed < 40);
    if (copNear) {
      world.bustedTimer += dt;
      if (world.bustedTimer > 1.2) {
        world.bustedTimer = 0;
        world.stats.arrests += 1;
        die('busted');
      }
    } else {
      world.bustedTimer = 0;
    }
  }

  // Particles and tracers.
  for (let i = world.particles.length - 1; i >= 0; i -= 1) {
    const pt = world.particles[i];
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.96;
    pt.vy *= 0.96;
    if (pt.life <= 0) world.particles.splice(i, 1);
  }
  for (let i = world.tracers.length - 1; i >= 0; i -= 1) {
    world.tracers[i].life -= dt;
    if (world.tracers[i].life <= 0) world.tracers.splice(i, 1);
  }

  // Autosave.
  world.autosave -= dt;
  if (world.autosave <= 0) {
    world.autosave = AUTOSAVE_EVERY;
    saveGame();
  }
}

/** The view the renderer reads: live numbers, already formatted. */
function viewWorld() {
  const combat = world.combat;
  const mission = world.mission;
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  const mouseCanvas = { x: input.mouse.x * dpr, y: input.mouse.y * dpr };
  const weaponDef = WEAPONS[combat.weapon];
  const ammoText = combat.weapon === 'fists'
    ? '—'
    : combat.reloading > 0
      ? 'RELOADING…'
      : `${combat.ammo[combat.weapon]} / ${combat.reserve[combat.weapon]}`;
  const missionStep = currentStep(mission);
  const objective = mission.active && missionStep
    ? missionStep.label
    : mission.index < 0
      ? 'Story complete — free roam'
      : 'Go to The Rusty Anchor (M) for work';
  const wp = missionWaypoint(mission);
  const marker = startMarker(mission);
  const hours = Math.floor(world.timeOfDay);
  const minutes = Math.floor((world.timeOfDay - hours) * 60);
  const clockText = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const speedText = world.playerCar ? `${Math.round(Math.abs(world.playerCar.speed) * 0.36)} km/h` : '';
  return {
    ...world,
    cityDistricts: DISTRICTS,
    wanted: combat.wanted,
    weaponName: weaponDef.name,
    ammoText,
    objective,
    missionWaypoint: wp,
    startMarker: marker,
    timerText: mission.active && mission.timer > 0 ? formatTimer(mission.timer) : '',
    timerTextUrgent: mission.active && mission.timer > 0 && mission.timer < 30,
    speedText,
    clockText,
    radioText: world.playerCar ? audio.stationName() : districtNameAt(world.player.x, world.player.y),
    districtName: districtNameAt(world.player.x, world.player.y),
    banner: world.banner,
    bannerTimer: world.bannerTimer,
    showCrosshair: screen === SCREEN_PLAY && combat.weapon !== 'fists',
    mouse: mouseCanvas,
    hurtFlash: world.hurtFlash,
    hasSave: world.hasSave,
    completePay: world.completePay,
    completeText: world.completeText,
    lostCash: world.lostCash,
  };
}

function formatTimer(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function runShot(name) {
  const scene = setupShot(name, world, random);
  const steps = Math.floor(scene.seconds / STEP);
  let i = 0;
  function stepFrame() {
    if (i < steps) {
      const drive = autopilotKeys(world, scene);
      input.script(drive.keys);
      if (scene.mode === 'combat') combatFx(world);
      // Staged shots must not end in a death: the player and their car stay
      // healthy so the chase and the shootout are still happening in frame.
      world.player.health = 100;
      if (world.playerCar) world.playerCar.health = 100;
      updateWorld(STEP);
      i += 1;
      requestAnimationFrame(stepFrame);
    } else {
      input.script([]);
      let painted = 0;
      function paint() {
        renderer.draw(viewWorld(), SCREEN_PLAY);
        painted += 1;
        if (painted < 2) requestAnimationFrame(paint);
        else window.__shotReady = true;
      }
      requestAnimationFrame(paint);
    }
  }
  requestAnimationFrame(stepFrame);
}

function runGame() {
  let last = performance.now();
  let accumulator = 0;
  audio.startMusic();

  function frame(now) {
    requestAnimationFrame(frame);
    let elapsed = (now - last) / 1000;
    last = now;
    if (elapsed > MAX_FRAME) elapsed = MAX_FRAME;

    if (screen === SCREEN_TITLE) {
      world.time += elapsed;
      if (input.justPressed(KEY.CONFIRM)) {
        audio.unlock();
        audio.startMusic();
        screen = SCREEN_PLAY;
        if (!world.mission.active && world.mission.index >= 0) {
          showBanner('Mara Voss has work at The Rusty Anchor — follow the yellow M.', 6);
        }
        setStatus('Solmar — WASD to move, E to enter a car, mouse to aim.');
      }
      if (input.justPressed(['KeyH'])) screen = SCREEN_HELP;
    } else if (screen === SCREEN_PLAY) {
      if (input.justPressed(KEY.PAUSE)) {
        screen = SCREEN_PAUSED;
      } else {
        accumulator += elapsed;
        let steps = 0;
        while (accumulator >= STEP && steps < 5) {
          updateWorld(STEP);
          accumulator -= STEP;
          steps += 1;
        }
        if (steps === 5) accumulator = 0;
      }
    } else if (screen === SCREEN_PAUSED) {
      if (input.justPressed(KEY.CONFIRM) || input.justPressed(KEY.PAUSE)) screen = SCREEN_PLAY;
      else if (input.justPressed(['KeyH'])) screen = SCREEN_HELP;
      else if (input.justPressed(['KeyR'])) {
        location.reload();
      }
    } else if (screen === SCREEN_HELP) {
      if (input.justPressed(KEY.CONFIRM) || input.justPressed(['KeyH'])) screen = SCREEN_PLAY;
    } else if (screen === SCREEN_WASTED || screen === SCREEN_BUSTED) {
      if (input.justPressed(KEY.CONFIRM)) screen = SCREEN_PLAY;
    } else if (screen === SCREEN_COMPLETE) {
      if (input.justPressed(KEY.CONFIRM)) screen = SCREEN_PLAY;
    }

    renderer.draw(viewWorld(), screen);
    input.endFrame();
  }
  requestAnimationFrame(frame);
}

// A handle for tests and screenshots: the live state, read-only-ish.
window.__game = {
  get screen() {
    return screen;
  },
  get world() {
    return world;
  },
  get wanted() {
    return world.combat.wanted;
  },
  get cash() {
    return Math.floor(world.cash);
  },
  get mission() {
    return world.mission.index;
  },
  teleport(x, y) {
    world.player.x = x;
    world.player.y = y;
    if (world.playerCar) {
      world.playerCar.x = x;
      world.playerCar.y = y;
    }
  },
  start() {
    if (screen === SCREEN_TITLE) screen = SCREEN_PLAY;
  },
  debug() {
    const step = currentStep(world.mission);
    return {
      px: Math.round(world.player.x),
      py: Math.round(world.player.y),
      wanted: world.combat.wanted,
      health: Math.round(world.player.health),
      cash: Math.floor(world.cash),
      screen,
      missionIndex: world.mission.index,
      missionStep: world.mission.step,
      waypoint: step ? { x: step.x, y: step.y } : null,
      inCar: !!world.playerCar,
    };
  },
};

if (shot) {
  runShot(shot);
} else {
  runGame();
}

export { world, screen };
