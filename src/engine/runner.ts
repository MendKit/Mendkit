import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { Catalog, CommandDef, EngineEvent, PackageManager, RecipeStep, RunKind, RunOptions, RunSummary, StepResult, StepStatus, ToolDef } from './types';

function expandEnv(s: string): string {
  return s.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

/** Turns a step's raw result into a plain-language line for the Simple mode results screen. */
export function friendlyFor(def: CommandDef, status: StepStatus, output: string): StepResult['friendly'] {
  const f = def.friendly;
  const title = f?.title ?? def.name;
  if (status === 'needs-admin') return { level: 'skipped', title, message: 'Skipped. This step needs MendKit to be restarted as administrator.' };
  if (status === 'cancelled') return { level: 'skipped', title, message: 'Cancelled before it finished.' };
  if (status === 'error') return { level: 'skipped', title, message: 'This step is not available on this computer.' };
  for (const n of f?.notes ?? []) {
    const m = new RegExp(n.pattern, 'i').exec(output);
    if (m) return { level: n.level, title, message: n.message.replace(/\$(\d)/g, (_x, d) => (m[Number(d)] ?? '').trim()) };
  }
  if (status === 'ok') return { level: 'good', title, message: f?.ok ?? 'Completed.' };
  return { level: 'problem', title, message: f?.problem ?? 'This step reported a problem.' };
}

export type StepAction = (write: (text: string) => void) => Promise<{ ok: boolean; note?: string }>;

interface Item {
  def: CommandDef;
  step: RecipeStep;
  /** When set, this function runs instead of the command line in def. */
  action?: StepAction;
}

/** A built-in step that is not a command line (a registry tweak, for example). */
export interface ActionStep {
  id: string;
  name: string;
  admin: boolean;
  ok: string;
  problem: string;
  action: StepAction;
  /** Plain-language results picked from what the step wrote, as for commands. */
  notes?: NonNullable<CommandDef['friendly']>['notes'];
}

/**
 * Runs commands from the catalog, one at a time, in order.
 * It only accepts command, recipe and tool ids, never free-form command lines.
 */
export class Engine extends EventEmitter {
  private child: ChildProcess | null = null;
  private cancelled = false;
  private busy = false;

  /**
   * @param privSpawn On macOS and Linux, starts a root shell (pkexec or sudo) for steps that need administrator rights.
   */
  constructor(private catalog: Catalog, private logDir: string, private privSpawn?: () => ChildProcess) {
    super();
    fs.mkdirSync(logDir, { recursive: true });
  }

  isBusy(): boolean {
    return this.busy;
  }

  runRecipe(recipeId: string, opts: RunOptions): Promise<RunSummary> {
    const recipe = this.catalog.recipes.find((r) => r.id === recipeId);
    if (!recipe) throw new Error(`Unknown recipe "${recipeId}"`);
    const items = (recipe.steps[this.catalog.platform] ?? []).map((step) => ({ step, def: this.catalog.commands.get(step.command)! }));
    return this.run(recipe.id, recipe.name, 'recipe', items, opts);
  }

  /** Runs several existing catalog commands in order, carrying on past any that fail. */
  runCommands(id: string, title: string, commandIds: string[], opts: RunOptions): Promise<RunSummary> {
    const items: Item[] = commandIds.map((cid) => {
      const def = this.catalog.commands.get(cid);
      if (!def) throw new Error(`Unknown command "${cid}"`);
      return { def, step: { command: cid, onFail: 'continue' as const } };
    });
    return this.run(id, title, 'recipe', items, opts);
  }

  runCommand(commandId: string, opts: RunOptions): Promise<RunSummary> {
    const def = this.catalog.commands.get(commandId);
    if (!def) throw new Error(`Unknown command "${commandId}"`);
    return this.run(def.id, def.name, 'command', [{ def, step: { command: def.id } }], opts);
  }

  /** Installs or removes a catalog tool through the system package manager. */
  runTool(toolId: string, action: 'install' | 'remove', opts: RunOptions): Promise<RunSummary> {
    const tool = this.catalog.tools.find((t) => t.id === toolId);
    if (!tool) throw new Error(`Unknown tool "${toolId}"`);
    const def = toolCommand(tool, action, this.catalog.manager);
    return this.run(def.id, def.name, 'tool', [{ def, step: { command: def.id } }], opts);
  }

  /** Reinstalls the apps listed in a winget export file that arrived from another computer. */
  runAppImport(file: string, opts: RunOptions): Promise<RunSummary> {
    const def: CommandDef = {
      id: 'reinstall-apps',
      name: 'Reinstall apps',
      description: 'Installs the apps from the other computer through winget.',
      exec: 'winget.exe',
      args: ['import', '-i', file, '--accept-package-agreements', '--accept-source-agreements', '--ignore-unavailable', '--disable-interactivity'],
      admin: false,
      typicalMinutes: 20,
      friendly: {
        title: 'Apps from the other computer',
        ok: 'The apps that winget knows were reinstalled. Apps it does not know need installing by hand.',
        problem: 'Some apps could not be reinstalled. The log lists which ones.',
      },
    };
    return this.run(def.id, def.name, 'tool', [{ def, step: { command: def.id } }], opts);
  }

  /** Runs a mixed list of command definitions and built-in steps as one job, carrying on past any that fail. */
  runSteps(id: string, title: string, kind: RunKind, steps: (CommandDef | ActionStep)[], opts: RunOptions): Promise<RunSummary> {
    const items: Item[] = steps.map((s) =>
      'action' in s
        ? { def: { id: s.id, name: s.name, description: '', exec: '', args: [], admin: s.admin, friendly: { title: s.name, ok: s.ok, problem: s.problem, notes: s.notes } }, step: { command: s.id, onFail: 'continue' as const }, action: s.action }
        : { def: s, step: { command: s.id, onFail: 'continue' as const } },
    );
    return this.run(id, title, kind, items, opts);
  }

  /** Installs several catalog tools in one run, carrying on past any that fail. */
  runToolInstalls(toolIds: string[], opts: RunOptions): Promise<RunSummary> {
    const items: Item[] = toolIds.map((id) => {
      const tool = this.catalog.tools.find((t) => t.id === id);
      if (!tool) throw new Error(`Unknown tool "${id}"`);
      const def = toolCommand(tool, 'install', this.catalog.manager);
      return { def, step: { command: def.id, onFail: 'continue' as const } };
    });
    return this.run('install-tools', `Install ${items.length} tools`, 'tool', items, opts);
  }

  /** Installs a list of apps, one step each, carrying on past any that fail. */
  runAppInstalls(installs: { name: string; manager: PackageManager; pkg: string }[], opts: RunOptions): Promise<RunSummary> {
    const items: Item[] = installs.map((i, n) => {
      const def = toolCommand({ id: `app-${n}`, name: i.name, job: '', description: '', license: 'free', packages: { [i.manager]: i.pkg } }, 'install', i.manager);
      return { def, step: { command: def.id, onFail: 'continue' as const } };
    });
    return this.run('reinstall-apps', 'Reinstall apps', 'tool', items, opts);
  }

  /** Runs built-in steps through the same logging, progress and results path as commands. */
  runActions(id: string, title: string, kind: RunKind, steps: ActionStep[], opts: RunOptions): Promise<RunSummary> {
    const items: Item[] = steps.map((s) => ({
      def: { id: s.id, name: s.name, description: '', exec: '', args: [], admin: s.admin, friendly: { title: s.name, ok: s.ok, problem: s.problem, notes: s.notes } },
      step: { command: s.id },
      action: s.action,
    }));
    return this.run(id, title, kind, items, opts);
  }

  cancel(): void {
    this.cancelled = true;
    const child = this.child;
    if (!child || child.pid === undefined) return;
    if (process.platform === 'win32') {
      spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  }

  private send(e: EngineEvent): void {
    this.emit('event', e);
  }

  private async run(id: string, title: string, kind: RunKind, items: Item[], opts: RunOptions): Promise<RunSummary> {
    if (this.busy) throw new Error('Another job is already running');
    this.busy = true;
    this.cancelled = false;
    const started = new Date();
    const base = path.join(this.logDir, `${stamp(started)}_${id}`);
    const logFile = `${base}.log`;
    const log = fs.createWriteStream(logFile, { encoding: 'utf8' });
    let stepOutput = '';
    const write = (text: string) => {
      log.write(text);
      stepOutput = (stepOutput + text).slice(-40000);
      this.send({ type: 'output', text });
    };

    this.send({ type: 'run-start', title, steps: items.map((i) => ({ command: i.def.id, name: i.def.name, minutes: i.def.typicalMinutes ?? 1 })) });
    write(`MendKit ${kind}: ${title}\nStarted ${started.toLocaleString()}\n`);

    const results: StepResult[] = [];
    let shell: PrivilegedShell | null = null;
    let shellRefused = false;
    let outcome: RunSummary['outcome'] = 'completed';
    let stopReason: string | undefined;
    let needsRestart = false;

    try {
      for (let i = 0; i < items.length; i++) {
        const { def, step, action } = items[i];
        if (this.cancelled) {
          outcome = 'cancelled';
          break;
        }
        this.send({ type: 'step-start', index: i, command: def.id, name: def.name });
        write(`\n===== ${i + 1}/${items.length} ${def.name} =====\n`);
        stepOutput = '';

        let raw: Omit<StepResult, 'friendly'>;
        let viaShell: Omit<StepResult, 'friendly'> | null = null;
        if (def.admin && !opts.elevated && !action && this.privSpawn && !shellRefused && !opts.noPrompt) {
          // macOS and Linux: ask for the password once, then run this and later admin steps in one root shell.
          if (!shell) {
            write('Asking for administrator rights...\n');
            shell = new PrivilegedShell(this.privSpawn());
            if ((await shell.run(':', [], write)) !== 0) {
              shellRefused = true;
              shell = null;
            }
          }
          if (shell) viaShell = await this.execPrivileged(shell, def, write);
          if (viaShell === null && shell) {
            shellRefused = true;
            shell = null;
          }
        }
        if (viaShell) {
          raw = viaShell;
        } else if (def.admin && !opts.elevated) {
          raw = { command: def.id, name: def.name, status: 'needs-admin', exitCode: null, seconds: 0, note: 'Needs administrator rights' };
          write('Skipped: this step needs administrator rights.\n');
        } else {
          raw = action ? await this.act(def, action, write) : await this.exec(def, write);
        }
        const result: StepResult = { ...raw, friendly: friendlyFor(def, raw.status, stepOutput) };
        results.push(result);
        this.send({ type: 'step-end', index: i, result });
        write(`Result: ${result.status}${result.exitCode !== null ? ` (exit code ${result.exitCode})` : ''}${result.note ? ` - ${result.note}` : ''}\n`);

        if (result.status === 'cancelled') {
          outcome = 'cancelled';
          break;
        }
        if (result.status === 'ok') {
          if (def.needsRestart) needsRestart = true;
          continue;
        }
        const overridden = step.gate && step.overridable && opts.overrideGates;
        if ((step.gate && !overridden) || (!step.gate && step.onFail !== 'continue' && kind === 'recipe')) {
          outcome = 'stopped';
          stopReason = `${def.name}: ${result.note ?? result.status}`;
          write(`\nStopped: ${stopReason}\n`);
          break;
        }
      }
    } finally {
      shell?.close();
      this.busy = false;
      this.child = null;
    }

    const levels = results.map((r) => r.friendly.level);
    const overall: RunSummary['overall'] =
      outcome === 'stopped' || levels.includes('problem') ? 'problem' : levels.includes('attention') || levels.includes('skipped') ? 'attention' : 'good';
    const finished = new Date();
    const summary: RunSummary = {
      id,
      title,
      kind,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      outcome,
      overall,
      stopReason,
      needsRestart,
      steps: results,
      logFile,
    };
    write(`\nFinished ${finished.toLocaleString()} - ${outcome}${needsRestart ? ' - restart needed' : ''}\n`);
    await new Promise<void>((resolve) => log.end(resolve));
    fs.writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
    this.send({ type: 'run-end', summary });
    return summary;
  }

  private async execPrivileged(shell: PrivilegedShell, def: CommandDef, write: (t: string) => void): Promise<Omit<StepResult, 'friendly'> | null> {
    const t0 = Date.now();
    const code = await shell.run(expandEnv(def.exec), def.args.map(expandEnv), write);
    if (code === null) return null;
    const seconds = Math.round((Date.now() - t0) / 1000);
    const base = { command: def.id, name: def.name, exitCode: code, seconds };
    if (this.cancelled) return { ...base, status: 'cancelled' };
    if (code === 127) return { ...base, status: 'error', note: 'Program not found on this computer' };
    const ok = (def.okExitCodes ?? [0]).includes(code);
    return { ...base, status: ok ? 'ok' : 'failed', note: ok ? undefined : def.exitNotes?.[String(code)] ?? `Exit code ${code}` };
  }

  private async act(def: CommandDef, action: StepAction, write: (t: string) => void): Promise<Omit<StepResult, 'friendly'>> {
    const t0 = Date.now();
    let ok = false;
    let note: string | undefined;
    try {
      ({ ok, note } = await action(write));
    } catch (err) {
      note = (err as Error).message;
    }
    if (!ok && note) write(`${note}\n`);
    return { command: def.id, name: def.name, status: ok ? 'ok' : 'failed', exitCode: null, note, seconds: Math.round((Date.now() - t0) / 1000) };
  }

  private exec(def: CommandDef, write: (t: string) => void): Promise<Omit<StepResult, 'friendly'>> {
    const t0 = Date.now();
    const done = (status: StepStatus, exitCode: number | null, note?: string) => ({
      command: def.id,
      name: def.name,
      status,
      exitCode,
      note,
      seconds: Math.round((Date.now() - t0) / 1000),
    });
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        // No stdin: a tool that stops to ask a question gets end-of-file instead of waiting for ever.
        child = spawn(expandEnv(def.exec), def.args.map(expandEnv), { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        resolve(done('error', null, (err as Error).message));
        return;
      }
      this.child = child;
      let timedOut = false;
      const timer = def.timeoutMinutes
        ? setTimeout(() => {
            timedOut = true;
            write(`\nStopped: no result after ${def.timeoutMinutes} minutes.\n`);
            if (process.platform === 'win32' && child.pid !== undefined) spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
            else child.kill('SIGKILL');
          }, def.timeoutMinutes * 60000)
        : null;
      // Some Windows tools (sfc) print UTF-16; dropping NUL bytes makes that readable.
      const onData = (buf: Buffer) => write(buf.toString('utf8').replace(/\u0000/g, ''));
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (timer) clearTimeout(timer);
        const note = err.code === 'ENOENT' ? 'Program not found on this computer' : err.message;
        write(`Could not start: ${note}\n`);
        resolve(done('error', null, note));
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (this.cancelled) return resolve(done('cancelled', code));
        if (timedOut) return resolve(done('failed', code, `Took longer than ${def.timeoutMinutes} minutes and was stopped`));
        const ok = (def.okExitCodes ?? [0]).includes(code ?? -1);
        resolve(done(ok ? 'ok' : 'failed', code, ok ? undefined : def.exitNotes?.[String(code)] ?? `Exit code ${code}`));
      });
    });
  }
}

