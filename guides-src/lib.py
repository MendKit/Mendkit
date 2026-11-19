def S(t, see=None, tip=None, warn=None, ex=None):
    """ex: an example, a string or a list of lines. A line starting with "> " is something to type."""
    if not (see or tip or warn or ex): return t
    d={"t":t}
    if see: d["see"]=see
    if tip: d["tip"]=tip
    if warn: d["warn"]=warn
    if ex: d["ex"]=[ex] if isinstance(ex,str) else list(ex)
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
 'win-gui': lambda n: S(f'Windows: click the Start button (the Windows logo at the bottom of the screen), type {n} and click it when it appears at the top of the list.', see=f'{n} opens in its own window. If a box asks "Do you want to allow this app to make changes to your device?", click Yes. That box is Windows checking with you, not an error.', tip=f'If {n} does not appear straight away, wait a few seconds and type the name again, or look under All apps in the Start menu.'),
 'mac-gui': lambda n: S(f'Mac: open Finder, click Applications in the left column and double-click {n}. Or press Command and Space together, type {n} and press Return.', see=f'The first time, macOS may ask whether you are sure you want to open an app downloaded from the internet. Click Open.', tip='If macOS says the developer cannot be verified, open System Settings, Privacy & Security, scroll down and click Open Anyway.'),
 'linux-gui': lambda n: S(f'Linux: open the applications menu (the grid of dots at the bottom left on Ubuntu, or the menu button in the bottom corner on Linux Mint), type {n} and click it.', tip='Programs installed as a Flatpak can take a minute to appear in the menu. If it is not there, sign out and back in.'),
 'cli': lambda n: S(f'{n} has no window of its own: you type its commands in Terminal (Command Prompt or PowerShell on Windows). See the guide "Opening Terminal and typing a command" if you have not done this before.', tip='If Terminal says "command not found" or "is not recognized", close Terminal and open a new one. A Terminal that was already open does not see newly installed programs.'),
 'cli-other': lambda n: S(f'On a Mac and on Linux, {n} has no window: you type its commands in Terminal. See the guide "Opening Terminal and typing a command" if you have not done this before.'),
}
def install(name, tool, how):
    """how: list of WHERE keys, e.g. ['win-gui','mac-gui'] or ['cli']"""
    steps=[
     S('Open MendKit. At the bottom left of its window, tick the Technician mode box.', see='Repair, Tools and Tweaks appear in the menu on the left. If they were already there, Technician mode was already on.'),
     S(f'Click Tools in the menu on the left. Click the search box at the top of the list and type {name}.', see=f'The list shrinks to the row for {name}: a tick box, its name, what it is for, its licence and a Status column saying Not installed or Installed.', ex=f'Part of the name is enough: "{name[:3]}" finds the same row.'),
     S(f'Tick the box at the start of the {name} row, then click Install selected at the top of the list.', tip='On Windows, click "Restart as administrator" on the Dashboard first, so installs do not stop half-way to ask permission. On a Mac or Linux, MendKit asks for your password once; nothing shows on screen as you type it, which is normal.', see='The panel at the bottom of MendKit shows each step of the download and install as it happens. It usually takes one to five minutes.'),
     S(f'Wait until the Status column for {name} says Installed and the bottom panel says the job has finished.', tip='If it failed, check the internet connection and click Install selected again; a second try often works when a download was interrupted. The full reason is in Reports, in the newest Install report.'),
    ]
    if 'cli' in how and len(how) > 1: how = [h if h != 'cli' else 'cli-other' for h in how]
    steps += [WHERE[h](name) for h in how]
    return sec('Install it', steps, 'steps')
