// Solmar — every tuning number, colour and piece of game data in one place.
// The city is a fixed 3200 x 2400 world of streets and blocks; the camera
// shows a 1280 x 720 window of it. Nothing here depends on the screen size.

export const WORLD = { width: 3200, height: 2400 };
export const VIEW = { width: 1280, height: 720 };
export const STEP = 1 / 60;
export const SAVE_KEY = 'solmar.save.v1';

// Streets run every 320 units; the road itself is 72 wide with a sidewalk
// of 20 on each side, so a block face is 248 units across.
export const GRID = { spacing: 320, roadHalf: 36, walkHalf: 56 };
export const ROADS_X = [200, 520, 840, 1160, 1480, 1800, 2120, 2440, 2760, 3080];
export const ROADS_Y = [200, 520, 840, 1160, 1480, 1800, 2120];

// Districts, by rectangle, with their palette and their name on the map.
export const DISTRICTS = [
  { name: 'Palm Heights', x: 0, y: 0, w: 1200, h: 700, roof: ['#c96f4a', '#d98a5f', '#b85c3e'], ground: '#8a9a6b' },
  { name: 'Downtown', x: 1200, y: 0, w: 1200, h: 1100, roof: ['#4a6b8a', '#5b7d9c', '#3d5a75'], ground: '#6b7a72' },
  { name: 'Old Town', x: 0, y: 700, w: 1200, h: 1100, roof: ['#a8763e', '#c08a4a', '#96682f'], ground: '#7d8a5f' },
  { name: 'Neon Strip', x: 1200, y: 1100, w: 1200, h: 700, roof: ['#7a4a8a', '#9357a3', '#5f3a70'], ground: '#5f6b7a' },
  { name: 'The Docks', x: 2400, y: 0, w: 800, h: 1800, roof: ['#6b6b6b', '#7d7d7d', '#595959'], ground: '#5a5a52' },
  { name: 'Marina', x: 0, y: 1800, w: 2400, h: 600, roof: ['#3e8a7a', '#4a9c8a', '#2f6b5f'], ground: '#c2a878' },
];
export const WATER = { y: 2280 }; // south of this line is beach, then sea

export const PLAYER = {
  walkSpeed: 175,
  runSpeed: 270,
  radius: 13,
  health: 100,
  armor: 100,
};

export const WEAPONS = {
  fists: { name: 'Fists', damage: 12, range: 34, rate: 0.32, spread: 0, auto: false, ammo: Infinity },
  pistol: { name: 'P9 Pistol', damage: 34, range: 520, rate: 0.22, spread: 0.035, auto: false, ammo: 12, reload: 1.1, price: 250 },
  smg: { name: 'VK-9 SMG', damage: 20, range: 460, rate: 0.085, spread: 0.075, auto: true, ammo: 30, reload: 1.4, price: 900 },
};

// Cars: name, size, acceleration, top speed, grip (how fast velocity turns
// toward the heading), colour choices and what the traffic drives.
export const CARS = {
  sedan: { name: 'Vagabond', w: 46, l: 88, accel: 420, top: 330, grip: 5.5, colors: ['#c0392b', '#2e86c1', '#7d3c98', '#b7950b', '#5d6d7e'] },
  coupe: { name: 'Comet GT', w: 44, l: 84, accel: 560, top: 420, grip: 7.0, colors: ['#e74c3c', '#f1c40f', '#1abc9c'] },
  taxi: { name: 'Sunrunner Cab', w: 46, l: 88, accel: 430, top: 330, grip: 5.5, colors: ['#f5b041'] },
  van: { name: 'Mule', w: 50, l: 104, accel: 330, top: 280, grip: 4.5, colors: ['#aeb6bf', '#7f8c8d', '#5d6d7e'] },
  truck: { name: 'Bison', w: 54, l: 128, accel: 280, top: 250, grip: 4.0, colors: ['#935116', '#6e2c00', '#1e8449'] },
  police: { name: 'SPD Interceptor', w: 46, l: 90, accel: 620, top: 450, grip: 7.5, colors: ['#1b2631'] },
  sports: { name: 'Falcon S', w: 44, l: 82, accel: 640, top: 470, grip: 8.0, colors: ['#ff2e63', '#08d9d6', '#eaeaea'] },
};

export const WANTED = {
  maxStars: 5,
  decayDelay: 14,      // seconds of no crime and no police sight before stars fall
  decayInterval: 6,    // seconds between star drops once decaying
  copsPerStar: [0, 1, 2, 3, 4, 5],
  sprayCost: 200,
  bustedFine: 150,
};

export const ECONOMY = {
  startCash: 150,
  taxiFare: 60,
  pickupReward: 40,
  clinicCost: 120,
  armorCost: 180,
};

