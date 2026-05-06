const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';

test('public index inline script is parseable', () => {
  assert.doesNotThrow(() => new Function(inlineScript));
});

test('mobile interview keeps content floating over one full-screen video surface', () => {
  assert.match(html, /#interview-screen\s*{[\s\S]*height:\s*100svh/);
  assert.match(html, /#interview-card\s*{[\s\S]*height:\s*100svh[\s\S]*display:\s*block/);
  assert.match(html, /\.video-shell\s*{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0/);
  assert.match(html, /\.panel\s*{[\s\S]*position:\s*absolute[\s\S]*bottom:/);
});

test('minimal animated interviewer avatar is rendered and reacts while assistant audio plays', () => {
  assert.match(html, /id="avatar-card"/);
  assert.match(html, /极简动画 AI 面试官/);
  assert.match(html, /avatar-orb/);
  assert.match(html, /avatar-wave/);
  assert.match(html, /orb-speaking/);
  assert.match(html, /wave-speaking/);
  assert.doesNotMatch(html, /interviewer-idle|interviewer-talking|avatar-media/);
  assert.match(inlineScript, /function setAvatarSpeaking\(isSpeaking\)/);
  assert.match(inlineScript, /setAvatarSpeaking\(true\)/);
});

test('speech answer flow auto-submits without a visible finish button', () => {
  assert.doesNotMatch(html, /finish-speech-btn/);
  assert.doesNotMatch(html, /点击[“"]?完成回答/);
  assert.match(html, /停顿后自动提交，无需点击按钮/);
  assert.match(inlineScript, /AUTO_FINISH_SILENCE_MS/);
  assert.match(inlineScript, /updateSpeechAutoFinish\(input\)/);
  assert.match(inlineScript, /finishSpeechCapture\('silence'\)/);
  assert.match(inlineScript, /type:\s*'speech\.finish'/);
});
