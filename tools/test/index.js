'use strict';
// Entry point for `node --test tools/test`: Node 22 resolves a directory
// argument as a module, so this file loads every *.test.js suite beside it.
const fs = require('node:fs');
const path = require('node:path');

for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort()) {
  require(path.join(__dirname, f));
}
