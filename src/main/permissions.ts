import { app, ipcMain, Notification, shell, systemPreferences } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isElevated } from './system';

/**
 * Permissions setup: checks what the system lets MendKit do, asks where the system allows an app to ask,
 * and opens the exact settings page where it does not. Shown once after install, and any time from the menu.
 */

export type PermState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'not-needed';
export interface Permission {
  id: string;
  name: string;
  why: string;
  state: PermState;
  /** Required for MendKit to work fully; optional ones only affect one feature. */
  required: boolean;
  /** An Allow button can show the system prompt directly. */
  canAsk: boolean;
  /** Has a settings page to open. */
  canOpen: boolean;
  help: string;
  stateText: string;
}

const run = (cmd: string, args: string[], timeout = 15000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` })));

const MAC_PANES: Record<string, string> = {
  'full-disk': 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  notifications: 'x-apple.systempreferences:com.apple.preference.notifications',
  admin: 'x-apple.systempreferences:com.apple.Users-Groups-Settings.extension',
};
const WIN_PANES: Record<string, string> = {
  camera: 'ms-settings:privacy-webcam',
  microphone: 'ms-settings:privacy-microphone',
  notifications: 'ms-settings:notifications',
};

/** Full Disk Access cannot be queried; reading a file only it unlocks is the standard test. */
export function hasFullDiskAccess(home = os.homedir()): PermState {
  const probes = [path.join(home, 'Library/Application Support/com.apple.TCC/TCC.db'), path.join(home, 'Library/Safari/Bookmarks.plist'), '/Library/Application Support/com.apple.TCC/TCC.db'];
  let sawDenied = false;
  for (const p of probes) {
    try {
      fs.closeSync(fs.openSync(p, 'r'));
      return 'granted';
    } catch (e: any) {
      if (e?.code === 'EPERM' || e?.code === 'EACCES') sawDenied = true;
    }
  }
  return sawDenied ? 'denied' : 'unknown';
}

const mediaState = (kind: 'camera' | 'microphone'): PermState => {
  try {
    const s = systemPreferences.getMediaAccessStatus(kind);
    return s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : s === 'restricted' ? 'restricted' : s === 'not-determined' ? 'not-determined' : 'unknown';
  } catch {
    return 'unknown';
  }
};

/** Windows keeps a system switch, a per-user switch and a separate switch for desktop (non-Store) apps. */
async function winConsent(cap: 'webcam' | 'microphone'): Promise<PermState> {
  const base = `\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\${cap}`;
  for (const key of [`HKLM${base}`, `HKCU${base}`, `HKCU${base}\\NonPackaged`]) {
    const r = await run('reg.exe', ['query', key, '/v', 'Value']);
    if (/Value\s+REG_SZ\s+Deny/i.test(r.out)) return 'denied';
  }
  return 'granted';
}

function stateText(p: Pick<Permission, 'state' | 'id'>): string {
  switch (p.state) {
    case 'granted':
      return p.id === 'admin' ? 'Yes' : 'Allowed';
    case 'denied':
      return p.id === 'admin' ? 'No' : 'Not allowed';
    case 'not-determined':
      return 'Not asked yet';
    case 'restricted':
      return 'Blocked by a management profile';
    case 'not-needed':
      return p.id === 'camera' ? 'No camera found' : 'Not needed here';
    default:
      return 'Unknown until first use';
  }
}

export function registerPermissions(): { needsSetup: () => Promise<boolean> } {
  const plat = process.platform;
  const seenFile = path.join(app.getPath('userData'), 'permissions-seen.json');
  let automation: PermState = 'unknown';

  const list = async (): Promise<Permission[]> => {
    const out: Omit<Permission, 'stateText'>[] = [];
    if (plat === 'darwin') {
      const admin = /\badmin\b/.test((await run('id', ['-Gn'])).out);
      out.push(
        {
          id: 'full-disk',
          name: 'Full Disk Access',
          why: 'Lets MendKit read and repair the whole Mac: moving files to a new computer, clearing the Trash and old device backups, reading crash and shutdown records, and the Safari and accessibility tweaks.',
          state: hasFullDiskAccess(),
          required: true,
          canAsk: false,
          canOpen: true,
          help: 'macOS does not let apps ask for this. Click Open Settings, then turn on MendKit. If MendKit is not in the list, click + (or drag MendKit in from the Finder window that opens) and choose MendKit in Applications. When macOS offers "Quit & Reopen", choose it.',
        },
        {
          id: 'admin',
          name: 'Administrator account',
          why: 'System repairs ask for an administrator\'s password. MendKit never stores it.',
          state: admin ? 'granted' : 'denied',
          required: false,
          canAsk: false,
          canOpen: !admin,
          help: admin ? '' : 'This account is a standard user. Repairs that change the system will ask for the name and password of an administrator on this Mac. To make this account an administrator, open Users & Groups.',
        },
        {
          id: 'camera',
          name: 'Camera',
          why: 'Used only by the camera test in Hardware Tests.',
          state: mediaState('camera'),
          required: false,
          canAsk: true,
          canOpen: true,
          help: 'Click Allow and choose OK in the macOS message. If it was refused before, turn MendKit on in Settings instead.',
        },
        {
          id: 'microphone',
          name: 'Microphone',
          why: 'Used only by the microphone test in Hardware Tests.',
          state: mediaState('microphone'),
          required: false,
          canAsk: true,
          canOpen: true,
          help: 'Click Allow and choose OK in the macOS message. If it was refused before, turn MendKit on in Settings instead.',
        },
        {
          id: 'automation',
          name: 'Control System Events',
          why: 'Lets MendKit list and remove login items (the apps that open when you sign in).',
          state: automation,
          required: false,
          canAsk: true,
          canOpen: true,
          help: 'Click Allow and choose OK when macOS asks whether MendKit may control System Events.',
        },
        {
          id: 'notifications',
          name: 'Notifications',
          why: 'Tells you when scheduled maintenance finds something that needs attention.',
          state: 'unknown',
          required: false,
          canAsk: true,
          canOpen: true,
          help: 'Click Allow to send a test notification. If it does not appear, turn on notifications for MendKit in Settings.',
        },
      );
    } else if (plat === 'win32') {
      out.push(
        {
          id: 'admin',
          name: 'Running as administrator',
          why: 'Most repairs change system files and settings, which Windows only allows an administrator to do.',
          state: isElevated() ? 'granted' : 'denied',
          required: true,
          canAsk: !isElevated(),
          canOpen: false,
          help: 'Click Allow to restart MendKit as administrator and choose Yes when Windows asks.',
        },
        {
          id: 'camera',
          name: 'Camera',
          why: 'Used only by the camera test in Hardware Tests.',
          state: mediaState('camera') === 'denied' ? 'denied' : await winConsent('webcam'),
          required: false,
          canAsk: false,
          canOpen: true,
          help: 'In Settings, turn on Camera access and "Let desktop apps access your camera".',
        },
        {
          id: 'microphone',
          name: 'Microphone',
          why: 'Used only by the microphone test in Hardware Tests.',
          state: mediaState('microphone') === 'denied' ? 'denied' : await winConsent('microphone'),
          required: false,
          canAsk: false,
          canOpen: true,
          help: 'In Settings, turn on Microphone access and "Let desktop apps access your microphone".',
        },
        {
          id: 'notifications',
          name: 'Notifications',
          why: 'Tells you when scheduled maintenance finds something that needs attention.',
          state: 'unknown',
          required: false,
          canAsk: true,
          canOpen: true,
          help: 'Click Allow to send a test notification. If it does not appear, turn notifications on in Settings.',
        },
      );
    } else {
      const pk = (await run('sh', ['-c', 'command -v pkexec || command -v sudo'])).ok;
      const cams = fs.existsSync('/dev') ? fs.readdirSync('/dev').filter((n) => /^video\d+$/.test(n)) : [];
      let camState: PermState = cams.length ? 'granted' : 'not-needed';
      for (const c of cams) {
        try {
          fs.accessSync(`/dev/${c}`, fs.constants.R_OK | fs.constants.W_OK);
        } catch {
          camState = 'denied';
        }
      }
      out.push(
        {
          id: 'admin',
          name: 'Password prompt for repairs',
          why: 'System repairs run through pkexec or sudo and ask for your password once.',
          state: pk ? 'granted' : 'denied',
          required: true,
          canAsk: false,
          canOpen: false,
          help: 'Install polkit (pkexec) or sudo with your package manager.',
        },
        {
          id: 'camera',
          name: 'Camera',
          why: 'Used only by the camera test in Hardware Tests.',
          state: camState,
          required: false,
          canAsk: false,
          canOpen: false,
          help: camState === 'denied' ? 'Add your account to the video group (sudo usermod -aG video $USER), then sign out and back in.' : '',
        },
      );
    }
    return out.map((p) => ({ ...p, stateText: stateText(p) }));
  };

  const needsSetup = async (): Promise<boolean> => {
    if (process.env.MENDKIT_TEST_PERMS === 'skip') return false;
    try {
      if (JSON.parse(fs.readFileSync(seenFile, 'utf8')).seen) return false;
    } catch {
      /* first run */
    }
    return true;
  };

  ipcMain.handle('perm-list', () => list());
  ipcMain.handle('perm-needs-setup', () => needsSetup());
  ipcMain.handle('perm-done', () => fs.writeFileSync(seenFile, JSON.stringify({ seen: true, at: new Date().toISOString(), version: app.getVersion() })));
  ipcMain.handle('perm-open', (_e, id: string) => {
    const url = (plat === 'darwin' ? MAC_PANES : plat === 'win32' ? WIN_PANES : {})[String(id)];
    if (!url) throw new Error('No settings page for that permission');
    if (plat === 'darwin' && id === 'full-disk') {
      // Shows MendKit in the Finder so it can be dragged into the list.
      const bundle = process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, '');
      if (bundle.endsWith('.app')) shell.showItemInFolder(bundle);
    }
    return shell.openExternal(url);
  });
  ipcMain.handle('perm-ask', async (_e, id: string) => {
    if (id === 'camera' || id === 'microphone') {
      if (plat !== 'darwin') throw new Error('Windows does not let apps ask. Open Settings instead.');
      await systemPreferences.askForMediaAccess(id);
    } else if (id === 'automation' && plat === 'darwin') {
      const r = await run('osascript', ['-e', 'tell application "System Events" to get the name of every login item'], 60000);
      automation = r.ok ? 'granted' : /-1743|not allowed|not authori[sz]ed/i.test(r.out) ? 'denied' : 'unknown';
    } else if (id === 'notifications') {
      if (!Notification.isSupported()) throw new Error('This system does not support notifications.');
      new Notification({ title: 'MendKit', body: 'Notifications are working. You will hear from MendKit when scheduled maintenance needs you.' }).show();
    } else throw new Error('That permission cannot be asked for from here.');
    return list();
  });
  ipcMain.handle('perm-restart', () => {
    app.relaunch();
    app.exit(0);
  });

  return { needsSetup };
}
