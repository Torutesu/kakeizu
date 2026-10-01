import { GitBranch } from 'lucide-react'
import { Brand } from './Brand'

export function AuthShell({ children }: { children: React.ReactNode }) {
  return <main className="auth-shell">
    <aside className="auth-story">
      <Brand />
      <div className="auth-story-copy">
        <h1>家族のつながりを、<br />確かな記録から。</h1>
        <p>戸籍を読み解き、家系図を整える。<br />事務所のメンバーと、一つひとつの記録を<br className="hidden xl:block" />確かめながら進められます。</p>
        <div className="auth-story-card">
          <GitBranch className="mb-5 h-9 w-9 text-primary" aria-hidden="true" />
          <p className="font-medium text-primary">取り込む → 確認する → 共有する</p>
          <p className="mt-4 text-xs text-muted-foreground">AIの読み取り結果は、戸籍の原文と照合してご利用ください。</p>
        </div>
      </div>
    </aside>
    <section className="auth-form"><div className="w-full max-w-md">{children}</div></section>
  </main>
}
