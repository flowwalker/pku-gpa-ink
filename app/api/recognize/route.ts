export const runtime = 'edge';

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    envKey: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-v4-flash-vision-exp',
  },
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4.1-mini',
  },
  siliconflow: {
    name: '硅基流动',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    envKey: 'SILICONFLOW_API_KEY',
    defaultModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
  },
} as const;
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES = 6;

type ProviderId = keyof typeof PROVIDERS;

type ModelCourse = {
  name?: unknown;
  credit?: unknown;
  grade?: unknown;
};

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function cleanModelJson(content: string) {
  return content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: '图片总大小过大，请减少图片或重新裁切。' }, 413);

  let images: unknown;
  let provider: unknown;
  let requestedModel: unknown;
  let suppliedApiKey: unknown;
  try {
    ({ images, provider, model: requestedModel, apiKey: suppliedApiKey } = await request.json());
  } catch {
    return json({ error: '请求内容无法读取。' }, 400);
  }

  const providerId = (typeof provider === 'string' ? provider : 'deepseek') as ProviderId;
  const providerConfig = PROVIDERS[providerId];
  if (!providerConfig) return json({ error: '暂不支持这个 AI 厂家。' }, 400);
  const model = typeof requestedModel === 'string' && requestedModel.trim()
    ? requestedModel.trim()
    : providerConfig.defaultModel;
  if (model.length > 160) return json({ error: '视觉模型名称过长。' }, 400);
  const browserApiKey = typeof suppliedApiKey === 'string' ? suppliedApiKey.trim() : '';
  const apiKey = browserApiKey || process.env[providerConfig.envKey];
  if (!apiKey) return json({ error: `请填写 ${providerConfig.name} API Key。` }, 400);

  if (!Array.isArray(images) || images.length === 0 || images.length > MAX_IMAGES) {
    return json({ error: `请选择 1–${MAX_IMAGES} 张成绩截图。` }, 400);
  }

  const validImages = images.filter(
    (value): value is string =>
      typeof value === 'string' &&
      /^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(value) &&
      value.length <= 10 * 1024 * 1024,
  );
  if (validImages.length !== images.length) return json({ error: '图片格式或大小不受支持。' }, 400);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const prompt = [
      '你是大学成绩单结构化识别器。请读取用户提供的全部截图，只提取真实可见的课程行。',
      '必须只输出一个 JSON 对象，不要输出 Markdown、解释或代码围栏。',
      '格式：{"courses":[{"name":"课程名","credit":3,"grade":"92"}],"warnings":["无法确认的内容"]}',
      '规则：',
      '1. name 保留完整课程名；credit 必须是数字；grade 必须是字符串。',
      '2. 数字成绩保留小数；A+、A、A-、B+、B、B-、C+、C、C-、D+、D、F 原样保留。',
      '3. “合格”或“通过”统一写成 P；“免修”统一写成 EX；IP 或在修统一写成 IP。',
      '4. 不要把学期标题、课程性质、页面按钮、时间、电量等识别成课程。',
      '5. 多张截图有重叠课程时去重；看不清就写入 warnings，不得猜测。',
    ].join('\n');

    const response = await fetch(providerConfig.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...validImages.map((image) => ({
                type: 'image_url',
                image_url: { url: image, detail: 'original' },
              })),
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const payload = (await response.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!response.ok) {
      const message = response.status === 429
        ? `${providerConfig.name} 当前请求较多，请稍后重试。`
        : response.status === 401 || response.status === 403
          ? `${providerConfig.name} API Key 无效或无权调用该视觉模型。`
          : payload.error?.message || `${providerConfig.name} 识别服务暂时不可用。`;
      return json({ error: message }, response.status >= 500 ? 502 : response.status);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) return json({ error: `${providerConfig.name} 没有返回可解析的结果。` }, 502);

    const parsed = JSON.parse(cleanModelJson(content)) as {
      courses?: ModelCourse[];
      warnings?: unknown[];
    };
    const courses = (Array.isArray(parsed.courses) ? parsed.courses : [])
      .slice(0, 100)
      .flatMap((course) => {
        const name = typeof course.name === 'string' ? course.name.trim() : '';
        const credit = Number(course.credit);
        const grade = String(course.grade ?? '').trim().toUpperCase();
        if (!name || !Number.isFinite(credit) || credit <= 0 || credit > 20 || !grade) return [];
        return [{ name, credit, grade }];
      });
    const warnings = (Array.isArray(parsed.warnings) ? parsed.warnings : [])
      .filter((value): value is string => typeof value === 'string')
      .slice(0, 10);

    if (!courses.length) return json({ error: '模型没有识别到完整的课程、学分与成绩，请换一张更清晰的截图。', warnings }, 422);
    return json({ courses, warnings, model, provider: providerId });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return json({ error: '识别超过 90 秒，请稍后重试。' }, 504);
    }
    return json({ error: '识别结果格式异常，请重试或改用文字粘贴。' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
