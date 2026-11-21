// Prints every package id MendKit installs for one manager (winget, brew), from the tools and apps lists.
const fs = require('fs');
const path = require('path');
const m = process.argv[2];
const defs = path.join(__dirname, '..', '..', 'definitions');
const tools = JSON.parse(fs.readFileSync(path.join(defs, 'tools.json'), 'utf8')).map((t) => t.packages[m]);
const apps = JSON.parse(fs.readFileSync(path.join(defs, 'apps.json'), 'utf8')).map((a) => a[m]);
console.log([...new Set([...tools, ...apps].filter(Boolean))].sort().join('\n'));
