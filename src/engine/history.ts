/**
 * Health history: one snapshot a day of the numbers that drift before something fails (drive errors and wear,
 * free space, battery capacity, crashes), and warnings worked out from how they change over time.
 */

export interface HealthSnapshot {
  /** ISO date and time the snapshot was taken. */
  at: string;
  freeGb: number | null;
  freePercent: number | null;
  driveHealthy: boolean | null;
  /** SSD wear used, 0 to 100. */
  wear: number | null;
  /** Read errors the drive could not correct, since it was made. */
  driveErrors: number | null;
  temperature: number | null;
  batteryPercent: number | null;
  /** Blue screens, kernel panics or unexpected shutdowns in the last 30 days. */
  crashes: number | null;
}

export interface Trend {
  id: string;
  level: 'problem' | 'attention' | 'info';
  title: string;
  message: string;
}

const DAY = 86400000;
const t = (s: HealthSnapshot) => new Date(s.at).getTime();

/** Adds a snapshot, keeping one per day (the newest) and at most the last 400 days. */
export function addSnapshot(history: HealthSnapshot[], snap: HealthSnapshot): HealthSnapshot[] {
  const day = snap.at.slice(0, 10);
  return [...history.filter((h) => h.at.slice(0, 10) !== day), snap].sort((a, b) => t(a) - t(b)).slice(-400);
}

/** Least-squares slope per day of a value over time, or null with fewer than 3 points or less than 7 days. */
export function slopePerDay(points: { at: number; v: number }[]): number | null {
  if (points.length < 3 || points[points.length - 1].at - points[0].at < 7 * DAY) return null;
  const xs = points.map((p) => (p.at - points[0].at) / DAY);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = points.reduce((a, p) => a + p.v, 0) / points.length;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (xs[i] - mx) * (p.v - my);
    den += (xs[i] - mx) ** 2;
  });
  return den ? num / den : null;
}

const series = (h: HealthSnapshot[], key: keyof HealthSnapshot, sinceDays: number, now: number) =>
  h.filter((s) => typeof s[key] === 'number' && now - t(s) <= sinceDays * DAY).map((s) => ({ at: t(s), v: s[key] as number }));

export function healthTrends(history: HealthSnapshot[], now = Date.now()): Trend[] {
  const out: Trend[] = [];
  if (history.length < 2) return out;
  const last = history[history.length - 1];
  const before = history.slice(0, -1);

  // Drive: a newly failing health status, or uncorrected errors that went up.
  if (last.driveHealthy === false && before.some((s) => s.driveHealthy === true))
    out.push({ id: 'drive-failing', level: 'problem', title: 'The drive started reporting a problem', message: 'It was healthy before and is not now. Back up everything today and plan to replace the drive.' });
  const errs = series(history, 'driveErrors', 365, now);
  if (errs.length >= 2 && errs[errs.length - 1].v > errs[0].v)
    out.push({ id: 'drive-errors', level: 'problem', title: 'Drive read errors are going up', message: `The drive failed to read data ${errs[errs.length - 1].v - errs[0].v === 1 ? 'once more' : `${errs[errs.length - 1].v - errs[0].v} more times`} since ${new Date(errs[0].at).toLocaleDateString()}. That usually gets worse: back up now and replace the drive soon.` });

  // SSD wear: fast wear, or on course to be used up within a year.
  const wear = series(history, 'wear', 365, now);
  const ws = slopePerDay(wear);
  if (wear.length && ws !== null && ws > 0) {
    const left = (100 - wear[wear.length - 1].v) / ws;
    if (left < 365) out.push({ id: 'wear', level: 'attention', title: 'The SSD is wearing out quickly', message: `At this rate its rated life is used up in about ${Math.max(1, Math.round(left / 30))} ${Math.round(left / 30) <= 1 ? 'month' : 'months'}. Back up regularly and plan a replacement.` });
  }

  // Free space: on course to run out within two months.
  const free = series(history, 'freeGb', 90, now);
  const fs = slopePerDay(free);
  if (free.length && fs !== null && fs < -0.05) {
    const days = free[free.length - 1].v / -fs;
    if (days < 60) out.push({ id: 'space', level: days < 14 ? 'problem' : 'attention', title: 'The drive is filling up', message: `Free space is falling by about ${(-fs * 7).toFixed(1)} GB a week, so it runs out in about ${Math.max(1, Math.round(days))} ${Math.round(days) <= 1 ? 'day' : 'days'}. Run Free up space, and look for a program filling it (a sync folder, a backup, a log).` });
  }

  // Battery: capacity dropping faster than normal ageing (about 1 point a month).
  const bat = series(history, 'batteryPercent', 180, now);
  const bs = slopePerDay(bat);
  if (bat.length && bs !== null && bs * 30 < -2.5)
    out.push({ id: 'battery', level: 'attention', title: 'The battery is wearing faster than normal', message: `It is losing about ${(-bs * 30).toFixed(1)} percentage points of capacity a month. Heat and staying at 100% all day speed this up; replacement is due below 60%.` });

  // Crashes: more of them than before.
  const crashes = last.crashes ?? 0;
  const prev = [...before].reverse().find((s) => typeof s.crashes === 'number')?.crashes ?? null;
  if (crashes >= 3 || (prev !== null && crashes >= prev + 2))
    out.push({ id: 'crashes', level: 'attention', title: 'More crashes than before', message: `${crashes} ${crashes === 1 ? 'crash or unexpected shutdown' : 'crashes or unexpected shutdowns'} in the last 30 days${prev !== null ? `, up from ${prev}` : ''}. Run the Crash Analyzer to see what is behind them.` });

  // Temperature: the drive running much hotter than it used to.
  const temps = series(history, 'temperature', 90, now);
  if (temps.length >= 3) {
    const avg = temps.slice(0, -1).reduce((a, p) => a + p.v, 0) / (temps.length - 1);
    if (temps[temps.length - 1].v >= 60 && temps[temps.length - 1].v - avg >= 10)
      out.push({ id: 'temperature', level: 'attention', title: 'The drive is running hotter than usual', message: `${temps[temps.length - 1].v} °C now, against about ${Math.round(avg)} °C before. Check the fans and air vents for dust.` });
  }
  return out;
}
