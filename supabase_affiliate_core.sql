-- ============================================================
--  PlugBet — Portail d'affiliation : SCHÉMA SOCLE (Phase 0)
-- ============================================================
--  Idempotent. Additif : ne touche AUCUN flux d'argent existant.
--  Conventions du dashboard reprises :
--    * is_admin() / is_super_admin() (définies dans l'app principale /
--      supabase_treasury.sql) pour l'autorisation.
--    * RPC SECURITY DEFINER, retour jsonb { success, ... } pour les mutations.
--    * RLS activée partout ; l'affilié ne voit que SES lignes (auth.uid()),
--      l'admin via is_admin(). Grants EXECUTE ... TO authenticated (jamais anon).
--    * Paramètres p_, variables v_, helpers internes préfixés _.
--
--  Modèle commission : HYBRIDE (CPA au 1er dépôt qualifié + revenue-share %).
--  Le calcul des commissions (moteur cron) est livré en Phase 3 ; ici on pose
--  le socle (tables, config, RLS, vues, RPC de lecture/onboarding).
-- ============================================================

-- Les corps de fonctions référencent des tables créées plus bas : on diffère
-- leur validation le temps de la migration.
set check_function_bodies = off;

-- ─────────────────────────────────────────────────────────────
-- 0. Helper : l'utilisateur courant est-il propriétaire de cet affilié ?
-- ─────────────────────────────────────────────────────────────
create or replace function public._is_affiliate_owner(p_affiliate_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.affiliates a
    where a.id = p_affiliate_id and a.user_id = auth.uid()
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- 1. affiliate_config — paramètres globaux (singleton id = 1)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.affiliate_config (
  id                    int primary key default 1,
  cpa_amount            bigint  not null default 2000,    -- FCFA / 1er dépôt qualifié
  cpa_min_deposit       bigint  not null default 1000,    -- dépôt qualifiant minimum
  revenue_share_percent numeric not null default 25,      -- % du revenu net des filleuls
  holding_days          int     not null default 7,       -- rétention pending -> disponible
  withdrawal_min        bigint  not null default 20000,   -- seuil minimum de retrait
  withdrawal_weekday    int     not null default 1,        -- ISODOW : 1 = lundi
  tier_thresholds       jsonb   not null default
    '{"bronze":{"revenue":0,"players":0},
      "silver":{"revenue":100000,"players":10},
      "gold":{"revenue":500000,"players":50},
      "diamond":{"revenue":2000000,"players":150},
      "vip":{"revenue":10000000,"players":500}}'::jsonb,
  updated_by            uuid,
  updated_at            timestamptz not null default now(),
  constraint affiliate_config_singleton check (id = 1)
);
insert into public.affiliate_config(id) values (1) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 2. affiliates — 1 ligne par utilisateur devenu affilié
-- ─────────────────────────────────────────────────────────────
create table if not exists public.affiliates (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references auth.users(id) on delete cascade,
  status           text not null default 'active'
                     check (status in ('active','suspended','banned')),
  tier             text not null default 'bronze'
                     check (tier in ('bronze','silver','gold','diamond','vip')),
  preferred_method text check (preferred_method in ('orange_money','mtn_money','wave','crypto')),
  payout_holder    text,
  payout_number    text,
  created_at       timestamptz not null default now(),
  suspended_at     timestamptz,
  suspended_by     uuid,
  suspend_reason   text
);
create index if not exists affiliates_status_idx on public.affiliates(status);

-- ─────────────────────────────────────────────────────────────
-- 3. affiliate_promo_codes — codes promo (plusieurs par affilié)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.affiliate_promo_codes (
  id              uuid primary key default gen_random_uuid(),
  affiliate_id    uuid not null references public.affiliates(id) on delete cascade,
  code            text not null,
  status          text not null default 'pending'
                    check (status in ('pending','active','refused','suspended')),
  -- champs de la demande
  reason          text,
  usage_location  text,
  followers_count int,
  socials         jsonb default '{}'::jsonb,
  website         text,
  promo_plan      text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid,
  decision_reason text
);
-- Un code ACTIF doit être globalement unique (il sert dans les URLs).
-- Les codes pending/refused/suspended ne réservent pas le libellé.
create unique index if not exists affiliate_promo_codes_active_uq
  on public.affiliate_promo_codes(lower(code)) where status = 'active';
