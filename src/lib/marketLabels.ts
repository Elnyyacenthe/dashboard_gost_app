// ============================================================
// marketLabels.ts — Traduction codes marche -> labels FR
// ============================================================
// Port partiel du market_labels.dart cote Flutter. Gere les ~70 codes
// emis par le parser StatPal (statpal_service.dart).
// Utilise dans Bets.tsx pour afficher des labels humains au lieu des
// codes raw ("correct_score_2_1" -> "Score exact 2-1").
// ============================================================

export interface ParsedMarketCode {
  base: string;
  line?: number;
}

/** Decode "ah_home@-1.5" -> { base: "ah_home", line: -1.5 } */
export function parseMarketLine(code: string): ParsedMarketCode {
  const at = code.indexOf('@');
  if (at < 0) return { base: code };
  const base = code.substring(0, at);
  const line = parseFloat(code.substring(at + 1));
  return { base, line: isNaN(line) ? undefined : line };
}

function fmtNum(v: number): string {
  return v === Math.floor(v) ? String(v) : v.toFixed(1).replace('.', ',');
}

function fmtSigned(v: number): string {
  if (v === 0) return '0';
  const s = fmtNum(Math.abs(v));
  return v > 0 ? `+${s}` : `-${s}`;
}

/**
 * Map d'un code marche brut vers son label FR humain.
 * Format complet retourne : "Section — Selection"
 * Ex: 'home' -> '1X2 — Domicile'
 *     'ah_home@-1.5' -> 'Handicap asiatique (-1,5) — Domicile'
 *     'correct_score_2_1' -> 'Score exact — 2:1'
 */
