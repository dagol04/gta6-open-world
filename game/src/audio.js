// Every sound in Solmar is synthesized live with WebAudio — no audio files.
// A small synth for effects (gunshots, sirens, pickups, explosions) and a
// two-station procedural radio that plays a bass line, a kick and hats on a
// lookahead scheduler. Nothing here loads over the network.

const STATIONS = {
  solmar: {
    name: 'SOLMAR FM',
    bpm: 112,
    bass: [0, 0, 7, 0, 10, 0, 7, 5],
    root: 55,
    wave: 'sawtooth',
  },
  bay: {
    name: 'BAY 97',
    bpm: 96,
    bass: [0, 3, 5, 3, 0, 3, 10, 7],
    root: 49,
    wave: 'triangle',
  },
};

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let muted = false;
  let stationKey = 'solmar';
  let musicTimer = null;
  let nextNoteTime = 0;
  let step = 0;
  let engineNodes = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.16;
      musicGain.connect(master);
      return true;
    } catch {
      return false;
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function tone({ type = 'sine', freq = 440, to = null, dur = 0.2, vol = 0.3, when = 0, dest = null }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(dest || master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.2, vol = 0.4, filterFreq = 1200, type = 'lowpass', when = 0 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t0);
  }

  function scheduleMusic() {
    if (!ctx) return;
    const station = STATIONS[stationKey];
    const stepDur = 60 / station.bpm / 2;
    while (nextNoteTime < ctx.currentTime + 0.25) {
      const barStep = step % 16;
      const note = station.bass[Math.floor(barStep / 2) % station.bass.length];
      const freq = station.root * Math.pow(2, note / 12);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = station.wave;
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      gain.gain.setValueAtTime(0.5, nextNoteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + stepDur * 1.8);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(musicGain);
      osc.start(nextNoteTime);
      osc.stop(nextNoteTime + stepDur * 2);
      if (barStep % 4 === 0) {
        const kick = ctx.createOscillator();
        const kg = ctx.createGain();
        kick.type = 'sine';
        kick.frequency.setValueAtTime(120, nextNoteTime);
        kick.frequency.exponentialRampToValueAtTime(40, nextNoteTime + 0.12);
        kg.gain.setValueAtTime(0.6, nextNoteTime);
        kg.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + 0.14);
        kick.connect(kg);
        kg.connect(musicGain);
        kick.start(nextNoteTime);
        kick.stop(nextNoteTime + 0.16);
      }
      if (barStep % 2 === 1) {
        const len = Math.floor(ctx.sampleRate * 0.03);
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const hat = ctx.createBufferSource();
        hat.buffer = buffer;
        const hf = ctx.createBiquadFilter();
        hf.type = 'highpass';
        hf.frequency.value = 6000;
        const hg = ctx.createGain();
        hg.gain.value = 0.12;
        hat.connect(hf);
        hf.connect(hg);
        hg.connect(musicGain);
        hat.start(nextNoteTime);
      }
      nextNoteTime += stepDur;
      step += 1;
    }
  }

  return {
    unlock() {
      if (ensure()) resume();
    },
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : 0.55;
    },
    isMuted() {
      return muted;
    },
    stationName() {
      return STATIONS[stationKey].name;
    },
    nextStation() {
      stationKey = stationKey === 'solmar' ? 'bay' : 'solmar';
      return STATIONS[stationKey].name;
    },
    startMusic() {
      if (!ensure() || musicTimer) return;
      nextNoteTime = ctx.currentTime + 0.1;
      musicTimer = setInterval(scheduleMusic, 90);
    },
    stopMusic() {
      if (musicTimer) {
        clearInterval(musicTimer);
        musicTimer = null;
      }
    },
    gunshot() {
      noise({ dur: 0.14, vol: 0.5, filterFreq: 900, type: 'bandpass' });
      tone({ type: 'square', freq: 160, to: 50, dur: 0.1, vol: 0.25 });
    },
    punch() {
      noise({ dur: 0.09, vol: 0.35, filterFreq: 500 });
    },
    explosion() {
      noise({ dur: 0.7, vol: 0.7, filterFreq: 300 });
      tone({ type: 'sine', freq: 90, to: 28, dur: 0.6, vol: 0.5 });
    },
    sirenBlip() {
      tone({ type: 'square', freq: 720, to: 980, dur: 0.28, vol: 0.07 });
      tone({ type: 'square', freq: 980, to: 720, dur: 0.28, vol: 0.07, when: 0.28 });
    },
    pickup() {
      tone({ freq: 660, dur: 0.09, vol: 0.25 });
      tone({ freq: 990, dur: 0.14, vol: 0.25, when: 0.08 });
    },
    cash() {
      tone({ freq: 880, dur: 0.08, vol: 0.22 });
      tone({ freq: 1174, dur: 0.08, vol: 0.22, when: 0.07 });
      tone({ freq: 1568, dur: 0.16, vol: 0.22, when: 0.14 });
    },
    fail() {
      tone({ type: 'sawtooth', freq: 220, to: 110, dur: 0.4, vol: 0.25 });
    },
    missionDone() {
      [523, 659, 784, 1046].forEach((freq, i) => tone({ freq, dur: 0.16, vol: 0.25, when: i * 0.1 }));
    },
    click() {
      tone({ freq: 1200, dur: 0.04, vol: 0.15 });
    },
    engine(on, speedRatio) {
      if (!ensure()) return;
      if (!on) {
        if (engineNodes) {
          try {
            engineNodes.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
            engineNodes.osc.stop(ctx.currentTime + 0.4);
          } catch { /* already stopped */ }
          engineNodes = null;
        }
        return;
      }
      if (!engineNodes) {
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        osc2.type = 'square';
        filter.type = 'lowpass';
        filter.frequency.value = 900;
        gain.gain.value = 0.05;
        osc.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        osc.start();
        osc2.start();
        engineNodes = { osc, osc2, gain };
      }
      const rpm = 50 + speedRatio * 160;
      engineNodes.osc.frequency.setTargetAtTime(rpm, ctx.currentTime, 0.05);
      engineNodes.osc2.frequency.setTargetAtTime(rpm * 0.5, ctx.currentTime, 0.05);
      engineNodes.gain.gain.setTargetAtTime(0.04 + speedRatio * 0.05, ctx.currentTime, 0.1);
    },
  };
}
