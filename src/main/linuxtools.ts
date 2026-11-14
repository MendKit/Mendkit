import { app, ipcMain, shell } from 'electron';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { eolState, linuxEol, parseOsRelease } from '../engine/eol';
import { ActionStep, Engine } from '../engine/runner';
import { CommandDef, RunSummary } from '../engine/types';
import { isElevated } from './system';

/**
 * Linux-only tools that need a choice from the person before anything changes:
 * startup items, free up space, boot repair from a live USB, and upgrading to the next release.
 */

const sh = (c: string, timeout = 60000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile('sh', ['-c', c], { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` })));
const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
const human = (b: number): string => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
const du = async (p: string): Promise<number> => (fs.existsSync(p) ? (parseInt((await sh(`du -sk ${q(p)} 2>/dev/null`, 120000)).out, 10) || 0) * 1024 : 0);
const cmd = (id: string, name: string, script: string, ok: string, problem: string, admin = true, minutes = 1): CommandDef => ({ id, name, description: '', exec: 'sh', args: ['-c', script], admin, typicalMinutes: minutes, friendly: { title: name, ok, problem } });

/** Services that make the system work. They are listed for information but cannot be ticked. */
const ESSENTIAL = /^(systemd-|dbus|NetworkManager|network|wpa_supplicant|iwd|gdm|lightdm|sddm|display-manager|getty@|polkit|accounts-daemon|udisks2|upower|rtkit|apparmor|selinux|auditd|firewalld|ufw|cron|cronie|anacron|rsyslog|syslog|bluetooth|cups|avahi|ModemManager|thermald|power-profiles-daemon|tuned|switcheroo|snapd|lvm2|dm-event|multipathd|blk-availability|grub|plymouth|kerneloops|console-setup|keyboard-setup|setvtrgb|irqbalance|smartd|smartmontools|fwupd|packagekit|unattended-upgrades|dnf-makecache|e2scrub|fstrim|logrotate|man-db|chronyd|chrony|ntp|openvpn|nvidia-|alsa-|pipewire|wireplumber|pulseaudio|xdg-|gnome-|cinnamon|plasma|kde|xfce|at-spi|colord|geoclue|fprintd|switcheroo-control|whoopsie|apport|zram|swap|ssh|sshd|snap\.)/i;

interface StartupItem {
  id: string;
  kind: 'autostart' | 'user-service' | 'system-service';
  name: string;
  detail: string;
  file?: string;
  unit?: string;
  essential: boolean;
}

export function registerLinuxTools(ctx: { engine: Engine }): void {
  const { engine } = ctx;
  const linux = process.platform === 'linux';
  const home = os.homedir();
  const opts = () => ({ elevated: isElevated() });
  const journal = path.join(app.getPath('userData'), 'linux-startup-off.json');
  const readJournal = (): { id: string; kind: string; name: string; unit?: string; file?: string; when: string }[] => {
    try {
      return JSON.parse(fs.readFileSync(journal, 'utf8'));
    } catch {
      return [];
    }
  };
  const notLinux = () => {
    throw new Error('This tool is for Linux.');
  };

  // ---------- Startup items ----------
  let startup: StartupItem[] = [];
  ipcMain.handle('linux-startup-scan', async () => {
    if (!linux) notLinux();
    const items: StartupItem[] = [];
    const desk = (process.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase();
    const readDesktop = (f: string) => {
      const t = fs.readFileSync(f, 'utf8');
      const get = (k: string) => new RegExp(`^${k}=(.*)$`, 'm').exec(t)?.[1]?.trim() ?? '';
      return { name: get('Name') || path.basename(f), exec: get('Exec'), hidden: /^(Hidden=true|X-GNOME-Autostart-enabled=false)$/m.test(t), only: get('OnlyShowIn').toLowerCase(), not: get('NotShowIn').toLowerCase() };
    };
    const userDir = path.join(home, '.config/autostart');
    const seen = new Set<string>();
    for (const dir of [userDir, '/etc/xdg/autostart']) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir).filter((n) => n.endsWith('.desktop'));
      } catch {
        continue;
      }
      for (const n of names) {
        if (seen.has(n)) continue;
        seen.add(n);
        const d = readDesktop(path.join(dir, n));
        if (d.hidden) continue;
        // Skip entries meant for other desktops: they never start here.
        if (d.only && !d.only.split(';').some((x) => x && desk.includes(x))) continue;
        if (d.not && d.not.split(';').some((x) => x && desk.includes(x))) continue;
        items.push({ id: `a${items.length}`, kind: 'autostart', name: d.name, detail: `Runs ${d.exec || 'a program'} when you sign in${dir === userDir ? '' : ' (installed for everyone)'}`, file: n, essential: dir !== userDir && /^(org\.gnome|gnome-|cinnamon-|xfce4-|xfsettingsd|polkit|at-spi|pulseaudio|pipewire|nm-applet|mintupdate|update-notifier|xdg-user-dirs|geoclue|spice-vdagent|org\.kde|kde|plasma|baloo|im-launch|snap-userd|user-dirs)/i.test(n) },);
      }
    }
    const enabled = async (scope: string) => (await sh(`systemctl ${scope} list-unit-files --type=service --state=enabled --no-legend --no-pager 2>/dev/null`)).out.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((u) => u && u.endsWith('.service'));
    for (const [scope, kind] of [['--user', 'user-service'], ['', 'system-service']] as const) {
      for (const unit of await enabled(scope)) {
        const show = (await sh(`systemctl ${scope} show -p Description -p ExecStart -p FragmentPath ${q(unit)} 2>/dev/null`)).out;
        const desc = /^Description=(.*)$/m.exec(show)?.[1] ?? '';
        const exe = /path=([^ ;]+)/.exec(show)?.[1] ?? '';
        items.push({ id: `s${items.length}`, kind, unit, name: desc || unit, detail: `${unit}${exe ? `, runs ${exe}` : ''}${kind === 'user-service' ? ', for your account' : ', for the whole computer'}`, essential: ESSENTIAL.test(unit) || /^\/(usr\/)?lib\/systemd\//.test(exe) });
      }
    }
    const cron = (await sh('crontab -l 2>/dev/null | grep -v "^#" | grep .')).out.trim();
    startup = items;
    return { items, cron: cron ? cron.split('\n') : [], off: readJournal() };
  });

  ipcMain.handle('linux-startup-off', async (_e, ids: string[]): Promise<RunSummary> => {
    if (!linux) notLinux();
    const pick = startup.filter((s) => ids.includes(s.id) && !s.essential);
    if (!pick.length) throw new Error('Nothing that can be turned off was selected.');
    const steps: (CommandDef | ActionStep)[] = pick.map((s) => {
      const record = () => fs.writeFileSync(journal, JSON.stringify([...readJournal().filter((j) => j.id !== `${s.kind}:${s.unit ?? s.file}`), { id: `${s.kind}:${s.unit ?? s.file}`, kind: s.kind, name: s.name, unit: s.unit, file: s.file, when: new Date().toISOString() }], null, 2));
      if (s.kind === 'autostart')
        return {
          id: `off-${s.id}`, name: `Stop ${s.name} starting`, admin: false, ok: `${s.name} will not start when you sign in.`, problem: `${s.name} could not be turned off.`,
          action: async (write: (t: string) => void) => {
            // The standard way: a copy in your own autostart folder marked Hidden overrides the system one.
            const dir = path.join(home, '.config/autostart');
            fs.mkdirSync(dir, { recursive: true });
            const mine = path.join(dir, s.file!);
            const src = fs.existsSync(mine) ? mine : path.join('/etc/xdg/autostart', s.file!);
            const text = fs.readFileSync(src, 'utf8').replace(/^Hidden=.*$/m, '');
            fs.writeFileSync(mine, text.replace(/\n*$/, '\nHidden=true\n'));
            write(`Marked ${mine} as hidden\n`);
            record();
            return { ok: true };
          },
        } as ActionStep;
      const user = s.kind === 'user-service';
      return cmd(`off-${s.id}`, `Stop ${s.name} starting`, `systemctl ${user ? '--user ' : ''}disable --now ${q(s.unit!)} && echo DISABLED`, `${s.name} is stopped and will not start again.`, `${s.name} could not be turned off.`, !user);
    });
    const summary = await engine.runSteps('linux-startup', 'Turn off startup items', 'command', steps, opts());
    // Services turned off as root are recorded once the run shows them disabled.
    for (const s of pick.filter((p) => p.kind !== 'autostart')) {
      const r = await sh(`systemctl ${s.kind === 'user-service' ? '--user ' : ''}is-enabled ${q(s.unit!)} 2>/dev/null`);
      if (!/^enabled/.test(r.out.trim())) fs.writeFileSync(journal, JSON.stringify([...readJournal().filter((j) => j.id !== `${s.kind}:${s.unit}`), { id: `${s.kind}:${s.unit}`, kind: s.kind, name: s.name, unit: s.unit, when: new Date().toISOString() }], null, 2));
    }
    return summary;
  });

  ipcMain.handle('linux-startup-on', async (_e, id: string): Promise<RunSummary> => {
    const j = readJournal().find((x) => x.id === id);
    if (!j) throw new Error('MendKit did not turn that off.');
    let step: CommandDef | ActionStep;
    if (j.kind === 'autostart') {
      step = {
        id: 'on', name: `Start ${j.name} again`, admin: false, ok: `${j.name} will start when you sign in again.`, problem: 'It could not be turned back on.',
        action: async () => {
          const mine = path.join(home, '.config/autostart', j.file!);
          if (fs.existsSync(path.join('/etc/xdg/autostart', j.file!))) fs.rmSync(mine, { force: true });
          else fs.writeFileSync(mine, fs.readFileSync(mine, 'utf8').replace(/^Hidden=true\n?/m, ''));
          return { ok: true };
        },
      };
    } else step = cmd('on', `Start ${j.name} again`, `systemctl ${j.kind === 'user-service' ? '--user ' : ''}enable --now ${q(j.unit!)}`, `${j.name} is running and will start again.`, 'It could not be turned back on.', j.kind !== 'user-service');
    const s = await engine.runSteps('linux-startup-on', `Turn ${j.name} back on`, 'command', [step], opts());
    if (s.steps.every((x) => x.status === 'ok')) fs.writeFileSync(journal, JSON.stringify(readJournal().filter((x) => x.id !== id), null, 2));
    return s;
  });

  // ---------- Free up space ----------
  interface SpaceItem {
    id: string;
    name: string;
    detail: string;
    bytes: number | null;
    preset: boolean;
    step: CommandDef | ActionStep;
  }
  let space: SpaceItem[] = [];
  const emptyFolder = (id: string, name: string, dir: string): ActionStep => ({
    id, name: `Delete ${name}`, admin: false, ok: `${name}: deleted.`, problem: `${name} could not be fully deleted.`,
    action: async (write) => {
      let failed = 0;
      for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        try {
          fs.rmSync(path.join(dir, n), { recursive: true, force: true });
        } catch {
          failed++;
        }
      }
      write(`emptied ${dir}${failed ? `, ${failed} items in use` : ''}\n`);
      return { ok: true };
    },
  });
  ipcMain.handle('linux-space-scan', async () => {
    if (!linux) notLinux();
    const has = async (b: string) => (await sh(`command -v ${b}`)).ok;
    const items: SpaceItem[] = [];
    const add = (i: SpaceItem) => {
      if (i.bytes === null || i.bytes > 1024 * 1024) items.push(i);
    };
    add({ id: 'cache', name: 'App caches', detail: 'Temporary files apps rebuild by themselves, including thumbnails.', bytes: await du(path.join(home, '.cache')), preset: true, step: emptyFolder('space-cache', 'App caches', path.join(home, '.cache')) });
    const trash = path.join(home, '.local/share/Trash');
    add({ id: 'trash', name: 'Trash', detail: 'Files already in the Trash.', bytes: (await du(path.join(trash, 'files'))) + (await du(path.join(trash, 'info'))), preset: false, step: { ...emptyFolder('space-trash', 'Trash', path.join(trash, 'files')), action: async (w) => { await emptyFolder('x', 'Trash', path.join(trash, 'files')).action(w); return emptyFolder('x', 'Trash', path.join(trash, 'info')).action(w); } } });
    const pkgCache = (await has('apt-get')) ? ['/var/cache/apt/archives', 'apt-get clean'] : (await has('dnf')) ? ['/var/cache/dnf', 'dnf clean all'] : (await has('pacman')) ? ['/var/cache/pacman/pkg', 'paccache -rk1 2>/dev/null || pacman -Sc --noconfirm'] : (await has('zypper')) ? ['/var/cache/zypp', 'zypper clean --all'] : null;
    if (pkgCache) add({ id: 'pkgcache', name: 'Downloaded update files', detail: 'Copies of packages already installed. They download again if ever needed.', bytes: await du(pkgCache[0]), preset: true, step: cmd('space-pkgcache', 'Delete downloaded update files', pkgCache[1], 'Downloaded update files were deleted.', 'They could not be deleted.') });
    const jr = /(\d+(\.\d+)?)([KMGT])/.exec((await sh('journalctl --disk-usage 2>/dev/null')).out);
    const jb = jr ? Number(jr[1]) * 1024 ** ' KMGT'.indexOf(jr[3]) : null;
    add({ id: 'journal', name: 'Old system logs', detail: 'Keeps the last 200 MB of logs and deletes the rest.', bytes: jb !== null && jb > 200 * 1024 ** 2 ? jb - 200 * 1024 ** 2 : jb === null ? null : 0, preset: true, step: cmd('space-journal', 'Delete old system logs', 'journalctl --vacuum-size=200M', 'Old system logs were deleted.', 'Old logs could not be deleted.') });
    if (await has('snap')) {
      const disabled = (await sh("LANG=C snap list --all 2>/dev/null | awk '/disabled/{print $1\"_\"$3\".snap\"}'")).out.split('\n').filter(Boolean);
      let b = 0;
      for (const f of disabled) b += fs.existsSync(`/var/lib/snapd/snaps/${f}`) ? fs.statSync(`/var/lib/snapd/snaps/${f}`).size : 0;
      add({ id: 'snaps', name: 'Old Snap versions', detail: `${disabled.length} old copies of Snap apps.`, bytes: b, preset: true, step: cmd('space-snaps', 'Remove old Snap versions', "snap set system refresh.retain=2; LANG=C snap list --all | awk '/disabled/{print $1, $3}' | while read n r; do snap remove \"$n\" --revision=\"$r\"; done", 'Old Snap versions were removed.', 'They could not be removed.', true, 3) });
    }
    const running = (await sh('uname -r')).out.trim();
    if (await has('dpkg')) {
      const old = (await sh(`dpkg -l 'linux-image-[0-9]*' | awk '/^ii/{print $2}' | grep -v ${q(running)}`)).out.split('\n').filter(Boolean);
      if (old.length > 1) add({ id: 'kernels', name: 'Old kernels', detail: `${old.length} older kernels. The running one and the newest spare are kept.`, bytes: null, preset: false, step: cmd('space-kernels', 'Remove old kernels', 'DEBIAN_FRONTEND=noninteractive apt-get autoremove --purge -y', 'Old kernels were removed.', 'They could not be removed.', true, 3) });
    } else if (await has('dnf')) {
      const old = (await sh('dnf repoquery --installonly --latest-limit=-2 -q 2>/dev/null')).out.split('\n').filter(Boolean);
      if (old.length) add({ id: 'kernels', name: 'Old kernels', detail: `${old.length} older kernel packages. The running one and one spare are kept.`, bytes: null, preset: false, step: cmd('space-kernels', 'Remove old kernels', 'dnf remove -y $(dnf repoquery --installonly --latest-limit=-2 -q)', 'Old kernels were removed.', 'They could not be removed.', true, 3) });
    }
    if (await has('flatpak')) add({ id: 'flatpak', name: 'Unused Flatpak parts', detail: 'Runtimes no app uses any more.', bytes: null, preset: true, step: cmd('space-flatpak', 'Remove unused Flatpak parts', 'flatpak uninstall --unused -y --noninteractive; true', 'Unused Flatpak parts were removed.', 'They could not be removed.', true, 3) });
    if (await has('docker')) {
      const df = (await sh("docker system df --format '{{.Reclaimable}}' 2>/dev/null")).out;
      add({ id: 'docker', name: 'Unused Docker data', detail: `Stopped containers, unused images and build cache. Reclaimable: ${df.split('\n').filter(Boolean).join(', ') || 'unknown'}.`, bytes: null, preset: false, step: cmd('space-docker', 'Remove unused Docker data', 'docker system prune -f', 'Unused Docker data was removed.', 'It could not be removed.', true, 3) });
    }
    if (await has('timeshift')) add({ id: 'timeshift', name: 'Older Timeshift snapshots', detail: 'Keeps the newest two snapshots and deletes older ones.', bytes: null, preset: false, step: cmd('space-timeshift', 'Delete older Timeshift snapshots', "timeshift --list --scripted 2>/dev/null | awk '/^[0-9]+ +>/{print $3}' | head -n -2 | while read s; do timeshift --delete --snapshot \"$s\" --scripted; done", 'Older snapshots were deleted.', 'They could not be deleted.', true, 5) });
    const big = await sh(`find ${q(home)} -xdev -type f -size +1G -not -path ${q(home + '/.local/share/Trash/*')} -not -path ${q(home + '/.cache/*')} 2>/dev/null | head -30`, 120000);
    const large = big.out.split('\n').filter((l) => l.startsWith('/')).map((f) => {
      const size = fs.existsSync(f) ? fs.statSync(f).size : 0;
      return { path: f, size, label: `${f.replace(home, '~')} (${human(size)})` };
    }).sort((a, b) => b.size - a.size);
    const df = /\s(\d+)\s+(\d+)\s+(\d+)\s+\d+%/.exec((await sh('df -k /')).out.split('\n')[1] ?? '');
    space = items;
    return { items: items.map(({ step: _s, ...i }) => ({ ...i, size: i.bytes === null ? 'unknown' : human(i.bytes) })), large, free: df ? human(Number(df[3]) * 1024) : null, total: df ? human(Number(df[1]) * 1024) : null };
  });
  ipcMain.handle('linux-space-clean', async (_e, ids: string[]): Promise<RunSummary> => {
    if (!linux) notLinux();
    const pick = space.filter((s) => ids.includes(s.id));
    if (!pick.length) throw new Error('Nothing was selected.');
    return engine.runSteps('linux-space', 'Free up space', 'command', pick.map((p) => p.step), opts());
  });
  ipcMain.handle('linux-reveal', (_e, p: string) => {
    if (typeof p !== 'string' || !p.startsWith(home)) throw new Error('Bad path');
    shell.showItemInFolder(p);
  });

  // ---------- Boot repair (from a live USB) ----------
  ipcMain.handle('linux-boot-info', async () => {
    if (!linux) notLinux();
    const cmdline = fs.existsSync('/proc/cmdline') ? fs.readFileSync('/proc/cmdline', 'utf8') : '';
    const live = /boot=casper|boot=live|rd\.live\.image|archisobasedir|root=live:/.test(cmdline) || /overlay|squashfs/.test((await sh("findmnt -no FSTYPE /")).out);
    const j = JSON.parse((await sh('lsblk -J -o NAME,PATH,SIZE,FSTYPE,LABEL,MOUNTPOINT,TYPE,PKNAME,PARTTYPE')).out || '{"blockdevices":[]}');
    const flat: any[] = [];
    const walk = (list: any[], parent?: any) => {
      for (const d of list ?? []) {
        flat.push({ ...d, disk: parent?.type === 'disk' ? parent.path : d.type === 'disk' ? d.path : parent?.disk });
        walk(d.children, { ...d, disk: parent?.type === 'disk' ? parent.path : d.type === 'disk' ? d.path : parent?.disk });
      }
    };
    walk(j.blockdevices);
    const roots = flat.filter((d) => ['ext4', 'btrfs', 'xfs', 'ext3'].includes(d.fstype) && d.mountpoint !== '/' && !/^\/(cdrom|run\/live|run\/initramfs)/.test(d.mountpoint ?? ''))
      .map((d) => ({ path: d.path, label: `${d.path} ${d.size} ${d.fstype}${d.label ? ` "${d.label}"` : ''}${d.mountpoint ? `, open at ${d.mountpoint}` : ''}`, mounted: !!d.mountpoint }));
    const locked = flat.filter((d) => d.fstype === 'crypto_LUKS' && !(d.children ?? []).length).map((d) => d.path);
    const lvm = flat.some((d) => d.fstype === 'LVM2_member');
    return { live, uefi: fs.existsSync('/sys/firmware/efi'), roots, locked, lvm };
  });
  ipcMain.handle('linux-boot-lvm', async (): Promise<RunSummary> =>
    engine.runSteps('boot-lvm', 'Look for LVM partitions', 'command', [cmd('lvm', 'Look for LVM partitions', 'vgscan; vgchange -ay; lsblk -o NAME,SIZE,FSTYPE', 'LVM partitions were opened. Refresh the list.', 'No LVM partitions could be opened.')], opts()));
  ipcMain.handle('linux-boot-repair', async (_e, root: string, opt: { fsck: boolean; grub: boolean; initramfs: boolean }): Promise<RunSummary> => {
    if (!linux) notLinux();
    if (!/^\/dev\/[\w/.-]+$/.test(String(root))) throw new Error('Bad partition');
    const steps: CommandDef[] = [];
    if (opt.fsck)
      steps.push(cmd('boot-fsck', `Check and repair ${root}`, `umount ${q(root)} 2>/dev/null; t=$(lsblk -no FSTYPE ${q(root)}); case "$t" in ext*) e2fsck -f -y ${q(root)}; r=$?; [ $r -le 1 ] && echo FSCK_OK || { [ $r -le 3 ] && echo FSCK_FIXED; } ;; xfs) xfs_repair ${q(root)} && echo FSCK_OK ;; btrfs) btrfs check --readonly ${q(root)} && echo FSCK_OK ;; esac`, 'The file system was checked and repaired where needed.', 'The file system has damage that could not be repaired. Copy the files off before anything else.', true, 10));
    if (opt.grub || opt.initramfs) {
      const inner = [
        'mount /boot 2>/dev/null; mount /boot/efi 2>/dev/null; true',
        opt.initramfs ? '(command -v update-initramfs >/dev/null && update-initramfs -u -k all) || (command -v dracut >/dev/null && dracut -f --regenerate-all) || (command -v mkinitcpio >/dev/null && mkinitcpio -P)' : 'true',
        opt.grub
          ? `if [ -d /sys/firmware/efi ]; then if command -v dnf >/dev/null; then dnf reinstall -y shim-\\* grub2-efi-\\* grub2-common; else id=$(. /etc/os-release; echo $ID); grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id="$id" --recheck; fi; else d=$(lsblk -no PKNAME ${q(root)} | head -1); (grub-install /dev/$d || grub2-install /dev/$d); fi
