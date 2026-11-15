import json
from lib import *
TOOLS={t['id']:t for t in json.load(open(__import__('pathlib').Path(__file__).resolve().parent.parent / 'definitions' / 'tools.json'))}
def systems_of(t):
    k=t['packages'].keys(); out=[]
    if 'winget' in k: out.append('Windows')
    if 'brew' in k: out.append('macOS')
    if set(k)&{'apt','dnf','pacman','zypper','flatpak'}: out.append('Linux')
    return out
def tool(id, summary, what, when, how, results=None, trouble=None, care=None, time=None, level='Easy', ui='gui', related=None, need=None, extra=None):
    t=TOOLS[id]; name=t['name']; sy=systems_of(t)
    if ui=='gui': keys=[{'Windows':'win-gui','macOS':'mac-gui','Linux':'linux-gui'}[s] for s in sy]
    elif ui=='cli': keys=['cli']
    else: keys=ui
    secs=[sec('What it is',what), sec('When to use it',when), install(name,id,keys)]
    secs+= how if isinstance(how[0],dict) and 'heading' in how[0] else [sec('How to use it',how,'steps')]
    if extra: secs+=extra
    if results: secs.append(sec('Reading the results',results))
    if trouble: secs.append(sec('If something goes wrong',trouble))
    c=list(care or [])
    if t.get('homeUseOnly'): c.append(f'{name} is free for personal use only. Using it on customers\' computers as a business needs the paid licence from its maker.')
    if c: secs.append(sec('Take care',c))
    return G(id,'Tools',name,summary,secs,systems=', '.join(sy),time=time,level=level,need=need,tool=id,related=related)
