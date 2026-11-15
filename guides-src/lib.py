def S(t, see=None, tip=None, warn=None):
    if not (see or tip or warn): return t
    d={"t":t}
    if see: d["see"]=see
    if tip: d["tip"]=tip
    if warn: d["warn"]=warn
    return d
def sec(heading, steps, kind=None):
    d={"heading":heading,"steps":steps}
    if kind: d["kind"]=kind
    return d
def G(id, group, title, summary, sections, systems=None, time=None, level=None, need=None, tool=None, screen=None, related=None):
    d={"id":id,"group":group,"title":title,"summary":summary}
    for k,v in (("systems",systems),("time",time),("level",level),("need",need),("tool",tool),("screen",screen),("related",related)):
        if v: d[k]=v
    d["sections"]=sections
    return d

WHERE={
 'win-gui': lambda n: S(f'Click the Start button (the Windows logo at the bottom of the screen), type {n} and click it in the list.', see=f'{n} opens in its own window. If Windows asks "Do you want to allow this app to make changes to your device?", click Yes.'),
 'mac-gui': lambda n: S(f'Open Finder, click Applications in the left column and double-click {n}. Or press Command and Space together, type {n} and press Return.', see=f'If macOS says {n} was downloaded from the internet, click Open.'),
 'linux-gui': lambda n: S(f'Open the applications menu (the grid of dots or the menu button in the corner), type {n} and click it.'),
 'cli': lambda n: S(f'{n} has no window of its own: it runs in Terminal (Command Prompt or PowerShell on Windows). See the guide "Opening Terminal and typing a command" if you have not done this before.'),
}
def install(name, tool, how):
    """how: list of WHERE keys, e.g. ['win-gui','mac-gui'] or ['cli']"""
    steps=[
     S('Open MendKit. At the bottom left, tick Technician mode.', see='Repair, Tools and Tweaks appear in the menu on the left.'),
     S(f'Click Tools in the menu. Type {name} in the search box at the top, or scroll to find it.', see=f'A row for {name} with a tick box, its job, its licence and a Status column.'),
     S(f'Tick the box beside {name} and click Install selected.', tip='On Windows, use "Restart as administrator" on the Dashboard first so installs do not stop to ask permission. On a Mac or Linux, MendKit asks for your password once.', see='The bottom panel shows the download and install. It usually takes one to five minutes.'),
     S(f'Wait until the Status column says Installed.', tip='If it says it failed, check the internet connection and click Install selected again. The full reason is in Reports.'),
    ]
    steps += [WHERE[h](name) for h in how]
    return sec('Install it', steps, 'steps')
