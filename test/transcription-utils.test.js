const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isMeaningfulTranscript,
  shouldRetryTranscriptionWait,
} = require('../lib/transcription-utils');

test('isMeaningfulTranscript rejects empty and english filler transcripts', () => {
  assert.equal(isMeaningfulTranscript(''), false);
  assert.equal(isMeaningfulTranscript('Thank you.'), false);
  assert.equal(isMeaningfulTranscript('You.'), false);
  assert.equal(isMeaningfulTranscript('Okay'), false);
});

test('isMeaningfulTranscript keeps short but useful chinese answers', () => {
  assert.equal(isMeaningfulTranscript('没做过。'), true);
  assert.equal(isMeaningfulTranscript('不管他。'), true);
  assert.equal(isMeaningfulTranscript('先联系客户。'), true);
});

test('shouldRetryTranscriptionWait only retries first empty timeout', () => {
  assert.equal(shouldRetryTranscriptionWait({ transcriptCount: 0, retryCount: 0 }), true);
  assert.equal(shouldRetryTranscriptionWait({ transcriptCount: 0, retryCount: 1 }), false);
  assert.equal(shouldRetryTranscriptionWait({ transcriptCount: 1, retryCount: 0 }), false);
});