const NONINTERACTIVE = ['env', 'DEBIAN_FRONTEND=noninteractive'];

/** Builds the package-manager command for a tool. The package name comes only from the catalog file. */
export function toolCommand(tool: ToolDef, action: 'install' | 'remove', manager: PackageManager | null = 'winget'): CommandDef {
  const pkg = manager ? tool.packages[manager] : undefined;
  if (!manager || !pkg) throw new Error(`Tool "${tool.id}" has no package for this system`);
  const install = action === 'install';
  const cask = pkg.startsWith('cask:');
  const name = cask ? pkg.slice(5) : pkg;
  const lines: Record<PackageManager, string[]> = {
    winget: install
      ? ['winget.exe', 'install', '--id', name, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity']
      : ['winget.exe', 'uninstall', '--id', name, '-e', '--silent', '--disable-interactivity'],
    brew: ['brew', install ? 'install' : 'uninstall', ...(cask ? ['--cask'] : []), name],
    apt: [...NONINTERACTIVE, 'apt-get', '-y', install ? 'install' : 'remove', name],
    dnf: ['dnf', '-y', install ? 'install' : 'remove', name],
    pacman: ['pacman', install ? '-S' : '-R', '--noconfirm', name],
    zypper: ['zypper', '--non-interactive', install ? 'install' : 'remove', name],
    flatpak: install ? ['flatpak', 'install', '-y', '--noninteractive', 'flathub', name] : ['flatpak', 'uninstall', '-y', '--noninteractive', name],
  };
  let [exec, ...args] = lines[manager];
  if (manager === 'winget' && install) {
    // winget fails in two common ways that a retry fixes: a package that only installs per user refuses an
    // elevated MendKit (install it for all users instead), and a stale catalog points at a download the
    // publisher has replaced (refresh the catalog, then try again).
    const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
    const script = [
      `$a = @(${args.map(q).join(', ')})`,
      '$out = & winget.exe @a 2>&1 | Out-String; $code = $LASTEXITCODE; $out',
      "if ($code -ne 0 -and $out -match 'administrator context|user scope|0x8A15007D|0x8A150056') {",
      "  'MK_RETRY_MACHINE: installing it for all users instead...'",
      "  $out = & winget.exe @a --scope machine 2>&1 | Out-String; $code = $LASTEXITCODE; $out",
      '}',
      "if ($code -ne 0 -and $out -match '404|Not found|0x80190194|hash does not match|0x8A150011') {",
      "  'MK_RETRY_SOURCE: refreshing the winget catalog and trying again...'",
      '  winget.exe source update --disable-interactivity 2>&1 | Out-String',
      '  $out = & winget.exe @a 2>&1 | Out-String; $code = $LASTEXITCODE; $out',
      "  if ($code -ne 0 -and $out -match '404|Not found|0x80190194') { 'MK_GONE' }",
      '}',
      'exit $code',
    ].join('\n');
    exec = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-Command', script];
  }
  return {
    id: `${action}-${tool.id}`,
    name: `${install ? 'Install' : 'Remove'} ${tool.name}`,
    description: tool.description,
    exec,
    args,
    // winget and brew ask for rights themselves; the Linux package managers must run as root.
    admin: manager !== 'winget' && manager !== 'brew' && manager !== 'flatpak',
    typicalMinutes: 3,
    friendly: {
      title: tool.name,
      ok: install ? `${tool.name} was installed.` : `${tool.name} was removed.`,
      problem: install ? `${tool.name} could not be installed.` : `${tool.name} could not be removed.`,
      notes: install
        ? [
            { pattern: 'already installed|is already the newest|No newer package versions', level: 'good', message: `${tool.name} is already installed.` },
            { pattern: 'MK_GONE', level: 'problem', message: `The publisher has removed the download that winget's catalog lists for ${tool.name}, and the catalog has not caught up yet. Try again in a day or two, or download it from the publisher's website.` },
          ]
        : [],
    },
  };
}

/** The command that exits 0 when a tool is installed. */
export function toolCheckCommand(tool: ToolDef, manager: PackageManager): string[] {
  const pkg = tool.packages[manager]!;
  const cask = pkg.startsWith('cask:');
  const name = cask ? pkg.slice(5) : pkg;
  switch (manager) {
    case 'winget':
      return ['winget.exe', 'list', '--id', name, '-e', '--accept-source-agreements', '--disable-interactivity'];
    case 'brew':
      return ['brew', 'list', ...(cask ? ['--cask'] : ['--formula']), name];
    case 'apt':
      return ['dpkg', '-s', name];
    case 'pacman':
      return ['pacman', '-Q', name];
    case 'flatpak':
      return ['flatpak', 'info', name];
    default:
      return ['rpm', '-q', name];
  }
}

/** Commands that together list every installed package for a package manager (winget is handled by an export file instead). */
export function installedListCommands(manager: PackageManager): string[][] {
  switch (manager) {
    case 'brew':
      return [['brew', 'list', '--formula', '-1'], ['brew', 'list', '--cask', '-1']];
    case 'apt':
      return [['dpkg-query', '-W', '-f=${Package} ${db:Status-Status}\n']];
    case 'pacman':
      return [['pacman', '-Qq']];
    case 'flatpak':
      return [['flatpak', 'list', '--app', '--columns=application']];
    case 'dnf':
    case 'zypper':
      return [['rpm', '-qa', '--qf', '%{NAME}\n']];
    default:
      return [];
  }
}

/** Which catalog tools are installed, given the output of each command from installedListCommands (or winget package ids). */
export function installedTools(tools: ToolDef[], manager: PackageManager, outputs: string[]): string[] {
  const names = new Set<string>();
  outputs.forEach((out, i) => {
    for (const raw of out.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (manager === 'apt') {
        const [name, status] = line.split(' ');
        if (status === 'installed') names.add(name.toLowerCase());
      } else names.add((manager === 'brew' && i === 1 ? 'cask:' : '') + line.toLowerCase());
    }
  });
  return tools
    .filter((t) => {
      const pkg = t.packages[manager]?.toLowerCase();
      if (!pkg) return false;
      // "GIMP.GIMP.3" still means GIMP: a winget id matches exactly or as a dotted prefix.
      return names.has(pkg) || (manager === 'winget' && [...names].some((n) => n.startsWith(pkg + '.')));
    })
    .map((t) => t.id);
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * One root shell for the length of a run on macOS and Linux, so the user is asked for their
 * password once instead of once per step. Only catalog command lines are ever written to it.
 */
export class PrivilegedShell {
  private buf = '';
  private dead = false;
  private wake: (() => void) | null = null;
  private readonly marker = `__MENDKIT_${Math.random().toString(36).slice(2)}__`;

  constructor(private child: ChildProcess) {
    const onData = (d: Buffer) => {
      this.buf += d.toString('utf8');
      this.wake?.();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const end = () => {
      this.dead = true;
      this.wake?.();
    };
    child.on('close', end);
    child.on('error', end);
    child.stdin?.on('error', end);
  }

  /** Runs one command line as root. Resolves to its exit code, or null if the shell is gone (password refused). */
  async run(exec: string, args: string[], write: (t: string) => void): Promise<number | null> {
    if (this.dead) return null;
    const line = [exec, ...args].map(shq).join(' ');
    this.child.stdin?.write(`${line} </dev/null 2>&1; printf '\\n${this.marker} %d\\n' $?\n`);
    const re = new RegExp(`\\n?${this.marker} (\\d+)\\n`);
    for (;;) {
      const m = re.exec(this.buf);
      if (m) {
        if (m.index > 0) write(this.buf.slice(0, m.index) + '\n');
        this.buf = this.buf.slice(m.index + m[0].length);
        return Number(m[1]);
      }
      // Pass output along as it arrives, keeping back enough to recognise the marker.
      const keep = this.marker.length + 8;
      if (this.buf.length > keep) {
        write(this.buf.slice(0, this.buf.length - keep));
        this.buf = this.buf.slice(this.buf.length - keep);
      }
      if (this.dead) {
        if (this.buf.trim()) write(this.buf);
        this.buf = '';
        return null;
      }
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }

  close(): void {
    try {
      this.child.stdin?.end();
    } catch {
      /* already closed */
    }
  }
}
