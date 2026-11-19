export type Platform = 'win32' | 'darwin' | 'linux';
export type Level = 'good' | 'info' | 'attention' | 'problem' | 'skipped';

export interface FriendlyDef {
  /** Plain-language name for the step. */
  title: string;
  /** Shown when the step succeeded. */
  ok: string;
  /** Shown when the step failed. */
  problem: string;
  /** If the output matches a pattern, its message and level win. First match is used; $1 is the first capture group. */
  notes?: { pattern: string; level: Level; message: string }[];
}

export interface CommandDef {
  id: string;
  name: string;
  description: string;
  exec: string;
  args: string[];
  admin: boolean;
  /** A program that must be installed for this command to exist on this computer (apt-get, brew, ...). */
  requires?: string;
  heavy?: boolean;
  needsRestart?: boolean;
  typicalMinutes?: number;
  /** Stop the command and count it as failed if it runs longer than this. */
  timeoutMinutes?: number;
  okExitCodes?: number[];
  exitNotes?: Record<string, string>;
  friendly?: FriendlyDef;
}

export interface RecipeStep {
  command: string;
  onFail?: 'stop' | 'continue';
  /** A gate that fails stops the whole recipe. */
  gate?: boolean;
  /** Only overridable gates can be skipped, and only in Technician mode. */
  overridable?: boolean;
}

export interface RecipeDef {
  id: string;
  name: string;
  description: string;
  simpleMode: boolean;
  steps: Partial<Record<Platform, RecipeStep[]>>;
}

export interface ToolDef {
  id: string;
  name: string;
  job: string;
  description: string;
  license: 'open-source' | 'free';
  homeUseOnly?: boolean;
  /** Package name per package manager. A brew name starting with "cask:" is a cask. */
  packages: Partial<Record<PackageManager, string>>;
  /**
   * Windows: the publisher's own zip, used when winget cannot install the tool (Sysinternals replaces its
   * downloads in place, so winget's recorded checksum goes stale). The exe must be signed by the publisher.
   */
  windowsZip?: { url: string; exe: string };
  /**
   * Windows: the publisher's download page, used when winget's catalog points at a removed file. The newest
   * installer linked there (link is a pattern for its file name) is downloaded, its signature checked against
   * signer, and run with the silent-install args.
   */
  windowsDownload?: { sources: { page: string; base: string; suffix?: string }[]; link: string; signer: string; args: string };
}

export type PackageManager = 'winget' | 'brew' | 'apt' | 'dnf' | 'pacman' | 'zypper' | 'flatpak';

export interface Catalog {
  platform: Platform;
  /** The package manager found on this computer, if any. */
  manager: PackageManager | null;
  commands: Map<string, CommandDef>;
  recipes: RecipeDef[];
  tools: ToolDef[];
}

export type StepStatus = 'ok' | 'failed' | 'error' | 'needs-admin' | 'skipped' | 'cancelled';

export interface StepResult {
  command: string;
  name: string;
  status: StepStatus;
  exitCode: number | null;
  note?: string;
  seconds: number;
  /** Plain-language result for the Simple mode results screen. */
  friendly: { level: Level; title: string; message: string };
}

export interface RunOptions {
  elevated: boolean;
  overrideGates?: boolean;
  /** Unattended runs: never show a password prompt; steps that need one are skipped. */
  noPrompt?: boolean;
}

export type RunKind = 'recipe' | 'command' | 'tool' | 'tweak' | 'migrate';

export interface RunSummary {
  id: string;
  title: string;
  kind: RunKind;
  startedAt: string;
  finishedAt: string;
  outcome: 'completed' | 'stopped' | 'cancelled';
  overall: 'good' | 'attention' | 'problem';
  stopReason?: string;
  needsRestart: boolean;
  steps: StepResult[];
  logFile: string;
}

export type EngineEvent =
  | { type: 'run-start'; title: string; steps: { command: string; name: string; minutes: number }[] }
  | { type: 'step-start'; index: number; command: string; name: string }
  | { type: 'output'; text: string }
  | { type: 'step-end'; index: number; result: StepResult }
  | { type: 'run-end'; summary: RunSummary };
