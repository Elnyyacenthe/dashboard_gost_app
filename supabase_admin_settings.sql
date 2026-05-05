-- ============================================================
-- ADMIN SETTINGS - RPC pour le super admin
-- ============================================================
-- Utilise la table app_settings existante (deja cree par freemopay).
-- Cle/valeur jsonb. Lecture publique authenticated, ecriture super_admin.
-- ============================================================

-- S'assurer que la table existe (au cas ou)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

alter table public.app_settings enable row level security;

drop policy if exists "Authenticated users can read app settings" on public.app_settings;
create policy "Authenticated users can read app settings"
  on public.app_settings for select
  using (auth.role() = 'authenticated');

drop policy if exists "Super admin can write app settings" on public.app_settings;
create policy "Super admin can write app settings"
  on public.app_settings for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================
-- RPC : update_app_setting
-- ============================================================
create or replace function public.update_app_setting(
  p_key text,
  p_value jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    return jsonb_build_object('success', false, 'error', 'NOT_SUPER_ADMIN');
  end if;

  insert into public.app_settings(key, value, updated_by, updated_at)
    values (p_key, p_value, auth.uid(), now())
  on conflict (key) do update set
    value = excluded.value,
    updated_by = auth.uid(),
    updated_at = now();

  return jsonb_build_object('success', true, 'key', p_key);
end;
$$;

grant execute on function public.update_app_setting(text, jsonb) to authenticated;

-- ============================================================
-- Defaults : preremplir les cles courantes (idempotent via on conflict do nothing)
-- ============================================================
insert into public.app_settings(key, value) values
  ('platform_config', jsonb_build_object(
    'maintenance_mode', false,
    'registration_open', true,
    'default_coins', 1000,
    'max_bet', 5000,
    'email_alerts', true,
    'weekly_reports', true
  ))
on conflict (key) do nothing;
