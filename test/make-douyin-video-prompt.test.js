const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

test('prints an isolated Grok prompt for one character scene', () => {
  const output = execFileSync(process.execPath, [
    'scripts/make-douyin-magic666-video.js',
    '--theme=存钱幻想',
    '--print-video-prompts',
    '--only-scene=future-worker',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const payload = JSON.parse(output);
  assert.equal(payload.prompts.length, 1);
  assert.equal(payload.prompts[0].id, 'future-worker');
  assert.ok(payload.prompts[0].seconds > 5);
  assert.match(payload.prompts[0].prompt, /未来星际打工人/);
  assert.match(payload.prompts[0].prompt, /氧气、舱租、星际通勤/);
  assert.match(payload.prompts[0].prompt, /目标视频时长：\d+ 秒/);
  assert.doesNotMatch(payload.prompts[0].prompt, /整条视频/);
  assert.doesNotMatch(payload.prompts[0].prompt, /第 \d+ 段/);
  assert.doesNotMatch(payload.prompts[0].prompt, /延续同一条短剧/);
  assert.doesNotMatch(payload.prompts[0].prompt, /古代|近现代|现代人物/);
});

test('estimates longer scene durations from normal Mandarin reading time', () => {
  const output = execFileSync(process.execPath, [
    'scripts/make-douyin-magic666-video.js',
    '--theme=存钱幻想',
    '--print-video-prompts',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const payload = JSON.parse(output);
  const secondsById = Object.fromEntries(payload.prompts.map((item) => [item.id, item.seconds]));
  assert.deepEqual(Object.keys(secondsById), [
    'ancient-accountant',
    'factory-worker',
    'modern-worker',
    'future-worker',
  ]);
  assert.ok(secondsById['ancient-accountant'] >= 8);
  assert.ok(secondsById['factory-worker'] >= 9);
  assert.ok(secondsById['modern-worker'] >= 9);
  assert.ok(secondsById['future-worker'] >= 8);
});

test('requires visible full-line speaking in character video prompts', () => {
  const output = execFileSync(process.execPath, [
    'scripts/make-douyin-magic666-video.js',
    '--theme=存钱幻想',
    '--print-video-prompts',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const payload = JSON.parse(output);
  const factory = payload.prompts.find((item) => item.id === 'factory-worker');
  const modern = payload.prompts.find((item) => item.id === 'modern-worker');
  for (const item of [factory, modern]) {
    assert.ok(item);
    assert.match(item.prompt, /必须开口说完整台词/);
    assert.match(item.prompt, /视频原生现场同期声/);
    assert.match(item.prompt, /声音自然清晰/);
    assert.match(item.prompt, /嘴型、停顿和表情必须对应这句中文台词/);
    assert.match(item.prompt, /不要只做动作或沉默看镜头/);
    assert.doesNotMatch(item.prompt, /大声|比环境音更大声/);
  }
});
