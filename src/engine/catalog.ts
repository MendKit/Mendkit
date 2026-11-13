import * as fs from 'fs';
import * as path from 'path';
import { Catalog, CommandDef, PackageManager, Platform, RecipeDef, ToolDef } from './types';

export const PLATFORMS: Platform[] = ['win32', 'darwin', 'linux'];

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/** True when a program can be found on the PATH. */
export function onPath(program: string): boolean {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, program + ext), fs.constants.X_OK);
        return true;
      } catch {
        /* keep looking */
      }
    }
  }
  return false;
}

const MANAGERS: Record<Platform, [PackageManager, string][]> = {
  win32: [['winget', 'winget']],
  darwin: [['brew', 'brew']],
  linux: [
    ['apt', 'apt-get'],
    ['dnf', 'dnf'],
    ['pacman', 'pacman'],
    ['zypper', 'zypper'],
  ],
};

/**
 * Loads the command, recipe and tool definitions for one platform and checks them.
 * Commands whose `requires` program is missing are left out, along with their recipe steps,
 * so one Linux pack covers every distro family. Pass `has = () => true` to validate everything.
 */
export function loadCatalog(definitionsDir: string, platform: Platform, has: (program: string) => boolean = onPath): Catalog {
  const list = readJson<CommandDef[]>(path.join(definitionsDir, `commands.${platform}.json`));
  const commands = new Map<string, CommandDef>();
  const known = new Set<string>();
  for (const c of list) {
    if (!c.id || !c.exec || !Array.isArray(c.args)) throw new Error(`Bad command definition: ${JSON.stringify(c)}`);
    if (known.has(c.id)) throw new Error(`Duplicate command id "${c.id}" for ${platform}`);
    for (const n of c.friendly?.notes ?? []) new RegExp(n.pattern); // throws on a bad pattern
    known.add(c.id);
    if (!c.requires || has(c.requires)) commands.set(c.id, c);
  }
  const all = readJson<RecipeDef[]>(path.join(definitionsDir, 'recipes.json'));
  const recipes: RecipeDef[] = [];
  for (const r of all) {
    const steps = r.steps[platform] ?? [];
    for (const s of steps) if (!known.has(s.command)) throw new Error(`Recipe "${r.id}" uses unknown ${platform} command "${s.command}"`);
    const usable = steps.filter((s) => commands.has(s.command));
    if (usable.length) recipes.push({ ...r, steps: { ...r.steps, [platform]: usable } });
  }
  const allTools = readJson<ToolDef[]>(path.join(definitionsDir, 'tools.json'));
  const seen = new Set<string>();
  for (const t of allTools) {
    if (!t.id || !t.name || !t.packages) throw new Error(`Bad tool definition: ${JSON.stringify(t)}`);
    if (seen.has(t.id)) throw new Error(`Duplicate tool id "${t.id}"`);
    for (const pkg of Object.values(t.packages)) if (!/^(cask:)?[A-Za-z0-9.+_-]+$/.test(pkg ?? '')) throw new Error(`Bad package name for tool "${t.id}"`);
    seen.add(t.id);
  }
  // winget ships with Windows, so it is assumed there; elsewhere the first manager found is used.
  const manager = platform === 'win32' ? 'winget' : (MANAGERS[platform].find(([, bin]) => has(bin))?.[0] ?? null);
  const tools = manager ? allTools.filter((t) => t.packages[manager]) : [];
  return { platform, manager, commands, recipes, tools };
}

export function currentPlatform(): Platform {
  const p = process.platform;
  if (p === 'win32' || p === 'darwin' || p === 'linux') return p;
  throw new Error(`Unsupported platform: ${p}`);
}
