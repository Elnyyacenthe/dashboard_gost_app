import type { ReactNode } from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  change?: string;
  changeType?: 'up' | 'down' | 'neutral';
  accent?: boolean;
}

export default function StatsCard({ title, value, icon, change, changeType = 'neutral', accent }: StatsCardProps) {
  const changeColor = changeType === 'up'
    ? 'text-success'
    : changeType === 'down'
    ? 'text-danger'
    : 'text-text-muted';

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/5 ${
        accent
          ? 'border-primary/30 bg-gradient-to-br from-primary/10 to-surface-light pulse-glow'
          : 'border-border/30 bg-surface-light'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-text-muted">{title}</p>
          <p className="text-3xl font-bold tracking-tight text-text">{value}</p>
          {change && (
            <p className={`text-sm font-medium ${changeColor}`}>
              {changeType === 'up' ? '↑' : changeType === 'down' ? '↓' : '•'} {change}
            </p>
          )}
        </div>
        <div className={`rounded-xl p-3 ${accent ? 'bg-primary/20 text-primary' : 'bg-surface-lighter text-text-muted'}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
