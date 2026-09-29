import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: '家系図ジェネレーター',
  description: '戸籍謄本PDFをAIで解析し、家系図を作成・編集できるアプリ',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja">
      <head>
        <style>{`
html {
  font-family: ${GeistSans.style.fontFamily};
  --font-sans: ${GeistSans.variable};
  --font-mono: ${GeistMono.variable};
}
        `}</style>
      </head>
      <body>
        {process.env.AI_SAMPLE_ONLY === 'true' && (
          <div role="note" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-950">
            見本専用の確認環境です。本物の戸籍は入れないでください。見本は無料AI APIへ送信され、品質改善に利用される場合があります。
          </div>
        )}
        {children}
        <Toaster />
      </body>
    </html>
  )
}
