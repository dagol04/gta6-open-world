// Solmar itself: the street grid, the blocks, the buildings, the props and
// the places that matter. One seed builds one city; the buildings are plain
// rectangles with a height, a roof colour and a district, and the collision
// test is a circle against those rectangles. Roads are free space.

import { DISTRICTS, GRID, PALETTE, ROADS_X, ROADS_Y, WATER, WORLD } from './config.js';

export function createCity(random) {
  const buildings = [];
  const trees = [];
  const lamps = [];
  const hydrants = [];
  const benches = [];

  // A block is the land between four streets. Fill most of it with one or
  // two buildings, the rest with a yard, a car park or a little park.
  for (let ix = 0; ix < ROADS_X.length - 1; ix += 1) {
    for (let iy = 0; iy < ROADS_Y.length - 1; iy += 1) {
      const x0 = ROADS_X[ix] + GRID.walkHalf;
      const y0 = ROADS_Y[iy] + GRID.walkHalf;
      const x1 = ROADS_X[ix + 1] - GRID.walkHalf;
      const y1 = ROADS_Y[iy + 1] - GRID.walkHalf;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const district = districtAt(cx, cy);
      if (cy > WATER.y - 120) {
        // The marina strip: sand and palms, no buildings.
        for (let t = 0; t < 5; t += 1) {
          trees.push({ x: random.range(x0 + 20, x1 - 20), y: random.range(y0 + 20, y1 - 20), r: random.range(9, 14) });
        }
        continue;
      }
      if (random.chance(0.16)) {
        // A park: trees, benches and a path, no building.
        for (let t = 0; t < 7; t += 1) {
          trees.push({ x: random.range(x0 + 16, x1 - 16), y: random.range(y0 + 16, y1 - 16), r: random.range(8, 13) });
        }
        benches.push({ x: cx - 30, y: cy, angle: 0 });
        benches.push({ x: cx + 30, y: cy, angle: Math.PI });
        continue;
      }
      const tall = district.name === 'Downtown';
      const split = random.chance(0.45);
      if (split) {
        const vertical = random.chance(0.5);
        if (vertical) {
          const cut = random.range(0.38, 0.62);
          buildings.push(makeBuilding(random, district, x0, y0, x0 + (x1 - x0) * cut - 8, y1, tall));
          buildings.push(makeBuilding(random, district, x0 + (x1 - x0) * cut + 8, y0, x1, y1, tall));
        } else {
          const cut = random.range(0.38, 0.62);
          buildings.push(makeBuilding(random, district, x0, y0, x1, y0 + (y1 - y0) * cut - 8, tall));
          buildings.push(makeBuilding(random, district, x0, y0 + (y1 - y0) * cut + 8, x1, y1, tall));
        }
      } else {
        buildings.push(makeBuilding(random, district, x0 + 6, y0 + 6, x1 - 6, y1 - 6, tall));
      }
      if (random.chance(0.5)) {
        trees.push({ x: random.range(x0 + 14, x1 - 14), y: random.range(y0 + 14, y1 - 14), r: random.range(8, 12) });
      }
      if (random.chance(0.3)) {
        hydrants.push({ x: x0 + 12, y: y0 + 12 });
      }
    }
  }

  // Street lamps along every road, alternating sides.
  for (const x of ROADS_X) {
    for (const y of ROADS_Y) {
      lamps.push({ x: x + GRID.roadHalf + 8, y: y - GRID.roadHalf - 8 });
      lamps.push({ x: x - GRID.roadHalf - 8, y: y + GRID.roadHalf + 8 });
    }
  }

  return {
    buildings, trees, lamps, hydrants, benches,
    // A point is on a road when it is close to a vertical or horizontal street.
    onRoad(x, y) {
      for (const rx of ROADS_X) if (Math.abs(x - rx) <= GRID.roadHalf) return true;
      for (const ry of ROADS_Y) if (Math.abs(y - ry) <= GRID.roadHalf) return true;
      return false;
    },
    // The nearest road centre line, for snapping traffic onto streets.
    nearestRoadX(x) {
      let best = ROADS_X[0];
      for (const rx of ROADS_X) if (Math.abs(rx - x) < Math.abs(best - x)) best = rx;
      return best;
    },
    nearestRoadY(y) {
      let best = ROADS_Y[0];
      for (const ry of ROADS_Y) if (Math.abs(ry - y) < Math.abs(best - y)) best = ry;
      return best;
    },
  };
}

function districtAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d;
  }
  return DISTRICTS[0];
}

function makeBuilding(random, district, x0, y0, x1, y1, tall) {
  const w = x1 - x0;
  const h = y1 - y0;
  const floors = tall ? random.int(6, 14) : random.int(1, 4);
  return {
    x: x0, y: y0, w, h,
    roof: random.pick(district.roof),
    floors,
    windows: random.chance(0.8),
    neon: district.name === 'Neon Strip' && random.chance(0.6),
    neonColor: random.pick(['#ff2e88', '#00e5ff', '#ffe600', '#7cff00']),
    name: district.name,
  };
}

/** True when the circle (x, y, r) overlaps any building. */
export function hitsBuilding(city, x, y, r) {
  for (const b of city.buildings) {
    const cx = Math.max(b.x, Math.min(x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(y, b.y + b.h));
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < r * r) return b;
  }
  return null;
}

/** Push a circle out of every building it overlaps; returns true if pushed. */
export function resolveBuildings(city, body, r) {
  let pushed = false;
  for (const b of city.buildings) {
    const cx = Math.max(b.x, Math.min(body.x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(body.y, b.y + b.h));
    let dx = body.x - cx;
    let dy = body.y - cy;
    let d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    pushed = true;
    if (d2 < 0.0001) {
      // Centre inside the building: push out along the smallest penetration.
      const left = body.x - b.x;
      const right = b.x + b.w - body.x;
      const top = body.y - b.y;
      const bottom = b.y + b.h - body.y;
      const min = Math.min(left, right, top, bottom);
      if (min === left) body.x = b.x - r;
      else if (min === right) body.x = b.x + b.w + r;
      else if (min === top) body.y = b.y - r;
      else body.y = b.y + b.h + r;
      continue;
    }
    const d = Math.sqrt(d2);
    dx /= d;
    dy /= d;
    body.x = cx + dx * r;
    body.y = cy + dy * r;
  }
  return pushed;
}

/** A random point on a road, for spawning traffic and pedestrians. */
export function randomRoadPoint(random) {
  if (random.chance(0.5)) {
    return { x: random.pick(ROADS_X) + random.range(-24, 24), y: random.range(120, WORLD.height - 160) };
  }
  return { x: random.range(120, WORLD.width - 120), y: random.pick(ROADS_Y) + random.range(-24, 24) };
}

/** A random point on a sidewalk, for pedestrians. */
export function randomSidewalkPoint(random) {
  const vertical = random.chance(0.5);
  if (vertical) {
    const rx = random.pick(ROADS_X);
    const side = random.chance(0.5) ? GRID.roadHalf + 10 : -GRID.roadHalf - 10;
    return { x: rx + side, y: random.range(120, WORLD.height - 160) };
  }
  const ry = random.pick(ROADS_Y);
  const side = random.chance(0.5) ? GRID.roadHalf + 10 : -GRID.roadHalf - 10;
  return { x: random.range(120, WORLD.width - 120), y: ry + side };
}

/** The palette of the ground under a point (grass, sand, sea or block). */
export function groundAt(x, y) {
  if (y > WATER.y + 40) return 'sea';
  if (y > WATER.y - 60) return 'sand';
  const district = districtAt(x, y);
  return district.ground;
}

export { PALETTE };
