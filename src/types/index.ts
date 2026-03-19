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
  role: 'super_admin' | 'admin' | 'moderator' | 'user';
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

// ─── Service client ────────────────────────────────────────────────────────
export type TicketStatus   = 'open' | 'answered' | 'closed';
export type TicketCategory = 'general' | 'paiement' | 'compte' | 'jeu' | 'bug';

export interface SupportTicket {
  id: string;
  user_id: string;
  username: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  unread_user: boolean;
  unread_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  is_admin: boolean;
  content: string;
  created_at: string;
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
