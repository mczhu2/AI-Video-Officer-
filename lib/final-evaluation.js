const { buildCourierInterviewReport } = require('./courier-interview');

function buildActionSummary(actions) {
  const items = Array.isArray(actions) ? actions : [];
  if (!items.length) return '未记录到动作结果。';
  return items.map((item) => {
    const statusText = item.status === 'pass' ? '通过' : item.status === 'fail' ? '未通过' : '待确认';
    return [item.label, '动作结果：' + statusText, item.note ? '说明：' + item.note : '说明：无'].join('，');
  }).join('\n');
}

function buildQuestionSummary(questionEvaluations) {
  const items = Array.isArray(questionEvaluations) ? questionEvaluations : [];
  if (!items.length) return '未记录到问答评估结果。';
  return items.map((item, index) => {
    return [
      '问题' + (index + 1) + '：' + (item.label || '未命名问题'),
      '原始回答：' + (item.transcript || '无有效回答'),
      '概述：' + (item.summary || '无'),
      '判断：' + (item.judgement || '无'),
      '风险：' + (item.risk || '无'),
    ].join('\n');
  }).join('\n\n');
}

function buildFinalEvaluationInstructions(report) {
  return [
    '你是快递员岗位的终面评估官。',
    '你会收到动作结果和4道面试题的结构化评估。',
    '你的任务是基于这些评估结果做最终综合判断。',
    '严禁直接复述候选人原话拼接成结论，必须优先使用每题的“判断”和“风险”来形成综合分析。',
    '如果某题信息不足，要在对应结论里明确指出，而不是默认正向通过。',
    '你必须只输出一个合法 JSON 对象，不要输出 markdown，不要输出解释文字。',
    'JSON 必须严格包含以下字段：',
    '{',
    '  "healthConclusion": "...",',
    '  "experienceConclusion": "...",',
    '  "deliveryCapacity": "...",',
    '  "exceptionHandling": "...",',
    '  "serviceAwareness": "...",',
    '  "recommendation": "...",',
    '  "summary": "..."',
    '}',
    '每个字段都必须是中文字符串，不能为空。',
    '',
    '动作结果：',
    buildActionSummary(report && report.actions),
    '',
    '问答评估：',
    buildQuestionSummary(report && report.questionEvaluations),
  ].join('\n');
}

function readField(raw, name) {
  const fieldNames = ['健康情况', '配送经验', '单量能力', '异常处理', '服务意识', '建议结论', '总体总结'];
  const otherNames = fieldNames.filter((item) => item !== name).join('|');
  const match = raw.match(new RegExp(name + '[:：]\\s*([\\s\\S]*?)(?=(?:' + otherNames + ')[:：]|\\n|$)'));
  return match ? match[1].trim() : '';
}

function parseFinalEvaluation(text) {
  const raw = String(text || '').trim();
  if (raw) {
    try {
      const json = JSON.parse(raw);
      if (json && typeof json === 'object') {
        return {
          healthConclusion: String(json.healthConclusion || '').trim(),
          experienceConclusion: String(json.experienceConclusion || '').trim(),
          deliveryCapacity: String(json.deliveryCapacity || '').trim(),
          exceptionHandling: String(json.exceptionHandling || '').trim(),
          serviceAwareness: String(json.serviceAwareness || '').trim(),
          recommendation: String(json.recommendation || '').trim(),
          summary: String(json.summary || '').trim(),
          raw,
        };
      }
    } catch (err) {
    }
  }
  return {
    healthConclusion: readField(raw, '健康情况'),
    experienceConclusion: readField(raw, '配送经验'),
    deliveryCapacity: readField(raw, '单量能力'),
    exceptionHandling: readField(raw, '异常处理'),
    serviceAwareness: readField(raw, '服务意识'),
    recommendation: readField(raw, '建议结论'),
    summary: readField(raw, '总体总结'),
    raw,
  };
}

function hasStructuredFinalEvaluation(parsed) {
  return !!(
    parsed &&
    parsed.healthConclusion &&
    parsed.experienceConclusion &&
    parsed.deliveryCapacity &&
    parsed.exceptionHandling &&
    parsed.serviceAwareness &&
    parsed.recommendation &&
    parsed.summary
  );
}

function buildFinalEvaluationFallback(report, raw) {
  const fallback = buildCourierInterviewReport(report || {});
  return Object.assign({}, fallback, {
    raw: String(raw || '').trim(),
  });
}

module.exports = {
  buildFinalEvaluationInstructions,
  parseFinalEvaluation,
  hasStructuredFinalEvaluation,
  buildFinalEvaluationFallback,
};
