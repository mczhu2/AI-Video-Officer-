const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const {
  INTERVIEW_STEPS,
  parseCourierQuestionEvaluation,
} = require('./lib/courier-interview');
const {
  buildFinalEvaluationInstructions,
  parseFinalEvaluation,
  hasStructuredFinalEvaluation,
  buildFinalEvaluationFallback,
} = require('./lib/final-evaluation');
const {
  buildStepPromptRequest,
  buildRealtimeSessionConfig,
  shouldForwardAssistantMedia,
} = require('./lib/omni-prompt');
const {
  isMeaningfulTranscript,
  shouldRetryTranscriptionWait,
} = require('./lib/transcription-utils');

const PORT = Number(process.env.PORT || 3000);
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const REALTIME_MODEL = process.env.DASHSCOPE_REALTIME_MODEL || 'qwen3.5-omni-plus-realtime';
const REALTIME_URL =
  (process.env.DASHSCOPE_REALTIME_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime') +
  '?model=' + encodeURIComponent(REALTIME_MODEL);
const REALTIME_VOICE = process.env.DASHSCOPE_REALTIME_VOICE || 'Tina';
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOG_DIR = path.join(__dirname, 'logs');
const DEBUG_LOG_FILE = path.join(LOG_DIR, 'interview-debug.jsonl');
const ACTION_EVAL_TIMEOUT_MS = 8000;
const SPEECH_TRANSCRIPT_TIMEOUT_MS = 4000;
const SPEECH_TRANSCRIPT_RETRY_TIMEOUT_MS = 3000;
const QUESTION_SESSION_INSTRUCTIONS = [
  '你是视频面试助手。',
  '当系统通过单次 response 指令要求你播报问题时，你要像真实面试官一样自然说话。',
  '除此之外，不要主动回答，不要主动评价，不要擅自继续追问。',
  '候选人回答阶段只需要配合转写链路。',
].join('\n');
const SPEECH_TRANSCRIPTION_INSTRUCTIONS = [
  '你是语音转写助手。',
  '你的职责只是接收候选人的回答语音并产出转写事件。',
  '不要主动回答，不要评价，不要播报任何额外内容。',
].join('\n');
const STEPS = INTERVIEW_STEPS;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function makeEventId(prefix) {
  return (prefix || 'evt') + '_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(DEBUG_LOG_FILE)) {
    fs.writeFileSync(DEBUG_LOG_FILE, '', 'utf8');
  }
}

