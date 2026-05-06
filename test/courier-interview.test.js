const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INTERVIEW_STEPS,
  parseCourierQuestionEvaluation,
  buildCourierInterviewReport,
} = require('../lib/courier-interview');

test('INTERVIEW_STEPS exposes courier interview flow', () => {
  assert.deepEqual(
    INTERVIEW_STEPS.map((step) => step.id),
    ['left_hand', 'right_hand', 'courier_q1', 'courier_q2', 'courier_q3', 'courier_q4']
  );
  assert.equal(INTERVIEW_STEPS[2].label, '配送经验');
  assert.equal(INTERVIEW_STEPS[5].type, 'question');
});

test('parseCourierQuestionEvaluation extracts structured fields', () => {
  const parsed = parseCourierQuestionEvaluation(
    [
      '概述：做过两年同城配送，主要负责日常派件。',
      '判断：有明确配送经验，回答比较具体。',
      '风险：暂未说明投诉处理细节。',
    ].join('\n'),
    { id: 'courier_q1', label: '配送经验' },
    '做过两年同城配送，主要负责日常派件。'
  );

  assert.equal(parsed.stepId, 'courier_q1');
  assert.equal(parsed.label, '配送经验');
  assert.equal(parsed.transcript, '做过两年同城配送，主要负责日常派件。');
  assert.equal(parsed.summary, '做过两年同城配送，主要负责日常派件。');
  assert.equal(parsed.judgement, '有明确配送经验，回答比较具体。');
  assert.equal(parsed.risk, '暂未说明投诉处理细节。');
});

test('buildCourierInterviewReport aggregates action and question results', () => {
  const report = buildCourierInterviewReport({
    actions: [
      { stepId: 'left_hand', label: '举左手', status: 'pass', note: '健康：动作正常，无异常。' },
      { stepId: 'right_hand', label: '举右手', status: 'pass', note: '健康：动作正常，无异常。' },
    ],
    questionEvaluations: [
      {
        stepId: 'courier_q1',
        label: '配送经验',
        transcript: '做过两年快递，熟悉片区派件。',
        summary: '做过两年快递，熟悉片区派件。',
        judgement: '有明确配送经验。',
        risk: '未提到离职原因。',
      },
      {
        stepId: 'courier_q2',
        label: '单量效率',
        transcript: '平时一天 120 单，高峰能到 180 单。',
        summary: '平时 120 单，高峰 180 单。',
        judgement: '单量表达具体，效率信号较强。',
        risk: '未说明极端天气应对。',
      },
      {
        stepId: 'courier_q3',
        label: '异常处理',
        transcript: '先联系客户，再联系站点，最后备注异常。',
        summary: '会先联系客户，再同步站点。',
        judgement: '有基本异常处理流程。',
        risk: '需要确认超时件处理熟练度。',
      },
      {
        stepId: 'courier_q4',
        label: '投诉处理',
        transcript: '遇到投诉会先道歉，再解释情况并上报站长。',
        summary: '遇到投诉会先安抚并上报。',
        judgement: '服务意识较稳定。',
        risk: '未提供复杂投诉案例。',
      },
    ],
  });

  assert.match(report.healthConclusion, /双手动作完成/);
  assert.match(report.experienceConclusion, /两年快递/);
  assert.match(report.deliveryCapacity, /120 单/);
  assert.match(report.exceptionHandling, /联系客户/);
  assert.match(report.serviceAwareness, /投诉/);
  assert.match(report.recommendation, /建议进入下一轮/);
  assert.match(report.summary, /快递员面试/);
});
