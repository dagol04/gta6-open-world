// Save and load, in localStorage only. The save holds the player's cash,
// which missions are done, their best stats and their settings — never the
// live world, which is rebuilt from the seed on every visit. A save from a
// future version is ignored, never trusted.

import { SAVE_KEY } from './config.js';

export function blankSave() {
  return {
    version: 1,
    cash: 150,
    missionsDone: [],
    bestCash: 150,
    carsStolen: 0,
    arrests: 0,
    deaths: 0,
    muted: false,
    station: 'solmar',
  };
}

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return blankSave();
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return blankSave();
    return { ...blankSave(), ...data };
  } catch {
    return blankSave();
  }
}

export function writeSave(save) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage can be off (private windows): progress then lasts the visit.
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch { /* ignore */ }
}
