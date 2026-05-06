const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStepPromptRequest,
  buildQuestionPromptRequest,
  buildRealtimeSessionConfig,
  shouldForwardAssistantMedia,
} = require('../lib/omni-prompt');

test('buildStepPromptRequest supports action prompt payload', () => {
  const payload = buildStepPromptRequest({
    id: 'left_hand',
    type: 'action',
    label: '举左手',
    prompt: '你好，请举起左手并保持五秒。',
  });

  assert.match(payload.item.content[0].text, /左手.*五秒/);
  assert.match(payload.response.instructions, /播报当前步骤要求/);
  assert.match(payload.response.instructions, /不要提前开始判断/);
});

test('buildQuestionPromptRequest creates natural question prompt payload', () => {
  const payload = buildQuestionPromptRequest({
    id: 'courier_q2',
    label: '单量效率',
    prompt: '第二个问题：你平时一天大概能派送多少单？高峰时最多能做到多少单？',
  });

  assert.equal(payload.item.type, 'message');
  assert.equal(payload.item.role, 'user');
  assert.match(payload.item.content[0].text, /请你像真实面试官一样自然说话/);
  assert.match(payload.item.content[0].text, /第二个问题/);
  assert.match(payload.response.instructions, /只负责自然地播报当前问题/);
  assert.match(payload.response.instructions, /不要抢先评价/);
});

test('shouldForwardAssistantMedia includes question prompting phase', () => {
  assert.equal(shouldForwardAssistantMedia('action_eval'), true);
  assert.equal(shouldForwardAssistantMedia('action_prompting'), true);
  assert.equal(shouldForwardAssistantMedia('question_prompting'), true);
  assert.equal(shouldForwardAssistantMedia('question_eval'), true);
  assert.equal(shouldForwardAssistantMedia('question_ready'), false);
});

test('buildRealtimeSessionConfig keeps enough max tokens for capture mode', () => {
  const config = buildRealtimeSessionConfig({
    instructions: 'capture instructions',
    voice: 'Tina',
    maxTokens: 160,
  });

  assert.equal(config.max_tokens, 160);
  assert.equal(config.instructions, 'capture instructions');
  assert.equal(config.voice, 'Tina');
  assert.deepEqual(config.modalities, ['text', 'audio']);
});
