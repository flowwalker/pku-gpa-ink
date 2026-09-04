'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ImagePlus,
  Info,
  Plus,
  RotateCcw,
  Sparkles,
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

const PAGE_SECTIONS = [
  { id: 'overview', label: '绩点总览', note: '三种算法结果' },
  { id: 'courses', label: '课程卷', note: '填写成绩与学分' },
  { id: 'rules', label: '换算标准', note: '公式、等级与优秀线' },
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem('yanji-courses-v1');
      if (saved) setCourses(JSON.parse(saved));
    } catch {
      // Ignore malformed device-local data.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('yanji-courses-v1', JSON.stringify(courses));
  }, [courses]);

  useEffect(() => {
    const updateActiveSection = () => {
      const current = PAGE_SECTIONS
        .map((section) => ({ id: section.id, top: document.getElementById(section.id)?.getBoundingClientRect().top ?? Infinity }))
        .filter((section) => section.top <= 180)
        .at(-1);
      setActiveSection(current?.id ?? PAGE_SECTIONS[0].id);
    };
    updateActiveSection();
    window.addEventListener('scroll', updateActiveSection, { passive: true });
    return () => window.removeEventListener('scroll', updateActiveSection);
  }, []);

  const metrics = useMemo(() => {
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
  }, [courses]);

  const results = [
    { mark: '壹', title: '加权平均绩点', detail: '加权均分 ÷ 25', gpa: metrics.g1, score: metrics.g1 * 25, tone: 'jade' },
    { mark: '贰', title: '逐科抛物线加权', detail: '各科先换算，再按学分平均', gpa: metrics.g2, score: metrics.g2 * 25, inverse: metrics.g2Inverse, tone: 'cinnabar' },
    { mark: '叁', title: '均分后抛物线', detail: '加权均分后，再作抛物线换算', gpa: metrics.g3, score: metrics.g3 * 25, tone: 'ink' },
  ];

  const updateCourse = (id: string, key: keyof Omit<Course, 'id'>, value: string) => {
    setCourses((current) => current.map((course) => (course.id === id ? { ...course, [key]: value } : course)));
  };

  const addCourse = () => {
    setCourses((current) => [...current, { id: makeId(), name: '', credit: '', grade: '' }]);
    setTimeout(() => document.querySelector<HTMLInputElement>('tbody tr:last-child input')?.focus(), 0);
  };

  const handleImage = async (files?: FileList | File[]) => {
    const selected = files ? Array.from(files).slice(0, 6) : [];
    if (!selected.length) return;
    setOcrOpen(true);
    setOcrBusy(true);
    setOcrProgress(10);
    setOcrStatus(`正在压缩 ${selected.length} 张图片…`);
    try {
      const images = await Promise.all(selected.map(prepareImage));
      setOcrProgress(55);
      setOcrStatus(`${PROVIDER_NAMES[aiProvider]} 正在辨认并整理课程…`);
      const response = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, provider: aiProvider, model: visionModel.trim(), apiKey: apiKey.trim() }),
      });
      const result = (await response.json()) as {
        error?: string;
        courses?: Array<{ name: string; credit: number; grade: string }>;
        warnings?: string[];
      };
      if (!response.ok || !result.courses?.length) throw new Error(result.error || '没有识别到课程。');
      setOcrProgress(100);
      setOcrText(result.courses.map((course) => `${course.name} ${course.credit} ${course.grade}`).join('\n'));
      const warning = result.warnings?.length ? `；${result.warnings.join('；')}` : '';
      setOcrStatus(`已识别 ${result.courses.length} 门课程，请核对后导入${warning}`);
    } catch (error) {
      setOcrProgress(0);
      setOcrStatus(error instanceof Error ? error.message : '识别没有完成，请重试或改用文字粘贴。');
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
          {PAGE_SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} className={activeSection === section.id ? 'active' : ''}>{section.label}</a>
          ))}
        </nav>

        <div id="overview" className="jump-target grid gap-4 md:grid-cols-3" aria-live="polite">
          {results.map((result, index) => {
            const assessment = level(result.score);
            return (
              <article key={result.mark} className={`result-card ${result.tone}`} style={{ animationDelay: `${index * 100}ms` }}>
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-serif-cn text-sm tracking-[0.12em] text-[#385c55]">{result.title}</p><p className="mt-1 text-[10px] text-[#78908a]">{result.detail}</p></div>
                  <span className="result-mark">{result.mark}</span>
                </div>
                <div className="mt-6 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-[#66817c]">GPA / 4.00</p>
                    <p className="score-number">{result.gpa.toFixed(3)}</p>
                  </div>
                  <div className="pb-1 text-right">
                    <span className={`level-badge ${assessment.tone}`}>{assessment.label}</span>
                    <p className="mt-2 text-[10px] text-[#66817c]">绩点 × 25</p>
                    <p className="font-serif-cn text-lg text-[#294c46]">{result.score.toFixed(2)}</p>
                  </div>
                </div>
                {'inverse' in result && (
                  <p className="inverse-note">抛物线反函数等效分 <strong>{result.inverse?.toFixed(2)}</strong></p>
                )}
              </article>
            );
          })}
        </div>

        <section id="courses" className="jump-target paper-panel mt-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-serif-cn text-xl tracking-[0.06em]">课程卷</p>
              <p className="mt-1 text-xs text-[#66817c]">已计入 {metrics.credits.toFixed(1)} 学分 · 修改即重算 · 自动保存在本机</p>
            </div>
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="sr-only" onChange={(event) => handleImage(event.target.files || undefined)} />
              <Button variant="outline" className="ink-button" onClick={() => setOcrOpen(true)}><Camera />智能导入</Button>
              <Button className="cinnabar-button" onClick={addCourse}><Plus />添一门课</Button>
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
                      <td><Input aria-label="课程名称" value={course.name} placeholder="课程名称" onChange={(event) => updateCourse(course.id, 'name', event.target.value)} className="table-input" /></td>
                      <td><Input aria-label="学分" inputMode="decimal" value={course.credit} placeholder="3" onChange={(event) => updateCourse(course.id, 'credit', event.target.value)} className="table-input text-center" /></td>
                      <td><Input aria-label="成绩或等级" value={course.grade} placeholder="90 / A- / EX" onChange={(event) => updateCourse(course.id, 'grade', event.target.value)} className="table-input text-center font-medium uppercase" /></td>
                      <td className="text-center">
                        <span className={`status-chip ${parsed.excluded ? 'excluded' : valid ? 'included' : 'invalid'}`}>
                          {parsed.excluded ? '排除' : valid ? '计入' : '待填'}
                        </span>
                      </td>
                      <td><Button size="icon-sm" variant="ghost" aria-label={`删除${course.name || '课程'}`} className="text-[#8ba09b] hover:text-[#9e3e2f]" onClick={() => setCourses((current) => current.filter((item) => item.id !== course.id))}><Trash2 /></Button></td>
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
            <Button variant="ghost" size="sm" className="text-[#718781]" onClick={() => setCourses(DEFAULT_COURSES)}><RotateCcw />恢复示例</Button>
          </div>
        </section>

        <section id="rules" className="jump-target mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="formula-panel">
            <div><span>线性换算</span><strong>G₁ = x̄ / 25</strong></div>
            <div><span>抛物线换算</span><strong>G(x) = 4 − 3(x−100)² / 1600</strong></div>
            <p>G₂ 对每门课程先应用 G(x) 再按学分平均；G₃ 先求加权均分 x̄，再应用 G(x)。</p>
          </div>
          <div className="threshold-panel">
            {[{ score: 85, label: '客观优秀' }, { score: 90, label: '主观优秀' }, { score: 95, label: '极度满意' }].map((item) => (
              <div key={item.score}><span>{item.score}</span><i /><strong>{item.label}</strong></div>
            ))}
          </div>
        </section>

        <p className="mt-6 text-center text-[11px] tracking-[0.1em] text-[#6f8580]">等级：A+/A/A− 100 · B+ 85 · B 81 · B− 77 · C+ 73 · C 70 · C− 67 · D+ 64 · D 62 · F 0</p>
      </section>

      <aside className="jump-sidebar" aria-label="页面目录">
        <div className="jump-card">
          <div className="jump-card-title"><span>目</span><div><strong>卷内导航</strong><small>PAGE INDEX</small></div></div>
          <nav>
            {PAGE_SECTIONS.map((section, index) => (
              <a key={section.id} href={`#${section.id}`} className={`jump-link ${activeSection === section.id ? 'active' : ''}`}>
                <span className="jump-index">0{index + 1}</span>
                <span><strong>{section.label}</strong><small>{section.note}</small></span>
              </a>
            ))}
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
            <p className="secret-note">API Key 仅用于本次页面中的识别请求，不会写入浏览器本机存储。</p>
            <button type="button" disabled={ocrBusy || !visionModel.trim()} className="upload-zone" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleImage(event.dataTransfer.files); }}>
              <UploadCloud className="size-6" /><span>{ocrBusy ? `${PROVIDER_NAMES[aiProvider]} 识别进行中，请稍候` : '粘贴、选择或拖入成绩单截图（最多 6 张）'}</span><small>建议裁掉无关区域；图片发送前会压缩，本站不作持久存储</small>
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
