import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>{children}</section>;
}

export function Label({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const cls =
    variant === 'primary'
      ? 'bg-accent text-accent-ink hover:opacity-90'
      : 'border border-line text-ink hover:bg-surface-alt';
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}

const TONE: Record<string, string> = {
  ok: 'text-ok bg-ok/10',
  alert: 'text-alert bg-alert/10',
  warning: 'text-warning bg-warning/10',
  info: 'text-info bg-info/10',
  muted: 'text-muted bg-surface-alt',
};

export function Pill({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card>
      <Label>{label}</Label>
      <p className="tabular mt-2 text-3xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </Card>
  );
}

export function severityTone(s: string): 'alert' | 'warning' | 'info' {
  return s === 'alert' ? 'alert' : s === 'warning' ? 'warning' : 'info';
}
