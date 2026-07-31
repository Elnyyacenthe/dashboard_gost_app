// ============================================================
// PERMISSIONS — Matrice centralisée des droits par rôle
// ============================================================
// Source unique de vérité pour ce que chaque rôle peut voir/faire
// dans le dashboard. Importé par Sidebar, AdminLayout, et chaque
// page sensible pour cacher boutons et bloquer accès direct.
// ============================================================

export type Role =
  | 'super_admin'
  | 'admin'
  | 'finance'      // Finances : trésorerie, cashflow, rapports, retraits
  | 'trading'      // Cotes : monitoring odds + OddsPapi
  | 'community'    // Communauté : users, annonces, alertes, support social
  | 'affiliation'  // Affiliation : programme de parrainage
  | 'moderator'    // Modération générale (lecture large, actions limitées)
  | 'analyst'      // Analyste : dashboards en lecture seule
  | 'support'      // Support : messagerie utilisateurs uniquement
  | 'user';

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
  | 'nav.cashflow'
  | 'nav.replay'
  | 'nav.support'
  | 'nav.affiliates'
  | 'nav.odds'
  | 'nav.oddspapi'
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
  | 'action.export_data'
  | 'action.manage_affiliates'
  | 'action.decide_promo_code'
  | 'action.decide_withdrawal';

// ─── Matrice principale ─────────────────────────────────────
const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set<Permission>([
    'nav.overview', 'nav.users', 'nav.games', 'nav.analytics',
    'nav.alerts', 'nav.announcements', 'nav.treasury', 'nav.audit',
    'nav.finance', 'nav.cashflow', 'nav.replay', 'nav.support', 'nav.settings',
    'nav.affiliates', 'nav.odds', 'nav.oddspapi',
    'action.broadcast_announcement', 'action.retract_announcement',
    'action.adjust_user_coins', 'action.block_user', 'action.change_user_role',
    'action.refund_game', 'action.treasury_transfer', 'action.modify_settings',
    'action.scan_fraud', 'action.resolve_alert', 'action.reply_ticket',
    'action.export_data',
    'action.manage_affiliates', 'action.decide_promo_code', 'action.decide_withdrawal',
  ]),
  admin: new Set<Permission>([
    'nav.overview', 'nav.users', 'nav.games', 'nav.analytics',
    'nav.alerts', 'nav.announcements', 'nav.replay', 'nav.support',
    'nav.affiliates', 'nav.odds', 'nav.oddspapi',
    'action.broadcast_announcement', 'action.retract_announcement',
    'action.block_user', 'action.refund_game',
    'action.scan_fraud', 'action.resolve_alert', 'action.reply_ticket',
    'action.export_data',
    'action.manage_affiliates', 'action.decide_promo_code', 'action.decide_withdrawal',
    // Pas de : treasury, audit, finance, settings, change_role,
    //         adjust_coins, treasury_transfer, modify_settings
  ]),
  moderator: new Set<Permission>([
    'nav.overview', 'nav.users', 'nav.games', 'nav.analytics',
    'nav.alerts', 'nav.support',
    'action.resolve_alert', 'action.reply_ticket',
    // Read-only : Users/Games/Analytics oui mais pas d'actions destructrices
  ]),
  // Finance : trésorerie / cashflow / rapports financiers / audit.
  // Peut décider des retraits et exporter, mais pas d'ajustement de solde
  // (adjust_coins/treasury_transfer restent super_admin) ni de refund.
  finance: new Set<Permission>([
    'nav.treasury', 'nav.finance', 'nav.cashflow', 'nav.audit',
    'action.decide_withdrawal', 'action.export_data',
  ]),
  // Trading : suivi des cotes (odds) et de l'intégration OddsPapi.
  trading: new Set<Permission>([
    'nav.odds', 'nav.oddspapi',
  ]),
  // Communauté : gestion sociale (users, annonces, alertes, support).
  // Peut bloquer un joueur et diffuser des annonces, PAS d'action financière.
  community: new Set<Permission>([
    'nav.users', 'nav.support', 'nav.announcements', 'nav.alerts',
    'action.block_user', 'action.resolve_alert', 'action.reply_ticket',
    'action.broadcast_announcement', 'action.retract_announcement',
  ]),
  // Affiliation : programme de parrainage (validation codes + retraits affiliés).
  affiliation: new Set<Permission>([
    'nav.affiliates',
    'action.manage_affiliates', 'action.decide_promo_code', 'action.decide_withdrawal',
  ]),
  // Analyste : lecture seule des tableaux de bord. Aucune action.
  analyst: new Set<Permission>([
    'nav.overview', 'nav.analytics', 'nav.games',
  ]),
  // Agent de support : accès UNIQUEMENT à la messagerie utilisateurs.
  // Aucune autre page, aucune action financière (pas de refund/ajustement).
  support: new Set<Permission>([
    'nav.support',
    'action.reply_ticket',
  ]),
  user: new Set<Permission>([]), // Aucun accès dashboard
};

// Liste des permissions de navigation (une par page de la sidebar).
// Sert de source unique pour "ce rôle a-t-il accès au dashboard ?".
export const NAV_PERMS: Permission[] = [
  'nav.overview', 'nav.users', 'nav.games', 'nav.analytics', 'nav.alerts',
  'nav.announcements', 'nav.treasury', 'nav.audit', 'nav.finance',
  'nav.cashflow', 'nav.replay', 'nav.support', 'nav.affiliates',
  'nav.odds', 'nav.oddspapi', 'nav.settings',
];

/**
 * Un rôle a-t-il accès au dashboard ? = possède au moins une page de nav.
 * Future-proof : tout nouveau rôle avec une perm nav.* est automatiquement admis.
 */
export function hasDashboardAccess(role: Role | string | null | undefined): boolean {
  return NAV_PERMS.some(p => can(role, p));
}

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
  finance: 'Finance',
  trading: 'Trading',
  community: 'Communauté',
  affiliation: 'Affiliation',
  moderator: 'Modérateur',
  analyst: 'Analyste',
  support: 'Support',
  user: 'Joueur',
};

/**
 * Hiérarchie : un rôle peut promouvoir/rétrograder à un rôle inférieur
 */
export const ROLE_RANK: Record<Role, number> = {
  super_admin: 100,
  admin: 50,
  finance: 40,
  trading: 40,
  community: 30,
  affiliation: 30,
  moderator: 25,
  analyst: 20,
  support: 10,
  user: 0,
};

export function canActOn(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}