function appendDebugLog(level, module, event, payload) {
  try {
    ensureLogDir();
    const record = {
      timestamp: new Date().toISOString(),
      level,
      module,
      event,
      payload,
    };
    fs.appendFileSync(DEBUG_LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.error('[DEBUG_LOG] 写入失败:', err.message || err);
  }
}

function logInterviewEvent(session, event, payload) {
  appendDebugLog('INFO', 'InterviewSession', event, Object.assign({
    sessionId: session.id,
    phase: session.phase,
    stepIndex: session.stepIndex,
    stepId: currentStep(session) ? currentStep(session).id : null,
  }, payload || {}));
}

function readStaticFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not Found' : 'Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

function stripDataUrlPrefix(value) {
  const raw = String(value || '');
  const marker = 'base64,';
  const index = raw.indexOf(marker);
  return index === -1 ? raw : raw.slice(index + marker.length);
}

function buildSilenceBase64(durationMs) {
  const sampleRate = 16000;
  const samples = Math.max(1, Math.floor(sampleRate * (durationMs || 240) / 1000));
  return Buffer.alloc(samples * 2).toString('base64');
}

function sendBrowser(session, type, payload) {
  if (!session.browser || session.browser.readyState !== WebSocket.OPEN) return;
  session.browser.send(JSON.stringify(Object.assign({ type }, payload || {})));
}

function sendUpstream(session, payload) {
  if (!session.upstream || session.upstream.readyState !== WebSocket.OPEN) {
    throw new Error('Omni connection is not ready');
  }
  const event = Object.assign({ event_id: makeEventId('evt') }, payload);
  session.upstream.send(JSON.stringify(event));
}

function currentStep(session) {
  return STEPS[session.stepIndex] || null;
}

function isQuestionStep(step) {
  return !!step && step.type === 'question';
}

function getCurrentTranscriptText(session) {
  return (session.currentQuestionTranscripts || []).join('\n').trim();
}

function getStepDurationSeconds(step) {
  return Math.round(((step && step.durationMs) || 0) / 1000);
}

function buildInstructions(session, mode) {
  const step = currentStep(session);
  const base = [
    '你是视频面试助手。',
    '你只能基于当前收到的音频和图像作出判断，不要假设看不到的信息。',
  ];

  if (!step) {
    return base.concat([
      '面试已经结束。',
      '如果需要总结，只输出最终总结。',
    ]).join('\n');
  }

  if (mode === 'evaluate_action') {
    return base.concat([
      '当前步骤：' + step.label + '。',
      '你会收到候选人在固定 ' + getStepDurationSeconds(step) + ' 秒动作窗口结束时的连续图像帧。',
      '动作达标标准：' + (step.criteria || '动作需要清楚、完整、可辨认。'),
      '你的任务是判断这个动作是否已经完成。',
      '只输出一句中文短句，并且必须以"健康："或"异常："开头。',
      '如果动作完成，写"健康：动作正常，无异常。"',
      '如果动作未完成，写"异常：动作未完成或不规范。"',
    ]).join('\n');
  }

  const transcriptText = getCurrentTranscriptText(session);

  return base.concat([
    '当前步骤：' + step.label + '。',
    '你现在要评估的是快递员岗位问答，不要把它当作动作检测任务。',
    '面试问题：' + step.prompt,
    '候选人回答转写：' + (transcriptText || '（暂未获取到有效转写，请仅根据可见内容谨慎总结）'),
    '请判断这段回答是否具体、是否体现快递员岗位经验或处理思路。',
    '严禁输出“健康：”“异常：”“通过：”“未通过：”“动作正常”或“内容异常”这类动作判断结论。',
    '即使候选人内容很少、经历不清楚，也必须输出结构化评估，而不是输出异常标签。',
    '请严格按照以下三行格式输出，不要增加任何别的行：',
    '概述：一句话概括候选人回答了什么。',
    '判断：基于回答内容判断经验、效率或处理思路是否具体。',
    '风险：指出还缺什么关键信息，或者需要继续追问的点。',
  ]).join('\n');
}

function parseActionVerdict(text) {
  const normalized = String(text || '').trim();
  if (/^健康[:：]/.test(normalized)) return 'pass';
  if (/^异常[:：]/.test(normalized)) return 'fail';
  if (/^通过[:：]/.test(normalized)) return 'pass';
  if (/^未通过[:：]/.test(normalized)) return 'fail';
  return 'unknown';
}

function clearActionEvalTimer(session) {
  if (session.actionEvalTimer) {
    clearTimeout(session.actionEvalTimer);
    session.actionEvalTimer = null;
  }
}

function clearSpeechTranscriptTimer(session) {
  if (session.speechTranscriptTimer) {
    clearTimeout(session.speechTranscriptTimer);
    session.speechTranscriptTimer = null;
  }
}

function scheduleSpeechTranscriptTimeout(session, delayMs) {
  clearSpeechTranscriptTimer(session);
  session.speechTranscriptTimer = setTimeout(() => {
    if (session.phase !== 'question_transcribing' || session.speechEvaluationRequested) return;
    const transcriptCount = (session.currentQuestionTranscripts || []).length;
    if (shouldRetryTranscriptionWait({ transcriptCount, retryCount: session.transcriptionRetryCount })) {
      session.transcriptionRetryCount += 1;
      logInterviewEvent(session, 'question.transcription.retry_wait', {
        transcriptCount,
        retryCount: session.transcriptionRetryCount,
        delayMs: SPEECH_TRANSCRIPT_RETRY_TIMEOUT_MS,
      });
      scheduleSpeechTranscriptTimeout(session, SPEECH_TRANSCRIPT_RETRY_TIMEOUT_MS);
      return;
    }
    logInterviewEvent(session, 'question.transcription.timeout', {
      transcriptCount,
      retryCount: session.transcriptionRetryCount,
    });
    requestSpeechEvaluation(session);
  }, delayMs);
}

function completeFinalEvaluation(session, parsed, rawTranscript) {
  logInterviewEvent(session, 'final.evaluate.response', {
    rawTranscript,
    parsed,
    questionEvaluationCount: session.report.questionEvaluations.length,
  });
  session.report.finalEvaluation = parsed;
  session.phase = 'complete';
  session.acceptUserTranscript = false;
  sendBrowser(session, 'interview.complete', {
    report: session.report,
    summary: parsed.summary || '',
    finalEvaluation: parsed,
  });
}

function completeQuestionEvaluation(session, parsed, rawTranscript) {
  logInterviewEvent(session, 'question.evaluate.response', {
    rawTranscript,
    parsed,
    userTranscripts: (session.currentQuestionTranscripts || []).slice(),
  });
  session.report.questionEvaluations.push(parsed);
  session.phase = 'idle';
  session.acceptUserTranscript = false;
  session.stepIndex += 1;
  setTimeout(() => {
    try {
      promptCurrentStep(session);
    } catch (err) {
      sendBrowser(session, 'error', { message: err.message });
    }
  }, 500);
}

function runIsolatedSpeechEvaluation(session, instructions) {
  const evaluationSocket = new WebSocket(REALTIME_URL, {
    headers: {
      Authorization: 'Bearer ' + DASHSCOPE_API_KEY,
    },
  });

  session.speechEvalSocket = evaluationSocket;
  let assistantTranscript = '';
  let finished = false;

  const finish = (rawTranscript) => {
    if (finished) return;
    finished = true;
    session.speechEvalSocket = null;
    const step = currentStep(session);
    const transcriptText = getCurrentTranscriptText(session);
    const parsed = parseCourierQuestionEvaluation(rawTranscript, step, transcriptText);
    console.log('[QUESTION_EVAL] Raw transcript:', rawTranscript);
    console.log('[QUESTION_EVAL] Parsed:', parsed);
    completeQuestionEvaluation(session, parsed, rawTranscript);
    try {
      evaluationSocket.close(1000, 'speech evaluation complete');
    } catch (err) {
    }
  };

  evaluationSocket.on('open', () => {
    const send = (payload) => {
      evaluationSocket.send(JSON.stringify(Object.assign({ event_id: makeEventId('evt') }, payload)));
    };
    send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: REALTIME_VOICE,
        input_audio_format: 'pcm',
        output_audio_format: 'pcm',
        turn_detection: null,
        temperature: 0.25,
        max_tokens: 320,
        instructions,
      },
    });
    session.pendingSpeechFrames.forEach((image) => {
      if (image) {
        send({ type: 'input_image_buffer.append', image });
      }
    });
    send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
            {
              type: 'input_text',
              text: '面试问题：' + ((currentStep(session) && currentStep(session).prompt) || '（未知问题）') + '\n候选人回答转写：' + (getCurrentTranscriptText(session) || '（无有效转写）'),
            },
          ],
        },
    });
    send({ type: 'response.create' });
  });

  evaluationSocket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch (err) {
      return;
    }

    if (message.type === 'response.audio_transcript.delta') {
      assistantTranscript += message.delta || '';
      sendBrowser(session, 'assistant.text.delta', { delta: message.delta || '' });
      return;
    }

    if (message.type === 'response.audio_transcript.done') {
      assistantTranscript = String(message.transcript || assistantTranscript || '').trim();
      sendBrowser(session, 'assistant.text.done', { text: assistantTranscript });
      return;
    }

    if (message.type === 'response.done') {
      finish(String(assistantTranscript || '').trim());
      return;
    }

    if (message.type === 'error') {
      finish('');
    }
  });

  evaluationSocket.on('close', () => {
    if (!finished) {
      finish(String(assistantTranscript || '').trim());
    }
  });

  evaluationSocket.on('error', () => {
    finish('');
  });
}

