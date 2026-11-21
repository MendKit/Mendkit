/**
 * Run on Windows: lists every app winget has an update for and updates each through MendKit, as
 * "Update everything" does, then reports which failed and why. The CI machine comes with many
 * out-of-date programs, so this exercises real-world installers. Usage: node dist/scripts/app-updates-check.js
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadCatalog } from '../engine/catalog';
import { Engine } from '../engine/runner';
import { parseWingetUpgrade, appUpdateCommands, AppUpdate } from '../engine/appupdates';

async function main() {
  const cat = loadCatalog(path.join(__dirname, '..', '..', 'definitions'), 'win32', () => true);
  const eng = new Engine(cat, fs.mkdtempSync(path.join(os.tmpdir(), 'mk-upd-')));
  const out = spawnSync('winget.exe', ['upgrade', '--include-unknown', '--accept-source-agreements', '--disable-interactivity'], { encoding: 'utf8', maxBuffer: 16 << 20 }).stdout;
  // Visual Studio takes an hour; everything else is updated.
  const list: AppUpdate[] = parseWingetUpgrade(out).filter((u) => !/VisualStudio\.(Enterprise|Professional|Community|BuildTools)/.test(u.id));
  console.log(`${list.length} updates listed`);
  // Live progress, so a hung installer shows up in the log.
  eng.on('event', (e: { type: string; name?: string; text?: string }) => {
    if (e.type === 'step-start') console.log(`\n=== ${new Date().toISOString().slice(11, 19)} ${e.name}`);
    if (e.type === 'output' && e.text) process.stdout.write(e.text.replace(/[\r\u2588\u2592]+/g, ' ').replace(/ {3,}/g, ' '));
  });
  const r = await eng.runSteps('app-updates-selected', 'Update all', 'command', appUpdateCommands('win32', list).map((c) => ({ ...c, timeoutMinutes: 15 })), { elevated: process.argv.includes('--elevated') });
  const log = fs.readFileSync(r.logFile, 'utf8');
  let failed = 0;
  for (const s of r.steps) {
    console.log(`${s.status.padEnd(8)} ${s.name}: ${s.friendly?.message}`);
    if (s.status !== 'ok') failed++;
  }
  if (failed) console.log(log.replace(/[\r█▒]+/g, ' ').replace(/ {3,}/g, ' ').slice(-15000));
  console.log(`${failed} of ${r.steps.length} failed`);
}
main();
