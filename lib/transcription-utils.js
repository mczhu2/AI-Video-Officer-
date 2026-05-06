const ENGLISH_FILLER_PATTERNS = [
  /^thank\s*you[.!?]?$/i,
  /^you[.!?]?$/i,
  /^ok(?:ay)?[.!?]?$/i,
  /^hello[.!?]?$/i,
];

function isMeaningfulTranscript(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  if (ENGLISH_FILLER_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return normalized.length >= 2;
}

function shouldRetryTranscriptionWait({ transcriptCount, retryCount }) {
  return Number(transcriptCount || 0) === 0 && Number(retryCount || 0) === 0;
}

module.exports = {
  isMeaningfulTranscript,
  shouldRetryTranscriptionWait,
};
