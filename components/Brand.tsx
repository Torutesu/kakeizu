import Image from 'next/image'
import { cn } from '@/lib/utils'

export function Brand({ className }: { className?: string }) {
  return <span className={cn('inline-flex items-center gap-2 text-primary', className)}>
    <Image src="/brand/kakeizu.svg" width={32} height={32} alt="" priority />
    <span className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'var(--font-geist-sans), sans-serif' }}>Kakeizu</span>
  </span>
}