function runIsolatedFinalEvaluation(session, instructions) {
  const evaluationSocket = new WebSocket(REALTIME_URL, {
    headers: {
      Authorization: 'Bearer ' + DASHSCOPE_API_KEY,
    },
  });

  session.finalEvalSocket = evaluationSocket;
  let assistantTranscript = '';
  let finished = false;

  const finish = (rawTranscript) => {
    if (finished) return;
    finished = true;
    session.finalEvalSocket = null;
    const parsed = parseFinalEvaluation(rawTranscript);
    const finalResult = hasStructuredFinalEvaluation(parsed)
      ? parsed
      : buildFinalEvaluationFallback(session.report, rawTranscript);
    console.log('[FINAL_EVAL] Raw transcript:', rawTranscript);
    console.log('[FINAL_EVAL] Parsed:', finalResult);
    completeFinalEvaluation(session, finalResult, rawTranscript);
    try {
      evaluationSocket.close(1000, 'final evaluation complete');
    } catch (err) {
    }
  };

  evaluationSocket.on('open', () => {
    const send = (payload) => {
      evaluationSocket.send(JSON.stringify(Object.assign({ event_id: makeEventId('evt') }, payload)));
    };
    send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: REALTIME_VOICE,
        input_audio_format: 'pcm',
        output_audio_format: 'pcm',
        turn_detection: null,
        temperature: 0.2,
        max_tokens: 480,
        instructions: '你是快递员岗位终面评估官，请严格输出结构化最终结论。',
      },
    });
    send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: instructions,
          },
        ],
      },
    });
    send({ type: 'response.create' });
  });

  evaluationSocket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch (err) {
      return;
    }

    if (message.type === 'response.audio_transcript.delta') {
      assistantTranscript += message.delta || '';
      return;
    }

    if (message.type === 'response.audio_transcript.done') {
      assistantTranscript = String(message.transcript || assistantTranscript || '').trim();
      return;
    }

    if (message.type === 'response.done') {
      finish(String(assistantTranscript || '').trim());
      return;
    }

    if (message.type === 'error') {
      finish('');
    }
  });

  evaluationSocket.on('close', () => {
    if (!finished) {
      finish(String(assistantTranscript || '').trim());
    }
  });

  evaluationSocket.on('error', () => {
    finish('');
  });
}

