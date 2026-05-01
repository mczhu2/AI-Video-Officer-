const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const REALTIME_MODEL = process.env.DASHSCOPE_REALTIME_MODEL || 'qwen3.5-omni-plus-realtime';
const REALTIME_URL =
  (process.env.DASHSCOPE_REALTIME_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime') +
  '?model=' + encodeURIComponent(REALTIME_MODEL);
const REALTIME_VOICE = process.env.DASHSCOPE_REALTIME_VOICE || 'Tina';
const PUBLIC_DIR = path.join(__dirname, 'public');
const ACTION_DURATION_MS = 8000;
const SPEECH_DURATION_MS = 35000;
const ACTION_EVAL_TIMEOUT_MS = 8000;

const STEPS = [
  {
    id: 'left_hand',
    type: 'action',
    label: '举左手',
    prompt: '你好，请举起左手并保持八秒。',
    criteria: '左手需要明显抬起，至少高于腰部，最好接近肩部；不能只是轻微移动手臂。',
    durationMs: ACTION_DURATION_MS,
  },
  {
    id: 'right_hand',
    type: 'action',
    label: '举右手',
    prompt: '你好，请举起右手并保持八秒。',
    criteria: '右手需要明显抬起，至少高于腰部，最好接近肩部；不能只是轻微移动手臂。',
    durationMs: ACTION_DURATION_MS,
  },
  {
    id: 'turn_left',
    type: 'action',
    label: '左转',
    prompt: '你好，请向左转头或微微转身，并保持八秒。',
    criteria: '头部或上半身需要有清晰的左转姿态，能看出面部朝向或肩线明显偏向左侧。',
    durationMs: ACTION_DURATION_MS,
  },
  {
    id: 'turn_right',
    type: 'action',
    label: '右转',
    prompt: '你好，请向右转头或微微转身，并保持八秒。',
    criteria: '头部或上半身需要有清晰的右转姿态，能看出面部朝向或肩线明显偏向右侧。',
    durationMs: ACTION_DURATION_MS,
  },
  {
    id: 'speech',
    type: 'speech',
    label: '工作经历介绍',
    prompt: '你好，请用三十五秒介绍你最近的一段工作经历，重点说目标、做法和结果。',
    durationMs: SPEECH_DURATION_MS,
  },
];

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

function getStepDurationSeconds(step) {
  return Math.round(((step && step.durationMs) || 0) / 1000);
}

function buildInstructions(session, mode) {
  const step = currentStep(session);
  const base = [
    '你是 OpenClaw 的实时视频面试官。',
    '你只能基于当前收到的音频和图像作出判断，不要假设看不到的信息。',
    '你可以判断动作是否完成、表达是否清晰、整体配合度如何，但不要做医疗诊断。',
    '你说话要简短、自然、像实时语音助手。',
  ];

  if (!step) {
    return base.concat([
      '面试已经结束。',
      '如果需要总结，只输出最终总结。',
    ]).join('\n');
  }

  if (mode === 'prompt') {
    return base.concat([
      '当前步骤：' + step.label + '。',
      '请直接发出一句口令，必须以“你好，”开头。',
      '不要提候选人姓名。',
      '动作步骤只说当前动作和固定时长，不要解释后续流程。',
      '发言步骤只说当前发言要求和固定时长。',
      '尽量贴近这句口令：' + step.prompt,
    ]).join('\n');
  }

  if (mode === 'evaluate_action') {
    return base.concat([
      '当前步骤：' + step.label + '。',
      '你会收到候选人在固定 ' + getStepDurationSeconds(step) + ' 秒动作窗口结束时的连续图像帧。',
      '动作达标标准：' + (step.criteria || '动作需要清楚、完整、可辨认。'),
      '你的任务是判断这个动作是否已经完成。',
      '只输出一句中文短句，并且必须以“通过：”或“未通过：”开头。',
      '如果未通过，只指出动作没有达成，不要继续指导第二次尝试。',
    ]).join('\n');
  }

  return base.concat([
    '当前步骤：' + step.label + '。',
    '你会收到候选人的一段工作经历自述音频和最近的视频帧。',
    '请直接输出最终面试结果。',
    '输出必须严格使用两行格式：',
    '总结：一句话总评。',
    '点评：一句话点评候选人的工作经历表达是否清晰、是否抓住目标、做法、结果。',
    '总长度控制在一百五十字以内。',
  ]).join('\n');
}

function parseActionVerdict(text) {
  const normalized = String(text || '').trim();
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

function parseSpeechSummary(text) {
  const raw = String(text || '').trim();
  const summaryMatch = raw.match(/总结[:：]\s*([\s\S]*?)(?:\n点评[:：]|$)/);
  const commentMatch = raw.match(/点评[:：]\s*([\s\S]*)$/);
  return {
    summary: summaryMatch ? summaryMatch[1].trim() : raw,
    speechComment: commentMatch ? commentMatch[1].trim() : '',
    raw,
  };
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
    session.phase = 'complete';
    session.acceptUserTranscript = false;
    sendBrowser(session, 'interview.complete', {
      report: session.report,
      summary: session.report.summary || '',
      speechComment: session.report.speechComment || '',
    });
    return;
  }

  session.phase = step.type === 'action' ? 'action_prompt' : 'speech_prompt';
  session.lastAssistantTranscript = '';
  sendBrowser(session, 'stage.changed', {
    stepIndex: session.stepIndex,
    step,
  });
  sendUpstream(session, {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      voice: REALTIME_VOICE,
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      turn_detection: null,
      input_audio_transcription: { model: 'gummy-realtime-v1' },
      temperature: 0.25,
      max_tokens: 220,
      instructions: buildInstructions(session, 'prompt'),
    },
  });
  sendUpstream(session, { type: 'input_audio_buffer.clear' });
  sendUpstream(session, {
    type: 'input_audio_buffer.append',
    audio: buildSilenceBase64(240),
  });
  sendUpstream(session, { type: 'input_audio_buffer.commit' });
  sendUpstream(session, { type: 'response.create' });
}

