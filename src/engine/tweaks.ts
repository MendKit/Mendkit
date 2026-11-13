import { execFile } from 'child_process';
import * as fs from 'fs';
import { ActionStep } from './runner';

export interface RegValue {
  exists: boolean;
  type?: string;
  data?: string;
}

/** The registry operations tweaks need. The real one calls reg.exe; tests use an in-memory one. */
export interface RegBackend {
  get(path: string, name: string): Promise<RegValue>;
  set(path: string, name: string, type: string, data: string): Promise<void>;
  del(path: string, name: string): Promise<void>;
  delKey(path: string): Promise<void>;
  run(cmd: string[]): Promise<void>;
}

export interface TweakEntry {
  path: string;
  /** Value name; an empty string means the key's default value. */
  name: string;
  /** REG_DWORD or REG_SZ on Windows; bool, int, float or string on macOS; unused for gsettings. */
  type: string;
  /** Data when the tweak is on. */
  on: string;
  /** Windows default data, or null when the value does not exist by default. */
  off: string | null;
  /** When turning off, delete this whole key instead of the value. */
  deleteKeyOnOff?: string;
}

export interface TweakDef {
  id: string;
  name: string;
  description: string;
  group: string;
  admin: boolean;
  needsSignOut?: boolean;
  entries: TweakEntry[];
  /** Entries are only used to detect the state; the commands make the change. */
  detectOnly?: boolean;
  applyCmd?: string[];
  revertCmd?: string[];
}

export interface TweakPreset {
  id: string;
  name: string;
  description: string;
  tweaks: string[];
}

type Journal = Record<string, { appliedAt: string; entries: { path: string; name: string; prev: RegValue }[] }>;

const norm = (type: string | undefined, data: string | undefined): string => {
  if (data === undefined) return '';
  if (type === 'REG_DWORD' || type === 'int' || type === 'float') return String(Number(data));
  if (type === 'bool') return /^(1|true|yes)$/i.test(data.trim()) ? '1' : '0';
  return data.trim();
};

