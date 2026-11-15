from lib import *
GR = 'Windows'
W = 'Windows 10 and 11'
GUIDES = [
G('mk-win-tools', 'Using MendKit', 'Windows tools', 'The Windows tools on the Repair screen, step by step.', [
 sec('Before you start', [
  S('Restart MendKit as administrator (Dashboard, Restart as administrator, then Yes).', tip='Without it, MendKit can only change items for your own account.'),
  'Tick Technician mode at the bottom left, open Repair. Windows tools is the first section.']),
 sec('Startup items', [
  S('Click Open beside Startup items, then Scan.', see='After up to a minute: programs that start when you sign in, scheduled tasks at sign-in or start-up, and background services, each with who made it and what it runs.'),
  S('Look for items marked "not signed", items marked "program missing" (leftovers), and names you do not recognise.', tip='Items marked "hardware helper" belong to the sound, touchpad or graphics maker. Leave them on unless you know they are not needed. Items marked "part of Windows" cannot be ticked.'),
  S('Tick what to stop and click Turn off selected.', see='Results for each item. Programs stay installed; services still start when a program needs them.'),
  S('Restart and check everything still works.'),
  S('To undo, scan again and click Turn back on beside the item under Turned off. Items turned off here also show as Disabled in Task Manager\'s Startup apps, and can be turned on there too.')], 'steps')],
 systems=W, time='10 minutes', level='Takes care', screen='repair', related=['autoruns', 'mk-repair']),
]
