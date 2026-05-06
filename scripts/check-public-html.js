const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (!scripts.length) {
  throw new Error('public/index.html does not contain an inline script to validate');
}
for (const script of scripts) {
  // Parse-only validation: browser globals are not executed, but syntax errors
  // such as duplicate const declarations are caught before shipping the demo.
  new Function(script);
}
console.log('public/index.html inline script syntax OK');
