const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFinalEvaluationInstructions,
  parseFinalEvaluation,
} = require('../lib/final-evaluation');

test('buildFinalEvaluationInstructions includes question judgements and risks', () => {
  const instructions = buildFinalEvaluationInstructions({
    actions: [
      { label: '举左手', status: 'pass', note: '健康：动作正常，无异常。' },
      { label: '举右手', status: 'fail', note: '异常：动作未完成或不规范。' },
    ],
    questionEvaluations: [
      {
        label: '配送经验',
        transcript: '做过两年快递。',
        summary: '做过两年快递。',
        judgement: '有明确配送经验。',
        risk: '未说明离职原因。',
      },
      {
        label: '单量效率',
        transcript: '平时一天120单。',
        summary: '平时一天120单。',
        judgement: '效率信号较强。',
        risk: '未说明极端天气表现。',
      },
    ],
  });

  assert.match(instructions, /有明确配送经验/);
  assert.match(instructions, /未说明离职原因/);
  assert.match(instructions, /效率信号较强/);
  assert.match(instructions, /未说明极端天气表现/);
  assert.match(instructions, /严禁直接复述候选人原话拼接成结论/);
});

test('parseFinalEvaluation extracts structured courier final report', () => {
  const parsed = parseFinalEvaluation([
    '健康情况：双手动作基本完成，但右手动作稳定性一般。',
    '配送经验：候选人提到两年快递经验，具备基础配送背景。',
    '单量能力：回答中提到日常单量，说明有一定效率概念。',
    '异常处理：知道先联系客户再同步站点，处理路径基本合理。',
    '服务意识：投诉场景下能先安抚客户，服务意识中等。',
    '建议结论：建议继续复试，但重点核查稳定性和复杂投诉处理能力。',
    '总体总结：候选人具备基础快递经验，但仍需进一步验证细节。',
  ].join('\n'));

  assert.equal(parsed.healthConclusion, '双手动作基本完成，但右手动作稳定性一般。');
  assert.equal(parsed.experienceConclusion, '候选人提到两年快递经验，具备基础配送背景。');
  assert.equal(parsed.deliveryCapacity, '回答中提到日常单量，说明有一定效率概念。');
  assert.equal(parsed.exceptionHandling, '知道先联系客户再同步站点，处理路径基本合理。');
  assert.equal(parsed.serviceAwareness, '投诉场景下能先安抚客户，服务意识中等。');
  assert.equal(parsed.recommendation, '建议继续复试，但重点核查稳定性和复杂投诉处理能力。');
  assert.equal(parsed.summary, '候选人具备基础快递经验，但仍需进一步验证细节。');
});

test('parseFinalEvaluation supports single-line structured output', () => {
  const parsed = parseFinalEvaluation('健康情况：动作测试全部通过。 配送经验：具备两年配送经历。 单量能力：高峰单量较明确。 异常处理：处理路径基本合理。 服务意识：有基础安抚意识。 建议结论：建议进入下一轮。 总体总结：整体匹配度中等偏上。');

  assert.equal(parsed.healthConclusion, '动作测试全部通过。');
  assert.equal(parsed.experienceConclusion, '具备两年配送经历。');
  assert.equal(parsed.deliveryCapacity, '高峰单量较明确。');
  assert.equal(parsed.exceptionHandling, '处理路径基本合理。');
  assert.equal(parsed.serviceAwareness, '有基础安抚意识。');
  assert.equal(parsed.recommendation, '建议进入下一轮。');
  assert.equal(parsed.summary, '整体匹配度中等偏上。');
});

test('parseFinalEvaluation prefers strict json output', () => {
  const parsed = parseFinalEvaluation(JSON.stringify({
    healthConclusion: '动作测试全部通过。',
    experienceConclusion: '具备两年配送经历。',
    deliveryCapacity: '高峰单量较明确。',
    exceptionHandling: '处理路径基本合理。',
    serviceAwareness: '有基础安抚意识。',
    recommendation: '建议进入下一轮。',
    summary: '整体匹配度中等偏上。',
  }));

  assert.equal(parsed.healthConclusion, '动作测试全部通过。');
  assert.equal(parsed.experienceConclusion, '具备两年配送经历。');
  assert.equal(parsed.deliveryCapacity, '高峰单量较明确。');
  assert.equal(parsed.exceptionHandling, '处理路径基本合理。');
  assert.equal(parsed.serviceAwareness, '有基础安抚意识。');
  assert.equal(parsed.recommendation, '建议进入下一轮。');
  assert.equal(parsed.summary, '整体匹配度中等偏上。');
});
