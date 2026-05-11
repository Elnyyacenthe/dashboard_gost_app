// ============================================================
// PERMISSIONS — Matrice centralisée des droits par rôle
// ============================================================
// Source unique de vérité pour ce que chaque rôle peut voir/faire
// dans le dashboard. Importé par Sidebar, AdminLayout, et chaque
// page sensible pour cacher boutons et bloquer accès direct.
// ============================================================

export type Role = 'super_admin' | 'admin' | 'moderator' | 'user';

// ─── Actions / sections du dashboard ────────────────────────
export type Permission =
  // Navigation (pages affichées dans la sidebar)
  | 'nav.overview'
  | 'nav.users'
  | 'nav.games'
  | 'nav.analytics'
  | 'nav.alerts'
  | 'nav.announcements'
  | 'nav.treasury'
  | 'nav.audit'
  | 'nav.finance'
  | 'nav.replay'
  | 'nav.support'
  | 'nav.settings'
  // Actions sensibles
  | 'action.broadcast_announcement'
  | 'action.retract_announcement'
  | 'action.adjust_user_coins'
  | 'action.block_user'
  | 'action.change_user_role'
  | 'action.refund_game'
  | 'action.treasury_transfer'
  | 'action.modify_settings'
  | 'action.scan_fraud'
  | 'action.resolve_alert'
  | 'action.reply_ticket'
  | 'action.export_data';

// ─── Matrice principale ─────────────────────────────────────
const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set<Permission>([
    'nav.overview', 'nav.users', 'nav.games', 'nav.analytics',
    'nav.alerts', 'nav.announcements', 'nav.treasury', 'nav.audit',
    'nav.finance', 'nav.replay', 'nav.support', 'nav.settings',
    'action.broadcast_announcement', 'action.retract_announcement',
    'action.adjust_user_coins', 'action.block_user', 'action.change_user_role',
    'action.refund_game', 'action.treasury_transfer', 'action.modify_settings',
    'action.scan_fraud', 'action.resolve_alert', 'action.reply_ticket',
    'action.export_data',
  ]),
  admin: new Set<Permission>([
    'nav.overview', 'nav.users', 'nav.games', 'nav.analytics',
    'nav.alerts', 'nav.announcements', 'nav.replay', 'nav.support',
    'action.broadcast_announcement', 'action.retract_announcement',
    'action.block_user', 'action.refund_game',
    'action.scan_fraud', 'action.resolve_alert', 'action.reply_ticket',
    'action.export_data',
    // Pas de : treasury, audit, finance, settings, change_role,
    //         adjust_coins, treasury_transfer, modify_settings
  ]),
  moderator: new Set<Permission>([
    'nav.overview', 'nav.users', 'nav.games', 'nav.analytics',
    'nav.alerts', 'nav.support',
    'action.resolve_alert', 'action.reply_ticket',
    // Read-only : Users/Games/Analytics oui mais pas d'actions destructrices
  ]),
  user: new Set<Permission>([]), // Aucun accès dashboard
};

// ─── Helpers publiques ──────────────────────────────────────

/**
 * Vérifie si un rôle peut effectuer une action / voir une page.
 * Pas de throw — retourne false si role inconnu.
 */
export function can(role: Role | string | null | undefined, perm: Permission): boolean {
  if (!role) return false;
  const set = MATRIX[role as Role];
  if (!set) return false;
  return set.has(perm);
}

/**
 * Renvoie la liste des permissions d'un rôle (pour debug / inspection).
 */
export function permsOf(role: Role): Permission[] {
  return Array.from(MATRIX[role] ?? []);
}

/**
 * Vérifie si le rôle a AU MOINS UNE permission donnée.
 */
export function canAny(role: Role | string | null | undefined, ...perms: Permission[]): boolean {
  return perms.some(p => can(role, p));
}

/**
 * Vérifie si le rôle a TOUTES les permissions données.
 */
export function canAll(role: Role | string | null | undefined, ...perms: Permission[]): boolean {
  return perms.every(p => can(role, p));
}

/**
 * Label affichable pour un rôle (badges, etc.)
 */
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  moderator: 'Modérateur',
  user: 'Joueur',
};

/**
 * Hiérarchie : un rôle peut promouvoir/rétrograder à un rôle inférieur
 */
export const ROLE_RANK: Record<Role, number> = {
  super_admin: 100,
  admin: 50,
  moderator: 25,
  user: 0,
};

export function canActOn(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}
