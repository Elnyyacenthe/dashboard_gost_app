// ─── Profil joueur (table user_profiles dans Supabase) ────────────────────
export interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  coins: number;
  xp: number;
  rank: string;
  total_wins: number;
  games_played: number;
  games_won: number;
  is_blocked: boolean;
  created_at: string;
  last_seen: string | null;
}

// ─── Profil admin/équipe (table profiles dans Supabase) ───────────────────
export interface Profile {
  id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  role: 'admin' | 'user' | 'moderator';
  coins: number;
  is_blocked: boolean;
  created_at: string;
  last_seen: string | null;
}

// ─── Tables sociales ───────────────────────────────────────────────────────
export interface Friendship {
  user_id: string;
  friend_id: string;
  status: 'accepted';
}

export interface FriendRequest {
  id: string;
  from_id: string;
  to_id: string;
  status: 'pending' | 'accepted' | 'declined';
}

// ─── KPIs dashboard ────────────────────────────────────────────────────────
export interface DashboardKPIs {
  total_players: number;
  active_players_7d: number;
  total_coins: number;
  top_rank: string;
  total_games_played: number;
  total_wins: number;
}

// ─── Stats par jeu (calculées depuis user_profiles) ───────────────────────
export interface GameStats {
  game_type: string;
  total_games: number;
  total_wins: number;
  win_rate: number;
}

// ─── Entrée leaderboard ────────────────────────────────────────────────────
export interface LeaderboardEntry {
  id: string;
  username: string;
  coins: number;
  xp: number;
  rank: string;
  total_wins: number;
  games_played: number;
  win_rate: number;
}
