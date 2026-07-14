#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

loadEnvFile(path.join(process.cwd(), '.env.magic666'));
loadEnvFile(path.join(process.cwd(), '.env.minimax'));

const API_BASE = process.env.MAGIC666_BASE_URL || 'https://api.magic666.top/v1';
const IMAGE_MODEL = 'gpt-image-2';
const VIDEO_MODEL = process.env.MAGIC666_VIDEO_MODEL || 'grok-video-3-pro';
const VOICE_MODEL = process.env.MAGIC666_VOICE_MODEL || 'gpt-4o-realtime-preview';
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
const MINIMAX_TTS_MODEL = process.env.MINIMAX_TTS_MODEL || 'speech-02-hd';
const MINIMAX_VOICE_ID = process.env.MINIMAX_VOICE_ID || 'male-qn-qingse';
const IMAGE_SIZE = process.env.MAGIC666_IMAGE_SIZE || readArg('--image-size') || '1536x1024';
const VIDEO_ASPECT = process.env.MAGIC666_VIDEO_ASPECT || readArg('--video-aspect') || '16:9';
const FONT = '/System/Library/Fonts/STHeiti Medium.ttc';

/*
最终版调整记录（离职幻想）：
- 开头文案：时代一直在变，想自由的人没变。只是生活，从不轻易放人。
- 结尾文案：想走是真的。走不了，也是真的。牛马不是不想休息，而是生活还在挥着鞭。
- 封面文字层必须从 script.hook / script.setup 读取，避免旁白更新后画面还保留旧标题。
- 中文文字不交给 image2 直接生成；先生成无字底图，再本地叠加 PNG 文字层。
- 图片检查先走 --preview-images 生成压缩 JPG，再人工识别内容。
- 首尾旁白使用 MiniMax speech-2.8-turbo，项目默认音色在 .env.minimax 中配置。
- 首尾静态段旁白前后各留 1 秒，避免声音贴边突兀。
- 视频切换不用黑场，默认使用 0.3 秒模糊交叉过渡，音频首尾 0.15 秒淡入淡出。
- 最终检查顺序：--compose-grok-video -> --inspect-grok-video -> --preview-grok-video。
*/

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function readArg(name) {
  const entry = process.argv.find((item) => item.startsWith(name + '='));
  return entry ? entry.slice(name.length + 1) : '';
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toSpeechText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

function usage() {
  return [
    'Usage:',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 [--auth-from-reference=/path/workbench/server.py]',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 --postprocess-images',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 --voiceover-responses',
    '  MINIMAX_API_KEY=... MINIMAX_GROUP_ID=... node scripts/make-douyin-magic666-video.js --theme=离职幻想 --voiceover-minimax',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 --compose-static-video',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 --compose-grok-video',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 --compose-grok-video --transition-duration=0.3 --audio-fade=0.15',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 --preview-images',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 --preview-grok-video',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 --inspect-grok-video',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 --images-only --only-scene=tao-yuanming',
    '  node scripts/make-douyin-magic666-video.js --theme=离职幻想 --videos-only --only-scene=tao-yuanming',
    '',
    'Auth:',
    '  MAGIC666_API_KEY or MAGIC666_AUTH is preferred.',
    '  --auth-from-reference can read the legacy WorkBuddy server.py AUTH value without printing it.',
    '  --postprocess-images, --compose-static-video, and --compose-grok-video use existing local assets only and do not require auth.',
    '',
    'Current final workflow:',
    '  1. --postprocess-images',
    '  2. --voiceover-minimax',
    '  3. --compose-grok-video',
    '  4. --preview-images / --preview-grok-video / --inspect-grok-video',
    '',
    'Final style notes:',
    '  --compose-grok-video uses 1s lead/trail silence on cover and ending voiceovers.',
    '  Scene cuts use blurred cross transitions by default, not black frames.',
    '  Tune with --transition-duration and --audio-fade when the pacing feels too abrupt or too slow.',
  ].join('\n');
}

function resolveAuth() {
  if (process.env.MAGIC666_AUTH) return process.env.MAGIC666_AUTH;
  if (process.env.MAGIC666_API_KEY) return 'Bearer ' + process.env.MAGIC666_API_KEY;

  const reference = readArg('--auth-from-reference');
  if (reference) {
    const source = fs.readFileSync(reference, 'utf8');
    const match = source.match(/AUTH\s*=\s*['"]([^'"]+)['"]/);
    if (!match) throw new Error('Cannot find AUTH assignment in reference file.');
    return match[1];
  }

  throw new Error('Missing MAGIC666_API_KEY/MAGIC666_AUTH or --auth-from-reference.');
}

function resolveMinimaxAuth() {
  const apiKey = process.env.MINIMAX_API_KEY || readArg('--minimax-api-key');
  const groupId = process.env.MINIMAX_GROUP_ID || readArg('--minimax-group-id');
  if (!apiKey || !groupId) {
    throw new Error('Missing MINIMAX_API_KEY/MINIMAX_GROUP_ID for --voiceover-minimax.');
  }
  return { apiKey, groupId };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: options.stdio || 'pipe', env: options.env || process.env });
}