function reg(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}` });
    });
  });
}

const valueArgs = (name: string) => (name === '' ? ['/ve'] : ['/v', name]);

export const windowsRegistry: RegBackend = {
  async get(path, name) {
    const r = await reg(['query', path, ...valueArgs(name)]);
    if (r.code !== 0) return { exists: false };
    const m = /^\s{4}(.+?)\s{4}(REG_\w+)(?:\s{4}(.*))?$/m.exec(r.out.replace(/\r/g, ''));
    if (!m) return { exists: false };
    return { exists: true, type: m[2], data: m[3] ?? '' };
  },
  async set(path, name, type, data) {
    // An empty default value is created with /ve and /f alone; reg.exe rejects an empty /d argument.
    const args = name === '' && data === '' ? ['add', path, '/ve', '/f'] : ['add', path, ...valueArgs(name), '/t', type, '/d', data, '/f'];
    const r = await reg(args);
    if (r.code !== 0) throw new Error(r.out.trim() || `Could not write ${path}`);
  },
  async del(path, name) {
    await reg(['delete', path, ...valueArgs(name), '/f']);
  },
  async delKey(path) {
    await reg(['delete', path, '/f']);
  },
  run(cmd) {
    return new Promise((resolve, reject) => {
      execFile(cmd[0], cmd.slice(1), { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => (err ? reject(new Error(`${stdout}${stderr}`.trim() || err.message)) : resolve()));
    });
  },
};

function tool(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: `${stdout}${stderr}` }));
  });
}
const runCmd = (cmd: string[]): Promise<void> => new Promise((resolve) => execFile(cmd[0], cmd.slice(1), { timeout: 60000 }, () => resolve()));

/** An in-memory stand-in for the registry, used by tests. */
export function memoryRegistry(): RegBackend {
  const values = new Map<string, { type: string; data: string }>();
  const k = (p: string, n: string) => `${p}\\${n}`;
  return {
    async get(p, n) {
      const v = values.get(k(p, n));
      return v ? { exists: true, ...v } : { exists: false };
    },
    async set(p, n, type, data) {
      values.set(k(p, n), { type, data });
    },
    async del(p, n) {
      values.delete(k(p, n));
    },
    async delKey(p) {
      for (const key of [...values.keys()]) if (key.startsWith(p)) values.delete(key);
    },
    async run() {
      /* nothing to run */
    },
  };
}

/** macOS: "path" is the defaults domain and "name" is the key. */
export const macDefaults: RegBackend = {
  async get(domain, key) {
    const r = await tool('defaults', ['read', domain, key]);
    return r.code === 0 ? { exists: true, data: r.out.trim() } : { exists: false };
  },
  async set(domain, key, type, data) {
    const r = await tool('defaults', ['write', domain, key, `-${type}`, data]);
    if (r.code !== 0) throw new Error(r.out.trim() || `Could not write ${domain} ${key}`);
  },
  async del(domain, key) {
    await tool('defaults', ['delete', domain, key]);
  },
  async delKey() {
    /* not used on macOS */
  },
  run: runCmd,
};

/** GNOME: "path" is the schema and "name" is the key; values are written the way gsettings prints them. */
export const gsettings: RegBackend = {
  async get(schema, key) {
    const r = await tool('gsettings', ['get', schema, key]);
    return r.code === 0 ? { exists: true, data: r.out.trim() } : { exists: false };
  },
  async set(schema, key, _type, data) {
    const r = await tool('gsettings', ['set', schema, key, data]);
    if (r.code !== 0) throw new Error(r.out.trim() || `Could not set ${schema} ${key}`);
  },
  async del(schema, key) {
    await tool('gsettings', ['reset', schema, key]);
  },
  async delKey() {
    /* not used with gsettings */
  },
  run: runCmd,
};

/** Reads tweak states, applies and reverts tweaks, and keeps a journal of the previous values for undo. */
export class TweakManager {
  constructor(public readonly defs: TweakDef[], private backend: RegBackend, private journalFile: string) {}

  private journal(): Journal {
    try {
      return JSON.parse(fs.readFileSync(this.journalFile, 'utf8')) as Journal;
    } catch {
      return {};
    }
  }

  private saveJournal(j: Journal): void {
    fs.writeFileSync(this.journalFile, JSON.stringify(j, null, 2));
  }

  /** Ids of tweaks MendKit itself turned on and can put back exactly. */
  journalIds(): string[] {
    return Object.keys(this.journal());
  }

  /** Tweaks MendKit turned on, with when it did so. */
  journalEntries(): { id: string; name: string; appliedAt: string }[] {
    return Object.entries(this.journal()).map(([id, j]) => ({ id, name: this.defs.find((d) => d.id === id)?.name ?? id, appliedAt: j.appliedAt }));
  }

  async isOn(def: TweakDef): Promise<boolean> {
    for (const e of def.entries) {
      const v = await this.backend.get(e.path, e.name);
      if (!v.exists || norm(v.type, v.data) !== norm(e.type, e.on)) return false;
    }
    return def.entries.length > 0;
  }

  async status(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const d of this.defs) out[d.id] = await this.isOn(d);
    return out;
  }

  /** Builds the engine step that turns a tweak on or off. */
  step(id: string, on: boolean): ActionStep {
    const def = this.defs.find((d) => d.id === id);
    if (!def) throw new Error(`Unknown tweak "${id}"`);
    return {
      id: `${on ? 'on' : 'off'}-${def.id}`,
      name: `${def.name}: ${on ? 'turn on' : 'turn off'}`,
      admin: def.admin,
      ok: on ? 'Turned on.' : 'Put back the way it was.',
      problem: 'This setting could not be changed. Windows may be protecting it.',
      action: async (write) => {
        if (on) await this.apply(def, write);
        else await this.revert(def, write);
        const now = await this.isOn(def);
        return now === on ? { ok: true } : { ok: false, note: 'The setting did not change' };
      },
    };
  }

  private async apply(def: TweakDef, write: (t: string) => void): Promise<void> {
    const j = this.journal();
    if (!j[def.id]) {
      const entries = [];
      for (const e of def.entries) entries.push({ path: e.path, name: e.name, prev: await this.backend.get(e.path, e.name) });
      j[def.id] = { appliedAt: new Date().toISOString(), entries };
      this.saveJournal(j);
    }
    if (!def.detectOnly) {
      for (const e of def.entries) {
        write(`set ${e.path}\\${e.name || '(Default)'} = ${e.on}\n`);
        await this.backend.set(e.path, e.name, e.type, e.on);
      }
    }
    if (def.applyCmd) {
      write(`run ${def.applyCmd.join(' ')}\n`);
      await this.backend.run(def.applyCmd);
    }
  }

  private async revert(def: TweakDef, write: (t: string) => void): Promise<void> {
    const j = this.journal();
    const saved = j[def.id];
    if (!def.detectOnly) {
      for (const e of def.entries) {
        const prev = saved?.entries.find((x) => x.path === e.path && x.name === e.name)?.prev;
        // Use what was there before MendKit changed it; otherwise fall back to the Windows default.
        const target: RegValue = prev ?? (e.off === null ? { exists: false } : { exists: true, type: e.type, data: e.off });
        if (target.exists) {
          write(`restore ${e.path}\\${e.name || '(Default)'} = ${target.data}\n`);
          await this.backend.set(e.path, e.name, target.type ?? e.type, target.data ?? '');
        } else if (e.deleteKeyOnOff) {
          write(`delete key ${e.deleteKeyOnOff}\n`);
          await this.backend.delKey(e.deleteKeyOnOff);
        } else {
          write(`delete ${e.path}\\${e.name || '(Default)'}\n`);
          await this.backend.del(e.path, e.name);
        }
      }
    }
    if (def.revertCmd) {
      write(`run ${def.revertCmd.join(' ')}\n`);
      await this.backend.run(def.revertCmd);
    }
    delete j[def.id];
    this.saveJournal(j);
  }
}

export function loadTweaks(definitionsDir: string, platform: string = 'win32'): { tweaks: TweakDef[]; presets: TweakPreset[] } {
  const file = `${definitionsDir}/tweaks.${platform}.json`;
  const tweaks = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as TweakDef[]) : [];
  const rawPresets = JSON.parse(fs.readFileSync(`${definitionsDir}/tweak-presets.json`, 'utf8')) as (Omit<TweakPreset, 'tweaks'> & { tweaks: Record<string, string[]> })[];
  const ids = new Set<string>();
  for (const t of tweaks) {
    if (!t.id || !t.name || !Array.isArray(t.entries) || t.entries.length === 0) throw new Error(`Bad tweak definition: ${JSON.stringify(t)}`);
    if (ids.has(t.id)) throw new Error(`Duplicate tweak id "${t.id}"`);
    if (platform === 'win32') for (const e of t.entries) if (!/^HK(CU|LM)\\/.test(e.path)) throw new Error(`Tweak "${t.id}" has a bad registry path`);
    ids.add(t.id);
  }
  const presets: TweakPreset[] = [];
  for (const p of rawPresets) {
    const list = p.tweaks[platform] ?? [];
    for (const id of list) if (!ids.has(id)) throw new Error(`Preset "${p.id}" uses unknown ${platform} tweak "${id}"`);
    if (list.length) presets.push({ ...p, tweaks: list });
  }
  return { tweaks, presets };
}
