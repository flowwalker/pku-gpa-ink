import type { Metadata } from 'next';
import './globals.css';

export const dynamic = 'force-static';

// favicon 用相对路径：GitHub Pages 子路径（/pku-gpa-ink/）与本地根路径都能正确解析。
const favicon = 'favicon.svg?v=2';

export const metadata: Metadata = {
  title: '砚绩 · 北大绩点计算器',
  description: '水墨风格的北大多口径绩点计算、DeepSeek 成绩识图与文本导入工具',
  icons: {
    icon: [{ url: favicon, type: 'image/svg+xml' }],
    shortcut: favicon,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
