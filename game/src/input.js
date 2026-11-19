// Keyboard and mouse, read once a frame. The game asks this module what
// the player is doing, never the DOM directly, so the screenshot autopilot
// can drive the same interface with scripted input.

export const KEY = {
  UP: ['KeyW', 'ArrowUp'],
  DOWN: ['KeyS', 'ArrowDown'],
  LEFT: ['KeyA', 'ArrowLeft'],
  RIGHT: ['KeyD', 'ArrowRight'],
  SPRINT: ['ShiftLeft', 'ShiftRight'],
  ENTER: ['KeyE'],
  RELOAD: ['KeyR'],
  MELEE: ['KeyF'],
  HANDBRAKE: ['Space'],
  PAUSE: ['KeyP', 'Escape'],
  MUTE: ['KeyM'],
  RADIO: ['KeyQ'],
  CONFIRM: ['Enter', 'Space'],
};

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const mouse = { x: 0, y: 0, down: false, clicked: false, worldX: 0, worldY: 0 };
  let blur = false;

  function codeOf(event) {
    return event.code;
  }

  window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
    if (!event.repeat) pressed.add(event.code);
    keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    blur = true;
  });
  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  });
  canvas.addEventListener('mousedown', (event) => {
    if (event.button === 0) {
      mouse.down = true;
      mouse.clicked = true;
    }
  });
  window.addEventListener('mouseup', () => {
    mouse.down = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  function held(names) {
    return names.some((code) => keys.has(code));
  }

  return {
    mouse,
    /** The drive/move vector for this frame: {x, y} in -1..1, screen space. */
    moveVector() {
      let x = 0;
      let y = 0;
      if (held(KEY.LEFT)) x -= 1;
      if (held(KEY.RIGHT)) x += 1;
      if (held(KEY.UP)) y -= 1;
      if (held(KEY.DOWN)) y += 1;
      return { x, y };
    },
    sprint() {
      return held(KEY.SPRINT);
    },
    handbrake() {
      return held(KEY.HANDBRAKE);
    },
    /** True only on the frame the key went down. */
    justPressed(names) {
      return names.some((code) => pressed.has(code));
    },
    /** True while the mouse button is held (for automatic weapons). */
    firing() {
      return mouse.down;
    },
    /** True only on the frame the mouse was clicked. */
    justClicked() {
      return mouse.clicked;
    },
    /** Clear the one-frame edges. Call once at the end of every frame. */
    endFrame() {
      pressed.clear();
      mouse.clicked = false;
      if (blur) {
        blur = false;
      }
    },
    /** Scripted input for the screenshot autopilot: pretend keys are held. */
    script(keysDown) {
      keys.clear();
      for (const code of keysDown) keys.add(code);
    },
  };
}
