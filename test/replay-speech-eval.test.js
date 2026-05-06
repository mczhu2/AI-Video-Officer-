const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReplayPayloadFromRecords } = require('../lib/replay-speech-eval');

test('buildReplayPayloadFromRecords picks latest speech evaluation session', () => {
  const records = [
    {
      event: 'speech.evaluate.request',
      timestamp: '2026-05-06T10:00:00.000Z',
      payload: {
        sessionId: 'session_old',
        instructions: 'old instructions',
        transcripts: ['旧转写'],
        frames: ['old-frame'],
      },
    },
    {
      event: 'speech.evaluate.response',
      timestamp: '2026-05-06T10:00:01.000Z',
      payload: {
        sessionId: 'session_old',
        rawTranscript: '总结：旧',
      },
    },
    {
      event: 'speech.evaluate.request',
      timestamp: '2026-05-06T10:01:00.000Z',
      payload: {
        sessionId: 'session_new',
        instructions: 'new instructions',
        transcripts: ['新转写'],
        frames: ['new-frame-1', 'new-frame-2'],
      },
    },
    {
      event: 'speech.evaluate.response',
      timestamp: '2026-05-06T10:01:01.000Z',
      payload: {
        sessionId: 'session_new',
        rawTranscript: '总结：新',
      },
    },
  ];

  const replay = buildReplayPayloadFromRecords(records);

  assert.equal(replay.sessionId, 'session_new');
  assert.equal(replay.instructions, 'new instructions');
  assert.deepEqual(replay.transcripts, ['新转写']);
  assert.deepEqual(replay.frames, ['new-frame-1', 'new-frame-2']);
  assert.equal(replay.originalRawTranscript, '总结：新');
});

test('buildReplayPayloadFromRecords throws when no speech evaluation request exists', () => {
  assert.throws(() => buildReplayPayloadFromRecords([]), /未找到可重放的 speech.evaluate.request/);
});

test('buildReplayPayloadFromRecords supports question evaluation records', () => {
  const records = [
    {
      event: 'question.evaluate.request',
      timestamp: '2026-05-06T10:01:00.000Z',
      payload: {
        sessionId: 'session_question',
        stepLabel: '配送经验',
        instructions: 'question instructions',
        transcripts: ['做过两年快递'],
        frames: ['frame-a'],
      },
    },
    {
      event: 'question.evaluate.response',
      timestamp: '2026-05-06T10:01:01.000Z',
      payload: {
        sessionId: 'session_question',
        rawTranscript: '概述：做过两年快递',
      },
    },
  ];

  const replay = buildReplayPayloadFromRecords(records);

  assert.equal(replay.sessionId, 'session_question');
  assert.equal(replay.stepLabel, '配送经验');
  assert.equal(replay.instructions, 'question instructions');
  assert.deepEqual(replay.transcripts, ['做过两年快递']);
  assert.equal(replay.originalRawTranscript, '概述：做过两年快递');
});
