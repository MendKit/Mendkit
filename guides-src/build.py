#!/usr/bin/env python3
"""Builds definitions/guides.json from the guide sources in this folder.  Run:  python3 guides-src/build.py
Each module defines GUIDES (see lib.py for S, sec, G and the install helper). Order: Start here, Using MendKit,
Mac, Linux, then the tool guides alphabetically."""
import json
import pathlib
import sys

here = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(here))
import basics, mendkit, mac, linux, windows, tools1, tools2, tools3  # noqa: E402
from toollib import TOOLS  # noqa: E402

using = lambda m: [g for g in m.GUIDES if g['group'] == 'Using MendKit']
out = basics.GUIDES + mendkit.GUIDES + using(windows) + using(mac) + using(linux)
out += [g for g in windows.GUIDES if g['group'] == 'Windows']
out += [g for g in mac.GUIDES if g['group'] == 'Mac'] + [g for g in linux.GUIDES if g['group'] == 'Linux']
out += sorted(tools1.GUIDES + tools2.GUIDES + tools3.GUIDES, key=lambda g: g['title'].lower())
ids = [g['id'] for g in out]
assert len(ids) == len(set(ids)), 'duplicate guide ids'
assert not [t for t in TOOLS if t not in ids], 'a tool has no guide'
bad = [(g['id'], r) for g in out for r in g.get('related', []) if r not in ids]
assert not bad, f'links to missing guides: {bad}'
for g in out:
    for s in g['sections']:
        assert s['steps'], (g['id'], s['heading'])
(here.parent / 'definitions' / 'guides.json').write_text(json.dumps(out, indent=1, ensure_ascii=False))
print(f'{len(out)} guides written')
