/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // 戸籍という機微情報を扱うため、防御的なセキュリティヘッダーを全レスポンスに付与する
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // クリックジャッキング防止（iframe埋め込み禁止）
          { key: 'X-Frame-Options', value: 'DENY' },
          // MIMEスニッフィング防止
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // 外部サイトへ遷移する際にURL（案件IDなど）を漏らさない
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // 使用しないブラウザ機能を明示的に無効化
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // HTTPS強制（1年、サブドメイン含む）
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ]
  },
}

export default nextConfig
