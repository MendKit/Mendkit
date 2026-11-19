/**
 * Search across all of MendKit: fixes, repair steps, tools, guides, settings and screens. Words people use
 * ("pop-ups", "printer won't print", "wifi") are matched with the words MendKit uses through groups of
 * related words, so a search finds every option for a problem, not only the ones with that exact word.
 * Plain script for the renderer; also loads under Node for the tests.
 */
(function (root) {
  /** Each group: words that mean the same problem. A search word in a group matches any word in it. */
  const GROUPS = [
    ['popup', 'popups', 'adware', 'ads', 'advert', 'adverts', 'advertising', 'notification', 'notifications', 'scam', 'scammer', 'scammers', 'hijack', 'hijacked', 'toolbar', 'toolbars', 'extension', 'extensions', 'fake warning', 'strange behaviour', 'strange behavior'],
    ['virus', 'viruses', 'malware', 'infected', 'infection', 'trojan', 'spyware', 'ransomware', 'defender', 'antivirus', 'scan'],
    ['printer', 'printers', 'print', 'printing', 'prints', 'spooler', 'queue'],
    ['scanner', 'scanners', 'scanning', 'sane'],
    ['slow', 'slower', 'sluggish', 'lag', 'laggy', 'speed', 'faster', 'performance', 'speed up'],
    ['internet', 'online', 'offline', 'network', 'connection', 'connect', 'dns', 'router', 'ethernet', 'web'],
    ['wifi', 'wi-fi', 'wireless', 'wlan'],
    ['sound', 'audio', 'speaker', 'speakers', 'volume', 'headphones', 'microphone', 'mic'],
    ['bluetooth', 'pairing', 'pair', 'earbuds', 'airpods'],
    ['camera', 'webcam', 'facetime'],
    ['space', 'storage', 'full', 'disk full', 'clean', 'cleanup', 'clean up', 'free up', 'junk', 'temp', 'cache'],
    ['crash', 'crashes', 'crashing', 'freeze', 'freezes', 'frozen', 'freezing', 'hang', 'hangs', 'blue screen', 'bsod', 'panic', 'restarts', 'shuts down', 'shutdown'],
    ['startup', 'start up', 'boot', 'booting', 'login items', 'autostart', 'starts with'],
    ['update', 'updates', 'updating', 'upgrade', 'upgrading', 'patch'],
    ['delete', 'deleted', 'recover', 'recovery', 'undelete', 'lost', 'restore', 'photorec'],
    ['backup', 'backups', 'back up', 'copy', 'transfer', 'move', 'migrate', 'migration', 'new computer'],
    ['phone', 'iphone', 'ipad', 'android', 'mobile', 'photos', 'pictures'],
    ['drive', 'disk', 'ssd', 'hdd', 'hard drive', 'smart', 'storage device'],
    ['battery', 'charging', 'charge', 'power'],
    ['heat', 'hot', 'overheating', 'temperature', 'fan', 'fans'],
    ['password', 'passwords', 'locked out', 'sign in', 'login', 'pin'],
    ['remote', 'remote access', 'teamviewer', 'anydesk', 'screenconnect', 'someone connected'],
    ['browser', 'chrome', 'edge', 'firefox', 'brave', 'safari', 'homepage', 'home page', 'search engine'],
    ['driver', 'drivers', 'graphics', 'nvidia', 'firmware', 'display'],
    ['security', 'firewall', 'encryption', 'bitlocker', 'filevault', 'secure'],
    ['windows 11', 'win11', 'tpm', 'secure boot', 'eligible', 'compatible'],
    ['linux', 'ubuntu', 'mint', 'switch'],
    ['erase', 'wipe', 'shred', 'sell', 'recycle'],
    ['app', 'apps', 'program', 'programs', 'software', 'install', 'uninstall'],
    ['memory', 'ram'],
    ['keyboard', 'keys', 'mouse', 'trackpad', 'touchpad', 'usb', 'ports'],
  ];

  /** Lower case, accents and punctuation removed, "pop-ups" and "pop ups" made into "popups". */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\bpop[\s-]+ups?\b/g, 'popups')
      .replace(/\bwi[\s-]+fi\b/g, 'wifi')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  /** A rough stem, so "printing", "printers" and "printer" meet. */
  function stem(w) {
    if (w.length <= 3) return w;
    return w.replace(/(ings|ing|ers|er|ies|es|ed|s)$/, (m) => (m === 'ies' ? 'y' : '')) || w;
  }
  const STOP = new Set(['computer', 'computers', 'pc', 'laptop', 'machine', 'problem', 'problems', 'issue', 'issues', 'fix', 'help', 'broken', 'isnt', 'no', 'cannot', 'stopped', 'working', 'work', 'works', 'a', 'an', 'the', 'my', 'it', 'is', 'to', 'of', 'and', 'or', 'on', 'in', 'for', 'with', 'not', 'wont', 'won', 't', 'doesnt', 'does', 'cant', 'can', 'will', 'keeps', 'keep', 'how', 'do', 'i', 'me', 'what', 'why', 'too', 'very', 'all', 'some']);

  const groupOf = new Map();
  GROUPS.forEach((g, i) => g.forEach((w) => { const k = norm(w); groupOf.set(k, i); groupOf.set(stem(k), i); }));

  /** The words a query word can match: itself, its stem, and the rest of its group. */
  function expand(word) {
    const out = new Set([word, stem(word)]);
    const gi = groupOf.has(word) ? groupOf.get(word) : groupOf.get(stem(word));
    if (gi !== undefined) GROUPS[gi].forEach((w) => { const k = norm(w); out.add(k); out.add(stem(k)); });
    return [...out].filter((w) => w.length > 1);
  }

  /** Prepares an item's text once, for fast matching. */
  function prepare(item) {
    const title = norm(item.title);
    const body = norm(`${item.text || ''} ${item.keywords || ''}`);
    const words = new Set(`${title} ${body}`.split(' ').flatMap((w) => [w, stem(w)]));
    return { ...item, _title: ` ${title} `, _body: ` ${body} `, _words: words };
  }

  /**
   * Items matching every word of the query (or one of its related words), best first. A word in the title
   * counts more than one in the description; an exact word more than a related one.
   */
  function search(prepared, query) {
    const q = norm(query);
    if (!q) return [];
    const words = q.split(' ').filter((w) => !STOP.has(w));
    if (!words.length) return [];
    const out = [];
    for (const it of prepared) {
      let score = 0;
      let ok = true;
      for (const w of words) {
        const alts = expand(w);
        let best = 0;
        for (const a of alts) {
          const exact = a === w || a === stem(w);
          const multi = a.includes(' ');
          const inTitle = multi ? it._title.includes(` ${a} `) : it._title.includes(` ${a}`);
          const inBody = multi ? it._body.includes(` ${a} `) : it._words.has(a) || it._body.includes(` ${a}`);
          const s = inTitle ? (exact ? 10 : 6) : inBody ? (exact ? 4 : 2) : 0;
          if (s > best) best = s;
        }
        if (!best) { ok = false; break; }
        score += best;
      }
      if (ok) out.push({ item: it, score: score + (it.weight || 0) });
    }
    return out.sort((a, b) => b.score - a.score || String(a.item.title).localeCompare(String(b.item.title))).map((r) => r.item);
  }

  const api = { norm, stem, expand, prepare, search, GROUPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MendKitSearch = api;
})(this);
