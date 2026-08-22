// サーバー専用モジュールのガード。
// Next.jsの'server-only'パッケージ相当だが、CLI（ベンチマークスクリプト等）の
// Node実行からも読み込めるよう、ブラウザ実行時のみ例外を投げる実装にしている。
// APIキーを扱うモジュールは必ずこれをimportすること。
if (typeof window !== 'undefined') {
  throw new Error('このモジュールはサーバー専用です。クライアントコードからimportしないでください。')
}

export {}
