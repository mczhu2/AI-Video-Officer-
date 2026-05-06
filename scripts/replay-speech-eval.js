#!/usr/bin/env node

const path = require('path');

const {
  DEFAULT_LOG_FILE,
  parseJsonlFile,
  buildReplayPayloadFromRecords,
  runSpeechReplay,
} = require('../lib/replay-speech-eval');

function readArg(name) {
  const entry = process.argv.find((item) => item.startsWith(name + '='));
  return entry ? entry.slice(name.length + 1) : '';
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const logPath = readArg('--log') || DEFAULT_LOG_FILE;
  const sessionId = readArg('--session');
  const dryRun = hasFlag('--dry-run');
  const records = parseJsonlFile(logPath);
  const replayPayload = buildReplayPayloadFromRecords(records, sessionId);

  const report = {
    logPath: path.resolve(logPath),
    sessionId: replayPayload.sessionId,
    requestTimestamp: replayPayload.requestTimestamp,
    transcriptCount: replayPayload.transcripts.length,
    frameCount: replayPayload.frames.length,
    originalRawTranscript: replayPayload.originalRawTranscript,
    originalParsed: replayPayload.originalParsed,
  };

  if (dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      replayPayload: report,
      transcripts: replayPayload.transcripts,
    }, null, 2));
    return;
  }

  const replayResult = await runSpeechReplay(replayPayload, {});

  console.log(JSON.stringify({
    mode: 'replay',
    replayPayload: report,
    replayRawTranscript: replayResult.rawTranscript,
    replayParsed: replayResult.parsed,
  }, null, 2));
}

main().catch((err) => {
  console.error('[replay-speech-eval] ' + (err && err.message ? err.message : err));
  process.exit(1);
});
