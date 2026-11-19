// Solmar — an open-world crime game for make.fun's "Make GTA 6" bounty.
// This is the entrypoint the grader runs (Node 22, standard library only).
// It stages the entry: game/ and screenshots/ are copied from this repository
// into the output directory, and /output/dossier.json is written with the
// vendored make.fun library, which is the summary the judge reads.
//
// Run it locally like this:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output; inside the
// grader the variable is unset and the program writes to /output directly.
// The program is deterministic: two runs on the same tree write the same
// bytes, because it only copies files and builds the dossier from them.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The repository root: the directory this file lives in.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The grader gives us /output; local runs use MAKEFUN_OUTPUT_DIR instead.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps for this bounty (from the kit's reference/gate.json):
// the dossier text is capped at 160 KiB, at most 4 screenshots of at most
// 256 KiB each, game/ holds at most 993 files and directories and 48 MiB
// in total, and no path under game/ is longer than 1000 UTF-8 bytes.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyTree(source, target) {
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}

function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    total += 1;
    if (entry.isDirectory()) total += countFiles(join(dir, entry.name));
  }
  return total;
}

function main() {
  const gameDir = join(repoRoot, 'game');
  const shotsDir = join(repoRoot, 'screenshots');
  if (!existsSync(gameDir) || !statSync(gameDir).isDirectory()) {
    throw new Error('game/ is missing: the entry has no playable game');
  }
  if (!existsSync(join(gameDir, 'index.html'))) {
    throw new Error('game/index.html is missing: the entry has no page to open');
  }

  mkdirSync(outputDir, { recursive: true });
  copyTree(gameDir, join(outputDir, 'game'));
  if (existsSync(shotsDir)) copyTree(shotsDir, join(outputDir, 'screenshots'));
  else mkdirSync(join(outputDir, 'screenshots'), { recursive: true });

  const dossier = buildDossier(outputDir, DOSSIER_CAPS);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);

  const gameFiles = countFiles(join(outputDir, 'game'));
  const shotFiles = readdirSync(join(outputDir, 'screenshots')).filter((name) => !name.startsWith('.'));
  console.log(`staged ${gameFiles} game files and ${shotFiles.length} screenshots into ${outputDir}`);
  console.log(`dossier.json: ${dossier.length} bytes`);
}

main();