function requestFinalEvaluation(session) {
  if (session.finalEvaluationRequested) return;
  session.finalEvaluationRequested = true;
  session.phase = 'final_eval';
  session.acceptUserTranscript = false;
  sendBrowser(session, 'final.evaluation.pending', {
    report: {
      actions: session.report.actions,
      questionEvaluations: session.report.questionEvaluations,
    },
  });
  const instructions = buildFinalEvaluationInstructions(session.report);
  logInterviewEvent(session, 'final.evaluate.request', {
    instructions,
    actionCount: session.report.actions.length,
    questionEvaluationCount: session.report.questionEvaluations.length,
  });
  runIsolatedFinalEvaluation(session, instructions);
}

function requestSpeechEvaluation(session) {
  const step = currentStep(session);
  if (!step || !isQuestionStep(step) || session.speechEvaluationRequested) return;

  clearSpeechTranscriptTimer(session);
  session.phase = 'question_eval';
  session.lastAssistantTranscript = '';
  session.acceptUserTranscript = false;
  session.speechEvaluationRequested = true;

  const instructions = buildInstructions(session, 'evaluate_speech');
  logInterviewEvent(session, 'question.evaluate.request', {
    stepLabel: step.label,
    instructions,
    transcriptCount: (session.currentQuestionTranscripts || []).length,
    transcripts: (session.currentQuestionTranscripts || []).slice(),
    frameCount: session.pendingSpeechFrames.length,
    frames: session.pendingSpeechFrames.slice(),
  });
  runIsolatedSpeechEvaluation(session, instructions);
}

function beginStepPrompt(session, step) {
  const promptRequest = buildStepPromptRequest(step);
  session.phase = step.type === 'action' ? 'action_prompting' : 'question_prompting';
  session.lastAssistantTranscript = '';
  session.acceptUserTranscript = false;
  logInterviewEvent(session, 'step.prompt.request', {
    stepId: step.id,
    stepLabel: step.label,
    stepType: step.type,
    promptText: step.prompt,
    responseInstructions: promptRequest.response.instructions,
  });
  sendUpstream(session, {
    type: 'conversation.item.create',
    item: promptRequest.item,
  });
  sendUpstream(session, {
    type: 'response.create',
    response: promptRequest.response,
  });
}

function advanceAfterAction(session, status, note) {
  const step = currentStep(session);
  if (!step) return;

  clearActionEvalTimer(session);
  session.report.actions.push({
    stepId: step.id,
    label: step.label,
    status,
    note: note || '',
  });
  sendBrowser(session, 'action.result', {
    step,
    status,
    message: note || '',
  });
  session.stepIndex += 1;
  session.phase = 'idle';
  setTimeout(() => {
    try {
      promptCurrentStep(session);
    } catch (err) {
      sendBrowser(session, 'error', { message: err.message });
    }
  }, 500);
}

