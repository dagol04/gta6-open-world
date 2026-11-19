// Everything the player sees: the city, the cars, the people, the HUD with
// its minimap, and the menus. One canvas, drawn in world space through a
// camera that follows the player, then the HUD in screen space. The renderer
// reads the world object main.js builds and never mutates it.

import { FONT, FONT_DISPLAY, GRID, PALETTE, ROADS_X, ROADS_Y, VIEW, WATER, WORLD } from './config.js';
import { clamp, dist, lerp } from './random.js';
import { groundAt } from './city.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_WASTED = 'wasted';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_COMPLETE = 'complete';
export const SCREEN_HELP = 'help';

const MINIMAP = { x: 0, y: 0, w: 208, h: 156 };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  /** Daylight: 0 at midnight, 1 at noon; and the sky colour to match. */
  function daylight(timeOfDay) {
    const t = timeOfDay / 24;
    const sun = Math.sin((t - 0.25) * Math.PI * 2);
    // Dusk and night stay readable: the city never drops below 30% light.
    return { level: clamp(sun * 0.5 + 0.62, 0.3, 1), sun };
  }

  function cameraFor(world) {
    const w = canvas.width;
    const h = canvas.height;
    // The camera zooms in close — GTA-style, the player and the cars are big
    // on screen and the city scrolls past. The minimap still shows the whole
    // city, so nothing is lost by the tighter view.
    const zoom = world.playerCar ? 1.25 : 1.6;
    const scale = Math.min(w / VIEW.width, h / VIEW.height) * zoom;
    const viewW = w / scale;
    const viewH = h / scale;
    const cx = clamp(world.player.x - viewW / 2, 0, Math.max(0, WORLD.width - viewW));
    const cy = clamp(world.player.y - viewH / 2, 0, Math.max(0, WORLD.height - viewH));
    return { scale, ox: (w - viewW * scale) / 2, oy: (h - viewH * scale) / 2, cx, cy, w, h };
  }

  function drawGround(world, cam) {
    const { level } = daylight(world.timeOfDay);
    ctx.fillStyle = shade('#7d9b5a', level);
    ctx.fillRect(0, 0, cam.w, cam.h);
    // District ground tints, culled to the camera.
    for (const d of world.cityDistricts) {
      const x = (d.x - cam.cx) * cam.scale + cam.ox;
      const y = (d.y - cam.cy) * cam.scale + cam.oy;
      const w = d.w * cam.scale;
      const h = d.h * cam.scale;
      if (x + w < 0 || y + h < 0 || x > cam.w || y > cam.h) continue;
      ctx.fillStyle = shade(d.ground, level);
      ctx.fillRect(x, y, w, h);
    }
    // Beach and sea along the south edge.
    const beachY = (WATER.y - 60 - cam.cy) * cam.scale + cam.oy;
    const seaY = (WATER.y + 40 - cam.cy) * cam.scale + cam.oy;
    ctx.fillStyle = shade(PALETTE.sand, level);
    ctx.fillRect(0, Math.max(0, beachY), cam.w, Math.max(0, seaY - beachY));
    ctx.fillStyle = shade(PALETTE.sea, level);
    ctx.fillRect(0, Math.max(0, seaY), cam.w, cam.h - Math.max(0, seaY));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, seaY + Math.sin(world.time * 1.4) * 3);
    ctx.lineTo(cam.w, seaY + Math.cos(world.time * 1.1) * 3);
    ctx.stroke();
  }

  function drawRoads(world, cam) {
    const { level } = daylight(world.timeOfDay);
    ctx.fillStyle = shade(PALETTE.sidewalk, level);
    for (const x of ROADS_X) {
      const px = (x - GRID.walkHalf - cam.cx) * cam.scale + cam.ox;
      ctx.fillRect(px, 0, GRID.walkHalf * 2 * cam.scale, cam.h);
    }
    for (const y of ROADS_Y) {
      const py = (y - GRID.walkHalf - cam.cy) * cam.scale + cam.oy;
      ctx.fillRect(0, py, cam.w, GRID.walkHalf * 2 * cam.scale);
    }
    ctx.fillStyle = shade(PALETTE.road, level);
    for (const x of ROADS_X) {
      const px = (x - GRID.roadHalf - cam.cx) * cam.scale + cam.ox;
      ctx.fillRect(px, 0, GRID.roadHalf * 2 * cam.scale, cam.h);
    }
    for (const y of ROADS_Y) {
      const py = (y - GRID.roadHalf - cam.cy) * cam.scale + cam.oy;
      ctx.fillRect(0, py, cam.w, GRID.roadHalf * 2 * cam.scale);
    }
    // Centre dashes and crosswalks.
    ctx.fillStyle = shade(PALETTE.roadLine, level);
    for (const x of ROADS_X) {
      const px = (x - cam.cx) * cam.scale + cam.ox;
      for (let y = 0; y < WORLD.height; y += 64) {
        const py = (y - cam.cy) * cam.scale + cam.oy;
        if (py < -20 || py > cam.h + 20) continue;
        if (onIntersection(x, y)) continue;
        ctx.fillRect(px - 1.5 * cam.scale, py, 3 * cam.scale, 26 * cam.scale);
      }
    }
    for (const y of ROADS_Y) {
      const py = (y - cam.cy) * cam.scale + cam.oy;
      for (let x = 0; x < WORLD.width; x += 64) {
        const px = (x - cam.cx) * cam.scale + cam.ox;
        if (px < -20 || px > cam.w + 20) continue;
        if (onIntersection(x, y)) continue;
        ctx.fillRect(px, py - 1.5 * cam.scale, 26 * cam.scale, 3 * cam.scale);
      }
    }
    ctx.fillStyle = 'rgba(240,240,230,0.5)';
    for (const x of ROADS_X) {
      for (const y of ROADS_Y) {
        const px = (x - cam.cx) * cam.scale + cam.ox;
        const py = (y - cam.cy) * cam.scale + cam.oy;
        if (px < -60 || py < -60 || px > cam.w + 60 || py > cam.h + 60) continue;
        for (let i = -2; i <= 2; i += 1) {
          ctx.fillRect(px - GRID.roadHalf * cam.scale + 6 * cam.scale, py + i * 14 * cam.scale - 4 * cam.scale, 10 * cam.scale, 8 * cam.scale);
          ctx.fillRect(px + GRID.roadHalf * cam.scale - 16 * cam.scale, py + i * 14 * cam.scale - 4 * cam.scale, 10 * cam.scale, 8 * cam.scale);
        }
      }
    }
  }

  function onIntersection(x, y) {
    for (const ry of ROADS_Y) if (Math.abs(y - ry) < GRID.roadHalf + 30) return true;
    for (const rx of ROADS_X) if (Math.abs(x - rx) < GRID.roadHalf + 30) return true;
    return false;
  }

  function drawBuildings(world, cam) {
    const { level, sun } = daylight(world.timeOfDay);
    const night = level < 0.45;
    for (const b of world.city.buildings) {
      const x = (b.x - cam.cx) * cam.scale + cam.ox;
      const y = (b.y - cam.cy) * cam.scale + cam.oy;
      const w = b.w * cam.scale;
      const h = b.h * cam.scale;
      if (x + w < -40 || y + h < -40 || x > cam.w + 40 || y > cam.h + 40) continue;
      const lift = Math.min(26, b.floors * 2.2) * cam.scale;
      // Shadow side and roof, so blocks read as solid.
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + lift * 0.5, y + lift * 0.5, w, h);
      ctx.fillStyle = shade(b.roof, level);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = PALETTE.buildingEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      // Windows: a sparse, irregular grid — only some lit at night.
      if (b.windows && w > 30 * cam.scale && h > 24 * cam.scale) {
        const cols = Math.max(2, Math.floor(w / (42 * cam.scale)));
        const rows = Math.max(2, Math.floor(h / (38 * cam.scale)));
        for (let c = 0; c < cols; c += 1) {
          for (let r = 0; r < rows; r += 1) {
            if ((c * 7 + r * 11 + b.floors * 3) % 3 === 0) continue;
            const lit = night && ((c * 5 + r * 7 + b.floors) % 4 === 0);
            ctx.fillStyle = lit ? '#ffd76a' : 'rgba(20,30,45,0.55)';
            ctx.fillRect(x + (6 + c * (w - 12) / cols) * 1, y + (6 + r * (h - 12) / rows) * 1, Math.max(2, (w - 12) / cols * 0.45), Math.max(2, (h - 12) / rows * 0.45));
          }
        }
      }
      if (b.neon) {
        ctx.strokeStyle = b.neonColor;
        ctx.globalAlpha = night ? 0.95 : 0.45;
        ctx.lineWidth = 2.5 * cam.scale;
        ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
        ctx.globalAlpha = 1;
      }
    }
    void sun;
  }

  function drawProps(world, cam) {
    const { level } = daylight(world.timeOfDay);
    for (const tree of world.city.trees) {
      const x = (tree.x - cam.cx) * cam.scale + cam.ox;
      const y = (tree.y - cam.cy) * cam.scale + cam.oy;
      if (x < -30 || y < -30 || x > cam.w + 30 || y > cam.h + 30) continue;
      ctx.fillStyle = shade('#3f7a34', level);
      ctx.beginPath();
      ctx.arc(x, y, tree.r * cam.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade('#5a9c46', level);
      ctx.beginPath();
      ctx.arc(x - tree.r * 0.25 * cam.scale, y - tree.r * 0.25 * cam.scale, tree.r * 0.6 * cam.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = shade('#2c313a', level);
    for (const lamp of world.city.lamps) {
      const x = (lamp.x - cam.cx) * cam.scale + cam.ox;
      const y = (lamp.y - cam.cy) * cam.scale + cam.oy;
      if (x < -10 || y < -10 || x > cam.w + 10 || y > cam.h + 10) continue;
      ctx.fillRect(x - 1.5 * cam.scale, y - 4 * cam.scale, 3 * cam.scale, 8 * cam.scale);
      if (level < 0.45) {
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath();
        ctx.arc(x, y - 5 * cam.scale, 3 * cam.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shade('#2c313a', level);
      }
    }
    ctx.fillStyle = shade('#c0392b', level);
    for (const hyd of world.city.hydrants) {
      const x = (hyd.x - cam.cx) * cam.scale + cam.ox;
      const y = (hyd.y - cam.cy) * cam.scale + cam.oy;
      if (x < -10 || y < -10 || x > cam.w + 10 || y > cam.h + 10) continue;
      ctx.fillRect(x - 3 * cam.scale, y - 5 * cam.scale, 6 * cam.scale, 10 * cam.scale);
    }
  }

  function drawCar(world, cam, car) {
    const { level } = daylight(world.timeOfDay);
    const x = (car.x - cam.cx) * cam.scale + cam.ox;
    const y = (car.y - cam.cy) * cam.scale + cam.oy;
    if (x < -120 || y < -120 || x > cam.w + 120 || y > cam.h + 120) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(car.angle);
    const s = cam.scale;
    const w = car.def.w * s;
    const l = car.def.l * s;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, -l / 2 + 3 * s, -w / 2 + 4 * s, l, w, 8 * s);
    ctx.fill();
    // Body.
    ctx.fillStyle = shade(car.color, level);
    roundRect(ctx, -l / 2, -w / 2, l, w, 9 * s);
    ctx.fill();
    if (car.police) {
      ctx.fillStyle = '#f2f5f7';
      ctx.fillRect(-l * 0.08, -w / 2, l * 0.16, w);
      ctx.fillStyle = '#1b2631';
      ctx.font = `bold ${Math.max(8, 11 * s)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.rotate(Math.PI / 2);
      ctx.fillText('SPD', 0, 0);
      ctx.restore();
      // Light bar, flashing.
      const phase = Math.floor(world.time * 6) % 2 === 0;
      ctx.fillStyle = phase ? '#ff3b30' : '#2f7fe0';
      ctx.fillRect(-l * 0.18, -w / 2 - 3 * s, l * 0.1, 4 * s);
      ctx.fillStyle = phase ? '#2f7fe0' : '#ff3b30';
      ctx.fillRect(l * 0.08, -w / 2 - 3 * s, l * 0.1, 4 * s);
    }
    if (car.taxi) {
      ctx.fillStyle = '#1b2631';
      ctx.font = `bold ${Math.max(8, 10 * s)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.rotate(Math.PI / 2);
      ctx.fillText('TAXI', 0, 0);
      ctx.restore();
    }
    // Windows and roof.
    ctx.fillStyle = 'rgba(15,25,40,0.85)';
    roundRect(ctx, -l * 0.28, -w * 0.36, l * 0.22, w * 0.72, 4 * s);
    ctx.fill();
    roundRect(ctx, l * 0.08, -w * 0.36, l * 0.2, w * 0.72, 4 * s);
    ctx.fill();
    // Wheels.
    ctx.fillStyle = '#14181d';
    const wy = w / 2;
    ctx.fillRect(-l * 0.32, -wy - 3 * s, l * 0.14, 5 * s);
    ctx.fillRect(-l * 0.32, wy - 2 * s, l * 0.14, 5 * s);
    ctx.fillRect(l * 0.2, -wy - 3 * s, l * 0.14, 5 * s);
    ctx.fillRect(l * 0.2, wy - 2 * s, l * 0.14, 5 * s);
    // Headlights at night.
    if (level < 0.5) {
      ctx.fillStyle = 'rgba(255,240,180,0.9)';
      ctx.fillRect(l / 2 - 2 * s, -w * 0.32, 4 * s, 5 * s);
      ctx.fillRect(l / 2 - 2 * s, w * 0.32 - 5 * s, 4 * s, 5 * s);
    }
    if (car.brakeLight) {
      ctx.fillStyle = '#ff2e2e';
      ctx.fillRect(-l / 2 - 1 * s, -w * 0.32, 3 * s, 5 * s);
      ctx.fillRect(-l / 2 - 1 * s, w * 0.32 - 5 * s, 3 * s, 5 * s);
    }
    // Smoke when wrecked.
    if (car.health < 35) {
      ctx.fillStyle = 'rgba(120,120,120,0.6)';
      ctx.beginPath();
      ctx.arc(-l * 0.2, 0, (6 + Math.sin(world.time * 9) * 3) * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Headlight cones on the ground at night.
    if (level < 0.5) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(car.angle);
      const grad = ctx.createLinearGradient(0, 0, 190 * s, 0);
      grad.addColorStop(0, 'rgba(255,240,180,0.16)');
      grad.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(l / 2, -w * 0.3);
      ctx.lineTo(l / 2 + 190 * s, -w * 0.9);
      ctx.lineTo(l / 2 + 190 * s, w * 0.9);
      ctx.lineTo(l / 2, w * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // Mission target car: a beacon.
    if (world.mission && world.mission.targetCar === car) {
      ctx.save();
      ctx.strokeStyle = '#ffd23e';
      ctx.lineWidth = 3;
      const pulse = 1 + Math.sin(world.time * 5) * 0.12;
      ctx.beginPath();
      ctx.arc(x, y, 52 * s * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPerson(world, cam, p, isPlayer, isCop, isRival) {
    const { level } = daylight(world.timeOfDay);
    const x = (p.x - cam.cx) * cam.scale + cam.ox;
    const y = (p.y - cam.cy) * cam.scale + cam.oy;
    if (x < -40 || y < -40 || x > cam.w + 40 || y > cam.h + 40) return;
    const s = cam.scale;
    ctx.save();
    ctx.translate(x, y);
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 7 * s, 10 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(p.angle + Math.PI / 2);
    const bob = p.speed > 10 ? Math.sin(world.time * 14 + p.x * 0.1) * 1.5 * s : 0;
    // Body.
    ctx.fillStyle = isPlayer ? '#ffcf3f' : isCop ? '#2f5fd0' : isRival ? '#8e2f5f' : shade(p.color, level);
    roundRect(ctx, -6 * s, -8 * s + bob, 12 * s, 16 * s, 5 * s);
    ctx.fill();
    // Head.
    ctx.fillStyle = shade(p.skin || '#e0ac69', level);
    ctx.beginPath();
    ctx.arc(0, -12 * s + bob, 6.5 * s, 0, Math.PI * 2);
    ctx.fill();
    if (isPlayer) {
      ctx.fillStyle = '#1b2631';
      ctx.fillRect(-6 * s, -14 * s + bob, 12 * s, 3 * s);
      // A thin ring marks the player so they are easy to find in a crowd.
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(0, 0, 20 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (isCop) {
      ctx.fillStyle = '#101820';
      ctx.fillRect(-6.5 * s, -15 * s + bob, 13 * s, 4 * s);
    }
    ctx.restore();
    if (isRival) {
      ctx.fillStyle = '#ff5a5a';
      ctx.font = `bold ${Math.max(10, 13 * s)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('!', x, y - 22 * s);
    }
  }

  function drawMarker(world, cam, x, y, label, color) {
    const px = (x - cam.cx) * cam.scale + cam.ox;
    const py = (y - cam.cy) * cam.scale + cam.oy;
    const s = cam.scale;
    const bob = Math.sin(world.time * 3) * 6 * s;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.arc(px, py - 26 * s + bob, 13 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px, py + bob);
    ctx.lineTo(px - 9 * s, py - 20 * s + bob);
    ctx.lineTo(px + 9 * s, py - 20 * s + bob);
    ctx.closePath();
    ctx.fill();
    if (label) {
      ctx.font = `bold ${Math.max(11, 15 * s)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, px, py - 46 * s + bob);
    }
    ctx.restore();
  }

  function drawParticles(world, cam) {
    for (const pt of world.particles) {
      const x = (pt.x - cam.cx) * cam.scale + cam.ox;
      const y = (pt.y - cam.cy) * cam.scale + cam.oy;
      if (x < -20 || y < -20 || x > cam.w + 20 || y > cam.h + 20) continue;
      ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, pt.size * cam.scale * (pt.life / pt.maxLife)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const tr of world.tracers) {
      const x1 = (tr.x1 - cam.cx) * cam.scale + cam.ox;
      const y1 = (tr.y1 - cam.cy) * cam.scale + cam.oy;
      const x2 = (tr.x2 - cam.cx) * cam.scale + cam.ox;
      const y2 = (tr.y2 - cam.cy) * cam.scale + cam.oy;
      ctx.globalAlpha = clamp(tr.life / tr.maxLife, 0, 1);
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPickups(world, cam) {
    for (const pk of world.pickups) {
      const x = (pk.x - cam.cx) * cam.scale + cam.ox;
      const y = (pk.y - cam.cy) * cam.scale + cam.oy;
      if (x < -30 || y < -30 || x > cam.w + 30 || y > cam.h + 30) continue;
      const s = cam.scale;
      const bob = Math.sin(world.time * 4 + pk.x) * 3 * s;
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.fillStyle = pk.kind === 'cash' ? '#7ee081' : pk.kind === 'health' ? '#ff6b81' : '#4db2ff';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      if (pk.kind === 'cash') {
        ctx.fillRect(-11 * s, -7 * s, 22 * s, 14 * s);
        ctx.strokeRect(-11 * s, -7 * s, 22 * s, 14 * s);
        ctx.fillStyle = '#1e7a34';
        ctx.font = `bold ${Math.max(9, 12 * s)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', 0, 0);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, 11 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(10, 14 * s)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pk.kind === 'health' ? '+' : 'A', 0, 1);
      }
      ctx.restore();
    }
  }

  function drawRain(world, cam) {
    if (!world.raining) return;
    ctx.strokeStyle = 'rgba(180,200,230,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 90; i += 1) {
      const rx = ((i * 137 + world.time * 900) % (cam.w + 40)) - 20;
      const ry = ((i * 89 + world.time * 1400) % (cam.h + 40)) - 20;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 6, ry + 16);
    }
    ctx.stroke();
  }

  function drawNight(world, cam) {
    const { level } = daylight(world.timeOfDay);
    if (level > 0.55) return;
    const px = (world.player.x - cam.cx) * cam.scale + cam.ox;
    const py = (world.player.y - cam.cy) * cam.scale + cam.oy;
    const grad = ctx.createRadialGradient(px, py, 60, px, py, Math.max(cam.w, cam.h) * 0.75);
    grad.addColorStop(0, 'rgba(8,12,28,0)');
    grad.addColorStop(1, `rgba(8,12,28,${(0.55 - level) * 0.85})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cam.w, cam.h);
  }

  function drawHeli(world, cam) {
    if (!world.heli) return;
    const { level } = daylight(world.timeOfDay);
    const x = (world.heli.x - cam.cx) * cam.scale + cam.ox;
    const y = (world.heli.y - cam.cy) * cam.scale + cam.oy;
    const s = cam.scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(4 * s, 6 * s, 22 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade('#2c3e50', level);
    ctx.beginPath();
    ctx.ellipse(0, 0, 20 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2 * s;
    const rotor = world.time * 30;
    ctx.beginPath();
    ctx.moveTo(Math.cos(rotor) * 34 * s, Math.sin(rotor) * 34 * s);
    ctx.lineTo(-Math.cos(rotor) * 34 * s, -Math.sin(rotor) * 34 * s);
    ctx.stroke();
    ctx.restore();
    // Searchlight on the player.
    const px = (world.player.x - cam.cx) * cam.scale + cam.ox;
    const py = (world.player.y - cam.cy) * cam.scale + cam.oy;
    const grad = ctx.createRadialGradient(px, py, 10, px, py, 120 * s);
    grad.addColorStop(0, 'rgba(255,250,200,0.28)');
    grad.addColorStop(1, 'rgba(255,250,200,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, 120 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMinimap(world) {
    const s = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
    const mw = MINIMAP.w * s;
    const mh = MINIMAP.h * s;
    const mx = canvas.width - mw - 14 * s;
    const my = 14 * s;
    MINIMAP.x = mx;
    MINIMAP.y = my;
    MINIMAP.w = mw;
    MINIMAP.h = mh;
    const sx = mw / WORLD.width;
    const sy = mh / WORLD.height;
    ctx.save();
    ctx.fillStyle = PALETTE.hudBg;
    roundRect(ctx, mx - 4 * s, my - 4 * s, mw + 8 * s, mh + 8 * s, 8 * s);
    ctx.fill();
    ctx.beginPath();
    roundRect(ctx, mx, my, mw, mh, 4 * s);
    ctx.clip();
    ctx.fillStyle = '#22303a';
    ctx.fillRect(mx, my, mw, mh);
    ctx.fillStyle = '#2e6f8e';
    ctx.fillRect(mx, my + (WATER.y + 40) * sy, mw, mh - (WATER.y + 40) * sy);
    ctx.strokeStyle = 'rgba(220,225,230,0.55)';
    ctx.lineWidth = 1;
    for (const rx of ROADS_X) {
      ctx.beginPath();
      ctx.moveTo(mx + rx * sx, my);
      ctx.lineTo(mx + rx * sx, my + mh);
      ctx.stroke();
    }
    for (const ry of ROADS_Y) {
      ctx.beginPath();
      ctx.moveTo(mx, my + ry * sy);
      ctx.lineTo(mx + mw, my + ry * sy);
      ctx.stroke();
    }
    const dot = (x, y, color, r) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx + x * sx, my + y * sy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const car of world.cars) dot(car.x, car.y, car.police ? '#ff5a5a' : 'rgba(200,205,210,0.8)', car.police ? 3.5 : 2);
    const wp = world.missionWaypoint;
    if (wp) {
      const pulse = 1 + Math.sin(world.time * 4) * 0.3;
      dot(wp.x, wp.y, '#ffd23e', 4 * pulse);
    }
    if (world.startMarker) dot(world.startMarker.x, world.startMarker.y, '#ffd23e', 4);
    dot(world.player.x, world.player.y, '#ffffff', 4);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx + world.player.x * sx, my + world.player.y * sy, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = PALETTE.hudText;
    ctx.font = `bold ${Math.max(10, 12 * s)}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(world.districtName || 'Solmar', mx, my + mh + 16 * s);
  }

  function drawHud(world) {
    const s = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
    const pad = 16 * s;
    ctx.textBaseline = 'alphabetic';
    // Wanted stars + health + armor, top left.
    ctx.fillStyle = PALETTE.hudBg;
    roundRect(ctx, pad - 6 * s, pad - 6 * s, 250 * s, 86 * s, 10 * s);
    ctx.fill();
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = i < world.wanted ? PALETTE.star : PALETTE.starEmpty;
      drawStar(ctx, pad + 14 * s + i * 26 * s, pad + 14 * s, 10 * s);
    }
    bar(ctx, pad + 8 * s, pad + 32 * s, 220 * s, 12 * s, world.player.health / 100, PALETTE.health);
    bar(ctx, pad + 8 * s, pad + 50 * s, 220 * s, 9 * s, world.player.armor / 100, PALETTE.armor);
    ctx.fillStyle = PALETTE.hudText;
    ctx.font = `bold ${Math.max(11, 14 * s)}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('DIZ MARLOWE', pad + 8 * s, pad + 76 * s);
    // Cash, weapon, ammo, bottom left.
    ctx.fillStyle = PALETTE.hudBg;
    roundRect(ctx, pad - 6 * s, canvas.height - 74 * s, 250 * s, 60 * s, 10 * s);
    ctx.fill();
    ctx.fillStyle = PALETTE.cash;
    ctx.font = `bold ${Math.max(14, 20 * s)}px ${FONT}`;
    ctx.fillText(`$${Math.floor(world.cash).toLocaleString('en-US')}`, pad + 8 * s, canvas.height - 44 * s);
    ctx.fillStyle = PALETTE.hudText;
    ctx.font = `${Math.max(11, 14 * s)}px ${FONT}`;
    const weapon = world.weaponName;
    const ammo = world.ammoText;
    ctx.fillText(`${weapon}   ${ammo}`, pad + 8 * s, canvas.height - 24 * s);
    // Objective, bottom centre.
    if (world.objective) {
      ctx.font = `bold ${Math.max(12, 16 * s)}px ${FONT}`;
      const text = world.objective;
      const w = ctx.measureText(text).width + 28 * s;
      ctx.fillStyle = PALETTE.hudBg;
      roundRect(ctx, (canvas.width - w) / 2, canvas.height - 52 * s, w, 36 * s, 8 * s);
      ctx.fill();
      ctx.fillStyle = '#ffd23e';
      ctx.textAlign = 'center';
      ctx.fillText(text, canvas.width / 2, canvas.height - 28 * s);
      ctx.textAlign = 'left';
    }
    if (world.timerText) {
      ctx.fillStyle = world.timerTextUrgent ? '#ff5a5a' : PALETTE.hudText;
      ctx.font = `bold ${Math.max(14, 20 * s)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(world.timerText, canvas.width / 2, 44 * s);
      ctx.textAlign = 'left';
    }
    // Speed, clock, radio, bottom right.
    ctx.fillStyle = PALETTE.hudBg;
    roundRect(ctx, canvas.width - 240 * s, canvas.height - 74 * s, 226 * s, 60 * s, 10 * s);
    ctx.fill();
    ctx.fillStyle = PALETTE.hudText;
    ctx.font = `bold ${Math.max(13, 18 * s)}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(world.speedText, canvas.width - 24 * s, canvas.height - 44 * s);
    ctx.font = `${Math.max(11, 13 * s)}px ${FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText(`${world.clockText}  ·  ${world.radioText}`, canvas.width - 24 * s, canvas.height - 24 * s);
    ctx.textAlign = 'left';
    // Mission briefing banner.
    if (world.banner && world.bannerTimer > 0) {
      ctx.globalAlpha = clamp(world.bannerTimer, 0, 1);
      ctx.fillStyle = 'rgba(8,12,18,0.82)';
      const bw = Math.min(canvas.width - 80 * s, 760 * s);
      const lines = wrapText(ctx, world.banner, bw - 32 * s, Math.max(12, 15 * s));
      const bh = lines.length * 22 * s + 24 * s;
      roundRect(ctx, (canvas.width - bw) / 2, 64 * s, bw, bh, 10 * s);
      ctx.fill();
      ctx.fillStyle = '#ffd23e';
      ctx.font = `bold ${Math.max(12, 15 * s)}px ${FONT}`;
      ctx.textAlign = 'center';
      lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, 64 * s + 26 * s + i * 22 * s));
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    // Crosshair.
    if (world.showCrosshair) {
      const mx = world.mouse.x;
      const my = world.mouse.y;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - 13, my);
      ctx.lineTo(mx - 5, my);
      ctx.moveTo(mx + 5, my);
      ctx.lineTo(mx + 13, my);
      ctx.moveTo(mx, my - 13);
      ctx.lineTo(mx, my - 5);
      ctx.moveTo(mx, my + 5);
      ctx.lineTo(mx, my + 13);
      ctx.stroke();
    }
    // Damage flash.
    if (world.hurtFlash > 0) {
      ctx.fillStyle = `rgba(200,30,30,${clamp(world.hurtFlash, 0, 0.35)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // Wanted flash at high stars.
    if (world.wanted >= 4 && Math.floor(world.time * 2) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,40,40,0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function drawTitle(world) {
    const s = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#ff9a56');
    grad.addColorStop(0.45, '#e85d75');
    grad.addColorStop(1, '#2b1055');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Sun and skyline silhouette.
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath();
    ctx.arc(canvas.width * 0.72, canvas.height * 0.3, 70 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,10,40,0.85)';
    let x = 0;
    const heights = [0.5, 0.72, 0.6, 0.85, 0.66, 0.78, 0.55, 0.9, 0.62, 0.75, 0.58, 0.82];
    heights.forEach((h, i) => {
      const bw = canvas.width / heights.length;
      ctx.fillRect(x, canvas.height * (1 - h * 0.62), bw - 4 * s, canvas.height * h * 0.62);
      x += bw;
    });
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `900 ${Math.max(48, 92 * s)}px ${FONT_DISPLAY}`;
    ctx.fillText('SOLMAR', canvas.width / 2, canvas.height * 0.34);
    ctx.fillStyle = '#ffd23e';
    ctx.font = `bold ${Math.max(16, 26 * s)}px ${FONT}`;
    ctx.fillText('STREETS OF VICE', canvas.width / 2, canvas.height * 0.34 + 34 * s);
    ctx.fillStyle = '#f2f5f7';
    ctx.font = `${Math.max(13, 17 * s)}px ${FONT}`;
    ctx.fillText('A wheelman. A fixer. A city that never sleeps.', canvas.width / 2, canvas.height * 0.5);
    ctx.fillText('Six jobs. One way out. Welcome to Solmar.', canvas.width / 2, canvas.height * 0.5 + 26 * s);
    ctx.font = `bold ${Math.max(14, 19 * s)}px ${FONT}`;
    ctx.fillStyle = Math.floor(world.time * 2) % 2 === 0 ? '#ffd23e' : '#fff';
    ctx.fillText(world.hasSave ? 'ENTER — Continue your story' : 'ENTER — Start a new story', canvas.width / 2, canvas.height * 0.66);
    ctx.fillStyle = '#d5dde3';
    ctx.font = `${Math.max(11, 14 * s)}px ${FONT}`;
    ctx.fillText('WASD move / drive · E enter car · Mouse aim · Click shoot · R reload · F punch · Shift sprint · Space handbrake · M mute · P pause', canvas.width / 2, canvas.height * 0.78);
    ctx.fillText('H help · your progress saves automatically', canvas.width / 2, canvas.height * 0.78 + 22 * s);
    ctx.textAlign = 'left';
  }

  function drawPause(world) {
    dim(world);
    panel(world, 'PAUSED', [
      'The city waits. Nothing moves while you are here.',
      '',
      'ENTER — keep playing',
      'H — how to play',
      'R — restart from the last save',
      'M — sound on / off',
    ]);
  }

  function drawHelp(world) {
    dim(world);
    panel(world, 'HOW TO PLAY SOLMAR', [
      'On foot: WASD or arrows to walk, Shift to sprint.',
      'Near a car, press E to get in. Drive with WASD; Space is the handbrake.',
      'Mouse aims, click shoots, R reloads, F punches.',
      'Follow the yellow marker: Mara Voss gives the jobs at The Rusty Anchor.',
      'Stars are the law. Commit crimes and the SPD comes: cars, cops on',
      'foot, roadblocks, and at five stars a helicopter. Lose them, or pay',
      'for a respray at Spray & Go. Getting caught costs you cash.',
      'Shops: Ironworks Arms sells guns, Doc\u2019s Clinic heals,',
      'Spray & Go clears your wanted level. Taxi fares pay between jobs.',
      '',
      'ENTER — back to the game',
    ]);
  }

  function drawEnd(world, title, lines, color) {
    dim(world);
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = `900 ${Math.max(48, 84 * s2(world))}px ${FONT_DISPLAY}`;
    ctx.fillText(title, canvas.width / 2, canvas.height * 0.36);
    ctx.fillStyle = '#f2f5f7';
    ctx.font = `${Math.max(13, 18 * s2(world))}px ${FONT}`;
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, canvas.height * 0.5 + i * 28 * s2(world)));
    ctx.fillStyle = '#ffd23e';
    ctx.font = `bold ${Math.max(13, 17 * s2(world))}px ${FONT}`;
    ctx.fillText('ENTER — continue', canvas.width / 2, canvas.height * 0.68);
    ctx.textAlign = 'left';
  }

  function s2(world) {
    return Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
  }

  function dim(world) {
    ctx.fillStyle = 'rgba(6,10,16,0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function panel(world, title, lines) {
    const s = s2(world);
    const w = Math.min(canvas.width - 60 * s, 640 * s);
    const h = (lines.length + 2) * 26 * s + 40 * s;
    ctx.fillStyle = 'rgba(10,16,24,0.9)';
    roundRect(ctx, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h, 12 * s);
    ctx.fill();
    ctx.strokeStyle = '#ffd23e';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23e';
    ctx.font = `bold ${Math.max(16, 22 * s)}px ${FONT}`;
    ctx.fillText(title, canvas.width / 2, (canvas.height - h) / 2 + 38 * s);
    ctx.fillStyle = '#e8edf0';
    ctx.font = `${Math.max(12, 15 * s)}px ${FONT}`;
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, (canvas.height - h) / 2 + 72 * s + i * 26 * s));
    ctx.textAlign = 'left';
  }

  function drawComplete(world) {
    dim(world);
    const s = s2(world);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7ee081';
    ctx.font = `900 ${Math.max(36, 56 * s)}px ${FONT_DISPLAY}`;
    ctx.fillText('JOB DONE', canvas.width / 2, canvas.height * 0.34);
    ctx.fillStyle = '#f2f5f7';
    ctx.font = `${Math.max(14, 19 * s)}px ${FONT}`;
    ctx.fillText(world.completeText || 'Mara Voss pays up. Solmar is one job closer to yours.', canvas.width / 2, canvas.height * 0.46);
    ctx.fillStyle = '#ffd23e';
    ctx.font = `bold ${Math.max(16, 24 * s)}px ${FONT}`;
    ctx.fillText(`+$${world.completePay || 0}`, canvas.width / 2, canvas.height * 0.54);
    ctx.fillStyle = '#f2f5f7';
    ctx.font = `bold ${Math.max(13, 17 * s)}px ${FONT}`;
    ctx.fillText('ENTER — back to the streets', canvas.width / 2, canvas.height * 0.66);
    ctx.textAlign = 'left';
  }

  function bar(ctx2, x, y, w, h, ratio, color) {
    ctx2.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx2, x, y, w, h, h / 2);
    ctx2.fill();
    ctx2.fillStyle = color;
    if (ratio > 0) {
      roundRect(ctx2, x, y, Math.max(h, w * clamp(ratio, 0, 1)), h, h / 2);
      ctx2.fill();
    }
  }

  function drawStar(ctx2, x, y, r) {
    ctx2.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const radius = i % 2 === 0 ? r : r * 0.45;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx2.moveTo(px, py);
      else ctx2.lineTo(px, py);
    }
    ctx2.closePath();
    ctx2.fill();
  }

  function wrapText(ctx2, text, maxWidth, fontSize) {
    ctx2.font = `bold ${fontSize}px ${FONT}`;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx2.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(ctx2, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx2.beginPath();
    ctx2.moveTo(x + radius, y);
    ctx2.arcTo(x + w, y, x + w, y + h, radius);
    ctx2.arcTo(x + w, y + h, x, y + h, radius);
    ctx2.arcTo(x, y + h, x, y, radius);
    ctx2.arcTo(x, y, x + w, y, radius);
    ctx2.closePath();
  }

  return {
    /** Convert a point in canvas pixels to world coordinates. */
    screenToWorld(world, sx, sy) {
      const cam = cameraFor(world);
      return {
        x: cam.cx + (sx - cam.ox) / cam.scale,
        y: cam.cy + (sy - cam.oy) / cam.scale,
      };
    },
    draw(world, screen) {
      const cam = cameraFor(world);
      if (screen === SCREEN_TITLE) {
        drawTitle(world);
        return;
      }
      drawGround(world, cam);
      drawRoads(world, cam);
      drawBuildings(world, cam);
      drawProps(world, cam);
      drawPickups(world, cam);
      const wp = world.missionWaypoint;
      if (wp) drawMarker(world, cam, wp.x, wp.y, '', '#ffd23e');
      if (world.startMarker) drawMarker(world, cam, world.startMarker.x, world.startMarker.y, 'M', '#ffd23e');
      for (const car of world.cars) drawCar(world, cam, car);
      for (const ped of world.peds) drawPerson(world, cam, ped, false, false, false);
      for (const cop of world.cops) drawPerson(world, cam, cop, false, true, false);
      for (const rival of world.rivals) drawPerson(world, cam, rival, false, false, true);
      drawPerson(world, cam, world.player, true, false, false);
      drawParticles(world, cam);
      drawHeli(world, cam);
      drawRain(world, cam);
      drawNight(world, cam);
      drawMinimap(world);
      drawHud(world);
      if (screen === SCREEN_PAUSED) drawPause(world);
      else if (screen === SCREEN_HELP) drawHelp(world);
      else if (screen === SCREEN_WASTED) drawEnd(world, 'WASTED', ['The SPD scraped you off the asphalt.', `You lost $${world.lostCash || 0}. The clinic patched you up.`], '#ff5a5a');
      else if (screen === SCREEN_BUSTED) drawEnd(world, 'BUSTED', ['The SPD dragged you in. Mara bailed you out.', `Fine: $${world.lostCash || 0}. Your wanted level is clear.`], '#5aa2ff');
      else if (screen === SCREEN_COMPLETE) drawComplete(world);
    },
    minimapRect() {
      return { x: MINIMAP.x, y: MINIMAP.y, w: MINIMAP.w, h: MINIMAP.h };
    },
  };
}

/** Shade a hex colour by a light level (0..1). */
export function shade(hex, level) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * level + 12 * (1 - level)));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * level + 14 * (1 - level)));
  const b = Math.min(255, Math.round((n & 255) * level + 26 * (1 - level)));
  return `rgb(${r},${g},${b})`;
}

export { groundAt };
