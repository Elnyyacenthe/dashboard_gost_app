import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Eye, EyeOff, Loader2, AlertCircle,
  TrendingUp, ShieldCheck, BarChart3, Activity,
} from 'lucide-react';
import { useAuth } from '../lib/hooks/useAuth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/dashboard/overview', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* ─── PANEL GAUCHE — BRAND ─────────────────────────────── */}
      <aside className="login-brand-panel relative hidden flex-col justify-between overflow-hidden p-10 lg:flex lg:w-[44%] xl:w-[40%]">
        {/* Decorative dots pattern */}
        <div className="login-dot-pattern pointer-events-none absolute inset-0" />
        {/* Green glow orbs */}
        <div className="login-orb-tl pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full blur-3xl" />
        <div className="login-orb-br pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full blur-3xl" />

        {/* Top : small brand tag */}
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 backdrop-blur-sm px-3 py-1.5">
            <span className="login-bullet-green h-1.5 w-1.5 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/80">
              Admin Console
            </span>
          </div>
        </div>

        {/* Middle : LOGO + tagline */}
        <div className="relative">
          <img
            src="/plugbet-logo.png"
            alt="Plugbet"
            className="mb-8 h-44 w-auto object-contain -ml-6 select-none drop-shadow-2xl"
            draggable={false}
          />

          <h2 className="text-3xl font-bold leading-tight text-white tracking-tight max-w-md">
            Pilote ta plateforme
            <br />
            de jeu en <span className="login-accent-green">temps réel</span>.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">
            Joueurs, transactions Mobile Money, parties, alertes anti-fraude,
            comptabilité — tout est centralisé dans une seule console
            professionnelle.
          </p>

          {/* Mini KPI grid */}
          <div className="mt-8 grid grid-cols-2 gap-3 max-w-md">
            <KpiTile icon={<Activity className="h-3.5 w-3.5" />} label="Live" value="23" sub="joueurs actifs" />
            <KpiTile icon={<TrendingUp className="h-3.5 w-3.5" />} label="Aujourd'hui" value="+109" sub="parties jouées" />
            <KpiTile icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Sécurité" value="100%" sub="comptes audités" />
            <KpiTile icon={<BarChart3 className="h-3.5 w-3.5" />} label="Caisses" value="✓" sub="zero-sum vérifié" />
          </div>
        </div>

        {/* Bottom : footer */}
        <div className="relative flex items-center justify-between text-[11px] text-white/45">
          <div className="flex items-center gap-2">
            <span className="login-bullet-green h-1.5 w-1.5 rounded-full" />
            Système opérationnel
          </div>
          <span>Plugbet · v1.0</span>
        </div>
      </aside>

      {/* ─── PANEL DROIT — FORM ─────────────────────────────────── */}
      <main className="login-form-bg flex flex-1 items-center justify-center px-6 py-12 lg:px-16">
        <div className="w-full max-w-md animate-fade-in">
          {/* Mobile-only logo */}
          <div className="mb-10 lg:hidden">
            <img
              src="/plugbet-logo.png"
              alt="Plugbet"
              className="login-mobile-logo-bg h-20 w-auto object-contain rounded-2xl"
              draggable={false}
            />
          </div>

          <div className="mb-8">
            <p className="login-accent-green-dk text-[11px] font-bold uppercase tracking-[0.25em]">
              Connexion sécurisée
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
              Bon retour 👋
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Entre tes identifiants pour accéder au dashboard administrateur.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@plugbet.app"
                className="login-input w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Mot de passe</span>
                <button type="button" className="login-accent-green-dk font-semibold hover:underline">
                  Mot de passe oublié ?
                </button>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="login-input w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="login-cta flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white transition-all duration-200 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connexion en cours...
                </>
              ) : (
                'Se connecter'
              )}
            </button>
          </form>

          <p className="mt-10 text-center text-xs text-slate-400">
            Plugbet Gaming Platform · Console v1.0
          </p>
        </div>
      </main>
    </div>
  );
}

// ─── Sub-component : KPI tile dans le panel gauche ──
function KpiTile({
  icon, label, value, sub,
}: {
  icon: React.ReactNode; label: string; value: string; sub: string;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.06] backdrop-blur-sm border border-white/10 p-3.5">
      <div className="flex items-center gap-1.5 text-white/55 text-[10px] font-bold uppercase tracking-wider">
        {icon} {label}
      </div>
      <p className="mt-1.5 text-2xl font-extrabold text-white tabular-nums tracking-tight">
        {value}
      </p>
      <p className="text-[11px] text-white/45">{sub}</p>
    </div>
  );
}
