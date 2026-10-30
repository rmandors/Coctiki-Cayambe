import type { ReactNode } from 'react'

export function FullScreenLoader() {
  return (
    <div className="grid min-h-svh place-items-center">
      <div className="size-9 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <p className="font-heading text-xl">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
  )
}
