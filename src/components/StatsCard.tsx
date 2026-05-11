import type { ReactNode } from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  change?: string;
  changeType?: 'up' | 'down' | 'neutral';
  accent?: boolean;
  variant?: 'green' | 'blue' | 'amber' | 'violet' | 'rose' | 'cyan';
}

const strip: Record<NonNullable<StatsCardProps['variant']>, string> = {
  green:  'kpi-strip-green',
  blue:   'kpi-strip-blue',
  amber:  'kpi-strip-amber',
  violet: 'kpi-strip-violet',
  rose:   'kpi-strip-rose',
  cyan:   'kpi-strip-cyan',
};

const iconBg: Record<NonNullable<StatsCardProps['variant']>, string> = {
  green:  'bg-green-100 text-green-700',
  blue:   'bg-blue-100 text-blue-700',
  amber:  'bg-amber-100 text-amber-700',
  violet: 'bg-violet-100 text-violet-700',
  rose:   'bg-rose-100 text-rose-700',
  cyan:   'bg-cyan-100 text-cyan-700',
};

export default function StatsCard({
  title, value, icon, change, changeType = 'neutral', accent, variant = 'green',
}: StatsCardProps) {
  const changeColor =
    changeType === 'up'   ? 'text-emerald-600' :
    changeType === 'down' ? 'text-red-600'     :
                            'text-slate-500';

  return (
    <div className={`exec-card exec-card-hover ${strip[variant]} relative overflow-hidden p-5 ${accent ? 'ring-1 ring-primary/30' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 truncate">
            {title}
          </p>
          <p className="hero-number text-3xl text-slate-900">{value}</p>
          {change && (
            <p className={`flex items-center gap-1 text-xs font-semibold ${changeColor}`}>
              <span className="text-[10px]">
                {changeType === 'up' ? '▲' : changeType === 'down' ? '▼' : '•'}
              </span>
              {change}
            </p>
          )}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg[variant]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