// The six story missions. Each has a title, a briefing from Mara Voss, the
// steps the player follows, and the cash it pays.
export const MISSIONS = [
  {
    id: 'pickup', title: 'The Pickup', pay: 300,
    briefing: 'Mara: "Diz, a crate is waiting at the docks. Bring it to my bar, The Rusty Anchor, and do not open it."',
    steps: [
      { type: 'goto', label: 'Pick up the crate at the Docks', x: 2900, y: 300, radius: 60 },
      { type: 'goto', label: 'Deliver the crate to The Rusty Anchor', x: 1080, y: 980, radius: 60 },
    ],
  },
  {
    id: 'hotwheels', title: 'Hot Wheels', pay: 450,
    briefing: 'Mara: "A Falcon S is parked outside the Neon Strip casino. Bring it to the garage on Palm Heights. The owner will not be happy."',
    steps: [
      { type: 'steal', label: 'Steal the Falcon S at the Neon Strip', x: 1700, y: 1300, radius: 70, car: 'sports' },
      { type: 'deliver', label: 'Deliver the Falcon S to the Palm Heights garage', x: 420, y: 420, radius: 70 },
    ],
  },
  {
    id: 'packages', title: 'Package Run', pay: 400, time: 150,
    briefing: 'Mara: "Three packages, three corners of Solmar, one very impatient buyer. You have two and a half minutes."',
    steps: [
      { type: 'goto', label: 'Collect package 1/3 — Old Town', x: 420, y: 1300, radius: 55 },
      { type: 'goto', label: 'Collect package 2/3 — Downtown', x: 1960, y: 420, radius: 55 },
      { type: 'goto', label: 'Collect package 3/3 — Marina', x: 700, y: 2000, radius: 55 },
      { type: 'goto', label: 'Deliver the packages to the buyer', x: 2280, y: 980, radius: 60 },
    ],
  },
  {
    id: 'heat', title: 'Lose the Heat', pay: 500, time: 120,
    briefing: 'Mara: "The SPD is all over you, Diz. Lose them — hide, spray the car, outrun them — before they drag you in."',
    steps: [
      { type: 'wanted', label: 'Lose your wanted level', stars: 3, time: 120 },
    ],
  },
  {
    id: 'dockjob', title: 'The Dock Job', pay: 800,
    briefing: 'Mara: "The Vultures took my shipment at the docks. Take it back. All of it."',
    steps: [
      { type: 'goto', label: 'Reach the docks', x: 2700, y: 700, radius: 90 },
      { type: 'clear', label: 'Clear out the Vultures', x: 2700, y: 700, radius: 320, count: 6 },
      { type: 'goto', label: 'Grab the shipment cash', x: 2900, y: 900, radius: 55 },
    ],
  },
  {
    id: 'king', title: 'King of Solmar', pay: 1500,
    briefing: 'Mara: "One last job, Diz. Drive my car to the marina and end the Vultures for good. After tonight, Solmar is ours."',
    steps: [
      { type: 'goto', label: 'Get to Mara\u2019s car at The Rusty Anchor', x: 1080, y: 980, radius: 60 },
      { type: 'deliver', label: 'Drive to the Marina meet', x: 1500, y: 2050, radius: 80 },
      { type: 'clear', label: 'Finish the Vultures at the Marina', x: 1500, y: 2050, radius: 340, count: 8 },
    ],
  },
];

export const PLACES = {
  anchorBar: { x: 1080, y: 980, name: 'The Rusty Anchor' },
  garage: { x: 420, y: 420, name: 'Palm Heights Garage' },
  gunShop: { x: 1480, y: 700, name: 'Ironworks Arms' },
  clinic: { x: 840, y: 1480, name: "Doc's Clinic" },
  spray: { x: 2120, y: 1480, name: 'Spray & Go' },
  casino: { x: 1700, y: 1300, name: 'Casino Solmar' },
};

export const PALETTE = {
  grass: '#7d9b5a', grass2: '#87a865', sand: '#d9c08a', sea: '#2e6f8e', seaDeep: '#1f5570',
  road: '#3a3f47', roadLine: '#d8c95a', sidewalk: '#9aa0a3', curb: '#6e7376',
  buildingEdge: 'rgba(0,0,0,0.35)',
  skyDay: '#87b5d9', skyDusk: '#e08a5a', skyNight: '#0d1526',
  hudBg: 'rgba(10,14,20,0.72)', hudText: '#f2f5f7', hudMuted: '#9fb0bd',
  star: '#ffd23e', starEmpty: '#5a6673',
  health: '#3ddc74', armor: '#4db2ff', cash: '#7ee081',
  cop: '#2f7fe0', copLight: '#ff3b30',
  marker: '#ffd23e', mission: '#ffcf3f',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_DISPLAY = '"Arial Black", "Segoe UI", system-ui, sans-serif';
