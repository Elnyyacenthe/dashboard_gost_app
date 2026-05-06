import type { ReactNode } from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  change?: string;
  changeType?: 'up' | 'down' | 'neutral';
  accent?: boolean;
  /** Couleur thématique : par défaut primary (vert néon).
   * Permet de différencier visuellement chaque KPI sans monochromie. */
  variant?: 'green' | 'blue' | 'red' | 'warning' | 'purple' | 'orange';
}

const variantConfig = {
  green:   { iconBg: 'bg-primary/15',  iconText: 'text-primary',  glow: 'card-glow-green',   bar: 'bg-primary' },
  blue:    { iconBg: 'bg-info/15',     iconText: 'text-info',     glow: 'card-glow-blue',    bar: 'bg-info' },
  red:     { iconBg: 'bg-danger/15',   iconText: 'text-danger',   glow: 'card-glow-red',     bar: 'bg-danger' },
  warning: { iconBg: 'bg-warning/15',  iconText: 'text-warning',  glow: 'card-glow-warning', bar: 'bg-warning' },
  purple:  { iconBg: 'bg-purple/15',   iconText: 'text-purple',   glow: '',                  bar: 'bg-purple' },
  orange:  { iconBg: 'bg-orange/15',   iconText: 'text-orange',   glow: '',                  bar: 'bg-orange' },
} as const;

export default function StatsCard({
  title, value, icon, change, changeType = 'neutral', accent, variant = 'green',
}: StatsCardProps) {
  const cfg = variantConfig[variant];
  const changeColor = changeType === 'up'
    ? 'text-primary'
    : changeType === 'down'
    ? 'text-danger'
    : 'text-text-secondary';

  return (
    <div
      className={`group card-plugbet relative overflow-hidden p-5 transition-all duration-300 hover:-translate-y-0.5 ${
        accent ? cfg.glow : ''
      }`}
    >
      {/* Subtle accent strip on the left */}
      <span
        className={`absolute left-0 top-0 h-full w-[3px] ${cfg.bar} opacity-60 transition-opacity group-hover:opacity-100`}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary truncate">
            {title}
          </p>
          <p className="hero-number text-3xl text-text">{value}</p>
          {change && (
            <p className={`flex items-center gap-1 text-xs font-semibold ${changeColor}`}>
              <span className="text-[10px]">
                {changeType === 'up' ? '▲' : changeType === 'down' ? '▼' : '•'}
              </span>
              {change}
            </p>
          )}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cfg.iconBg} ${cfg.iconText}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