create index if not exists affiliate_promo_codes_aff_idx
  on public.affiliate_promo_codes(affiliate_id, created_at desc);
create index if not exists affiliate_promo_codes_status_idx
  on public.affiliate_promo_codes(status);

-- ─────────────────────────────────────────────────────────────
-- 4. affiliate_referrals — joueurs parrainés
-- ─────────────────────────────────────────────────────────────
create table if not exists public.affiliate_referrals (
  id                  uuid primary key default gen_random_uuid(),
  affiliate_id        uuid not null references public.affiliates(id) on delete cascade,
  promo_code_id       uuid references public.affiliate_promo_codes(id) on delete set null,
  code                text,
  player_id           uuid not null references auth.users(id) on delete cascade,
  registered_at       timestamptz not null default now(),
  first_deposit_at    timestamptz,
  first_deposit_amount bigint,
  qualified           boolean not null default false,
  last_active_at      timestamptz,
  country             text,
  device              text,
  os                  text,
  unique (player_id)   -- un joueur est attribué à au plus un affilié
);
create index if not exists affiliate_referrals_aff_idx
  on public.affiliate_referrals(affiliate_id, registered_at desc);
create index if not exists affiliate_referrals_qualified_idx
  on public.affiliate_referrals(affiliate_id) where qualified;

-- ─────────────────────────────────────────────────────────────
-- 5. affiliate_commissions — grand livre des commissions
-- ─────────────────────────────────────────────────────────────
create table if not exists public.affiliate_commissions (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  referral_id  uuid references public.affiliate_referrals(id) on delete set null,
  type         text not null check (type in ('cpa','revenue_share','adjustment')),
  amount       bigint not null,                       -- peut être négatif (ajustement)
  status       text not null default 'pending'
                 check (status in ('pending','available','paid','reversed')),
  period_start date,
  period_end   date,
  available_at timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  note         text,
  meta         jsonb default '{}'::jsonb
);
-- Idempotence du moteur d'accrual (Phase 3) : 1 CPA / filleul, 1 rev-share / période.
create unique index if not exists affiliate_comm_cpa_uq
  on public.affiliate_commissions(referral_id) where type = 'cpa';
create unique index if not exists affiliate_comm_rev_uq
  on public.affiliate_commissions(affiliate_id, period_start, period_end)
  where type = 'revenue_share';
create index if not exists affiliate_comm_aff_idx
  on public.affiliate_commissions(affiliate_id, created_at desc);
create index if not exists affiliate_comm_status_idx
  on public.affiliate_commissions(affiliate_id, status);

-- ─────────────────────────────────────────────────────────────
-- 6. affiliate_withdrawals — demandes de retrait
-- ─────────────────────────────────────────────────────────────
create table if not exists public.affiliate_withdrawals (
  id              uuid primary key default gen_random_uuid(),
  affiliate_id    uuid not null references public.affiliates(id) on delete cascade,
  amount          bigint not null check (amount > 0),
  method          text not null check (method in ('orange_money','mtn_money','wave','crypto')),
  account_holder  text not null,
  account_number  text not null,
  status          text not null default 'pending'
                    check (status in ('pending','validated','refused','paid')),
  reference       text,
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid,
  decision_reason text,
  paid_at         timestamptz
);
create index if not exists affiliate_withdrawals_aff_idx
  on public.affiliate_withdrawals(affiliate_id, requested_at desc);
create index if not exists affiliate_withdrawals_status_idx
  on public.affiliate_withdrawals(status);

