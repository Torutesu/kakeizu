// プロバイダの内部応答を利用者へ露出せず、次に取れる操作を伝える。
export function analysisUserMessage(message: string): string {
  if (/429|RESOURCE_EXHAUSTED|quota|rate.limit/i.test(message)) {
    return 'AIの利用上限に達しました。時間をおいて、保存済みファイルの「再解析」をお試しください。続く場合は管理者にご連絡ください。'
  }
  if (/503|UNAVAILABLE|high demand|overloaded/i.test(message)) {
    return 'AIサービスが混み合っています。ファイルは保存されています。時間をおいて、保存済みファイルの「再解析」をお試しください。'
  }
  if (/timeout|timed out|AbortError/i.test(message)) {
    return 'AIの読み取りが時間内に完了しませんでした。保存済みファイルの「再解析」をお試しください。'
  }
  if (message.startsWith('すべての解析プロバイダが失敗しました')) {
    return 'AIで読み取れませんでした。時間をおいて再解析してください。繰り返し失敗する場合は管理者にご連絡ください。'
  }
  return message
}