if command -v update-grub >/dev/null; then update-grub; elif [ -d /boot/grub2 ]; then grub2-mkconfig -o /boot/grub2/grub.cfg; else grub-mkconfig -o /boot/grub/grub.cfg; fi && echo GRUB_DONE`
          : 'true',
      ].join('\n');
      const script = `set -e; m=/mnt/mendkit-root; mkdir -p $m; umount -R $m 2>/dev/null || true
t=$(lsblk -no FSTYPE ${q(root)})
if [ "$t" = btrfs ]; then mount ${q(root)} $m; sv=$(btrfs subvolume list $m | awk '{print $NF}' | grep -xE '@|root|@root' | head -1); umount $m; if [ -n "$sv" ]; then mount -o subvol=$sv ${q(root)} $m; else mount ${q(root)} $m; fi; else mount ${q(root)} $m; fi
[ -e $m/etc/os-release ] || { echo "NOT_A_SYSTEM: ${root} does not hold an installed Linux system"; umount $m; exit 3; }
echo "SYSTEM: $(. $m/etc/os-release; echo $PRETTY_NAME)"
for d in dev dev/pts proc sys run; do mount --bind /$d $m/$d; done
[ -d /sys/firmware/efi/efivars ] && mount --bind /sys/firmware/efi/efivars $m/sys/firmware/efi/efivars 2>/dev/null || true
cp -L /etc/resolv.conf $m/etc/resolv.conf 2>/dev/null || true
set +e; chroot $m /bin/sh -c ${q(inner)}; r=$?
umount -R $m; exit $r`;
      steps.push(cmd('boot-chroot', 'Repair the startup files of the installed system', script, 'The installed system\'s startup files were repaired. Remove the USB stick and restart.', 'The startup files could not be repaired. The log says which step failed.', true, 10));
    }
    if (!steps.length) throw new Error('Tick at least one repair');
    return engine.runSteps('boot-repair', 'Repair a Linux system that will not start', 'command', steps, opts());
  });

  // ---------- Upgrade to the next release ----------
  const osInfo = () => parseOsRelease(fs.existsSync('/etc/os-release') ? fs.readFileSync('/etc/os-release', 'utf8') : '');
  ipcMain.handle('linux-eol', () => {
    if (!linux) return null;
    const e = linuxEol(osInfo());
    return { ...e, state: eolState(e, new Date()) };
  });
  ipcMain.handle('linux-upgrade-check', async () => {
    if (!linux) notLinux();
    const o = osInfo();
    const id = (o.ID ?? '').toLowerCase();
    const free = parseInt((await sh("df -k / | awk 'NR==2{print $4}'")).out, 10) * 1024 || 0;
    const onBattery = /^Discharging/m.test((await sh('cat /sys/class/power_supply/BAT*/status 2>/dev/null')).out);
    const third = (await sh('ls /etc/apt/sources.list.d/ 2>/dev/null | grep -vE "^(ubuntu|official-package-repositories|official-source-repositories)\\.(list|sources)$"')).out.split('\n').filter(Boolean);
    const snaps = (await sh('timeshift --list --scripted 2>/dev/null | grep -c "^[0-9]" ')).out.trim();
    const pending = id === 'fedora' ? (await sh('dnf check-update -q 2>/dev/null | grep -c "^\\S"')).out.trim() : (await sh("apt list --upgradable 2>/dev/null | grep -c upgradable")).out.trim();
    const e = linuxEol(o);
    const method = id === 'ubuntu' || id === 'pop' ? 'ubuntu' : id === 'linuxmint' ? 'mint' : id === 'fedora' ? 'fedora' : 'manual';
    const checks = [
      { level: free > 15 * 1024 ** 3 ? 'good' : 'problem', text: `${human(free)} free on the system drive. The upgrade needs at least 15 GB.` },
      { level: onBattery ? 'problem' : 'good', text: onBattery ? 'Running on battery. Plug the charger in.' : 'On mains power.' },
      { level: Number(pending) > 0 ? 'attention' : 'good', text: Number(pending) > 0 ? `${pending} updates are waiting. Install them first (Updates screen), then restart.` : 'All updates are installed.' },
      { level: Number(snaps) > 0 ? 'good' : 'attention', text: Number(snaps) > 0 ? `${snaps} Timeshift snapshots exist to roll back to.` : 'No Timeshift snapshot. Take one first (or back up with Migrate), so the upgrade can be undone.' },
      ...(third.length ? [{ level: 'info', text: `Extra software sources will be turned off during the upgrade and need turning back on afterwards: ${third.join(', ')}.` }] : []),
      { level: eolState(e, new Date()) === 'ended' ? 'problem' : 'info', text: e.ends ? `${e.name}: security updates ${eolState(e, new Date()) === 'ended' ? 'ended' : 'end'} on ${new Date(e.ends + 'T12:00:00').toLocaleDateString()}.` : `${e.name}.` },
    ];
    return { name: o.PRETTY_NAME ?? '', method, checks, fedoraNext: id === 'fedora' ? Number(o.VERSION_ID) + 1 : null };
  });
  ipcMain.handle('linux-upgrade-start', async (): Promise<RunSummary | { launched: string }> => {
    if (!linux) notLinux();
    const id = (osInfo().ID ?? '').toLowerCase();
    if (id === 'fedora') {
      const next = Number(osInfo().VERSION_ID) + 1;
      return engine.runSteps('fedora-upgrade', `Upgrade to Fedora ${next}`, 'command', [
        cmd('f-update', 'Install the current updates', 'dnf upgrade -y --refresh', 'Current updates are installed.', 'Updates could not be installed.', true, 10),
        cmd('f-plugin', 'Get the upgrade tool', 'dnf system-upgrade --help >/dev/null 2>&1 || dnf install -y dnf-plugin-system-upgrade', 'The upgrade tool is ready.', 'The upgrade tool could not be installed.', true, 2),
        cmd('f-download', `Download Fedora ${next}`, `dnf system-upgrade download -y --releasever=${next}`, `Fedora ${next} is downloaded. Close your work, then run "Restart and upgrade".`, 'The download failed. The log names the package in the way; remove it and try again.', true, 30),
      ], opts());
    }
    const launch = (c: string, label: string) => {
      spawn('sh', ['-c', c], { detached: true, stdio: 'ignore' }).unref();
      return { launched: label };
    };
    if (id === 'linuxmint') return launch('command -v mintupgrade >/dev/null || pkexec apt-get install -y mintupgrade; mintupgrade', 'The Mint upgrade tool');
    if (id === 'ubuntu' || id === 'pop') {
      const kde = /kde/i.test(process.env.XDG_CURRENT_DESKTOP ?? '');
      return launch(kde ? 'pkexec do-release-upgrade -m desktop -f DistUpgradeViewKDE' : 'update-manager -c', 'The Ubuntu upgrade tool');
    }
    throw new Error('MendKit does not run upgrades for this distribution. Follow its release notes.');
  });
  ipcMain.handle('linux-upgrade-reboot', async (): Promise<RunSummary> =>
    engine.runSteps('fedora-upgrade-reboot', 'Restart and upgrade', 'command', [cmd('f-reboot', 'Restart and upgrade', 'dnf system-upgrade reboot', 'The computer is restarting to upgrade.', 'The upgrade restart could not start.', true, 1)], opts()));
}