function evaluateAction(session, frames) {
  const step = currentStep(session);
  if (!step || step.type !== 'action') return;

  clearActionEvalTimer(session);
  session.phase = 'action_eval';
  session.lastAssistantTranscript = '';
  session.acceptUserTranscript = false;
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
      instructions: buildInstructions(session, 'evaluate_action'),
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
  if (!step || step.type !== 'speech') return;

  session.phase = 'speech_eval';
  session.lastAssistantTranscript = '';
  sendUpstream(session, {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      voice: REALTIME_VOICE,
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      turn_detection: null,
      input_audio_transcription: { model: 'gummy-realtime-v1' },
      temperature: 0.25,
      max_tokens: 320,
      instructions: buildInstructions(session, 'evaluate_speech'),
    },
  });
  (frames || []).forEach((frame) => {
    const image = stripDataUrlPrefix(frame);
    if (image) {
      sendUpstream(session, { type: 'input_image_buffer.append', image });
    }
  });
  sendUpstream(session, { type: 'input_audio_buffer.commit' });
  sendUpstream(session, { type: 'response.create' });
}

function handleAssistantDone(session) {
  const step = currentStep(session);
  const transcript = String(session.lastAssistantTranscript || '').trim();

  if (session.phase === 'action_prompt') {
    sendBrowser(session, 'action.capture.start', {
      step,
      durationMs: (step && step.durationMs) || ACTION_DURATION_MS,
    });
    return;
  }

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

  if (session.phase === 'speech_prompt') {
    session.acceptUserTranscript = true;
    sendBrowser(session, 'speech.capture.start', {
      step,
      durationMs: (step && step.durationMs) || SPEECH_DURATION_MS,
    });
    return;
  }

  if (session.phase === 'speech_eval') {
    const parsed = parseSpeechSummary(transcript);
    session.report.summary = parsed.summary;
    session.report.speechComment = parsed.speechComment;
    session.phase = 'complete';
    session.acceptUserTranscript = false;
    session.stepIndex += 1;
    sendBrowser(session, 'interview.complete', {
      report: session.report,
      summary: parsed.summary,
      speechComment: parsed.speechComment,
    });
  }
}

function createSession(browser) {
  return {
    browser,
    upstream: null,
    stepIndex: 0,
    phase: 'idle',
    acceptUserTranscript: false,
    actionEvalTimer: null,
    lastAssistantTranscript: '',
    report: {
      actions: [],
      transcripts: [],
      summary: '',
      speechComment: '',
    },
  };
}

function closeSession(session) {
  clearActionEvalTimer(session);
  if (session.upstream && session.upstream.readyState === WebSocket.OPEN) {
    session.upstream.close(1000, 'browser closed');
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
      sendBrowser(session, 'assistant.audio.delta', { delta: message.delta });
      return;
    }

    if (message.type === 'response.audio_transcript.delta') {
      session.lastAssistantTranscript += message.delta || '';
      sendBrowser(session, 'assistant.text.delta', { delta: message.delta || '' });
      return;
    }

    if (message.type === 'response.audio_transcript.done') {
      session.lastAssistantTranscript = String(message.transcript || session.lastAssistantTranscript || '').trim();
      sendBrowser(session, 'assistant.text.done', { text: session.lastAssistantTranscript });
      return;
    }

    if (message.type === 'conversation.item.input_audio_transcription.completed') {
      const text = String(message.transcript || '').trim();
      if (text && session.acceptUserTranscript) {
        session.report.transcripts.push(text);
        sendBrowser(session, 'user.transcript', { text });
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
        connectUpstream(session);
        return;
      }

      if (message.type === 'action.evaluate') {
        evaluateAction(session, Array.isArray(message.frames) ? message.frames.slice(0, 4) : []);
        return;
      }

      if (message.type === 'speech.audio_chunk') {
        if (session.upstream && session.upstream.readyState === WebSocket.OPEN && message.audio) {
          sendUpstream(session, {
            type: 'input_audio_buffer.append',
            audio: String(message.audio),
          });
        }
        return;
      }

      if (message.type === 'speech.finish') {
        finishSpeech(session, Array.isArray(message.frames) ? message.frames.slice(0, 4) : []);
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
  console.log('Omni interview backend listening on http://0.0.0.0:' + PORT);
  console.log('Realtime proxy path: ws://0.0.0.0:' + PORT + '/api/realtime');
});