function getMediaDuration(filePath) {
  const output = execFileSync('ffprobe', [
    '-hide_banner',
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf8' }).trim();
  const duration = Number(output);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Cannot read media duration: ${filePath}`);
  }
  return duration;
}

function inspectMedia(filePath) {
  if (!fs.existsSync(filePath)) {
    const dir = path.dirname(filePath);
    const alternatives = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((name) => name.endsWith('-grok-draft.mp4'))
      : [];
    const suffix = alternatives.length
      ? ` Existing grok drafts: ${alternatives.join(', ')}.`
      : ' Run --compose-grok-video first.';
    throw new Error(`Missing media file: ${filePath}.${suffix}`);
  }
  const output = execFileSync('ffprobe', [
    '-hide_banner',
    '-v', 'error',
    '-show_entries', 'format=duration,size',
    '-show_entries', 'stream=index,codec_type,codec_name,width,height,duration,sample_rate,channels',
    '-of', 'json',
    filePath,
  ], { encoding: 'utf8' });
  return JSON.parse(output);
}

function sanitizeName(value) {
  return value.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'video';
}

function promptForLizhihuanxiang() {
  return {
    theme: '离职幻想',
    title: '如果辞职也要审核',
    hook: '时代一直在变，想自由的人没变。',
    setup: '只是生活，从不轻易放人。',
    ending: '想走是真的。\n走不了，也是真的。\n牛马不是不想休息，\n而是生活还在挥着鞭。',
    coverImagePrompt: [
      'Cinematic Korean drama poster, three resignation applications floating in the air:',
      'an ancient bamboo slip, a modern laptop document, and a futuristic holographic shutdown request,',
      'dark humorous office fantasy, dramatic rain and neon reflections, high contrast, premium short drama poster,',
      'leave empty space for Chinese title text, no readable text, no watermark.',
    ].join(' '),
    endingImagePrompt: [
      'Minimalist cinematic ending card, black background, three resignation letters overlapping,',
      'one bamboo slip, one modern office document, one futuristic hologram, slowly transforming into an empty employee badge,',
      'quiet emotional Korean drama finale mood, high contrast, clean composition, leave empty center space for Chinese copy,',
      'no readable text, no watermark.',
    ].join(' '),
    videoStylePrompt: [
      '整条视频是“离职幻想”主题的跨时空黑色幽默短剧。三个人物都想辞职，但都没真正走成。',
      '整体风格是韩剧式电影感加职场荒诞喜剧：雨夜、慢推镜头、突然静音、情绪停顿、最后一秒轻微反讽。',
      '每段都像同一条短剧里的“人物证言镜头”，人物可以看向镜头，也可以略微偏离镜头，但整体镜头语言要统一。',
      '语言是中文普通话。人物表演应明显是在说中文台词，请根据指定音色和语气来设计嘴型、表情、停顿和动作。',
      '画面不要内嵌字幕，不要出现可读文字，不要水印。',
    ].join('\n'),
    scenes: [
      {
        id: 'tao-yuanming',
        name: '陶渊明',
        gender: '男性',
        visualAge: '中年男性，约 42 岁',
        voiceTone: '中年男性声音，低沉、平静、略疲惫，有文人克制感。语气自嘲但不夸张，前半句像终于松一口气，后半句轻轻补刀。',
        roleFunction: '第 1 段，共 3 段。这个古代人物负责打开故事，用历史反差制造第一层笑点：他以为辞掉官职就自由了，但生活本身又变成了另一份工作。',
        line: '我以为辞了官就自由了，结果地里的草也催我上班。',
        imagePrompt: [
          'Cinematic Korean drama style, ancient Eastern Jin dynasty county office at rainy night,',
          'a tired middle-aged ancient Chinese male poet-official around 42 years old as Tao Yuanming from the Eastern Jin dynasty,',
          'strictly ancient Chinese scholar appearance: linen hanfu with wide sleeves, loose robe layers, simple cloth headscarf, tied ancient hair bun, short beard,',
          'not a modern or near-modern historical figure, not Qing dynasty, not Republican era, no western suit, no modern haircut, no photographic portrait look,',
          'an official seal on a low wooden desk, bamboo slips and brush documents, distant farmland visible outside the window,',
          'warm candlelight, melancholic but darkly humorous mood, emotional close-up, high contrast, no text, no watermark.',
        ].join(' '),
        videoPrompt: [
          '第 1 段，共 3 段。主题：跨时空离职幻想。',
          '这个古代人物负责打开故事，用历史反差制造第一层笑点：他以为辞掉官职就自由了，但生活本身又变成了另一份工作。',
          '人物性别：男性。视觉年龄：中年男性，约 42 岁。',
          '语言：中文普通话。音色：中年男性声音，低沉、平静、略疲惫，有文人克制感。语气自嘲但不夸张，前半句像终于松一口气，后半句轻轻补刀。',
          '画面：一位疲惫的中年中国男性诗人官员，必须是东晋士人陶渊明的古代形象，不要像近代历史人物、清末民初官员、现代人物照片或西装肖像。他穿宽袖素色汉服，衣料是麻布/粗布质感，头发是古代束发发髻，戴朴素葛巾或布巾，留短须，衣着略显凌乱。桌上有官印、毛笔和竹简公文，窗外能看到雨中的田地。室内是暖色烛光。',
          '表演：平静、疲惫、自嘲，不要夸张。他轻轻放下官印，像是终于松了一口气。随后他看见窗外雨中的田地，露出一个很轻的苦笑。',
          '后期配音/字幕台词：“我以为辞了官就自由了，结果地里的草也催我上班。”',
          '节奏：前半段要像终于解脱，认真、舒缓；后半段突然转成干巴巴的冷幽默。官印落桌之后，画面可以有短暂静音，只留下雨声。镜头缓慢推进，有韩剧式情绪停顿。整体忧郁，但带黑色幽默。',
          '不要内嵌字幕，不要可读文字，不要水印。',
        ].join(' '),
      },
      {
        id: 'office-worker',
        name: '现代打工人',
        gender: '男性',
        visualAge: '青年男性，约 29 岁',
        voiceTone: '青年男性声音，略沙哑、疲惫、带一点崩溃后的冷幽默。语气像深夜加班到麻木的人，前半句压着委屈，后半句带无奈的笑。',
        roleFunction: '第 2 段，共 3 段。这个现代人物负责把古代笑点拉回现实职场压力：他想辞职，但工作、账单和责任又把他拽回去。',
        line: '我的辞职信写了三年，唯一发出去的是加班日报。',
        imagePrompt: [
          'Cinematic Korean drama style, late-night modern office, exhausted Chinese office worker age 29,',
          'male, wrinkled white shirt, employee badge, dark circles, laptop showing a resignation letter draft without readable text,',
          'phone notifications glowing, blue monitor light, rain outside glass wall, black comedy mood, no text, no watermark.',
        ].join(' '),
        videoPrompt: [
          '第 2 段，共 3 段。延续同一条短剧的视觉风格和主题。',
          '这个现代人物负责把古代笑点拉回现实职场压力：他想辞职，但工作、账单和责任又把他拽回去。',
          '人物性别：男性。视觉年龄：青年男性，约 29 岁。',
          '语言：中文普通话。音色：青年男性声音，略沙哑、疲惫、带一点崩溃后的冷幽默。语气像深夜加班到麻木的人，前半句压着委屈，后半句带无奈的笑。',
          '画面：一位 29 岁左右的中国男性打工人，深夜坐在城市办公室里。他非常疲惫，穿着皱巴巴的白衬衫，戴工牌，有黑眼圈。蓝色显示器光打在脸上，玻璃墙外下着雨。笔记本电脑打开，手机通知在发光，但屏幕上不要出现可读文字。',
          '表演：疲惫、快崩溃，但带冷幽默。他的鼠标停在“像是要发送辞职信”的动作前。新的工作通知出现后，他僵住，露出一个认命的半笑，然后慢慢切回工作状态。',
          '后期配音/字幕台词：“我的辞职信写了三年，唯一发出去的是加班日报。”',
          '节奏：前半段要让人以为他终于要辞职了；后半段揭开笑点：真正发出去的不是辞职信，而是又一份加班日报。继续保持第 1 段的雨夜、情绪近景和压抑氛围，但更现代、更窒息。',
          '不要内嵌字幕，不要可读文字，不要水印。',
        ].join(' '),
      },
      {
        id: 'future-robot',
        name: '未来机器人',
        gender: '中性偏男性',
        visualAge: '无明确年龄，但外形接近成年男性类人机器人',
        voiceTone: '中性偏男性机械声，冷静、克制、略带电子质感，但不要完全没有情绪。语气像系统播报里混入了一点绝望，前半句理性，后半句荒诞但平静。',
        roleFunction: '第 3 段，共 3 段。这个未来机器人负责把主题推到荒诞尽头：到了未来，连机器人想“关机辞职”，也会被无尽任务拦住。',
        line: '我申请关机，系统说：还有999个需求没改。',
        imagePrompt: [
          'Cinematic futuristic office spaceship, gender-neutral but male-coded adult humanoid service robot with a calm metallic face,',
          'red alert light, holographic work dashboard without readable text, badge of excellent employee,',
          'dark sci-fi Korean drama lighting, absurd office comedy, emotional close-up, no text, no watermark.',
        ].join(' '),
        videoPrompt: [
          '第 3 段，共 3 段。作为最终升级段落。',
          '这个未来机器人负责把主题推到荒诞尽头：到了未来，连机器人想“关机辞职”，也会被无尽任务拦住。',
          '这一段要和前两段形成呼应：第 1 段是官印，第 2 段是电脑/辞职信，第 3 段是关机申请。它们本质上都是“想退出，但退出不了”。',
          '人物性别：中性偏男性。视觉年龄：无明确年龄，但外形接近成年男性类人机器人。',
          '语言：中文普通话。音色：中性偏男性机械声，冷静、克制、略带电子质感，但不要完全没有情绪。语气像系统播报里混入了一点绝望，前半句理性，后半句荒诞但平静。',
          '画面：一个中性偏男性的类人服务机器人，外形接近成年男性，坐在未来办公室飞船舱里。它有平静的金属脸，周围有红色警报灯、悬浮工作仪表盘，胸前有“优秀员工”式徽章。整体是暗色科幻韩剧光影。屏幕和仪表盘上不要出现可读文字。',
          '表演：一开始机械冷静，随后进入沉默的绝望。机器人点击“申请关机”的动作，红色警报光反射在它脸上。它停顿片刻，慢慢看向镜头，像是终于理解了人类为什么会累。',
          '后期配音/字幕台词：“我申请关机，系统说：还有999个需求没改。”',
          '节奏：前半段是理性、正常的关机动作；后半段突然变成荒诞职场囚禁。要呼应前两段：陶渊明逃不过田地，打工人逃不过加班，机器人连关机都逃不过需求。使用戏剧化慢动作、红色警报光、安静的黑色幽默。',
          '不要内嵌字幕，不要可读文字，不要水印。',
        ].join(' '),
      },
    ],
  };
}

function buildScript(theme) {
  if (theme !== '离职幻想') {
    throw new Error('This first maker script currently ships the ready-to-render theme: 离职幻想.');
  }
  return promptForLizhihuanxiang();
}

async function postJson(endpoint, body, auth) {
  const response = await fetch(API_BASE + endpoint, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`POST ${endpoint} failed: ${response.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function postJsonRaw(endpoint, body, auth) {
  const response = await fetch(API_BASE + endpoint, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = JSON.stringify(data).slice(0, 500);
    throw new Error(`POST ${endpoint} failed: ${response.status} ${message}`);
  }
  return data;
}

async function getJson(url, auth) {
  const response = await fetch(url, { headers: { Authorization: auth } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GET task failed: ${response.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function pollImage(taskId, auth) {
  for (let i = 0; i < 80; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const result = await getJson(`${API_BASE}/images/generations/async/${taskId}`, auth);
    const url = result && result.data && result.data[0] && result.data[0].url;
    if (url) return url;
    if (result.status === 'failed') throw new Error(`Image task failed: ${taskId}`);
  }
  throw new Error(`Image task timed out: ${taskId}`);
}

async function pollVideo(taskId, auth) {
  for (let i = 0; i < 120; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const result = await getJson(`${API_BASE}/videos/${taskId}`, auth);
    if (result.video_url) return result.video_url;
    if (result.status === 'failed') throw new Error(`Video task failed: ${taskId}`);
  }
  throw new Error(`Video task timed out: ${taskId}`);
}

async function download(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

async function generateImage(scene, auth, outputPath) {
  // 外部生成会消耗额度：只在用户明确要求生成作品时调用，并且不把凭据写入仓库。
  const task = await postJson('/images/generations/async', {
    model: IMAGE_MODEL,
    prompt: scene.imagePrompt,
    n: 1,
    size: IMAGE_SIZE,
    quality: 'high',
    response_format: 'url',
  }, auth);
  if (!task.task_id) throw new Error(`Image task missing task_id for ${scene.id}`);
  const url = await pollImage(task.task_id, auth);
  await download(url, outputPath);
  return url;
}

async function generateVideo(scene, auth, outputPath, script) {
  // 视频按最新方案走纯文本生成；图片资产单独生成，最终只通过 ffmpeg 做剪辑整合。
  const task = await postJson('/videos', {
    model: VIDEO_MODEL,
    prompt: `${script.videoStylePrompt}\n\n${scene.videoPrompt}\n\n视觉细节补充：${scene.imagePrompt}`,
    aspect_ratio: VIDEO_ASPECT,
    seconds: '5',
  }, auth);
  if (!task.task_id) throw new Error(`Video task missing task_id for ${scene.id}`);
  const url = await pollVideo(task.task_id, auth);
  await download(url, outputPath);
  return url;
}

function findAudioPayload(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.audio === 'string') return value.audio;
  if (value.audio && typeof value.audio.data === 'string') return value.audio.data;
  if (typeof value.data === 'string' && /audio|wav|mp3|mpeg|pcm/i.test(String(value.type || value.mime_type || ''))) {
    return value.data;
  }
  if (typeof value.b64_json === 'string') return value.b64_json;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudioPayload(item);
      if (found) return found;
    }
    return null;
  }
  for (const item of Object.values(value)) {
    const found = findAudioPayload(item);
    if (found) return found;
  }
  return null;
}

async function generateResponsesVoiceover({ auth, text, outputPath, jsonPath, label }) {
  const body = {
    model: VOICE_MODEL,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `请用中文普通话朗读以下短视频旁白，只输出自然配音，不要加解释：${text}`,
          },
        ],
      },
    ],
    instructions: [
      '你是中文短视频旁白配音演员。',
      '声音成熟、克制、清晰，有一点黑色幽默和韩剧式情绪停顿。',
      '语速自然偏短视频节奏，不要播音腔，不要广告腔。',
      '请生成音频输出。',
    ].join('\n'),
    modalities: ['text', 'audio'],
    audio: {
      voice: readArg('--voice') || 'alloy',
      format: 'wav',
    },
    temperature: 0.2,
    max_output_tokens: 200,
  };

  const data = await postJsonRaw('/responses', body, auth);
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
  const audioBase64 = findAudioPayload(data);
  if (!audioBase64) {
    throw new Error(`Responses voiceover returned no audio payload for ${label}; raw response saved to ${jsonPath}`);
  }
  fs.writeFileSync(outputPath, Buffer.from(audioBase64, 'base64'));
  return outputPath;
}

function extractMinimaxAudioBuffer(data) {
  if (data && data.base_resp && data.base_resp.status_code && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax TTS error ${data.base_resp.status_code}: ${data.base_resp.status_msg || 'unknown error'}`);
  }
  const audio = data && data.data && data.data.audio;
  if (typeof audio !== 'string' || !audio) {
    throw new Error('MiniMax TTS response did not include data.audio.');
  }

  if (/^[0-9a-fA-F]+$/.test(audio) && audio.length % 2 === 0) {
    return Buffer.from(audio, 'hex');
  }
  return Buffer.from(audio, 'base64');
}

async function generateMinimaxVoiceover({ apiKey, groupId, text, outputPath, jsonPath, label }) {
  const body = {
    model: readArg('--minimax-model') || MINIMAX_TTS_MODEL,
    text,
    stream: false,
    voice_setting: {
      voice_id: readArg('--minimax-voice') || MINIMAX_VOICE_ID,
      speed: Number(readArg('--minimax-speed') || process.env.MINIMAX_SPEED || 1),
      vol: Number(readArg('--minimax-vol') || process.env.MINIMAX_VOL || 1),
      pitch: Number(readArg('--minimax-pitch') || process.env.MINIMAX_PITCH || 0),
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  };
  const url = `${MINIMAX_BASE_URL.replace(/\/$/, '')}/t2a_v2?GroupId=${encodeURIComponent(groupId)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const textBody = await response.text();
  let data = {};
  try {
    data = JSON.parse(textBody);
  } catch (_) {
    data = { raw: textBody };
  }
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
  if (!response.ok) {
    throw new Error(`MiniMax TTS failed for ${label}: ${response.status} ${JSON.stringify(data).slice(0, 500)}`);
  }
  const audioBuffer = extractMinimaxAudioBuffer(data);
  fs.writeFileSync(outputPath, audioBuffer);
  return outputPath;
}

async function generateVoiceovers(script, root, auth) {
  const voiceDir = path.join(root, 'voiceover');
  ensureDir(voiceDir);
  const tasks = [
    {
      label: 'cover',
      text: `${script.hook} ${script.setup}`,
      outputPath: path.join(voiceDir, 'cover.wav'),
      jsonPath: path.join(voiceDir, 'cover.responses.json'),
    },
    {
      label: 'ending',
      text: toSpeechText(script.ending),
      outputPath: path.join(voiceDir, 'ending.wav'),
      jsonPath: path.join(voiceDir, 'ending.responses.json'),
    },
  ];

  const outputs = [];
  for (const task of tasks) {
    console.log(`[voiceover] generating ${task.label}: ${task.text}`);
    const local = await generateResponsesVoiceover({ auth, ...task });
    outputs.push({ label: task.label, local, json: task.jsonPath });
  }
  return outputs;
}

async function generateMinimaxVoiceovers(script, root, minimaxAuth) {
  const voiceDir = path.join(root, 'voiceover');
  ensureDir(voiceDir);
  const tasks = [
    {
      label: 'cover',
      text: `${script.hook} ${script.setup}`,
      outputPath: path.join(voiceDir, 'cover.mp3'),
      jsonPath: path.join(voiceDir, 'cover.minimax.json'),
    },
    {
      label: 'ending',
      text: toSpeechText(script.ending),
      outputPath: path.join(voiceDir, 'ending.mp3'),
      jsonPath: path.join(voiceDir, 'ending.minimax.json'),
    },
  ];

  const outputs = [];
  for (const task of tasks) {
    console.log(`[minimax voiceover] generating ${task.label}: ${task.text}`);
    const local = await generateMinimaxVoiceover({ ...minimaxAuth, ...task });
    outputs.push({ label: task.label, local, json: task.jsonPath });
  }
  return outputs;
}

function sayToAudio(text, outputPath) {
  try {
    run('/usr/bin/say', ['-v', 'Tingting', '-o', outputPath, text]);
    return true;
  } catch (_) {
    return false;
  }
}

function filterPath(value) {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function makeTextFile(dir, name, text) {
  const file = path.join(dir, `${name}.txt`);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

function writeTextRenderer(tempDir) {
  const rendererPath = path.join(tempDir, 'render-text-layer.swift');
  fs.writeFileSync(rendererPath, `
import AppKit
import Foundation

func number(_ dict: [String: Any], _ key: String, _ fallback: Double) -> Double {
  if let value = dict[key] as? Double { return value }
  if let value = dict[key] as? Int { return Double(value) }
  return fallback
}

func string(_ dict: [String: Any], _ key: String, _ fallback: String) -> String {
  return dict[key] as? String ?? fallback
}

let specPath = CommandLine.arguments[1]
let data = try Data(contentsOf: URL(fileURLWithPath: specPath))
let spec = try JSONSerialization.jsonObject(with: data) as! [String: Any]
let outputPath = spec["outputPath"] as! String
let width = Int(number(spec, "width", 1080))
let height = Int(number(spec, "height", 1920))
let items = spec["items"] as! [[String: Any]]

let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: width,
  pixelsHigh: height,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
)!

let context = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.cgContext.clear(CGRect(x: 0, y: 0, width: width, height: height))

for item in items {
  let text = string(item, "text", "")
  let fontSize = number(item, "fontSize", 64)
  let weightName = string(item, "weight", "bold")
  let weight: NSFont.Weight = weightName == "regular" ? .regular : (weightName == "medium" ? .medium : .bold)
  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = .center
  paragraph.lineBreakMode = .byWordWrapping
  paragraph.lineSpacing = number(item, "lineSpacing", 10)

  let shadow = NSShadow()
  shadow.shadowColor = NSColor.black.withAlphaComponent(number(item, "shadowAlpha", 0.75))
  shadow.shadowBlurRadius = number(item, "shadowBlur", 10)
  shadow.shadowOffset = NSSize(width: 0, height: number(item, "shadowY", 3))

  let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: fontSize, weight: weight),
    .foregroundColor: NSColor.white,
    .paragraphStyle: paragraph,
    .shadow: shadow
  ]

  let itemHeight = number(item, "h", 360)
  let topY = number(item, "y", 160)
  let rect = NSRect(
    x: number(item, "x", 80),
    y: Double(height) - topY - itemHeight,
    width: number(item, "w", Double(width - 160)),
    height: itemHeight
  )
  (text as NSString).draw(in: rect, withAttributes: attributes)
}

NSGraphicsContext.restoreGraphicsState()
let png = rep.representation(using: .png, properties: [:])!
try png.write(to: URL(fileURLWithPath: outputPath))
`, 'utf8');
  return rendererPath;
}

function renderTextLayer({ items, outputPath, tempDir, width = 1080, height = 1920 }) {
  ensureDir(path.dirname(outputPath));
  const rendererPath = writeTextRenderer(tempDir);
  const specPath = path.join(tempDir, `${path.basename(outputPath, '.png')}.json`);
  const moduleCachePath = path.join(tempDir, 'swift-module-cache');
  ensureDir(moduleCachePath);
  fs.writeFileSync(specPath, JSON.stringify({ outputPath, width, height, items }, null, 2), 'utf8');
  run('/usr/bin/swift', [rendererPath, specPath], {
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: moduleCachePath,
      SWIFT_MODULE_CACHE_PATH: moduleCachePath,
    },
  });
}

function overlayTextLayer({ imagePath, textLayerPath, outputPath }) {
  ensureDir(path.dirname(outputPath));
  run('ffmpeg', [
    '-y',
    '-i', imagePath,
    '-i', textLayerPath,
    '-filter_complex',
    [
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:1[bg];',
      '[0:v]scale=1080:-1:force_original_aspect_ratio=decrease[fg];',
      '[bg][fg]overlay=(W-w)/2:(H-h)/2[base];',
      '[base][1:v]overlay=0:0,format=rgba[out]',
    ].join(''),
    '-map', '[out]',
    '-frames:v', '1',
    outputPath,
  ]);
}

function buildTextItemsForImage(script, item, index) {
  if (item.id === 'cover') {
    return [
      {
        text: script.hook,
        x: 78,
        y: 116,
        w: 924,
        h: 220,
        fontSize: 62,
        lineSpacing: 14,
        weight: 'bold',
        shadowBlur: 14,
      },
      {
        text: script.setup,
        x: 118,
        y: 352,
        w: 844,
        h: 120,
        fontSize: 42,
        weight: 'medium',
        shadowBlur: 10,
      },
    ];
  }

  if (item.id === 'ending') {
    return [
      {
        text: script.ending,
        x: 90,
        y: 650,
        w: 900,
        h: 360,
        fontSize: 54,
        lineSpacing: 18,
        weight: 'bold',
        shadowBlur: 12,
      },
    ];
  }

  return [
    {
      text: item.name,
      x: 90,
      y: 104,
      w: 900,
      h: 96,
      fontSize: 52,
      weight: 'bold',
      shadowBlur: 10,
    },
    {
      text: item.line,
      x: 76,
      y: 1390,
      w: 928,
      h: 330,
      fontSize: index === 3 ? 42 : 45,
      lineSpacing: 14,
      weight: 'bold',
      shadowBlur: 12,
    },
  ];
}

function postprocessImages(script, root, tempDir) {
  const imageDir = path.join(root, 'images');
  const verticalDir = path.join(root, 'images-vertical');
  const textLayerDir = path.join(root, 'text-layers');
  ensureDir(verticalDir);
  ensureDir(textLayerDir);

  const imageTargets = [
    { id: 'cover', name: '封面' },
    ...script.scenes,
    { id: 'ending', name: '结尾金句图' },
  ];

  const outputs = [];
  for (let index = 0; index < imageTargets.length; index += 1) {
    const item = imageTargets[index];
    const sourcePath = path.join(imageDir, `${String(index).padStart(2, '0')}-${item.id}.png`);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing source image for ${item.name}: ${sourcePath}`);
    }

    const textLayerPath = path.join(textLayerDir, `${String(index).padStart(2, '0')}-${item.id}-text.png`);
    const outputPath = path.join(verticalDir, `${String(index).padStart(2, '0')}-${item.id}.png`);
    renderTextLayer({
      items: buildTextItemsForImage(script, item, index),
      outputPath: textLayerPath,
      tempDir,
    });
    overlayTextLayer({ imagePath: sourcePath, textLayerPath, outputPath });
    outputs.push({ name: item.name, source: sourcePath, textLayer: textLayerPath, output: outputPath });
  }

  return outputs;
}

function makeCard({ text, audioText, outputPath, workDir, name, duration = 3.5, color = '#101018' }) {
  const textFile = makeTextFile(workDir, `${name}-text`, text);
  const audioPath = path.join(workDir, `${name}.aiff`);
  const hasVoice = sayToAudio(audioText || text.replace(/\n/g, '，'), audioPath);
  const audioInput = hasVoice ? ['-i', audioPath] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
  const filter = [
    `[0:v]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.12:t=fill,`,
    `drawtext=fontfile='${filterPath(FONT)}':textfile='${filterPath(textFile)}':`,
    'fontcolor=white:fontsize=62:line_spacing=24:x=(w-text_w)/2:y=(h-text_h)/2[v];',
    '[1:a]apad[a]',
  ].join('');
  run('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${color}:s=1080x1920:r=30:d=${duration}`,
    ...audioInput,
    '-filter_complex', filter,
    '-map', '[v]',
    '-map', '[a]',
    '-t', String(duration),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

function makeStaticVideo(imagePath, outputPath, duration) {
  run('ffmpeg', [
    '-y',
    '-loop', '1',
    '-t', String(duration),
    '-i', imagePath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
    '-r', '30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    outputPath,
  ]);
}

function normalizeSegment({ inputVideo, line, label, outputPath, workDir, duration = 6 }) {
  const subtitleFile = makeTextFile(workDir, `${label}-subtitle`, `${label}\n${line}`);
  const audioPath = path.join(workDir, `${label}.aiff`);
  const hasVoice = sayToAudio(line, audioPath);
  const audioInput = hasVoice ? ['-i', audioPath] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
  const filter = [
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p,',
    'drawbox=x=70:y=1390:w=940:h=330:color=black@0.48:t=fill,',
    `drawtext=fontfile='${filterPath(FONT)}':textfile='${filterPath(subtitleFile)}':`,
    'fontcolor=white:fontsize=48:line_spacing=18:x=(w-text_w)/2:y=1435[v];',
    '[1:a]apad[a]',
  ].join('');
  run('ffmpeg', [
    '-y',
    '-i', inputVideo,
    ...audioInput,
    '-filter_complex', filter,
    '-map', '[v]',
    '-map', '[a]',
    '-t', String(duration),
    '-r', '30',
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

function concatVideos(files, outputPath, workDir) {
  const concatFile = path.join(workDir, 'concat.txt');
  fs.writeFileSync(concatFile, files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n') + '\n', 'utf8');
  run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', outputPath]);
}

function addSegmentAudioFade({ inputPath, outputPath, fade = 0.15 }) {
  const duration = getMediaDuration(inputPath);
  const fadeOutStart = Math.max(0, duration - fade);
  run('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-af', `afade=t=in:st=0:d=${fade},afade=t=out:st=${fadeOutStart}:d=${fade}`,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath,
  ]);
  return outputPath;
}

function makeBlurTransition({ fromPath, toPath, outputPath, duration = 0.3 }) {
  run('ffmpeg', [
    '-y',
    '-sseof', `-${duration}`,
    '-i', fromPath,
    '-i', toPath,
    '-f', 'lavfi',
    '-i', `anullsrc=channel_layout=stereo:sample_rate=44100:d=${duration}`,
    '-filter_complex',
    [
      `[0:v]trim=duration=${duration},setpts=PTS-STARTPTS,`,
      'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,',
      `boxblur=24:2,format=yuva420p,fade=t=out:st=0:d=${duration}:alpha=1[v0];`,
      `[1:v]trim=duration=${duration},setpts=PTS-STARTPTS,`,
      'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,',
      `boxblur=24:2,format=yuva420p,fade=t=in:st=0:d=${duration}:alpha=1[v1];`,
      `color=c=black:s=1080x1920:r=30:d=${duration},format=yuva420p[bg];`,
      '[bg][v0]overlay[tmp];',
      '[tmp][v1]overlay,format=yuv420p[v]',
    ].join(''),
    '-map', '[v]',
    '-map', '2:a',
    '-t', String(duration),
    '-r', '30',
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath,
  ]);
  return outputPath;
}

function applySegmentTransitions(files, workDir, { blackDuration = 0.3, audioFade = 0.15 } = {}) {
  const transitioned = [];
  files.forEach((file, index) => {
    const faded = path.join(workDir, `transition-faded-${String(index).padStart(2, '0')}.mp4`);
    addSegmentAudioFade({ inputPath: file, outputPath: faded, fade: audioFade });
    if (index > 0) {
      const transition = path.join(workDir, `transition-blur-${String(index).padStart(2, '0')}.mp4`);
      // 最终版转场策略：不用黑场，改用相邻片段的虚焦叠化，保持短剧分段感但减少硬切。
      makeBlurTransition({
        fromPath: files[index - 1],
        toPath: file,
        outputPath: transition,
        duration: blackDuration,
      });
      transitioned.push(transition);
    }
    transitioned.push(faded);
  });
  return transitioned;
}

function makeImageSegment({ imagePath, audioText, outputPath, workDir, name, duration }) {
  const audioPath = path.join(workDir, `${name}.aiff`);
  const hasVoice = sayToAudio(audioText, audioPath);
  const audioInput = hasVoice ? ['-i', audioPath] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
  run('ffmpeg', [
    '-y',
    '-loop', '1',
    '-t', String(duration),
    '-i', imagePath,
    ...audioInput,
    '-vf', 'scale=1080:1920,setsar=1',
    '-map', '0:v',
    '-map', '1:a',
    '-t', String(duration),
    '-r', '30',
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

function makeSilentImageSegment({ imagePath, outputPath, duration }) {
  run('ffmpeg', [
    '-y',
    '-loop', '1',
    '-t', String(duration),
    '-i', imagePath,
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-vf', 'scale=1080:1920,setsar=1',
    '-map', '0:v',
    '-map', '1:a',
    '-t', String(duration),
    '-r', '30',
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

function makeImageSegmentWithOptionalAudio({ imagePath, audioPath, outputPath, duration, audioPadding = 0 }) {
  const audioInput = audioPath && fs.existsSync(audioPath)
    ? ['-i', audioPath]
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
  const segmentDuration = audioPath && fs.existsSync(audioPath)
    ? Math.max(duration, getMediaDuration(audioPath) + audioPadding * 2 + 0.1)
    : duration;
  const audioFilter = audioPath && fs.existsSync(audioPath) && audioPadding > 0
    ? `adelay=${Math.round(audioPadding * 1000)}:all=1,apad`
    : 'apad';
  run('ffmpeg', [
    '-y',
    '-loop', '1',
    '-t', String(segmentDuration),
    '-i', imagePath,
    ...audioInput,
    '-vf', 'scale=1080:1920,setsar=1',
    '-af', audioFilter,
    '-map', '0:v',
    '-map', '1:a',
    '-t', String(segmentDuration),
    '-r', '30',
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

function normalizeGrokSegment({ inputVideo, textLayerPath, audioText, outputPath, workDir, name, duration = 5 }) {
  const audioPath = path.join(workDir, `${name}.aiff`);
  const hasVoice = sayToAudio(audioText, audioPath);
  const audioInput = hasVoice ? ['-i', audioPath] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
  run('ffmpeg', [
    '-y',
    '-i', inputVideo,
    '-i', textLayerPath,
    ...audioInput,
    '-filter_complex',
    [
      '[0:v:0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:1[bg];',
      '[0:v:0]scale=1080:-1:force_original_aspect_ratio=decrease[fg];',
      '[bg][fg]overlay=(W-w)/2:(H-h)/2[base];',
      '[base][1:v]overlay=0:0,format=yuv420p[v];',
      '[2:a]apad[a]',
    ].join(''),
    '-map', '[v]',
    '-map', '[a]',
    '-t', String(duration),
    '-r', '30',
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

function normalizeGrokSegmentWithSourceAudio({ inputVideo, textLayerPath, outputPath, duration = 5 }) {
  run('ffmpeg', [
    '-y',
    '-i', inputVideo,
    '-i', textLayerPath,
    '-filter_complex',
    [
      '[0:v:0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:1[bg];',
      '[0:v:0]scale=1080:-1:force_original_aspect_ratio=decrease[fg];',
      '[bg][fg]overlay=(W-w)/2:(H-h)/2[base];',
      '[base][1:v]overlay=0:0,format=yuv420p[v]',
    ].join(''),
    '-map', '[v]',
    '-map', '0:a:0?',
    '-t', String(duration),
    '-r', '30',
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

function composeStaticVideo(script, root, tempDir) {
  const verticalDir = path.join(root, 'images-vertical');
  const finalVideoDir = path.join(root, 'videos');
  ensureDir(finalVideoDir);

  const segments = [
    {
      image: path.join(verticalDir, '00-cover.png'),
      audioText: `${script.hook} ${script.setup}`,
      output: path.join(finalVideoDir, 'seg-00-cover-static.mp4'),
      name: 'cover-static',
      duration: 3.5,
    },
    ...script.scenes.map((scene, index) => ({
      image: path.join(verticalDir, `${String(index + 1).padStart(2, '0')}-${scene.id}.png`),
      audioText: scene.line,
      output: path.join(finalVideoDir, `seg-${String(index + 1).padStart(2, '0')}-${scene.id}-static.mp4`),
      name: `${scene.id}-static`,
      duration: 6.5,
    })),
    {
      image: path.join(verticalDir, '04-ending.png'),
      audioText: toSpeechText(script.ending),
      output: path.join(finalVideoDir, 'seg-99-ending-static.mp4'),
      name: 'ending-static',
      duration: 4.5,
    },
  ];

  for (const segment of segments) {
    if (!fs.existsSync(segment.image)) {
      throw new Error(`Missing vertical image for static video: ${segment.image}`);
    }
    makeImageSegment({
      imagePath: segment.image,
      audioText: segment.audioText,
      outputPath: segment.output,
      workDir: tempDir,
      name: segment.name,
      duration: segment.duration,
    });
  }

  const output = path.join(root, `${sanitizeName(script.theme)}-static-draft.mp4`);
  concatVideos(segments.map((segment) => segment.output), output, tempDir);
  return { output, segments: segments.map((segment) => segment.output) };
}

function composeGrokVideo(script, root, tempDir) {
  const verticalDir = path.join(root, 'images-vertical');
  const textLayerDir = path.join(root, 'text-layers');
  const rawVideoDir = path.join(root, 'videos-raw');
  const finalVideoDir = path.join(root, 'videos');
  const voiceDir = path.join(root, 'voiceover');
  ensureDir(finalVideoDir);

  function optionalVoiceover(name) {
    const candidates = [
      path.join(voiceDir, `${name}.mp3`),
      path.join(voiceDir, `${name}.wav`),
      path.join(voiceDir, `${name}.m4a`),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  const coverSegment = path.join(finalVideoDir, 'seg-00-cover-grok.mp4');
  makeImageSegmentWithOptionalAudio({
    imagePath: path.join(verticalDir, '00-cover.png'),
    audioPath: optionalVoiceover('cover'),
    outputPath: coverSegment,
    duration: 3.5,
    // 首尾旁白前后各留 1 秒，避免声音贴着画面边界突然进入或退出。
    audioPadding: 1,
  });

  const finalSegments = [coverSegment];
  for (let index = 0; index < script.scenes.length; index += 1) {
    const scene = script.scenes[index];
    const rawVideoPath = path.join(rawVideoDir, `${String(index + 1).padStart(2, '0')}-${scene.id}.mp4`);
    const textLayerPath = path.join(textLayerDir, `${String(index + 1).padStart(2, '0')}-${scene.id}-text.png`);
    if (!fs.existsSync(rawVideoPath)) throw new Error(`Missing grok raw video: ${rawVideoPath}`);
    if (!fs.existsSync(textLayerPath)) throw new Error(`Missing text layer: ${textLayerPath}`);

    const segmentPath = path.join(finalVideoDir, `seg-${String(index + 1).padStart(2, '0')}-${scene.id}-grok.mp4`);
    normalizeGrokSegmentWithSourceAudio({
      inputVideo: rawVideoPath,
      textLayerPath,
      outputPath: segmentPath,
      duration: 5,
    });
    finalSegments.push(segmentPath);
  }

  const endingSegment = path.join(finalVideoDir, 'seg-99-ending-grok.mp4');
  makeImageSegmentWithOptionalAudio({
    imagePath: path.join(verticalDir, '04-ending.png'),
    audioPath: optionalVoiceover('ending'),
    outputPath: endingSegment,
    duration: 4.5,
    // 结尾金句需要留呼吸感，和封面使用相同的旁白留白规则。
    audioPadding: 1,
  });
  finalSegments.push(endingSegment);

  const output = path.join(root, `${sanitizeName(script.theme)}-grok-draft.mp4`);
  const transitionSegments = applySegmentTransitions(finalSegments, tempDir, {
    blackDuration: Number(readArg('--transition-duration') || process.env.DOUYIN_TRANSITION_DURATION || 0.3),
    audioFade: Number(readArg('--audio-fade') || process.env.DOUYIN_AUDIO_FADE || 0.15),
  });
  concatVideos(transitionSegments, output, tempDir);
  return { output, segments: finalSegments, transitionSegments };
}

function makeImagePreviews(script, root) {
  const verticalDir = path.join(root, 'images-vertical');
  const previewDir = path.join(verticalDir, '.preview');
  ensureDir(previewDir);
  const targets = [
    { id: 'cover', file: '00-cover.png' },
    ...script.scenes.map((scene, index) => ({
      id: scene.id,
      file: `${String(index + 1).padStart(2, '0')}-${scene.id}.png`,
    })),
    { id: 'ending', file: `${String(script.scenes.length + 1).padStart(2, '0')}-ending.png` },
  ];
  return targets.map((target) => {
    const input = path.join(verticalDir, target.file);
    if (!fs.existsSync(input)) throw new Error(`Missing vertical image for preview: ${input}`);
    const output = path.join(previewDir, target.file.replace(/\.png$/, '.jpg'));
    run('ffmpeg', ['-y', '-i', input, '-vf', 'scale=540:-1', '-frames:v', '1', '-q:v', '6', output]);
    return { id: target.id, input, output };
  });
}

function makeVideoPreviews(videoPath, outputDir) {
  if (!fs.existsSync(videoPath)) throw new Error(`Missing video for preview: ${videoPath}`);
  ensureDir(outputDir);
  const frames = readArg('--preview-frames') || '1,125,250,375,525';
  const expressions = frames
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => `eq(n\\,${Number(value)})`);
  if (!expressions.length || expressions.some((expr) => expr.includes('NaN'))) {
    throw new Error(`Invalid --preview-frames value: ${frames}`);
  }
  run('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-vf', `select='${expressions.join('+')}',scale=540:-1`,
    '-vsync', '0',
    '-q:v', '6',
    path.join(outputDir, 'frame-%03d.jpg'),
  ]);
  return { video: videoPath, outputDir, frames };
}

async function main() {
  if (hasFlag('--help')) {
    console.log(usage());
    return;
  }

  const theme = readArg('--theme') || '离职幻想';
  const script = buildScript(theme);
  const root = path.resolve(readArg('--output-dir') || path.join('outputs', 'douyin', sanitizeName(theme)));
  const imageDir = path.join(root, 'images');
  const rawVideoDir = path.join(root, 'videos-raw');
  const finalVideoDir = path.join(root, 'videos');
  const tempDir = path.join(root, '.tmp');
  ensureDir(imageDir);
  ensureDir(rawVideoDir);
  ensureDir(finalVideoDir);
  ensureDir(tempDir);

  fs.writeFileSync(path.join(root, 'script.json'), JSON.stringify(script, null, 2), 'utf8');

  if (hasFlag('--postprocess-images')) {
    const images = postprocessImages(script, root, tempDir);
    console.log(JSON.stringify({
      ok: true,
      mode: 'postprocess-images',
      theme,
      outputDir: root,
      images,
    }, null, 2));
    return;
  }

  if (hasFlag('--voiceover-responses')) {
    const auth = resolveAuth();
    const voiceovers = await generateVoiceovers(script, root, auth);
    console.log(JSON.stringify({
      ok: true,
      mode: 'voiceover-responses',
      theme,
      outputDir: root,
      model: VOICE_MODEL,
      voiceovers,
    }, null, 2));
    return;
  }

  if (hasFlag('--voiceover-minimax')) {
    const minimaxAuth = resolveMinimaxAuth();
    const voiceovers = await generateMinimaxVoiceovers(script, root, minimaxAuth);
    console.log(JSON.stringify({
      ok: true,
      mode: 'voiceover-minimax',
      theme,
      outputDir: root,
      baseUrl: MINIMAX_BASE_URL,
      model: readArg('--minimax-model') || MINIMAX_TTS_MODEL,
      voice: readArg('--minimax-voice') || MINIMAX_VOICE_ID,
      voiceovers,
    }, null, 2));
    return;
  }

  if (hasFlag('--compose-static-video')) {
    const video = composeStaticVideo(script, root, tempDir);
    console.log(JSON.stringify({
      ok: true,
      mode: 'compose-static-video',
      theme,
      outputDir: root,
      ...video,
    }, null, 2));
    return;
  }

  if (hasFlag('--compose-grok-video')) {
    const video = composeGrokVideo(script, root, tempDir);
    console.log(JSON.stringify({
      ok: true,
      mode: 'compose-grok-video',
      theme,
      outputDir: root,
      inspection: inspectMedia(video.output),
      ...video,
    }, null, 2));
    return;
  }

  if (hasFlag('--preview-images')) {
    const previews = makeImagePreviews(script, root);
    console.log(JSON.stringify({
      ok: true,
      mode: 'preview-images',
      theme,
      outputDir: root,
      previews,
    }, null, 2));
    return;
  }

  if (hasFlag('--preview-grok-video')) {
    const videoPath = path.join(root, `${sanitizeName(script.theme)}-grok-draft.mp4`);
    const preview = makeVideoPreviews(videoPath, path.join(root, 'video-preview-grok-latest'));
    console.log(JSON.stringify({
      ok: true,
      mode: 'preview-grok-video',
      theme,
      outputDir: root,
      preview,
    }, null, 2));
    return;
  }

  if (hasFlag('--inspect-grok-video')) {
    const videoPath = path.join(root, `${sanitizeName(script.theme)}-grok-draft.mp4`);
    console.log(JSON.stringify({
      ok: true,
      mode: 'inspect-grok-video',
      theme,
      outputDir: root,
      video: videoPath,
      inspection: inspectMedia(videoPath),
    }, null, 2));
    return;
  }

  if (hasFlag('--images-only')) {
    const auth = resolveAuth();
    const onlyScene = readArg('--only-scene');
    const imageTargets = [
      { id: 'cover', name: '封面', imagePrompt: script.coverImagePrompt, outputIndex: 0 },
      ...script.scenes.map((scene, index) => ({ ...scene, outputIndex: index + 1 })),
      { id: 'ending', name: '结尾金句图', imagePrompt: script.endingImagePrompt, outputIndex: script.scenes.length + 1 },
    ].filter((item) => !onlyScene || item.id === onlyScene);
    if (!imageTargets.length) throw new Error(`No image target matched --only-scene=${onlyScene}.`);

    const images = [];
    for (let index = 0; index < imageTargets.length; index += 1) {
      const item = imageTargets[index];
      console.log(`[${index + 1}/${imageTargets.length}] generating image: ${item.name}`);
      const imagePath = path.join(imageDir, `${String(item.outputIndex).padStart(2, '0')}-${item.id}.png`);
      if (fs.existsSync(imagePath) && hasFlag('--skip-existing')) {
        console.log(`[skip] existing image: ${imagePath}`);
        images.push({ name: item.name, local: imagePath, url: null, skipped: true });
        continue;
      }
      const imageUrl = await generateImage(item, auth, imagePath);
      images.push({ name: item.name, local: imagePath, url: imageUrl });
    }

    console.log(JSON.stringify({
      ok: true,
      mode: 'images-only',
      theme,
      outputDir: root,
      script: path.join(root, 'script.json'),
      images,
    }, null, 2));
    return;
  }

  if (hasFlag('--videos-only')) {
    const auth = resolveAuth();
    const onlyScene = readArg('--only-scene');
    const sceneTargets = script.scenes
      .map((scene, index) => ({ scene, outputIndex: index + 1 }))
      .filter((item) => !onlyScene || item.scene.id === onlyScene);
    if (!sceneTargets.length) throw new Error(`No scene matched --only-scene=${onlyScene}.`);
    const videos = [];
    for (let index = 0; index < sceneTargets.length; index += 1) {
      const { scene, outputIndex } = sceneTargets[index];
      console.log(`[${index + 1}/${sceneTargets.length}] generating text-to-video: ${scene.name}`);
      const videoPath = path.join(rawVideoDir, `${String(outputIndex).padStart(2, '0')}-${scene.id}.mp4`);
      const videoUrl = await generateVideo(scene, auth, videoPath, script);
      videos.push({ name: scene.name, local: videoPath, url: videoUrl });
    }

    console.log(JSON.stringify({
      ok: true,
      mode: 'videos-only',
      theme,
      outputDir: root,
      script: path.join(root, 'script.json'),
      videos,
    }, null, 2));
    return;
  }

  const finalSegments = [];
  const auth = resolveAuth();
  const titleCard = path.join(finalVideoDir, 'seg-00-title.mp4');
  makeCard({
    text: `${script.title}\n\n${script.setup}`,
    audioText: `${script.hook} ${script.setup}`,
    outputPath: titleCard,
    workDir: tempDir,
    name: 'title',
    duration: 3.5,
    color: '#11111a',
  });
  finalSegments.push(titleCard);

  for (let index = 0; index < script.scenes.length; index += 1) {
    const scene = script.scenes[index];
    console.log(`[${index + 1}/${script.scenes.length}] generating image: ${scene.name}`);
    const imagePath = path.join(imageDir, `${String(index + 1).padStart(2, '0')}-${scene.id}.png`);
    const imageUrl = await generateImage(scene, auth, imagePath);

    const rawVideoPath = path.join(rawVideoDir, `${String(index + 1).padStart(2, '0')}-${scene.id}.mp4`);
    try {
      console.log(`[${index + 1}/${script.scenes.length}] generating video: ${scene.name}`);
      await generateVideo(scene, auth, rawVideoPath, script);
    } catch (err) {
      console.warn(`[warn] video generation failed for ${scene.name}, using static fallback: ${err.message}`);
      makeStaticVideo(imagePath, rawVideoPath, 6);
    }

    const segmentPath = path.join(finalVideoDir, `seg-${String(index + 1).padStart(2, '0')}-${scene.id}.mp4`);
    normalizeSegment({
      inputVideo: rawVideoPath,
      line: scene.line,
      label: scene.name,
      outputPath: segmentPath,
      workDir: tempDir,
      duration: 6.5,
    });
    finalSegments.push(segmentPath);
  }

  const endingCard = path.join(finalVideoDir, 'seg-99-ending.mp4');
  makeCard({
    text: script.ending,
    audioText: toSpeechText(script.ending),
    outputPath: endingCard,
    workDir: tempDir,
    name: 'ending',
    duration: 4.5,
    color: '#08080d',
  });
  finalSegments.push(endingCard);

  const output = path.join(root, `${sanitizeName(theme)}-final.mp4`);
  concatVideos(finalSegments, output, tempDir);

  console.log(JSON.stringify({
    ok: true,
    theme,
    output,
    script: path.join(root, 'script.json'),
    segments: finalSegments.length,
  }, null, 2));
}

main().catch((err) => {
  console.error('[make-douyin-magic666-video] ' + (err && err.message ? err.message : err));
  console.error('');
  console.error(usage());
  process.exit(1);
});
