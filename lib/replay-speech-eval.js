const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocket } = require('ws');

const DEFAULT_LOG_FILE = path.join(__dirname, '..', 'logs', 'interview-debug.jsonl');
const DEFAULT_REALTIME_MODEL = process.env.DASHSCOPE_REALTIME_MODEL || 'qwen3.5-omni-plus-realtime';
const DEFAULT_REALTIME_URL =
  (process.env.DASHSCOPE_REALTIME_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime') +
  '?model=' + encodeURIComponent(DEFAULT_REALTIME_MODEL);
const DEFAULT_REALTIME_VOICE = process.env.DASHSCOPE_REALTIME_VOICE || 'Tina';

function makeEventId(prefix) {
  return (prefix || 'evt') + '_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
}

function buildSilenceBase64(durationMs) {
  const sampleRate = 16000;
  const samples = Math.max(1, Math.floor(sampleRate * (durationMs || 240) / 1000));
  return Buffer.alloc(samples * 2).toString('base64');
}

function parseJsonlFile(filePath) {
  const absolutePath = path.resolve(filePath || DEFAULT_LOG_FILE);
  const content = fs.readFileSync(absolutePath, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildReplayPayloadFromRecords(records, targetSessionId) {
  const requestRecords = records.filter(
    (record) => record.event === 'question.evaluate.request' || record.event === 'speech.evaluate.request'
  );
  if (!requestRecords.length) {
    throw new Error('未找到可重放的 speech.evaluate.request 或 question.evaluate.request 记录');
  }

  const chosenRequest = targetSessionId
    ? requestRecords.find((record) => record.payload && record.payload.sessionId === targetSessionId)
    : requestRecords[requestRecords.length - 1];

  if (!chosenRequest) {
    throw new Error('未找到指定 session 的 speech.evaluate.request 记录');
  }

  const sessionId = chosenRequest.payload.sessionId;
  const responseRecord = [...records]
    .reverse()
    .find(
      (record) =>
        (record.event === 'question.evaluate.response' || record.event === 'speech.evaluate.response') &&
        record.payload &&
        record.payload.sessionId === sessionId
    );

  const transcriptRecords = records.filter(
    (record) => record.event === 'user.transcript.completed' && record.payload && record.payload.sessionId === sessionId
  );

  return {
    sessionId,
    requestTimestamp: chosenRequest.timestamp,
    stepLabel: chosenRequest.payload.stepLabel || '',
    instructions: chosenRequest.payload.instructions || '',
    frames: Array.isArray(chosenRequest.payload.frames) ? chosenRequest.payload.frames : [],
    transcripts: Array.isArray(chosenRequest.payload.transcripts) && chosenRequest.payload.transcripts.length
      ? chosenRequest.payload.transcripts
      : transcriptRecords.map((record) => record.payload.transcript).filter(Boolean),
    originalRawTranscript: responseRecord && responseRecord.payload ? responseRecord.payload.rawTranscript || '' : '',
    originalParsed: responseRecord && responseRecord.payload ? responseRecord.payload.parsed || null : null,
  };
}

function parseSpeechEvaluationText(text) {
  const raw = String(text || '').trim();
  const readField = (name) => {
    const match = raw.match(new RegExp(name + '[:：]\\s*([\\s\\S]*?)(?:\\n|$)'));
    return match ? match[1].trim() : '';
  };

  const questionSummary = readField('概述');
  const questionJudgement = readField('判断');
  const questionRisk = readField('风险');

  if (questionSummary || questionJudgement || questionRisk) {
    return {
      summary: questionSummary,
      judgement: questionJudgement,
      risk: questionRisk,
      raw,
    };
  }

  return {
    summary: readField('总结'),
    expression: readField('表达'),
    experienceSignal: readField('经验'),
    jobFitHint: readField('岗位建议'),
    comment: readField('点评'),
    raw,
  };
}

function runSpeechReplay(payload, options) {
  const apiKey = options.apiKey || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 DASHSCOPE_API_KEY，无法执行 replay');
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(options.realtimeUrl || DEFAULT_REALTIME_URL, {
      headers: {
        Authorization: 'Bearer ' + apiKey,
      },
    });

    let assistantTranscript = '';
    let settled = false;

    const settle = (value, isError) => {
      if (settled) return;
      settled = true;
      try {
        socket.close(1000, 'replay complete');
      } catch (err) {
      }
      if (isError) {
        reject(value);
        return;
      }
      resolve(value);
    };

    socket.on('open', () => {
      const send = (message) => {
        socket.send(JSON.stringify(Object.assign({ event_id: makeEventId('evt') }, message)));
      };

      send({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          voice: options.voice || DEFAULT_REALTIME_VOICE,
          input_audio_format: 'pcm',
          output_audio_format: 'pcm',
          turn_detection: null,
          temperature: 0.25,
          max_tokens: 320,
          instructions: payload.instructions,
        },
      });

      send({ type: 'input_audio_buffer.clear' });
      send({
        type: 'input_audio_buffer.append',
        audio: buildSilenceBase64(240),
      });

      payload.frames.forEach((image) => {
        if (image) {
          send({ type: 'input_image_buffer.append', image });
        }
      });

      send({ type: 'input_audio_buffer.commit' });

      send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: payload.stepLabel
                ? '面试问题：' + payload.stepLabel + '\n候选人回答转写：' + (payload.transcripts.join('\n').trim() || '（无有效转写）')
                : '候选人自我介绍转写：' + (payload.transcripts.join('\n').trim() || '（无有效转写）'),
            },
          ],
        },
      });

      send({ type: 'response.create' });
    });

    socket.on('message', (raw) => {
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
        settle({
          rawTranscript: String(assistantTranscript || '').trim(),
          parsed: parseSpeechEvaluationText(assistantTranscript),
        });
        return;
      }

      if (message.type === 'error') {
        const detail = message.error && message.error.message ? message.error.message : JSON.stringify(message);
        settle(new Error('Replay 失败：' + detail), true);
      }
    });

    socket.on('error', (err) => settle(err, true));
    socket.on('close', () => {
      if (!settled) {
        settle({
          rawTranscript: String(assistantTranscript || '').trim(),
          parsed: parseSpeechEvaluationText(assistantTranscript),
        });
      }
    });
  });
}

module.exports = {
  DEFAULT_LOG_FILE,
  parseJsonlFile,
  buildReplayPayloadFromRecords,
  parseSpeechEvaluationText,
  runSpeechReplay,
};