export function humanizeMarketCode(
  code: string,
  ctx: { homeName?: string; awayName?: string; sport?: 'soccer' | 'basketball' } = {}
): string {
  const home = ctx.homeName ?? 'Domicile';
  const away = ctx.awayName ?? 'Extérieur';
  const sport = ctx.sport ?? 'soccer';

  // 1X2 / Moneyline
  if (code === 'home') return sport === 'basketball' ? `Moneyline — ${home}` : `1X2 — ${home}`;
  if (code === 'draw') return '1X2 — Match nul';
  if (code === 'away') return sport === 'basketball' ? `Moneyline — ${away}` : `1X2 — ${away}`;

  // Double Chance
  if (code === 'dc_1x' || code === 'dc_1X') return `Double chance — ${home} ou nul`;
  if (code === 'dc_12') return 'Double chance — Pas de nul';
  if (code === 'dc_x2' || code === 'dc_X2') return `Double chance — ${away} ou nul`;

  // OU 2.5 / spread
  if (code === 'over25') return sport === 'basketball'
    ? 'Total de points — Plus' : 'Total +/-2,5 — Plus de 2,5 buts';
  if (code === 'under25') return sport === 'basketball'
    ? 'Total de points — Moins' : 'Total +/-2,5 — Moins de 2,5 buts';
  if (code === 'spread_home') return `Handicap — ${home}`;
  if (code === 'spread_away') return `Handicap — ${away}`;

  // BTTS
  if (code === 'btts_yes') return 'Les deux marquent — Oui';
  if (code === 'btts_no') return 'Les deux marquent — Non';

  // HT 1X2
  if (code === 'ht_home') return `1X2 mi-temps — ${home}`;
  if (code === 'ht_draw') return '1X2 mi-temps — Match nul';
  if (code === 'ht_away') return `1X2 mi-temps — ${away}`;
  if (code === 'ht_over15') return 'Buts MT — Plus de 1,5';
  if (code === 'ht_under15') return 'Buts MT — Moins de 1,5';

  // Asian Handicap
  if (code.startsWith('ah_')) {
    const { base, line } = parseMarketLine(code);
    const team = base === 'ah_home' ? home : away;
    const shown = base === 'ah_away' && line != null ? -line : line;
    const lineStr = shown != null ? ` (${fmtSigned(shown)})` : '';
    return `Handicap asiatique${lineStr} — ${team}`;
  }

  // Correct Score : correct_score_X_Y
  if (code.startsWith('correct_score_')) {
    const score = code.substring('correct_score_'.length).replace('_', ':');
    return `Score exact — ${score}`;
  }

  // HT/FT Double : htft_double_home_away
  if (code.startsWith('htft_double_')) {
    const parts = code.substring('htft_double_'.length).split('_');
    const t = (p: string) => p === 'home' ? home : p === 'away' ? away : 'Nul';
    return parts.length === 2
      ? `Mi-temps / Fin de match — ${t(parts[0])} / ${t(parts[1])}`
      : 'Mi-temps / Fin de match';
  }

  // Odd/Even
  if (code === 'odd_even_odd') return 'Pair / impair — Impair';
  if (code === 'odd_even_even') return 'Pair / impair — Pair';
  if (code === 'odd_even_ht_odd') return 'Pair / impair MT — Impair';
  if (code === 'odd_even_ht_even') return 'Pair / impair MT — Pair';
  if (code === 'odd_even_2h_odd') return 'Pair / impair 2eMT — Impair';
  if (code === 'odd_even_2h_even') return 'Pair / impair 2eMT — Pair';

  // Clean Sheet
  if (code === 'clean_sheet_home_yes') return `Clean sheet ${home} — Oui`;
  if (code === 'clean_sheet_home_no') return `Clean sheet ${home} — Non`;
  if (code === 'clean_sheet_away_yes') return `Clean sheet ${away} — Oui`;
  if (code === 'clean_sheet_away_no') return `Clean sheet ${away} — Non`;

  // Win to Nil
  if (code === 'win_to_nil_home_yes') return `${home} gagne sans encaisser — Oui`;
  if (code === 'win_to_nil_home_no') return `${home} gagne sans encaisser — Non`;
  if (code === 'win_to_nil_away_yes') return `${away} gagne sans encaisser — Oui`;
  if (code === 'win_to_nil_away_no') return `${away} gagne sans encaisser — Non`;

  // Win Both Halves
  if (code === 'win_both_halves_home_yes') return `${home} gagne les 2 MT — Oui`;
  if (code === 'win_both_halves_away_yes') return `${away} gagne les 2 MT — Oui`;

  // Highest Scoring Half
  if (code === 'highest_half_1st') return 'MT la + prolifique — 1ere';
  if (code === 'highest_half_2nd') return 'MT la + prolifique — 2eme';
  if (code === 'highest_half_equal') return 'MT la + prolifique — Egalité';

  // Exact Goals
  if (code.startsWith('exact_goals_')) {
    const n = code.substring('exact_goals_'.length);
    return n === 'no_goal' ? 'Nombre exact de buts — Aucun' : `Nombre exact de buts — ${n}`;
  }

  // 1X2 2H
  if (code === '1x2_2h_home') return `1X2 2eMT — ${home}`;
  if (code === '1x2_2h_draw') return '1X2 2eMT — Match nul';
  if (code === '1x2_2h_away') return `1X2 2eMT — ${away}`;

  // OU MT/2eMT lignes variables
  if (code.startsWith('ou_ht_over@')) {
    const { line } = parseMarketLine(code);
    return `Total buts MT — Plus de ${line ?? '?'}`;
  }
  if (code.startsWith('ou_ht_under@')) {
    const { line } = parseMarketLine(code);
    return `Total buts MT — Moins de ${line ?? '?'}`;
  }
  if (code.startsWith('ou_2h_over@')) {
    const { line } = parseMarketLine(code);
    return `Total buts 2eMT — Plus de ${line ?? '?'}`;
  }
  if (code.startsWith('ou_2h_under@')) {
    const { line } = parseMarketLine(code);
    return `Total buts 2eMT — Moins de ${line ?? '?'}`;
  }

  // Race To X Points (NBA)
  if (code.startsWith('race_')) {
    const m = code.match(/^race_(\d+)_(home|away|neither)$/);
    if (m) {
      const team = m[2] === 'home' ? home : m[2] === 'away' ? away : 'Aucune';
      return `Course aux ${m[1]} points — ${team}`;
    }
  }

  // Overtime
  if (code === 'overtime_yes') return 'Prolongation — Oui';
  if (code === 'overtime_no') return 'Prolongation — Non';

  // BTTS variants
  if (code === 'btts_ht_yes') return 'BTTS mi-temps — Oui';
  if (code === 'btts_ht_no') return 'BTTS mi-temps — Non';
  if (code === 'btts_2h_yes') return 'BTTS 2e mi-temps — Oui';
  if (code === 'btts_2h_no') return 'BTTS 2e mi-temps — Non';
  if (code === 'btts_both_halves_yes') return 'BTTS dans les 2 MT — Oui';
  if (code === 'btts_both_halves_no') return 'BTTS dans les 2 MT — Non';

  // Team score yes/no
  if (code === 'home_score_yes') return `${home} marque — Oui`;
  if (code === 'home_score_no') return `${home} marque — Non`;
  if (code === 'away_score_yes') return `${away} marque — Oui`;
  if (code === 'away_score_no') return `${away} marque — Non`;
  if (code === 'home_score_both_yes') return `${home} marque dans les 2 MT — Oui`;
  if (code === 'away_score_both_yes') return `${away} marque dans les 2 MT — Oui`;

  // Scoring Draw
  if (code === 'scoring_draw_yes') return 'Match nul avec buts — Oui';
  if (code === 'scoring_draw_no') return 'Match nul avec buts — Non';

  // OU par quart NBA
  const ouQ = code.match(/^ou_q([1-4])_(over|under)@(.+)$/);
  if (ouQ) {
    const q = ouQ[1], side = ouQ[2] === 'over' ? 'Plus' : 'Moins', line = ouQ[3];
    return `Total points Q${q} — ${side} de ${line}`;
  }

  // 3Way / ML par quart NBA
  const wayQ = code.match(/^(3way|ml)_q([1-4])_(home|draw|away)$/);
  if (wayQ) {
    const q = wayQ[2];
    const team = wayQ[3] === 'home' ? home : wayQ[3] === 'away' ? away : 'Nul';
    return `Q${q} — ${team}`;
  }

  // Highest Scoring Quarter
  if (code.startsWith('highest_qtr_q')) {
    const q = code.replace('highest_qtr_q', '');
    return `Quart-temps le + prolifique — Q${q}`;
  }

  // Fallback : code raw rendu lisible
  return code.replace(/_/g, ' ');
}
