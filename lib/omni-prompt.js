function buildStepPromptRequest(step) {
  const promptText = (step && step.prompt) || '请回答当前问题。';
  const isAction = step && step.type === 'action';
  const stepLabel = (step && step.label) || '当前步骤';
  return {
    item: {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            '请你像真实面试官一样自然说话，语气简洁、友好、口语化。',
            isAction ? '只播报当前步骤要求，不要扩展，不要解释流程。' : '只提当前这一道题，不要扩展，不要解释流程。',
            '当前内容：' + stepLabel + '。' + promptText,
          ].join('\n'),
        },
      ],
    },
    response: {
      instructions: [
        '你现在是快递员岗位面试官。',
        isAction ? '只负责自然地播报当前步骤要求。' : '只负责自然地播报当前问题。',
        isAction ? '不要提前开始判断，不要解释动作标准。' : '不要抢先评价，不要总结，不要连续追问。',
        isAction ? '说完当前步骤要求就结束。' : '说完当前问题就结束。',
      ].join('\n'),
    },
  };
}

function buildQuestionPromptRequest(step) {
  return buildStepPromptRequest(step);
}

function buildRealtimeSessionConfig(options) {
  return {
    modalities: ['text', 'audio'],
    voice: options.voice,
    input_audio_format: 'pcm',
    output_audio_format: 'pcm',
    turn_detection: null,
    input_audio_transcription: { model: 'gummy-realtime-v1' },
    temperature: 0.1,
    max_tokens: options.maxTokens,
    instructions: options.instructions,
  };
}

function shouldForwardAssistantMedia(phase) {
  return phase === 'action_prompting' || phase === 'action_eval' || phase === 'question_prompting' || phase === 'question_eval';
}

module.exports = {
  buildStepPromptRequest,
  buildQuestionPromptRequest,
  buildRealtimeSessionConfig,
  shouldForwardAssistantMedia,
};
