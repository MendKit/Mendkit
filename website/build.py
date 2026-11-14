#!/usr/bin/env python3
"""Fills the website's numbers and the "What is the problem?" panel from MendKit's own definitions,
so the site always describes what the app really does.  Run after changing definitions:  python3 website/build.py"""
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
d = root / 'definitions'
page = root / 'website' / 'index.html'
load = lambda name: json.loads((d / name).read_text())

commands = {p: {c['id']: c for c in load(f'commands.{p}.json')} for p in ('win32', 'darwin', 'linux')}
recipes = {r['id']: r for r in load('recipes.json')}
OTHER_MANAGERS = re.compile(r'\((dnf|pacman|zypper)\)')


def step_names(recipe, platform):
    """The steps a recipe runs on a system, as the app names them. Linux shows the apt variant once."""
    out = []
    for s in recipe['steps'].get(platform, []):
        c = commands[platform].get(s['command'])
        if not c or (platform == 'linux' and OTHER_MANAGERS.search(c['name'])):
            continue
        name = re.sub(r'\s*\((apt|Ubuntu and Mint)\)$', '', c['name'])
        if name not in [n for n, _ in out]:
            out.append((name, c.get('typicalMinutes', 1)))
    return out


problems = []
for s in load('symptoms.json'):
    r = recipes[s['recipe']]
    per = {}
    for p, key in (('win32', 'windows'), ('darwin', 'mac'), ('linux', 'linux')):
        steps = step_names(r, p)
        if steps:
            per[key] = {'steps': [n for n, _ in steps], 'minutes': sum(m for _, m in steps)}
    problems.append({'id': s['id'], 'label': s['label'], 'title': r['name'], 'about': r['description'], 'on': per})

guides = load('guides.json')
counts = {
    'tools': len(load('tools.json')),
    'guides': len(guides),
    'isos': len(load('isos.json')),
    'remote': len(load('remote-tools.json')),
    'problems': len(problems),
    'tweaks-win': len(load('tweaks.win32.json')),
    'tweaks-mac': len(load('tweaks.darwin.json')),
    'tweaks-linux': len(load('tweaks.linux.json')),
    'tool-guides': sum(1 for g in guides if g['group'] == 'Tools'),
    'version': json.loads((root / 'package.json').read_text())['version'],
}

html = page.read_text()
data = json.dumps({'problems': problems, 'counts': counts}, separators=(',', ':'), ensure_ascii=False)
html, n = re.subn(r'(/\*DATA\*/).*?(/\*END\*/)', lambda m: m.group(1) + data + m.group(2), html, flags=re.S)
assert n == 1, 'DATA markers missing'
for k, v in counts.items():
    html = re.sub(rf'(<span data-count="{k}">)[^<]*(</span>)', rf'\g<1>{v}\g<2>', html)
page.write_text(html)
print(f'website: {len(problems)} problems, counts {counts}')