function promptCurrentStep(session) {
  const step = currentStep(session);
  if (!step) {
    requestFinalEvaluation(session);
    return;
  }

  session.phase = step.type === 'action' ? 'action_prompting' : 'question_prompting';
  session.lastAssistantTranscript = '';
  session.acceptUserTranscript = false;
  if (isQuestionStep(step)) {
    session.currentQuestionTranscripts = [];
    session.pendingSpeechFrames = [];
    session.speechChunkIndex = 0;
    session.speechEvaluationRequested = false;
  }
  logInterviewEvent(session, 'step.prompt', {
    stepLabel: step.label,
    stepType: step.type,
    promptText: step.prompt,
  });
  sendBrowser(session, 'stage.changed', {
    stepIndex: session.stepIndex,
    step,
    promptText: step.prompt,
  });
  sendUpstream(session, { type: 'input_audio_buffer.clear' });
  sendUpstream(session, {
    type: 'session.update',
    session: buildRealtimeSessionConfig({
      voice: REALTIME_VOICE,
      maxTokens: 160,
      instructions: QUESTION_SESSION_INSTRUCTIONS,
    }),
  });
  beginStepPrompt(session, step);
}

function evaluateAction(session, frames) {
  const step = currentStep(session);
  if (!step || step.type !== 'action') return;

  clearActionEvalTimer(session);
  session.phase = 'action_eval';
  session.lastAssistantTranscript = '';
  session.acceptUserTranscript = false;
  const instructions = buildInstructions(session, 'evaluate_action');
  logInterviewEvent(session, 'action.evaluate.request', {
    stepLabel: step.label,
    instructions,
    frameCount: Array.isArray(frames) ? frames.length : 0,
  });
  sendUpstream(session, { type: 'input_audio_buffer.clear' });
  sendUpstream(session, {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      voice: REALTIME_VOICE,
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      turn_detection: null,
      input_audio_transcription: { model: 'gummy-realtime-v1' },
      temperature: 0.2,
      max_tokens: 160,
      instructions,
    },
  });
  sendUpstream(session, {
    type: 'input_audio_buffer.append',
    audio: buildSilenceBase64(240),
  });
  (frames || []).forEach((frame) => {
    const image = stripDataUrlPrefix(frame);
    if (image) {
      sendUpstream(session, { type: 'input_image_buffer.append', image });
    }
  });
  sendUpstream(session, { type: 'input_audio_buffer.commit' });
  sendUpstream(session, { type: 'response.create' });

  session.actionEvalTimer = setTimeout(() => {
    if (session.phase === 'action_eval') {
      advanceAfterAction(session, 'timeout', '未通过：固定时长内未能完成判断，进入下一步。');
    }
  }, ACTION_EVAL_TIMEOUT_MS);
}

function finishSpeech(session, frames) {
  const step = currentStep(session);
  if (!step || !isQuestionStep(step)) return;

  session.phase = 'question_transcribing';
  session.lastAssistantTranscript = '';
  session.transcriptionRetryCount = 0;
  session.pendingSpeechFrames = Array.isArray(frames)
    ? frames.slice(0, 4).map((frame) => stripDataUrlPrefix(frame)).filter(Boolean)
    : [];
  session.speechEvaluationRequested = false;
  logInterviewEvent(session, 'question.transcription.await', {
    stepLabel: step.label,
    chunkCount: session.speechChunkIndex,
    frameCount: session.pendingSpeechFrames.length,
  });
  sendUpstream(session, {
    type: 'session.update',
    session: buildRealtimeSessionConfig({
      voice: REALTIME_VOICE,
      maxTokens: 160,
      instructions: SPEECH_TRANSCRIPTION_INSTRUCTIONS,
    }),
  });
  sendUpstream(session, { type: 'input_audio_buffer.commit' });
  scheduleSpeechTranscriptTimeout(session, SPEECH_TRANSCRIPT_TIMEOUT_MS);
}

