'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Calculator,
  Camera,
  Check,
  House,
  ImagePlus,
  Info,
  LayoutDashboard,
  Plus,
  RotateCcw,
  Scale,
  Sparkles,
  Table2,
  Target,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Course = { id: string; name: string; credit: string; grade: string };
type Metrics = { credits: number; weightedScore: number; g1: number; g2: number; g3: number; g2Inverse: number };

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  deepseek: 'deepseek-v4-flash-vision-exp',
  openai: 'gpt-4.1-mini',
  siliconflow: 'Qwen/Qwen2.5-VL-72B-Instruct',
};

const PROVIDER_NAMES: Record<string, string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  siliconflow: '硅基流动',
};

const PROVIDER_ENDPOINTS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
};

const VISION_PROMPT = [
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

const PAGE_SECTIONS = [
  { id: 'overview', label: '绩点总览', note: '三种算法结果', icon: LayoutDashboard },
  { id: 'courses', label: '课程卷', note: '填写成绩与学分', icon: Table2 },
  { id: 'rules', label: '换算标准', note: '公式、等级与优秀线', icon: Scale },
];

const LETTER_SCORES: Record<string, number> = {
  'A+': 100,
  A: 100,
  'A-': 100,
  'B+': 85,
  B: 81,
  'B-': 77,
  'C+': 73,
  C: 70,
  'C-': 67,
  'D+': 64,
  D: 62,
  F: 0,
};

const DEFAULT_COURSES: Course[] = [
  { id: 'sample-1', name: '示例课程一', credit: '4', grade: '92' },
  { id: 'sample-2', name: '示例课程二', credit: '3', grade: '85' },
  { id: 'sample-3', name: '示例课程三', credit: '2', grade: 'A-' },
];

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

function normalizeGrade(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[−–—]/g, '-').replace(/＋/g, '+');
  if (normalized === '合格' || normalized === '通过') return 'P';
  if (normalized === '免修') return 'EX';
  if (normalized === '在修') return 'IP';
  return normalized;
}

function parseGrade(value: string): { score: number | null; excluded: boolean } {
  const normalized = normalizeGrade(value);
  if (normalized === 'EX' || normalized === 'P' || normalized === 'IP') return { score: null, excluded: true };
  if (normalized in LETTER_SCORES) return { score: LETTER_SCORES[normalized], excluded: false };
  const score = Number(normalized);
  if (normalized !== '' && Number.isFinite(score) && score >= 0 && score <= 100) {
    return { score, excluded: false };
  }
  return { score: null, excluded: false };
}

function parabola(score: number) {
  if (score < 60) return 0;
  return Math.max(0, Math.min(4, 4 - (3 / 1600) * (score - 100) ** 2));
}

function inverseParabola(gpa: number) {
  if (gpa <= 0) return 0;
  return 100 - Math.sqrt(((4 - Math.min(gpa, 4)) * 1600) / 3);
}

function calculateMetrics(courses: Course[]): Metrics {
  const valid = courses.flatMap((course) => {
    const credit = Number(course.credit);
    const parsed = parseGrade(course.grade);
    if (parsed.excluded || parsed.score === null || !Number.isFinite(credit) || credit <= 0) return [];
    return [{ credit, score: parsed.score }];
  });
  const credits = valid.reduce((sum, course) => sum + course.credit, 0);
  if (!credits) return { credits: 0, weightedScore: 0, g1: 0, g2: 0, g3: 0, g2Inverse: 0 };
  const weightedScore = valid.reduce((sum, course) => sum + course.score * course.credit, 0) / credits;
  const g1 = weightedScore / 25;
  const g2 = valid.reduce((sum, course) => sum + parabola(course.score) * course.credit, 0) / credits;
  const g3 = parabola(weightedScore);
  return { credits, weightedScore, g1, g2, g3, g2Inverse: inverseParabola(g2) };
}

