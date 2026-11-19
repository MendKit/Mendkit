"""Extra detail and worked examples for the guide steps, kept apart from the guide text so each guide's
structure stays readable. DETAILS maps a guide id to patches:
  'start of a step':  dict(more=..., see=..., tip=..., warn=..., ex=...)  adds to that step
  '+start of a step': S(...)                                           inserts a new step after it
  '#Heading':        [steps]                                           adds a section after How to use it
more is added to the end of the step text; tip/see/warn are added (or appended to what is there);
ex is an example: a string or list of lines, where a line starting with "> " is something to type.
Every patch must match exactly one step, or the build stops."""
from lib import S, sec

DETAILS = {}


def _merge(step, p):
    d = {'t': step} if isinstance(step, str) else dict(step)
    if p.get('more'):
        t = d['t'].rstrip()
        d['t'] = t + ('' if t[-1] in '.:!?)"' else '.') + ' ' + p['more']
    for k in ('see', 'tip', 'warn'):
        if p.get(k): d[k] = (d[k] + ' ' + p[k]) if d.get(k) else p[k]
    if p.get('ex'):
        ex = [p['ex']] if isinstance(p['ex'], str) else list(p['ex'])
        d['ex'] = d.get('ex', []) + ex
    return d


def _text(step):
    return step if isinstance(step, str) else step['t']


def apply(guides):
    by = {g['id']: g for g in guides}
    for gid, patches in DETAILS.items():
        g = by[gid]
        for key, val in patches.items():
            if key.startswith('#'):
                secs = g['sections']
                at = next((i + 1 for i, s in enumerate(secs) if s['heading'] in ('How to use it',)), len(secs))
                at = max([i + 1 for i, s in enumerate(secs) if s.get('_added')] + [at])
                secs.insert(at, dict(sec(key[1:], val, 'steps'), _added=True))
                continue
            ins = key.startswith('+')
            pre = key[1:] if ins else key
            hits = [(s, i) for s in g['sections'] for i, st in enumerate(s['steps']) if _text(st).startswith(pre)]
            assert len(hits) == 1, f'{gid}: "{pre}" matched {len(hits)} steps'
            s, i = hits[0]
            if ins: s['steps'].insert(i + 1, val)
            else: s['steps'][i] = _merge(s['steps'][i], val)
    for g in guides:
        for s in g['sections']: s.pop('_added', None)