-- ─────────────────────────────────────────────────────────────
-- 7. affiliate_tickets + messages — centre de support
-- ─────────────────────────────────────────────────────────────
create table if not exists public.affiliate_tickets (
  id               uuid primary key default gen_random_uuid(),
  affiliate_id     uuid not null references public.affiliates(id) on delete cascade,
  category         text not null check (category in
                     ('new_code','payment','withdrawal','registration','complaint','question','other')),
  subject          text not null,
  priority         text not null default 'normal'
                     check (priority in ('low','normal','high','urgent')),
  status           text not null default 'open'
                     check (status in ('open','pending','answered','closed')),
  unread_admin     boolean not null default true,
  unread_affiliate boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz
);
create index if not exists affiliate_tickets_aff_idx
  on public.affiliate_tickets(affiliate_id, updated_at desc);
create index if not exists affiliate_tickets_unread_admin_idx
  on public.affiliate_tickets(unread_admin) where unread_admin;

create table if not exists public.affiliate_ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.affiliate_tickets(id) on delete cascade,
  author_id   uuid not null references auth.users(id),
  author_role text not null check (author_role in ('affiliate','staff')),
  body        text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists affiliate_ticket_messages_ticket_idx
  on public.affiliate_ticket_messages(ticket_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- 8. affiliate_marketing_assets — ressources marketing (Storage)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.affiliate_marketing_assets (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  category     text not null check (category in
                 ('logo','flyer','poster','banner','qr','story','facebook_cover',
                  'tiktok_video','facebook_video','instagram_video','media_pack')),
  description  text,
  file_url     text not null,
  thumbnail_url text,
  format       text,
  dimensions   text,
  file_size    bigint,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid
);
create index if not exists affiliate_assets_cat_idx
  on public.affiliate_marketing_assets(category) where is_active;

-- ─────────────────────────────────────────────────────────────
-- 9. affiliate_link_clicks — tracking des clics (générateur de liens)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.affiliate_link_clicks (
  id            bigint generated always as identity primary key,
  code          text,
  promo_code_id uuid references public.affiliate_promo_codes(id) on delete set null,
  affiliate_id  uuid references public.affiliates(id) on delete set null,
  landing_page  text,
  country       text,
  device        text,
  os            text,
  referrer      text,
  created_at    timestamptz not null default now()
);
create index if not exists affiliate_clicks_aff_idx
  on public.affiliate_link_clicks(affiliate_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 10. affiliate_notifications — feed personnel de l'affilié
-- ─────────────────────────────────────────────────────────────
create table if not exists public.affiliate_notifications (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  data         jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists affiliate_notifs_aff_idx
  on public.affiliate_notifications(affiliate_id, created_at desc);

-- ============================================================
--  RLS — l'affilié ne voit que SES lignes ; l'admin voit tout
-- ============================================================
alter table public.affiliate_config             enable row level security;
alter table public.affiliates                   enable row level security;
alter table public.affiliate_promo_codes        enable row level security;
alter table public.affiliate_referrals          enable row level security;
alter table public.affiliate_commissions        enable row level security;
alter table public.affiliate_withdrawals        enable row level security;
alter table public.affiliate_tickets            enable row level security;
alter table public.affiliate_ticket_messages    enable row level security;
alter table public.affiliate_marketing_assets   enable row level security;
alter table public.affiliate_link_clicks        enable row level security;
alter table public.affiliate_notifications      enable row level security;

-- config : lecture par tout authentifié, écriture super_admin (via RPC)
drop policy if exists ac_read on public.affiliate_config;
create policy ac_read on public.affiliate_config
  for select using (auth.role() = 'authenticated');
drop policy if exists ac_admin on public.affiliate_config;
create policy ac_admin on public.affiliate_config
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- affiliates : self + admin
drop policy if exists aff_self on public.affiliates;
create policy aff_self on public.affiliates
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists aff_admin on public.affiliates;
create policy aff_admin on public.affiliates
  for all using (public.is_admin()) with check (public.is_admin());

-- helper macro : policy self-select + admin-all pour les tables liées à affiliate_id
--   (écritures passent par des RPC SECURITY DEFINER)
drop policy if exists apc_self on public.affiliate_promo_codes;
create policy apc_self on public.affiliate_promo_codes
  for select using (public._is_affiliate_owner(affiliate_id) or public.is_admin());
drop policy if exists apc_admin on public.affiliate_promo_codes;
create policy apc_admin on public.affiliate_promo_codes
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ar_self on public.affiliate_referrals;
create policy ar_self on public.affiliate_referrals
  for select using (public._is_affiliate_owner(affiliate_id) or public.is_admin());
drop policy if exists ar_admin on public.affiliate_referrals;
create policy ar_admin on public.affiliate_referrals
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists acm_self on public.affiliate_commissions;
create policy acm_self on public.affiliate_commissions
  for select using (public._is_affiliate_owner(affiliate_id) or public.is_admin());
drop policy if exists acm_admin on public.affiliate_commissions;
create policy acm_admin on public.affiliate_commissions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists aw_self on public.affiliate_withdrawals;
create policy aw_self on public.affiliate_withdrawals
  for select using (public._is_affiliate_owner(affiliate_id) or public.is_admin());
drop policy if exists aw_admin on public.affiliate_withdrawals;
create policy aw_admin on public.affiliate_withdrawals
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists at_self on public.affiliate_tickets;
create policy at_self on public.affiliate_tickets
  for select using (public._is_affiliate_owner(affiliate_id) or public.is_admin());
drop policy if exists at_admin on public.affiliate_tickets;
create policy at_admin on public.affiliate_tickets
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists atm_self on public.affiliate_ticket_messages;
create policy atm_self on public.affiliate_ticket_messages
  for select using (
    public.is_admin() or exists (
      select 1 from public.affiliate_tickets t
      where t.id = ticket_id and public._is_affiliate_owner(t.affiliate_id)
    )
  );
drop policy if exists atm_admin on public.affiliate_ticket_messages;
create policy atm_admin on public.affiliate_ticket_messages
  for all using (public.is_admin()) with check (public.is_admin());

-- marketing : lecture par tout affilié authentifié (assets actifs), admin all
drop policy if exists ama_read on public.affiliate_marketing_assets;
create policy ama_read on public.affiliate_marketing_assets
  for select using (is_active or public.is_admin());
drop policy if exists ama_admin on public.affiliate_marketing_assets;
create policy ama_admin on public.affiliate_marketing_assets
  for all using (public.is_admin()) with check (public.is_admin());

-- clics : self-select + admin ; insertion via RPC/edge (SECURITY DEFINER)
drop policy if exists alc_self on public.affiliate_link_clicks;
create policy alc_self on public.affiliate_link_clicks
  for select using (public._is_affiliate_owner(affiliate_id) or public.is_admin());
drop policy if exists alc_admin on public.affiliate_link_clicks;
create policy alc_admin on public.affiliate_link_clicks
  for all using (public.is_admin()) with check (public.is_admin());

-- notifications : self + admin ; l'affilié peut marquer lu (update de ses lignes)
drop policy if exists an_self on public.affiliate_notifications;
create policy an_self on public.affiliate_notifications
  for select using (public._is_affiliate_owner(affiliate_id) or public.is_admin());
drop policy if exists an_self_upd on public.affiliate_notifications;
create policy an_self_upd on public.affiliate_notifications
  for update using (public._is_affiliate_owner(affiliate_id))
  with check (public._is_affiliate_owner(affiliate_id));
drop policy if exists an_admin on public.affiliate_notifications;
create policy an_admin on public.affiliate_notifications
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
--  VUES agrégées
-- ============================================================
-- Soldes par affilié (buckets de commissions). Le "disponible réel" (moins les
-- retraits en cours) est recalculé dans les RPC de retrait (Phase 3).
create or replace view public.affiliate_balances_view as
select
  a.id as affiliate_id,
  coalesce(sum(c.amount) filter (where c.status <> 'reversed'), 0)          as total_earned,
  coalesce(sum(c.amount) filter (where c.status = 'available'), 0)          as available,
  coalesce(sum(c.amount) filter (where c.status = 'pending'), 0)            as pending,
  coalesce(sum(c.amount) filter (where c.status = 'paid'), 0)              as paid
from public.affiliates a
left join public.affiliate_commissions c on c.affiliate_id = a.id
group by a.id;
grant select on public.affiliate_balances_view to authenticated;

-- Codes promo enrichis (nb d'utilisateurs = filleuls rattachés au code)
create or replace view public.affiliate_promo_codes_view as
select
  pc.*,
  coalesce((select count(*) from public.affiliate_referrals r
            where r.promo_code_id = pc.id), 0) as users_count
from public.affiliate_promo_codes pc;
grant select on public.affiliate_promo_codes_view to authenticated;

-- Vue admin : affiliés + identité + compteurs + soldes
create or replace view public.admin_affiliates_view as
select
  a.id,
  a.user_id,
  up.username,
  up.email,
  up.avatar_url,
  a.status,
  a.tier,
  a.preferred_method,
  a.created_at,
  a.suspend_reason,
  coalesce((select count(*) from public.affiliate_referrals r where r.affiliate_id = a.id), 0)                as referrals_count,
  coalesce((select count(*) from public.affiliate_referrals r where r.affiliate_id = a.id and r.qualified), 0) as first_deposits_count,
  coalesce((select count(*) from public.affiliate_referrals r
            where r.affiliate_id = a.id and r.last_active_at > now() - interval '30 days'), 0)                 as active_players_count,
  coalesce((select count(*) from public.affiliate_promo_codes pc
            where pc.affiliate_id = a.id and pc.status = 'active'), 0)                                          as active_codes_count,
  b.total_earned, b.available, b.pending, b.paid
from public.affiliates a
join public.user_profiles up on up.id = a.user_id
left join public.affiliate_balances_view b on b.affiliate_id = a.id;
grant select on public.admin_affiliates_view to authenticated;

-- ============================================================
--  RPC socle
-- ============================================================
-- Onboarding : garantit un affiliate row pour l'utilisateur courant et
-- renvoie son profil + soldes + config publique.
create or replace function public.affiliate_get_or_create_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_aff public.affiliates; v_bal record; v_cfg public.affiliate_config;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  select * into v_aff from public.affiliates where user_id = v_uid;
  if not found then
    insert into public.affiliates(user_id) values (v_uid)
    on conflict (user_id) do nothing;
    select * into v_aff from public.affiliates where user_id = v_uid;
  end if;

  select * into v_bal from public.affiliate_balances_view where affiliate_id = v_aff.id;
  select * into v_cfg from public.affiliate_config where id = 1;

  return jsonb_build_object(
    'success', true,
    'affiliate', jsonb_build_object(
      'id', v_aff.id, 'status', v_aff.status, 'tier', v_aff.tier,
      'preferred_method', v_aff.preferred_method,
      'payout_holder', v_aff.payout_holder, 'payout_number', v_aff.payout_number,
      'created_at', v_aff.created_at
    ),
    'balances', jsonb_build_object(
      'total_earned', coalesce(v_bal.total_earned, 0),
      'available',    coalesce(v_bal.available, 0),
      'pending',      coalesce(v_bal.pending, 0),
      'paid',         coalesce(v_bal.paid, 0)
    ),
    'config', jsonb_build_object(
      'cpa_amount', v_cfg.cpa_amount, 'cpa_min_deposit', v_cfg.cpa_min_deposit,
      'revenue_share_percent', v_cfg.revenue_share_percent,
      'holding_days', v_cfg.holding_days,
      'withdrawal_min', v_cfg.withdrawal_min, 'withdrawal_weekday', v_cfg.withdrawal_weekday,
      'tier_thresholds', v_cfg.tier_thresholds
    )
  );
end; $$;
grant execute on function public.affiliate_get_or_create_me() to authenticated;

-- KPIs du tableau de bord affilié
create or replace function public.affiliate_dashboard_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_aff_id uuid; v_bal record;
  v_signups int; v_first_deposits int; v_active int;
  v_comm_today bigint; v_comm_month bigint;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;
  select id into v_aff_id from public.affiliates where user_id = v_uid;
  if v_aff_id is null then
    return jsonb_build_object('success', false, 'error', 'NOT_AFFILIATE');
  end if;

  select * into v_bal from public.affiliate_balances_view where affiliate_id = v_aff_id;

  select count(*) into v_signups
    from public.affiliate_referrals where affiliate_id = v_aff_id;
  select count(*) into v_first_deposits
    from public.affiliate_referrals where affiliate_id = v_aff_id and qualified;
  select count(*) into v_active
    from public.affiliate_referrals
    where affiliate_id = v_aff_id and last_active_at > now() - interval '30 days';

  select coalesce(sum(amount), 0) into v_comm_today
    from public.affiliate_commissions
    where affiliate_id = v_aff_id and status <> 'reversed'
      and created_at >= date_trunc('day', now());
  select coalesce(sum(amount), 0) into v_comm_month
    from public.affiliate_commissions
    where affiliate_id = v_aff_id and status <> 'reversed'
      and created_at >= date_trunc('month', now());

  return jsonb_build_object(
    'success', true,
    'total_earned',     coalesce(v_bal.total_earned, 0),
    'available',        coalesce(v_bal.available, 0),
    'pending',          coalesce(v_bal.pending, 0),
    'signups',          v_signups,
    'first_deposits',   v_first_deposits,
    'active_players',   v_active,
    'commission_today', v_comm_today,
    'commission_month', v_comm_month
  );
end; $$;
grant execute on function public.affiliate_dashboard_summary() to authenticated;

-- Admin : mise à jour de la config (super_admin), audit via _log_admin_action
create or replace function public.admin_update_affiliate_config(p_patch jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('success', false, 'error', 'NOT_SUPER_ADMIN');
  end if;
  select to_jsonb(c) into v_before from public.affiliate_config c where id = 1;

  update public.affiliate_config set
    cpa_amount            = coalesce((p_patch->>'cpa_amount')::bigint, cpa_amount),
    cpa_min_deposit       = coalesce((p_patch->>'cpa_min_deposit')::bigint, cpa_min_deposit),
    revenue_share_percent = coalesce((p_patch->>'revenue_share_percent')::numeric, revenue_share_percent),
    holding_days          = coalesce((p_patch->>'holding_days')::int, holding_days),
    withdrawal_min        = coalesce((p_patch->>'withdrawal_min')::bigint, withdrawal_min),
    withdrawal_weekday    = coalesce((p_patch->>'withdrawal_weekday')::int, withdrawal_weekday),
    tier_thresholds       = coalesce(p_patch->'tier_thresholds', tier_thresholds),
    updated_by = auth.uid(), updated_at = now()
  where id = 1;

  begin
    perform public._log_admin_action(
      'affiliate_config_update', null, null, v_before,
      (select to_jsonb(c) from public.affiliate_config c where id = 1),
      coalesce(nullif(p_reason,''), 'maj config affiliation'), null);
  exception when undefined_function then null; -- _log_admin_action hors repo local
  end;

  return jsonb_build_object('success', true);
end; $$;
grant execute on function public.admin_update_affiliate_config(jsonb, text) to authenticated;

-- ============================================================
--  VÉRIFICATION
-- ============================================================
-- select 'tables', count(*) from information_schema.tables
--   where table_schema='public' and table_name like 'affiliate%';
-- select public.affiliate_get_or_create_me();
