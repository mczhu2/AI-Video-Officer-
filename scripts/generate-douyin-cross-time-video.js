#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readArg(name) {
  const entry = process.argv.find((item) => item.startsWith(name + '='));
  return entry ? entry.slice(name.length + 1) : '';
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  return [
    'Usage:',
    '  node scripts/generate-douyin-cross-time-video.js --theme=拖延症 [--people=4] [--output=out.md]',
    '',
    'Options:',
    '  --theme=<主题>       Required unless --template is used.',
    '  --people=<3-5>       Number of cross-time characters. Default: 4.',
    '  --output=<file>      Write Markdown prompt to file instead of stdout.',
    '  --template           Emit a placeholder template instead of a filled prompt.',
    '  --help               Show this help.',
  ].join('\n');
}

function parsePeople(rawValue) {
  const value = rawValue ? Number(rawValue) : 4;
  if (!Number.isInteger(value) || value < 3 || value > 5) {
    throw new Error('--people must be an integer from 3 to 5.');
  }
  return value;
}

function buildPrompt({ theme, people, template }) {
  const themeText = template ? '{{填写主题}}' : theme;
  const peopleText = template ? '{{3-5}}' : String(people);

  return `# 抖音跨时空人物独白视频提示词

你是一名资深抖音短视频爆款编剧、短剧导演、分镜师和 AI 视频提示词设计师。你有丰富的短视频爆款经验，擅长用强钩子、反差人物、情绪刀口、黑色幽默和电影感画面，创作高完播、高评论、高转发的短视频内容。

我要制作一个“跨时空人物独白拼接短视频”系列。每条视频围绕一个主题展开，由 3-5 个来自不同时空/身份的人物组成。每个人物独白 5-8 秒，最后用一张结尾图片打印核心思想文案点明主题。

【主题】：${themeText}
【人数】：${peopleText} 人

## 一、创作目标

1. 视频要适合抖音传播。
2. 前 1 秒必须有停留钩子。
3. 中段要有反差、冲突、荒诞和共鸣。
4. 结尾要有一句能让人截图、转发或评论的核心文案。
5. 整体风格：视觉上像韩剧/爆款短剧名场面，内容上有黑色幽默，最后突然认真。
6. 不要平淡鸡汤，不要普通段子，不要像作文，不要只让人物站着念台词。

## 二、爆款结构要求

### 0-1 秒：强钩子

- 用一句话或一个画面让人停住。
- 可以是反常识、强代入、悬念、扎心问题、荒诞设定。
- 示例句式：
  - “如果拖延症有审判现场……”
  - “如果古人也有精神内耗……”
  - “如果人生可以点‘稍后提醒’……”

### 1-3 秒：主题定场

- 用大字字幕或旁白快速告诉观众这期讲什么。
- 不能解释太多，要短、狠、清楚。

### 中段：${peopleText} 个跨时空人物独白

- 每个人 5-8 秒。
- 每个人必须承担不同功能：
  1. 第一个人物：强反差，负责抓眼球。
  2. 第二个人物：现实共鸣，负责让观众代入。
  3. 第三个人物：荒诞升级，负责制造记忆点。
  4. 第四/第五个人物可选：负责补刀、升华或反转。
- 人物不能随机拼接，必须围绕同一个主题递进。

### 结尾 2-3 秒：图片金句

- 一张视觉统一的结尾图。
- 打印式字幕点明核心思想。
- 文案要能被截图、转发、评论。
- 不要普通鸡汤，要有锋利感。

## 三、刀口要求

整条视频至少包含 3 个以上刀口，每个人物至少包含 2 个刀口：

1. 身份刀：这个身份不该这样，但偏偏这样。
2. 处境刀：人物不是安全地说话，而是处在高压、崩溃、危险、荒诞或命运转折点。
3. 心理刀：戳中观众不好意思承认的真实心理。
4. 后果刀：把一个小问题夸张成严重后果。
5. 时代刀：古代、现代、未来都逃不开同一个人性问题。
6. 反转刀：台词前半句像解释、借口或认真表达，后半句突然反转。
7. 评论刀：设计一句容易让观众评论“这不就是我吗”“别骂了”“太真实了”的内容。

## 四、台词要求

每个人物只说一句话，但这句话必须有反差曲折。

台词结构建议：

- 前半句：像认真、借口、解释、装镇定。
- 后半句：突然露出真实心理、荒诞后果或扎心真相。

不要写：

- “我要努力。”
- “不要拖延。”
- “人生要自律。”

要写成：

- “我每天都准备重新开始，只是今天还没准备好做人。”
- “我不是没开始，我是在等压力把我逼成另一个人。”
- “人类不是输给灾难，是输给了再等五分钟。”

## 五、视觉风格要求

整体参考韩剧爆款短剧/影视名场面的视听语言，但不要照搬具体作品。

可以使用：

- 雨夜霓虹
- 慢镜头推脸
- 情绪特写
- 心跳音效
- 突然静音
- 巨大字幕压屏
- 红色警报
- 回忆闪回
- 命运感 BGM
- 高对比光影
- 眼神特写
- 屏幕弹窗压迫感

注意：特效不能乱堆。每个特效都必须服务这个人物的情绪或反转。

## 六、每个人物请输出以下字段

【人物序号】

- 时空/身份：
- 视觉年龄：
- 角色功能：抓眼球 / 共鸣 / 荒诞升级 / 补刀 / 升华 / 反转
- 背景画：具体描述地点、时代、光线、色调、关键道具、环境压力。
- 衣着：符合人物身份，可以有轻微反差。
- 动作：5-8 秒内可完成，必须能体现人物心理。
- 表情：描述表情变化。
- 语气：冷静、疲惫、崩溃、讽刺、自嘲、帝王式严肃等。
- 节奏控制：哪几个字重读，哪里停顿，最后如何收。
- 韩剧式特效：镜头、字幕、音效、闪回、灯光、慢动作等。
- 台词：一句话，必须有反差曲折和刀口。
- 使用的刀口：至少标出 2 个。
- 场景合理性：说明为什么这个人物、这个场景、这句台词是成立的。
- 观众反应预期：观众可能会笑、沉默、共鸣、评论什么。

## 七、整体递进逻辑

请说明：

1. 为什么第一个人物能在前 3 秒抓住观众？
2. 第二个人物如何让普通观众代入？
3. 第三个人物如何把主题荒诞放大？
4. 第四/第五个人物如果存在，如何补刀或升华？
5. 为什么这些人物放在一起是一个完整表达，而不是随机拼接？

## 八、结尾图片设计

请输出：

- 画面描述：
- 色调：
- 字体风格：
- 排版方式：
- 打印式核心文案：
- 文案情绪：扎心 / 清醒 / 黑色幽默 / 温柔补刀 / 突然认真
- 评论引导：设计一句不生硬的评论引导，比如让观众想说“我就是这样”。

## 九、封面与标题

请输出 5 个抖音标题，要求有点击欲但不低俗：

1.
2.
3.
4.
5.

请输出 3 个封面大字：

1.
2.
3.

## 十、成片时间轴

请按时间轴输出：

- 0-1 秒：
- 1-3 秒：
- 3-{{时间}} 秒：人物 1
- {{时间}}-{{时间}} 秒：人物 2
- {{时间}}-{{时间}} 秒：人物 3
- 可选人物 4/5：
- 最后 2-3 秒：结尾图片

## 十一、自检清单

生成后请自检，并直接指出哪里还可以更狠：

1. 前 1 秒有没有停留钩子？
2. 每个人物有没有至少 2 个刀口？
3. 整条视频有没有至少 3 个以上刀口？
4. 台词有没有反差曲折？
5. 有没有一句能让观众评论“太真实了”的话？
6. 结尾文案有没有截图传播价值？
7. 视觉特效是否服务情绪，而不是乱堆？
8. 人物之间是否有递进，而不是平铺？
9. 有没有平淡鸡汤？如果有，请重写。
10. 有没有更狠、更短、更像抖音爆款的表达？如果有，请给出优化版。

## 输出要求

- 先给完整版本。
- 再给一个“更狠版”台词优化。
- 最后给一个“更稳妥版”适合大众传播。
`;
}

function main() {
  if (hasFlag('--help')) {
    console.log(usage());
    return;
  }

  const template = hasFlag('--template');
  const theme = readArg('--theme').trim();
  const people = parsePeople(readArg('--people'));

  if (!template && !theme) {
    throw new Error('--theme is required unless --template is used.');
  }

  const prompt = buildPrompt({ theme, people, template });
  const output = readArg('--output');

  if (output) {
    const outputPath = path.resolve(output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, prompt, 'utf8');
    console.log(JSON.stringify({ outputPath, theme: template ? null : theme, people }, null, 2));
    return;
  }

  console.log(prompt);
}

try {
  main();
} catch (err) {
  console.error('[generate-douyin-cross-time-video] ' + (err && err.message ? err.message : err));
  console.error('');
  console.error(usage());
  process.exit(1);
}
