/**
 * Before/after speed score: a few quick measurements turned into a 0-100 score, so a customer can see what a
 * service changed. Measurements come from src/main/checkin.ts; this file only scores and compares them.
 */

export interface SpeedMeasure {
  at: string;
  /** Drive: MB per second writing and reading a temporary file. */
  writeMBs: number | null;
  readMBs: number | null;
  /** Milliseconds for a fixed piece of processor work (lower is faster). */
  cpuMs: number | null;
  /** Memory in use, percent. */
  memoryUsed: number | null;
  freePercent: number | null;
  startupItems: number | null;
}

export interface SpeedScore {
  score: number;
  parts: { id: string; name: string; value: string; points: number; max: number }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Points for a value between a poor and a good mark, scaled to max. */
const scale = (v: number, poor: number, good: number, max: number) => Math.round(clamp((v - poor) / (good - poor), 0, 1) * max);

export function speedScore(m: SpeedMeasure): SpeedScore {
  const parts: SpeedScore['parts'] = [];
  const add = (id: string, name: string, value: string, points: number, max: number) => parts.push({ id, name, value, points, max });
  if (m.writeMBs !== null) {
    const mbs = m.readMBs !== null ? (m.readMBs + m.writeMBs) / 2 : m.writeMBs;
    add('drive', 'Drive speed', m.readMBs !== null ? `${Math.round(m.readMBs)} MB/s read, ${Math.round(m.writeMBs)} MB/s write` : `${Math.round(m.writeMBs)} MB/s`, scale(Math.log10(Math.max(mbs, 1)), Math.log10(30), Math.log10(1500), 35), 35);
  }
  if (m.cpuMs !== null) add('cpu', 'Processor', `${Math.round(m.cpuMs)} ms for the test`, scale(-m.cpuMs, -2500, -250, 20), 20);
  if (m.memoryUsed !== null) add('memory', 'Memory in use', `${Math.round(m.memoryUsed)}%`, scale(-m.memoryUsed, -95, -50, 15), 15);
  if (m.freePercent !== null) add('space', 'Free space', `${Math.round(m.freePercent)}%`, scale(m.freePercent, 5, 25, 15), 15);
  if (m.startupItems !== null) add('startup', 'Programs starting with the computer', String(m.startupItems), scale(-m.startupItems, -30, -5, 15), 15);
  const max = parts.reduce((a, p) => a + p.max, 0);
  const got = parts.reduce((a, p) => a + p.points, 0);
  return { score: max ? Math.round((100 * got) / max) : 0, parts };
}

/** Lines comparing before and after, for the customer report. */
export function compareSpeed(before: SpeedMeasure, after: SpeedMeasure): { before: number; after: number; lines: string[] } {
  const b = speedScore(before);
  const a = speedScore(after);
  const lines: string[] = [];
  for (const p of a.parts) {
    const q = b.parts.find((x) => x.id === p.id);
    if (q && q.value !== p.value) lines.push(`${p.name}: ${q.value} before, ${p.value} after`);
  }
  return { before: b.score, after: a.score, lines };
}