function handleAssistantDone(session) {
  const transcript = String(session.lastAssistantTranscript || '').trim();

  if (session.phase === 'action_eval') {
    const verdict = parseActionVerdict(transcript);
    if (verdict === 'pass') {
      advanceAfterAction(session, 'pass', transcript);
      return;
    }
    advanceAfterAction(
      session,
      verdict === 'fail' ? 'fail' : 'timeout',
      transcript || '未通过：固定时长内未确认动作达成。'
    );
    return;
  }

  if (session.phase === 'question_eval') {
    return;
  }

  if (session.phase === 'final_eval') {
    return;
  }

  if (session.phase === 'action_prompting') {
    const step = currentStep(session);
    if (!step) return;
    session.phase = 'action_ready';
    sendBrowser(session, 'action.window.start', {
      stepIndex: session.stepIndex,
      step,
    });
    return;
  }

  if (session.phase === 'question_prompting') {
    const step = currentStep(session);
    if (!step) return;
    session.phase = 'question_ready';
    session.acceptUserTranscript = true;
    sendUpstream(session, { type: 'input_audio_buffer.clear' });
    sendUpstream(session, {
      type: 'session.update',
      session: buildRealtimeSessionConfig({
        voice: REALTIME_VOICE,
        maxTokens: 160,
        instructions: SPEECH_TRANSCRIPTION_INSTRUCTIONS,
      }),
    });
    sendBrowser(session, 'question.capture.start', {
      stepIndex: session.stepIndex,
      step,
    });
  }
}

function createSession(browser) {
  return {
    id: makeEventId('session'),
    browser,
    upstream: null,
    stepIndex: 0,
    phase: 'idle',
    acceptUserTranscript: false,
    actionEvalTimer: null,
    lastAssistantTranscript: '',
    report: {
      actions: [],
      questionEvaluations: [],
      finalEvaluation: {
        healthConclusion: '',
        experienceConclusion: '',
        deliveryCapacity: '',
        exceptionHandling: '',
        serviceAwareness: '',
        recommendation: '',
        summary: '',
        raw: '',
      },
    },
    currentQuestionTranscripts: [],
    pendingSpeechFrames: [],
    speechChunkIndex: 0,
    speechTranscriptTimer: null,
    speechEvaluationRequested: false,
    transcriptionRetryCount: 0,
    speechEvalSocket: null,
    finalEvaluationRequested: false,
    finalEvalSocket: null,
  };
}

function closeSession(session) {
  clearActionEvalTimer(session);
  clearSpeechTranscriptTimer(session);
  logInterviewEvent(session, 'session.closed', {
    actionCount: session.report.actions.length,
    questionEvaluationCount: session.report.questionEvaluations.length,
  });
  if (session.upstream && session.upstream.readyState === WebSocket.OPEN) {
    session.upstream.close(1000, 'browser closed');
  }
  if (session.speechEvalSocket && session.speechEvalSocket.readyState === WebSocket.OPEN) {
    session.speechEvalSocket.close(1000, 'browser closed');
  }
  if (session.finalEvalSocket && session.finalEvalSocket.readyState === WebSocket.OPEN) {
    session.finalEvalSocket.close(1000, 'browser closed');
  }
}