function level(score: number) {
  if (score >= 95) return { label: '极度满意', tone: 'supreme' };
  if (score >= 90) return { label: '主观优秀', tone: 'excellent' };
  if (score >= 85) return { label: '客观优秀', tone: 'good' };
  return { label: '继续行路', tone: 'plain' };
}

function parseOcrText(text: string): Course[] {
  const letterSet = new Set([...Object.keys(LETTER_SCORES), 'EX', 'P', 'IP']);
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[|｜,，]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap((line) => {
      const tokens = line.split(' ');
      let gradeIndex = -1;
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        const token = normalizeGrade(tokens[i].replace(/[;；:：]$/, ''));
        const numeric = Number(token);
        if (letterSet.has(token) || (Number.isFinite(numeric) && numeric >= 0 && numeric <= 100)) {
          gradeIndex = i;
          break;
        }
      }
      if (gradeIndex < 1) return [];

      let creditIndex = -1;
      for (let i = gradeIndex - 1; i >= 0; i -= 1) {
        const credit = Number(tokens[i]);
        if (Number.isFinite(credit) && credit > 0 && credit <= 20) {
          creditIndex = i;
          break;
        }
      }
      if (creditIndex < 1) return [];

      const name = tokens
        .slice(0, creditIndex)
        .join(' ')
        .replace(/^\d{4,}\s*/, '')
        .trim();
      if (!name || /^(课程|课程名称|course)$/i.test(name)) return [];
      return [{
        id: makeId(),
        name,
        credit: tokens[creditIndex],
        grade: normalizeGrade(tokens[gradeIndex].replace(/[;；:：]$/, '')),
      }];
    });
}

function prepareImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(?:jpeg|png|webp|gif)$/i.test(file.type) || file.size > 20 * 1024 * 1024) {
      reject(new Error('请选择不超过 20 MB 的 JPEG、PNG、WebP 或 GIF 图片。'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('图片格式无法读取。'));
      image.onload = () => {
        const maxSide = 2400;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('浏览器无法处理此图片。'));
          return;
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function cleanModelJson(content: string) {
  return content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function parseVisionCourses(content: string) {
  const parsed = JSON.parse(cleanModelJson(content)) as {
    courses?: Array<{ name?: unknown; credit?: unknown; grade?: unknown }>;
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
  return { courses, warnings };
}

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    const cursor = { x: -1000, y: -1000 };
    let particles: Array<{ x: number; y: number; r: number; vx: number; vy: number; a: number; red: boolean }> = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = reduceMotion ? 18 : Math.min(72, Math.max(34, Math.round(width / 18)));
      particles = Array.from({ length: count }, (_, index) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 2.1 + 0.55,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.18 - 0.06,
        a: Math.random() * 0.28 + 0.08,
        red: index % 19 === 0,
      }));
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      for (let i = 0; i < particles.length; i += 1) {
        const particle = particles[i];
        const dx = particle.x - cursor.x;
        const dy = particle.y - cursor.y;
        const distance = Math.hypot(dx, dy);
        if (!reduceMotion && distance < 130 && distance > 0) {
          particle.x += (dx / distance) * 0.28;
          particle.y += (dy / distance) * 0.28;
        }
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (particle.x < -10) particle.x = width + 10;
        if (particle.x > width + 10) particle.x = -10;
        if (particle.y < -10) particle.y = height + 10;
        if (particle.y > height + 10) particle.y = -10;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        context.fillStyle = particle.red ? `rgba(153,58,43,${particle.a})` : `rgba(29,78,68,${particle.a})`;
        context.fill();
      }
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const a = particles[i];
          const b = particles[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance < 82) {
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.strokeStyle = `rgba(42,87,77,${(1 - distance / 82) * 0.07})`;
            context.stroke();
          }
        }
      }
      if (!reduceMotion) frame = requestAnimationFrame(draw);
    };

    const onPointerMove = (event: PointerEvent) => {
      cursor.x = event.clientX;
      cursor.y = event.clientY;
    };
    resize();
    draw();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="particle-field" aria-hidden="true" />;
}

