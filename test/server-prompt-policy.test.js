const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('question evaluation prompt uses ordinary courier hiring standard', () => {
  assert.match(serverSource, /普通快递员，不是优秀快递员/);
  assert.match(serverSource, /有相关经验、是否能正常表达、是否有基本处理思路/);
  assert.match(serverSource, /不要因为回答不够优秀/);
  assert.match(serverSource, /不要把“不够优秀”写成不适合/);
});