function connectUpstream(session) {
  if (!DASHSCOPE_API_KEY) {
    sendBrowser(session, 'error', { message: 'Missing DASHSCOPE_API_KEY' });
    return;
  }

  session.upstream = new WebSocket(REALTIME_URL, {
    headers: {
      Authorization: 'Bearer ' + DASHSCOPE_API_KEY,
    },
  });

  session.upstream.on('open', () => {
    logInterviewEvent(session, 'upstream.open', {
      model: REALTIME_MODEL,
      voice: REALTIME_VOICE,
    });
    sendBrowser(session, 'backend.ready', {
      model: REALTIME_MODEL,
      voice: REALTIME_VOICE,
    });
    try {
      promptCurrentStep(session);
    } catch (err) {
      sendBrowser(session, 'error', { message: err.message });
    }
  });

  session.upstream.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch (err) {
      sendBrowser(session, 'error', { message: 'Omni returned unreadable data' });
      return;
    }

    if (message.type === 'response.audio.delta') {
      if (shouldForwardAssistantMedia(session.phase)) {
        sendBrowser(session, 'assistant.audio.delta', { delta: message.delta });
      }
      return;
    }

    if (message.type === 'response.audio_transcript.delta') {
      session.lastAssistantTranscript += message.delta || '';
      if (shouldForwardAssistantMedia(session.phase)) {
        sendBrowser(session, 'assistant.text.delta', { delta: message.delta || '' });
      }
      return;
    }

    if (message.type === 'response.audio_transcript.done') {
      session.lastAssistantTranscript = String(message.transcript || session.lastAssistantTranscript || '').trim();
      logInterviewEvent(session, 'assistant.transcript.done', {
        transcript: session.lastAssistantTranscript,
      });
      if (shouldForwardAssistantMedia(session.phase)) {
        sendBrowser(session, 'assistant.text.done', { text: session.lastAssistantTranscript });
      }
      return;
    }

    if (message.type === 'conversation.item.input_audio_transcription.completed') {
      const text = String(message.transcript || '').trim();
      if (text && session.acceptUserTranscript && isMeaningfulTranscript(text)) {
        session.currentQuestionTranscripts.push(text);
        logInterviewEvent(session, 'user.transcript.completed', {
          transcriptIndex: session.currentQuestionTranscripts.length - 1,
          stepId: currentStep(session) ? currentStep(session).id : '',
          transcript: text,
        });
        sendBrowser(session, 'user.transcript', {
          stepId: currentStep(session) ? currentStep(session).id : '',
          text,
        });
        if (session.phase === 'question_transcribing' && !session.speechEvaluationRequested) {
          requestSpeechEvaluation(session);
        }
      } else if (text) {
        logInterviewEvent(session, 'user.transcript.ignored', {
          transcript: text,
          acceptUserTranscript: session.acceptUserTranscript,
          phase: session.phase,
          reason: session.acceptUserTranscript ? 'not_meaningful' : 'not_accepting',
        });
      }
      return;
    }

    if (message.type === 'response.done') {
      handleAssistantDone(session);
      return;
    }

    if (message.type === 'error') {
      const detail = message.error && message.error.message
        ? message.error.message
        : JSON.stringify(message);
      sendBrowser(session, 'error', { message: detail });
    }
  });

  session.upstream.on('close', (code, reason) => {
    if (session.phase !== 'complete') {
      sendBrowser(session, 'error', {
        message: 'Omni connection closed: ' + code + ' ' + String(reason || ''),
      });
    }
  });

  session.upstream.on('error', (err) => {
    sendBrowser(session, 'error', { message: err.message || 'Omni connection failed' });
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      model: REALTIME_MODEL,
      voice: REALTIME_VOICE,
    });
    return;
  }

  let filePath = path.join(PUBLIC_DIR, parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);
  filePath = path.resolve(filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  readStaticFile(filePath, res);
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (browser) => {
  const session = createSession(browser);

  browser.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch (err) {
      sendBrowser(session, 'error', { message: 'Browser sent invalid JSON' });
      return;
    }

    try {
      if (message.type === 'session.start') {
        logInterviewEvent(session, 'session.start', {});
        connectUpstream(session);
        return;
      }

      if (message.type === 'action.evaluate') {
        evaluateAction(session, Array.isArray(message.frames) ? message.frames.slice(0, 4) : []);
        return;
      }

      if (message.type === 'speech.audio_chunk') {
        if (
          session.upstream &&
          session.upstream.readyState === WebSocket.OPEN &&
          message.audio &&
          (session.phase === 'question_ready' || session.phase === 'question_transcribing')
        ) {
          logInterviewEvent(session, 'question.audio_chunk', {
            chunkIndex: session.speechChunkIndex,
            audioBase64: String(message.audio),
          });
          session.speechChunkIndex += 1;
          sendUpstream(session, {
            type: 'input_audio_buffer.append',
            audio: String(message.audio),
          });
        }
        return;
      }

      if (message.type === 'speech.finish') {
        logInterviewEvent(session, 'question.finish', {
          frameCount: Array.isArray(message.frames) ? message.frames.length : 0,
          frames: Array.isArray(message.frames) ? message.frames.map((frame) => stripDataUrlPrefix(frame)) : [],
          chunkCount: session.speechChunkIndex,
        });
        finishSpeech(session, Array.isArray(message.frames) ? message.frames.slice(0, 4) : []);
        return;
      }
    } catch (err) {
      sendBrowser(session, 'error', { message: err.message });
    }
  });

  browser.on('close', () => closeSession(session));
  browser.on('error', () => closeSession(session));
});

server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url);
  if (parsedUrl.pathname !== '/api/realtime') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  ensureLogDir();
  console.log('Omni interview backend listening on http://0.0.0.0:' + PORT);
  console.log('Realtime proxy path: ws://0.0.0.0:' + PORT + '/api/realtime');
  console.log('Interview debug log file: ' + DEBUG_LOG_FILE);
});