export default function Home() {
  const [courses, setCourses] = useState<Course[]>(DEFAULT_COURSES);
  const [calculatedCourses, setCalculatedCourses] = useState<Course[]>(DEFAULT_COURSES);
  const [displayMetrics, setDisplayMetrics] = useState<Metrics>(() => calculateMetrics(DEFAULT_COURSES));
  const [charge, setCharge] = useState(100);
  const [isCalculating, setIsCalculating] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrStatus, setOcrStatus] = useState('可上传成绩单截图交给 DeepSeek 识别，或直接粘贴课程文本。');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [aiProvider, setAiProvider] = useState('deepseek');
  const [visionModel, setVisionModel] = useState(PROVIDER_DEFAULT_MODELS.deepseek);
  const [apiKey, setApiKey] = useState('');
  const [activeSection, setActiveSection] = useState(PAGE_SECTIONS[0].id);
  const fileRef = useRef<HTMLInputElement>(null);
  const calculationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('yanji-courses-v1');
      const savedCalculated = localStorage.getItem('yanji-calculated-courses-v1');
      const draftCourses = saved ? JSON.parse(saved) as Course[] : DEFAULT_COURSES;
      const resultCourses = savedCalculated ? JSON.parse(savedCalculated) as Course[] : draftCourses;
      setCourses(draftCourses);
      setCalculatedCourses(resultCourses);
      setDisplayMetrics(calculateMetrics(resultCourses));
    } catch {
      // Ignore malformed device-local data.
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    localStorage.setItem('yanji-courses-v1', JSON.stringify(courses));
    localStorage.setItem('yanji-calculated-courses-v1', JSON.stringify(calculatedCourses));
  }, [calculatedCourses, courses, storageReady]);

  useEffect(() => () => {
    if (calculationFrameRef.current !== null) cancelAnimationFrame(calculationFrameRef.current);
  }, []);

  useEffect(() => {
    const updateActiveSection = () => {
      const current = PAGE_SECTIONS
        .map((section) => ({ id: section.id, top: document.getElementById(section.id)?.getBoundingClientRect().top ?? Infinity }))
        .filter((section) => section.top <= window.innerHeight * 0.45)
        .at(-1);
      setActiveSection(current?.id ?? PAGE_SECTIONS[0].id);
    };
    updateActiveSection();
    window.addEventListener('scroll', updateActiveSection, { passive: true });
    return () => window.removeEventListener('scroll', updateActiveSection);
  }, []);

  const hasPendingChanges = useMemo(
    () => JSON.stringify(courses) !== JSON.stringify(calculatedCourses),
    [calculatedCourses, courses],
  );

  const results = [
    { mark: '壹', title: '加权平均绩点', detail: '加权均分 ÷ 25', gpa: displayMetrics.g1, score: displayMetrics.g1 * 25, tone: 'jade' },
    { mark: '贰', title: '逐科抛物线加权', detail: '各科先换算，再按学分平均', gpa: displayMetrics.g2, score: displayMetrics.g2 * 25, inverse: displayMetrics.g2Inverse, tone: 'cinnabar' },
    { mark: '叁', title: '均分后抛物线', detail: '加权均分后，再作抛物线换算', gpa: displayMetrics.g3, score: displayMetrics.g3 * 25, tone: 'ink' },
  ];

  const updateCourse = (id: string, key: keyof Omit<Course, 'id'>, value: string) => {
    setCharge(0);
    setCourses((current) => current.map((course) => (course.id === id ? { ...course, [key]: value } : course)));
  };

  const addCourse = () => {
    setCharge(0);
    setCourses((current) => [...current, { id: makeId(), name: '', credit: '', grade: '' }]);
    setTimeout(() => document.querySelector<HTMLInputElement>('tbody tr:last-child input')?.focus(), 0);
  };

  const runCalculation = () => {
    if (calculationFrameRef.current !== null) cancelAnimationFrame(calculationFrameRef.current);
    const snapshot = courses.map((course) => ({ ...course }));
    const from = displayMetrics;
    const target = calculateMetrics(snapshot);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 1100;
    let startedAt: number | null = null;
    const keys: Array<keyof Metrics> = ['credits', 'weightedScore', 'g1', 'g2', 'g3', 'g2Inverse'];
    setIsCalculating(true);
    setCharge(0);
    window.scrollTo({ top: 0, behavior: 'auto' });

    const animate = (now: number) => {
      if (startedAt === null) startedAt = now;
      const progress = Math.min(1, (now - startedAt) / duration);
      const convergence = progress === 1 ? 1 : 1 - Math.exp(-5.5 * progress) * Math.cos(11 * progress);
      const next = { ...from };
      keys.forEach((key) => {
        next[key] = Math.max(0, from[key] + (target[key] - from[key]) * convergence);
      });
      setDisplayMetrics(next);
      setCharge(progress * 100);
      if (progress < 1) {
        calculationFrameRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayMetrics(target);
        setCalculatedCourses(snapshot);
        setIsCalculating(false);
        calculationFrameRef.current = null;
      }
    };
    calculationFrameRef.current = requestAnimationFrame(animate);
  };

  const jumpToSection = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    setActiveSection(id);
    window.history.replaceState(null, '', `#${id}`);
    if (id === 'overview') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleImage = async (files?: FileList | File[]) => {
    const selected = files ? Array.from(files).slice(0, 6) : [];
    if (!selected.length) return;
    setOcrOpen(true);
    setOcrBusy(true);
    setOcrProgress(10);
    setOcrStatus(`正在压缩 ${selected.length} 张图片…`);
    try {
      const providerName = PROVIDER_NAMES[aiProvider] || 'AI 服务';
      const endpoint = PROVIDER_ENDPOINTS[aiProvider];
      const suppliedApiKey = apiKey.trim();
      if (!endpoint) throw new Error('暂不支持这个 AI 厂家。');
      if (!suppliedApiKey) throw new Error(`请先填写 ${providerName} API Key。`);
      const images = await Promise.all(selected.map(prepareImage));
      setOcrProgress(55);
      setOcrStatus(`${providerName} 正在辨认并整理课程…`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${suppliedApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: visionModel.trim() || PROVIDER_DEFAULT_MODELS[aiProvider],
          temperature: 0,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              ...images.map((image) => ({ type: 'image_url', image_url: { url: image, detail: 'original' } })),
            ],
          }],
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string } }>;
      };
      if (!response.ok) {
        const message = response.status === 429
          ? `${providerName} 当前请求较多，请稍后重试。`
          : response.status === 401 || response.status === 403
            ? `${providerName} API Key 无效或无权调用该视觉模型。`
            : payload.error?.message || `${providerName} 识别服务暂时不可用。`;
        throw new Error(message);
      }
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${providerName} 没有返回可解析的结果。`);
      const result = parseVisionCourses(content);
      if (!result.courses.length) throw new Error('模型没有识别到完整的课程、学分与成绩，请换一张更清晰的截图。');
      setOcrProgress(100);
      setOcrText(result.courses.map((course) => `${course.name} ${course.credit} ${course.grade}`).join('\n'));
      const warning = result.warnings.length ? `；${result.warnings.join('；')}` : '';
      setOcrStatus(`已识别 ${result.courses.length} 门课程，请核对后导入${warning}`);
    } catch (error) {
      setOcrProgress(0);
      const message = error instanceof TypeError
        ? '浏览器未能直连所选 AI 厂家，请检查网络或改用 DeepSeek。'
        : error instanceof Error ? error.message : '识别没有完成，请重试或改用文字粘贴。';
      setOcrStatus(message);
    } finally {
      setOcrBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const importOcr = () => {
    const parsed = parseOcrText(ocrText);
    if (!parsed.length) {
      setOcrStatus('仍未找到可导入的行。建议每行保持“课程名 学分 成绩”的顺序。');
      return;
    }
    setCharge(0);
    setCourses(parsed);
    setOcrStatus(`已导入 ${parsed.length} 门课程。`);
    setOcrOpen(false);
  };

  return (
    <main className="min-h-screen overflow-hidden pb-16 text-[#172d2a]">
      <ParticleField />
      <div className="ink-wash ink-wash-one" />
      <div className="ink-wash ink-wash-two" />

      <header className="site-header relative z-10 mx-auto flex w-[min(1460px,calc(100%-32px))] items-center justify-between py-7">
        <div className="flex items-center gap-3">
          <div className="seal">绩</div>
          <div>
            <p className="font-serif-cn text-xl tracking-[0.16em]">砚绩</p>
            <p className="text-[10px] uppercase tracking-[0.32em] text-[#54726c]">PKU GPA Atelier</p>
          </div>
        </div>
        <div className="privacy-pill">
          <Sparkles className="size-3.5 text-[#a73c2c]" />
          <span className="hidden sm:inline">可粘贴文字或自行填入 AI API Key 进行识图</span><span className="sm:hidden">文字 / AI 识图</span>
        </div>
      </header>

      <div className="page-layout relative z-10 mx-auto w-[min(1460px,calc(100%-32px))]">
      <section className="page-content">
        <div className="mb-7">
          <p className="mb-2 font-serif-cn text-sm tracking-[0.32em] text-[#9a3a2a]">观分 · 知止 · 再进</p>
          <h1 className="hero-title font-serif-cn text-[clamp(2.35rem,6vw,5.7rem)] leading-[0.96] tracking-[-0.035em] text-[#102a26]">
            一纸成绩，<span className="text-[#2c5b52]">三重观照</span>
          </h1>
        </div>

        <nav className="mobile-jump-nav" aria-label="页面快捷导航">
          {PAGE_SECTIONS.map((section) => {
            const Icon = section.icon;
            return <a key={section.id} href={`#${section.id}`} onClick={(event) => { event.preventDefault(); jumpToSection(section.id); }} className={activeSection === section.id ? 'active' : ''}><Icon />{section.label}</a>;
          })}
        </nav>

        <div id="overview" className="jump-target grid gap-4 md:grid-cols-3" aria-live="polite">
          {results.map((result, index) => {
            const assessment = level(result.score);
            return (
              <article key={result.mark} className={`result-card ${result.tone} ${isCalculating ? 'is-calculating' : ''}`} style={{ animationDelay: `${index * 70}ms` }}>
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-serif-cn text-sm tracking-[0.12em] text-[#385c55]">{result.title}</p><p className="mt-1 text-[10px] text-[#78908a]">{result.detail}</p></div>
                  <span className="result-mark">{result.mark}</span>
                </div>
                <div className="mt-6 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-[#66817c]">GPA / 4.00</p>
                    <p className={`score-number ${isCalculating ? 'calculating' : ''}`}>{result.gpa.toFixed(3)}</p>
                  </div>
                  <div className="pb-1 text-right">
                    <span className={`level-badge ${assessment.tone}`}>{assessment.label}</span>
                    <p className="mt-2 text-[10px] text-[#66817c]">绩点 × 25</p>
                    <p className={`secondary-score font-serif-cn text-lg text-[#294c46] ${isCalculating ? 'calculating' : ''}`}>{result.score.toFixed(2)}</p>
                  </div>
                </div>
                {'inverse' in result && (
                  <p className="inverse-note">抛物线反函数等效分 <strong>{result.inverse?.toFixed(2)}</strong></p>
                )}
              </article>
            );
          })}
        </div>

        <section className={`charge-console ${isCalculating ? 'is-calculating' : ''} ${hasPendingChanges ? 'has-pending' : 'is-ready'}`} aria-label="计算充能状态">
          <div className="charge-module" aria-live="polite">
            <div className="charge-meta"><span>能量注入</span><strong>{Math.round(charge)}%</strong></div>
            <div className="charge-track" role="progressbar" aria-label="计算进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(charge)}><span style={{ width: `${charge}%` }} /></div>
            <small>{isCalculating ? '数字正在收敛' : charge === 100 ? '结果稳定' : '等待启动旋钮'}</small>
          </div>
        </section>

        <section id="courses" className="jump-target paper-panel mt-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-serif-cn text-xl tracking-[0.06em]">课程卷</p>
              <p className="mt-1 text-xs text-[#66817c]">已演算 {displayMetrics.credits.toFixed(1)} 学分 · 输入不会自动重算 · 自动保存在本机</p>
            </div>
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="sr-only" onChange={(event) => handleImage(event.target.files || undefined)} />
              <Button variant="outline" className="ink-button" disabled={isCalculating} onClick={() => setOcrOpen(true)}><Camera />智能导入</Button>
              <Button className="cinnabar-button" disabled={isCalculating} onClick={addCourse}><Plus />添一门课</Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-separate border-spacing-y-2 text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.18em] text-[#718781]">
                <tr><th className="px-3 pb-1 font-medium">课程</th><th className="w-28 px-3 pb-1 font-medium">学分</th><th className="w-40 px-3 pb-1 font-medium">成绩 / 等级</th><th className="w-20 px-3 pb-1 text-center font-medium">状态</th><th className="w-12" /></tr>
              </thead>
              <tbody>
                {courses.map((course) => {
                  const parsed = parseGrade(course.grade);
                  const creditOk = Number(course.credit) > 0;
                  const valid = parsed.excluded || (parsed.score !== null && creditOk);
                  return (
                    <tr key={course.id} className="course-row">
                      <td><Input aria-label="课程名称" disabled={isCalculating} value={course.name} placeholder="课程名称" onChange={(event) => updateCourse(course.id, 'name', event.target.value)} className="table-input" /></td>
                      <td><Input aria-label="学分" disabled={isCalculating} inputMode="decimal" value={course.credit} placeholder="3" onChange={(event) => updateCourse(course.id, 'credit', event.target.value)} className="table-input text-center" /></td>
                      <td><Input aria-label="成绩或等级" disabled={isCalculating} value={course.grade} placeholder="90 / A- / EX" onChange={(event) => updateCourse(course.id, 'grade', event.target.value)} className="table-input text-center font-medium uppercase" /></td>
                      <td className="text-center">
                        <span className={`status-chip ${parsed.excluded ? 'excluded' : valid ? 'included' : 'invalid'}`}>
                          {parsed.excluded ? '排除' : valid ? '计入' : '待填'}
                        </span>
                      </td>
                      <td><Button size="icon-sm" variant="ghost" disabled={isCalculating} aria-label={`删除${course.name || '课程'}`} className="text-[#8ba09b] hover:text-[#9e3e2f]" onClick={() => { setCharge(0); setCourses((current) => current.filter((item) => item.id !== course.id)); }}><Trash2 /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {courses.length === 0 && (
            <div className="empty-state"><ImagePlus className="size-5" /><span>课程卷还是空的，添一门课或从截图识别。</span></div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#294f47]/10 pt-4">
            <div className="flex items-center gap-2 text-xs text-[#607b75]"><Info className="size-3.5" />EX / P / IP 排除；低于 60 分的抛物线绩点记为 0</div>
            <Button variant="ghost" size="sm" disabled={isCalculating} className="text-[#718781]" onClick={() => { setCharge(0); setCourses(DEFAULT_COURSES); }}><RotateCcw />恢复示例</Button>
          </div>
          <div className={`calculation-dock ${isCalculating ? 'is-calculating' : ''} ${hasPendingChanges ? 'has-pending' : 'is-ready'}`}>
            <div className="calculation-copy">
              <span>CALCULATION RITE</span>
              <strong>{isCalculating ? '三式汇流，正在演算' : hasPendingChanges ? '卷面已有修改，等待演算' : '本轮演算已经完成'}</strong>
              <small>{hasPendingChanges ? '上方结果暂时保持不变' : `已纳入 ${displayMetrics.credits.toFixed(1)} 学分`}</small>
            </div>
            <button type="button" className="calculation-knob" onClick={runCalculation} disabled={isCalculating} aria-label="开始计算绩点">
              <span className="knob-ring" aria-hidden="true" />
              <span className="knob-core"><Calculator /><b>{isCalculating ? '演算中' : '计算'}</b></span>
            </button>
            <div className="calculation-guidance">
              <strong>{hasPendingChanges ? '转动旋钮，落定三式结果' : '仍可再次演算'}</strong>
              <small>输入与结果彼此分离，由你决定何时更新</small>
            </div>
          </div>
        </section>

        <section id="rules" className="jump-target rules-panel mt-5">
          <header className="rules-header">
            <div className="rules-heading-icon"><BookOpen /></div>
            <div><p className="font-serif-cn">换算标准</p><span>三种口径，同一份成绩的不同观察方式</span></div>
            <code>G(x) = 4 − 3(x−100)² / 1600</code>
          </header>

          <div className="rule-cards">
            <article className="rule-card">
              <div className="rule-icon"><Calculator /></div><span className="rule-mark">G₁</span>
              <h3>加权平均绩点</h3><strong>x̄ ÷ 25</strong>
              <p>先按学分求百分制加权均分，再线性压缩到 4.00 制。</p>
            </article>
            <article className="rule-card featured">
              <div className="rule-icon"><Table2 /></div><span className="rule-mark">G₂</span>
              <h3>逐科抛物线加权</h3><strong>Σ cᵢG(xᵢ) ÷ Σ cᵢ</strong>
              <p>每门课先换成抛物线绩点，再按学分平均；另显示反函数等效分。</p>
            </article>
            <article className="rule-card">
              <div className="rule-icon"><Scale /></div><span className="rule-mark">G₃</span>
              <h3>均分后抛物线</h3><strong>G(Σ cᵢxᵢ ÷ Σ cᵢ)</strong>
              <p>先求百分制加权均分，再整体代入抛物线函数。</p>
            </article>
          </div>

          <div className="standards-grid">
            <div className="threshold-panel">
              <div className="standards-title"><Target /><span><strong>优秀刻度</strong><small>成绩评价参考线</small></span></div>
              {[{ score: 85, label: '客观优秀' }, { score: 90, label: '主观优秀' }, { score: 95, label: '极度满意' }].map((item) => (
                <div className="threshold-row" key={item.score}><span>{item.score}</span><i /><strong>{item.label}</strong></div>
              ))}
            </div>
            <div className="letter-panel">
              <div className="standards-title"><BookOpen /><span><strong>等级折算</strong><small>等级制课程先换为百分制</small></span></div>
              <div className="grade-scale">
                {[['A+/A/A−', '100'], ['B+', '85'], ['B', '81'], ['B−', '77'], ['C+', '73'], ['C', '70'], ['C−', '67'], ['D+', '64'], ['D', '62'], ['F', '0']].map(([grade, score]) => (
                  <span key={grade}><b>{grade}</b><em>{score}</em></span>
                ))}
              </div>
              <p><Info />EX 免修、P 通过和 IP 在修不计入绩点；低于 60 分的抛物线绩点记为 0。</p>
            </div>
          </div>
        </section>
      </section>

      <aside className="jump-sidebar" aria-label="页面目录">
        <a className="jump-home" href="https://flowwalker.github.io/">
          <span className="jump-home-box"><House /></span>
          <span className="jump-home-text"><strong>返回主站</strong><small>flowwalker.github.io</small></span>
        </a>
        <div className="jump-card">
          <div className="jump-card-title"><span>目</span><div><strong>卷内导航</strong><small>PAGE INDEX</small></div></div>
          <nav>
            {PAGE_SECTIONS.map((section, index) => {
              const Icon = section.icon;
              return (
                <a key={section.id} href={`#${section.id}`} onClick={(event) => { event.preventDefault(); jumpToSection(section.id); }} className={`jump-link ${activeSection === section.id ? 'active' : ''}`}>
                  <span className="jump-index"><Icon /><small>0{index + 1}</small></span>
                  <span><strong>{section.label}</strong><small>{section.note}</small></span>
                </a>
              );
            })}
          </nav>
        </div>
        <button type="button" className="jump-import" onClick={() => setOcrOpen(true)}>
          <Camera className="size-4" />
          <span><strong>智能入卷</strong><small>识图或识文导入</small></span>
        </button>
      </aside>
      </div>

      <Dialog open={ocrOpen} onOpenChange={setOcrOpen}>
        <DialogContent
          className="ocr-dialog max-h-[90vh] overflow-y-auto sm:max-w-3xl"
          onPaste={(event) => {
            const pastedImages = Array.from(event.clipboardData.items)
              .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null);
            if (pastedImages.length) {
              event.preventDefault();
              handleImage(pastedImages);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-serif-cn text-xl tracking-[0.08em]">智能入卷</DialogTitle>
            <DialogDescription>可任选识图或识文导入；识别结果请在导入前人工核对。</DialogDescription>
          </DialogHeader>

          <section className="import-section" aria-labelledby="image-import-title">
            <div className="section-heading">
              <span className="section-number">壹</span>
              <div><h2 id="image-import-title">识图</h2><p>配置视觉模型，再粘贴、选择或拖入成绩单图片。</p></div>
            </div>
            <div className="ai-config-grid">
              <div className="field-group">
                <Label htmlFor="ai-provider">AI 厂家</Label>
                <NativeSelect
                  id="ai-provider"
                  value={aiProvider}
                  onChange={(event) => {
                    const provider = event.target.value;
                    setAiProvider(provider);
                    setVisionModel(PROVIDER_DEFAULT_MODELS[provider]);
                  }}
                  className="w-full"
                >
                  <NativeSelectOption value="deepseek">DeepSeek（默认）</NativeSelectOption>
                  <NativeSelectOption value="openai">OpenAI</NativeSelectOption>
                  <NativeSelectOption value="siliconflow">硅基流动</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="field-group">
                <Label htmlFor="vision-model">视觉模型</Label>
                <Input id="vision-model" value={visionModel} onChange={(event) => setVisionModel(event.target.value)} placeholder="输入视觉模型名称" className="ai-input" />
              </div>
              <div className="field-group field-group-key">
                <Label htmlFor="api-key">API Key</Label>
                <Input id="api-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-••••••••••••" className="ai-input font-mono" />
              </div>
            </div>
            <p className="secret-note">API Key 仅在当前页面内存中使用，由浏览器直连所选 AI 厂家，不会发送给本站或写入本机存储。</p>
            <button type="button" disabled={ocrBusy || !visionModel.trim()} className="upload-zone" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleImage(event.dataTransfer.files); }}>
              <UploadCloud className="size-6" /><span>{ocrBusy ? `${PROVIDER_NAMES[aiProvider]} 识别进行中，请稍候` : '粘贴、选择或拖入成绩单截图（最多 6 张）'}</span><small>建议裁掉无关区域；图片压缩后由浏览器直接发往所选 AI 厂家</small>
            </button>
            {ocrBusy && <div className="progress-track"><span style={{ width: `${Math.max(4, ocrProgress)}%` }} /></div>}
          </section>

          <section className="import-section" aria-labelledby="text-import-title">
            <div className="section-heading">
              <span className="section-number">贰</span>
              <div><h2 id="text-import-title">识文</h2><p>直接粘贴已复制的课程文字，不需要 API。</p></div>
            </div>
            <Textarea value={ocrText} onChange={(event) => setOcrText(event.target.value)} placeholder={'每行格式示例：\n高等数学 5 93\n程序设计实习 3 A-\n体育 1 P'} className="min-h-44 border-[#31574f]/15 bg-white/40 font-mono text-xs leading-6" />
          </section>

          <p className="ocr-status">{ocrStatus}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-[#718781]">导入会替换当前课程；导入后仍可逐项修改。</p>
            <Button onClick={importOcr} disabled={ocrBusy || !ocrText.trim()} className="cinnabar-button"><Check />核对后导入</Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
