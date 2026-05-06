const ACTION_DURATION_MS = 5000;

const INTERVIEW_STEPS = [
  {
    id: 'left_hand',
    type: 'action',
    label: '举左手',
    prompt: '你好，请举起左手并保持五秒。',
    criteria: '左手需要明显抬起，至少高于腰部，最好接近肩部；不能只是轻微移动手臂。',
    durationMs: ACTION_DURATION_MS,
  },
  {
    id: 'right_hand',
    type: 'action',
    label: '举右手',
    prompt: '你好，请举起右手并保持五秒。',
    criteria: '右手需要明显抬起，至少高于腰部，最好接近肩部；不能只是轻微移动手臂。',
    durationMs: ACTION_DURATION_MS,
  },
  {
    id: 'courier_q1',
    type: 'question',
    label: '配送经验',
    prompt: '第一个问题：你做过快递、外卖或者同城配送吗？做了多久？主要负责什么？',
    durationMs: 0,
  },
  {
    id: 'courier_q2',
    type: 'question',
    label: '单量效率',
    prompt: '第二个问题：你平时一天大概能派送多少单？高峰时最多能做到多少单？',
    durationMs: 0,
  },
  {
    id: 'courier_q3',
    type: 'question',
    label: '异常处理',
    prompt: '第三个问题：如果客户电话打不通，或者地址不清楚，你一般会怎么处理？',
    durationMs: 0,
  },
  {
    id: 'courier_q4',
    type: 'question',
    label: '投诉处理',
    prompt: '第四个问题：你遇到过客户投诉吗？通常是什么原因？你是怎么处理的？',
    durationMs: 0,
  },
];

function readField(raw, name) {
  const match = raw.match(new RegExp(name + '[:：]\\s*([\\s\\S]*?)(?:\\n|$)'));
  return match ? match[1].trim() : '';
}

function buildQuestionFallback(step, transcript, raw) {
  const normalizedTranscript = String(transcript || '').trim();
  const short = normalizedTranscript.length < 10;
  return {
    stepId: step.id,
    label: step.label,
    transcript: normalizedTranscript,
    summary: short ? '回答内容较少，信息不足。' : normalizedTranscript,
    judgement: short ? '回答过于简短，暂时无法形成稳定判断。' : '回答包含基础信息，可结合下一轮追问继续判断。',
    risk: raw
      ? '模型返回格式不完整，已回退为保守解析。'
      : '候选人提供的信息有限，建议追问具体细节。',
    raw: String(raw || '').trim(),
  };
}

function parseCourierQuestionEvaluation(text, step, transcript) {
  const raw = String(text || '').trim();
  const normalizedStep = step || { id: '', label: '' };
  const summary = readField(raw, '概述');
  const judgement = readField(raw, '判断');
  const risk = readField(raw, '风险');

  if (!summary && !judgement && !risk) {
    return buildQuestionFallback(normalizedStep, transcript, raw);
  }

  return {
    stepId: normalizedStep.id,
    label: normalizedStep.label,
    transcript: String(transcript || '').trim(),
    summary,
    judgement,
    risk,
    raw,
  };
}

function buildHealthConclusion(actions) {
  const items = Array.isArray(actions) ? actions : [];
  if (!items.length) return '未记录到完整的健康动作结果。';
  const passed = items.filter((item) => item.status === 'pass').length;
  if (passed === items.length) {
    return '双手动作完成，基础肢体配合正常。';
  }
  return '肢体动作存在未完成项，建议复核健康状态和执行配合度。';
}

function pickAnswer(questionEvaluations, stepId) {
  return (Array.isArray(questionEvaluations) ? questionEvaluations : []).find((item) => item.stepId === stepId) || null;
}

function buildCourierInterviewReport(report) {
  const actions = Array.isArray(report && report.actions) ? report.actions : [];
  const questionEvaluations = Array.isArray(report && report.questionEvaluations) ? report.questionEvaluations : [];
  const q1 = pickAnswer(questionEvaluations, 'courier_q1');
  const q2 = pickAnswer(questionEvaluations, 'courier_q2');
  const q3 = pickAnswer(questionEvaluations, 'courier_q3');
  const q4 = pickAnswer(questionEvaluations, 'courier_q4');
  const allActionsPass = actions.length >= 2 && actions.every((item) => item.status === 'pass');
  const allQuestionsAnswered = questionEvaluations.length >= 4 && questionEvaluations.every((item) => String(item.transcript || '').trim());

  const finalReport = {
    healthConclusion: buildHealthConclusion(actions),
    experienceConclusion: q1
      ? '配送经验：' + (q1.transcript || q1.summary || q1.judgement || '已回答，但信息有限。')
      : '配送经验：未获取到有效回答。',
    deliveryCapacity: q2
      ? '单量效率：' + (q2.transcript || q2.summary || q2.judgement || '已回答，但信息有限。')
      : '单量效率：未获取到有效回答。',
    exceptionHandling: q3
      ? '异常处理：' + (q3.transcript || q3.summary || q3.judgement || '已回答，但信息有限。')
      : '异常处理：未获取到有效回答。',
    serviceAwareness: q4
      ? '服务意识：' + (q4.transcript || q4.summary || q4.judgement || '已回答，但信息有限。')
      : '服务意识：未获取到有效回答。',
    recommendation: allActionsPass && allQuestionsAnswered
      ? '建议进入下一轮，重点继续核实路线熟悉度、出勤稳定性和高峰承压能力。'
      : '暂不建议直接推进，需先补充核实健康动作或关键问答信息。',
    summary: allActionsPass && allQuestionsAnswered
      ? '快递员面试整体完成度较好，已获得基础健康判断和岗位经验线索。'
      : '快递员面试信息尚不完整，需要补充核验后再给出明确结论。',
  };

  return finalReport;
}

module.exports = {
  ACTION_DURATION_MS,
  INTERVIEW_STEPS,
  parseCourierQuestionEvaluation,
  buildCourierInterviewReport,
};
