/**
 * Recover deleted files on a real Windows or Mac runner: makes a small FAT drive (a VHD on Windows, a disk
 * image on the Mac), copies a photo onto it, deletes it, then runs the same search command MendKit runs
 * and checks the photo comes back. Needs administrator rights (the runners have them).
 */
import { execFileSync, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Engine } from '../engine/runner';
import { loadCatalog } from '../engine/catalog';
import { countRecovered, findPhotorec, macVolumes, photorecScan, sortRecovered, windowsVolumes } from '../engine/recover';

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const root = path.join(__dirname, '..', '..');
  const photo = path.join(root, 'test', 'fixtures', 'photo.jpg');
  // On the Mac, root may not create disk images in the runner's own temporary folder.
  const tmp = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'mk-recover-'));
  const out = path.join(tmp, 'Recovered files');
  const pr = findPhotorec(process.platform, process.env as Record<string, string>);
  if (!pr) fail('PhotoRec was not found where MendKit looks for it');
  console.log(`PhotoRec: ${pr}`);
  let vol = { device: '', partition: 'partition_none' };
  let cleanup = () => undefined as unknown;

  if (process.platform === 'win32') {
    const vhd = path.join(tmp, 'card.vhd');
    const script = path.join(tmp, 'make.txt');
    fs.writeFileSync(script, `create vdisk file="${vhd}" maximum=64 type=fixed\nselect vdisk file="${vhd}"\nattach vdisk\ncreate partition primary\nformat fs=fat32 quick label=CARD\nassign letter=R\n`);
    console.log(execFileSync('diskpart.exe', ['/s', script], { encoding: 'utf8' }).split('\n').slice(-4).join(' '));
    // Write the photo through to the disk before deleting it, as happens when a file has been there a while.
    // Windows wipes a deleted file's data on a virtual disk at once (as on an SSD), so instead put the photo's
    // bytes straight into the free space of the detached disk image: what a deleted photo on a card leaves.
    fs.writeFileSync(script, `select vdisk file="${vhd}"\ndetach vdisk\n`);
    execFileSync('diskpart.exe', ['/s', script]);
    const img = fs.openSync(vhd, 'r+');
    fs.writeSync(img, fs.readFileSync(photo), 0, fs.statSync(photo).size, 40 * 1024 * 1024);
    fs.closeSync(img);
    fs.writeFileSync(script, `select vdisk file="${vhd}"\nattach vdisk\n`);
    console.log(spawnSync('diskpart.exe', ['/s', script], { encoding: 'utf8' }).stdout.split('\n').slice(-3).join(' '));
    // Windows usually gives the volume its letter back by itself.
    for (let i = 0; i < 20 && !fs.existsSync('R:\\'); i++) spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500']);
    if (!fs.existsSync('R:\\')) {
      fs.writeFileSync(script, `select vdisk file="${vhd}"\nselect partition 1\nassign letter=R\n`);
      console.log(spawnSync('diskpart.exe', ['/s', script], { encoding: 'utf8' }).stdout.split('\n').slice(-4).join(' '));
    }
    const vols = windowsVolumes(spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'definitions', 'scripts', 'windows-volumes.ps1')], { encoding: 'utf8' }).stdout.trim(), process.env.SystemDrive);
    console.log(`volumes: ${vols.map((v) => `${v.mount} ${v.fs} ${v.removable ? 'removable' : 'fixed'}${v.system ? ' system' : ''}${v.internalSsd ? ' ssd' : ''}`).join('; ')}`);
    const card = vols.find((v) => v.mount === 'R:\\');
    if (!card || !/FAT32/i.test(card.fs) || !vols.some((v) => v.system)) fail('the volume list is missing the test drive or the system drive');
    vol = card;
    cleanup = () => {
      fs.writeFileSync(script, `select vdisk file="${vhd}"\ndetach vdisk\n`);
      spawnSync('diskpart.exe', ['/s', script]);
    };
    const places = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'definitions', 'scripts', 'windows-recover-places.ps1')], { encoding: 'utf8' }).stdout.trim();
    const p = JSON.parse(places);
    if (typeof p.bin !== 'number' || !('shadows' in p)) fail(`recover places output wrong: ${places}`);
    console.log(`places: Recycle Bin ${p.bin} items, ${[].concat(p.shadows ?? []).length} shadow copies, File History ${p.fileHistory}`);
  } else {
    const dmg = path.join(tmp, 'card.dmg');
    // This runs as the signed-in user, as a person would; only the search runs as root, through sudo.
    const asUser = (args: string[]) => execFileSync('hdiutil', args, { encoding: 'utf8' });
    asUser(['create', '-size', '64m', '-fs', 'MS-DOS FAT32', '-volname', 'CARD', '-layout', 'NONE', dmg]);
    const att = asUser(['attach', dmg]);
    const m = /^(\/dev\/disk\d+)\s+.*?(\/Volumes\/\S+)/m.exec(att);
    if (!m) fail(`disk image did not attach: ${att}`);
    fs.copyFileSync(photo, path.join(m[2], 'holiday.jpg'));
    fs.unlinkSync(path.join(m[2], 'holiday.jpg'));
    execFileSync('sync');
    vol = { device: m[1].replace('/dev/', '/dev/r'), partition: 'partition_none' };
    cleanup = () => spawnSync('hdiutil', ['detach', m[1], '-force']);
    const list = spawnSync('sh', ['-c', 'diskutil list -plist external physical | plutil -convert json -o - -'], { encoding: 'utf8' }).stdout;
    JSON.parse(list);
    console.log(`external drives: ${macVolumes(list).length}`);
  }

  const owner = process.platform === 'win32' ? { uid: 0, gid: 0 } : { uid: process.getuid!(), gid: process.getgid!() };
  const scan = photorecScan(process.platform, pr, vol, out, ['photos', 'documents'], false, 'CARD', owner);
  // On the Mac the search goes through a root shell, as in MendKit (there it asks for the password; here sudo needs none).
  const engine = new Engine(loadCatalog(path.join(root, 'definitions'), process.platform === 'win32' ? 'win32' : 'darwin'), tmp, process.platform === 'win32' ? undefined : () => spawn('sudo', ['-n', '/bin/sh', '-s'], { stdio: 'pipe' }));
  engine.on('event', (e: any) => e.type === 'output' && process.stdout.write(e.text));
  const s = await engine.runSteps('recover-check', 'Recover deleted files', 'command', [scan], { elevated: process.platform === 'win32' });
  const st = s.steps[0];
  console.log(`\nresult: ${st.status}, ${st.friendly?.level}: ${st.friendly?.message}`);
  const n = countRecovered(out);
  const sorted = sortRecovered(out);
  cleanup();
  if (n < 1) {
    // Show what PhotoRec itself says, to see why nothing came back.
    const walk = (d: string): string[] => { try { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])); } catch { return []; } };
    console.log(`files in the results folder: ${walk(out).join(', ') || 'none'}`);
    const direct = spawnSync(pr, ['/log', '/d', path.join(tmp, 'direct', 'recup_dir'), '/cmd', vol.device, `${vol.partition},options,keep_corrupted_file_no,fileopt,everything,disable,jpg,enable,wholespace,search`], { cwd: tmp, encoding: 'utf8', timeout: 120000, env: { ...process.env, TERM: 'dumb' } });
    console.log(`direct run: status ${direct.status} ${direct.error ?? ''}\n${String(direct.stdout).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ' ').slice(-1500)}\n${direct.stderr}`);
    if (process.platform === 'win32') {
      // Is the photo's data on the disk at all? Look for its first bytes in the raw disk.
      try {
        const head = fs.readFileSync(photo).subarray(0, 64);
        const raw = fs.openSync(vol.device, 'r');
        const buf = Buffer.alloc(64 * 1024 * 1024);
        const got = fs.readSync(raw, buf, 0, buf.length, 0);
        fs.closeSync(raw);
        console.log(`raw disk: read ${got} bytes, photo data ${buf.subarray(0, got).indexOf(head) >= 0 ? 'present' : 'NOT present'} at ${buf.subarray(0, got).indexOf(head)}`);
      } catch (e) {
        console.log(`raw disk read failed: ${(e as Error).message}`);
      }
    }
    console.log(`direct found ${countRecovered(path.join(tmp, 'direct'))}; log: ${(() => { try { return fs.readFileSync(path.join(tmp, 'photorec.log'), 'utf8').slice(-2000); } catch { return 'none'; } })()}`);
  }
  if (st.status !== 'ok' || n < 1 || !(sorted.Photos >= 1)) fail(`the deleted photo was not recovered (found ${n}, sorted ${JSON.stringify(sorted)}). photorec.log: ${(() => { try { return fs.readFileSync(path.join(out, 'photorec.log'), 'utf8').slice(-1500); } catch { return 'none'; } })()}`);
  const back = fs.readdirSync(path.join(out, 'Photos')).map((f) => fs.statSync(path.join(out, 'Photos', f)).size);
  console.log(`recovered: ${JSON.stringify(sorted)}, photo sizes ${back.join(', ')} (original ${fs.statSync(photo).size})`);
  if (!back.includes(fs.statSync(photo).size)) fail('the recovered photo is not the same size as the original');
  console.log('recover check passed');
}
main().catch((e) => fail(String(e?.stack ?? e)));
