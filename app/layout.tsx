import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '砚绩 · 北大绩点计算器',
  description: '水墨风格的北大多口径绩点计算、DeepSeek 成绩识图与文本导入工具',
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
