-- ============================================================
--  PlugBet Affiliation — Codes promo (Phase 2)
-- ============================================================
--  Demande (affilié) + modération (admin) des codes promo. Aucun code n'est
--  créé automatiquement : toute demande naît en 'pending' et doit être
--  validée manuellement. Idempotent. Conventions dashboard.
-- ============================================================

-- Helper : pousse une notification à un affilié (SECURITY DEFINER -> bypass RLS).
create or replace function public._affiliate_notify(
  p_affiliate_id uuid, p_type text, p_title text, p_body text, p_data jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.affiliate_notifications(affiliate_id, type, title, body, data)
  values (p_affiliate_id, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb));
end; $$;
revoke execute on function public._affiliate_notify(uuid, text, text, text, jsonb) from public;

-- Vue admin : codes + identité de l'affilié + nb d'utilisateurs.
create or replace view public.admin_affiliate_promo_codes_view as
select
  pc.id, pc.affiliate_id, pc.code, pc.status,
  pc.reason, pc.usage_location, pc.followers_count, pc.socials, pc.website, pc.promo_plan,
  pc.created_at, pc.decided_at, pc.decided_by, pc.decision_reason,
  up.username, up.email,
  coalesce((select count(*) from public.affiliate_referrals r where r.promo_code_id = pc.id), 0) as users_count
from public.affiliate_promo_codes pc
join public.affiliates a on a.id = pc.affiliate_id
join public.user_profiles up on up.id = a.user_id;
alter view public.admin_affiliate_promo_codes_view set (security_invoker = on);
grant select on public.admin_affiliate_promo_codes_view to authenticated;

-- ── Affilié : demande d'un nouveau code (naît en 'pending') ──
create or replace function public.affiliate_request_promo_code(
  p_code text,
  p_reason text,
  p_usage text,
  p_followers int,
  p_socials jsonb,
  p_website text,
  p_plan text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_aff public.affiliates;
  v_code text;
  v_pending int;
  v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); end if;
  select * into v_aff from public.affiliates where user_id = v_uid;
  if v_aff.id is null then return jsonb_build_object('success', false, 'error', 'NOT_AFFILIATE'); end if;
  if v_aff.status <> 'active' then return jsonb_build_object('success', false, 'error', 'AFFILIATE_INACTIVE'); end if;

  v_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if v_code !~ '^[A-Z0-9_]{3,20}$' then
    return jsonb_build_object('success', false, 'error', 'INVALID_CODE',
      'message', 'Le code doit faire 3 à 20 caractères (lettres, chiffres, _).');
  end if;

  -- Déjà pris par un code ACTIF (global) ?
  if exists (select 1 from public.affiliate_promo_codes
             where status = 'active' and lower(code) = lower(v_code)) then
    return jsonb_build_object('success', false, 'error', 'CODE_TAKEN',
      'message', 'Ce code est déjà utilisé. Choisis-en un autre.');
  end if;
  -- Déjà une demande en attente identique pour cet affilié ?
  if exists (select 1 from public.affiliate_promo_codes
             where affiliate_id = v_aff.id and status = 'pending' and lower(code) = lower(v_code)) then
    return jsonb_build_object('success', false, 'error', 'ALREADY_PENDING',
      'message', 'Tu as déjà une demande en attente pour ce code.');
  end if;
  -- Cap sur les demandes en attente.
  select count(*) into v_pending from public.affiliate_promo_codes
    where affiliate_id = v_aff.id and status = 'pending';
  if v_pending >= 5 then
    return jsonb_build_object('success', false, 'error', 'TOO_MANY_PENDING',
      'message', 'Trop de demandes en attente (5 max). Attends leur traitement.');
  end if;

  insert into public.affiliate_promo_codes(
    affiliate_id, code, status, reason, usage_location, followers_count, socials, website, promo_plan)
  values (v_aff.id, v_code, 'pending', nullif(trim(p_reason), ''), nullif(trim(p_usage), ''),
          p_followers, coalesce(p_socials, '{}'::jsonb), nullif(trim(p_website), ''), nullif(trim(p_plan), ''))
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'code', v_code, 'status', 'pending');
end; $$;
revoke execute on function public.affiliate_request_promo_code(text, text, text, int, jsonb, text, text) from public;
grant execute on function public.affiliate_request_promo_code(text, text, text, int, jsonb, text, text) to authenticated;

-- ── Admin : décision sur un code (approve/refuse/suspend/reactivate/request_info) ──
create or replace function public.admin_decide_promo_code(
  p_id uuid,
  p_action text,
  p_new_code text default null,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.affiliate_promo_codes;
  v_before jsonb;
  v_code text;
  v_new_status text;
  v_title text;
  v_body text;
  v_aff_user uuid;   -- user_id de l'affilié (target_user attend un auth.users.id)
begin
  if not (public.is_admin() or public.is_super_admin()) then
    return jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
  end if;
  select * into v_row from public.affiliate_promo_codes where id = p_id;
  if v_row.id is null then return jsonb_build_object('success', false, 'error', 'CODE_NOT_FOUND'); end if;
  select user_id into v_aff_user from public.affiliates where id = v_row.affiliate_id;
  v_before := to_jsonb(v_row);
  v_code := v_row.code;

  if p_action = 'approve' then
    -- Code éventuellement modifié par l'admin.
    if p_new_code is not null and trim(p_new_code) <> '' then
      v_code := upper(regexp_replace(p_new_code, '\s', '', 'g'));
      if v_code !~ '^[A-Z0-9_]{3,20}$' then
        return jsonb_build_object('success', false, 'error', 'INVALID_CODE');
      end if;
    end if;
    if exists (select 1 from public.affiliate_promo_codes
               where status = 'active' and lower(code) = lower(v_code) and id <> p_id) then
      return jsonb_build_object('success', false, 'error', 'CODE_TAKEN');
    end if;
    v_new_status := 'active';
    v_title := 'Code promo approuvé ✅';
    v_body := 'Ton code ' || v_code || ' est actif. Tu peux commencer à le partager !';
  elsif p_action = 'refuse' then
    v_new_status := 'refused';
    v_title := 'Code promo refusé';
    v_body := 'Ta demande de code ' || v_code || ' a été refusée' ||
              coalesce(' : ' || nullif(trim(p_reason), ''), '.') ;
  elsif p_action = 'suspend' then
    v_new_status := 'suspended';
    v_title := 'Code promo suspendu';
    v_body := 'Ton code ' || v_code || ' a été suspendu' ||
              coalesce(' : ' || nullif(trim(p_reason), ''), '.');
  elsif p_action = 'reactivate' then
    if exists (select 1 from public.affiliate_promo_codes
               where status = 'active' and lower(code) = lower(v_code) and id <> p_id) then
      return jsonb_build_object('success', false, 'error', 'CODE_TAKEN');
    end if;
    v_new_status := 'active';
    v_title := 'Code promo réactivé ✅';
    v_body := 'Ton code ' || v_code || ' est de nouveau actif.';
  elsif p_action = 'request_info' then
    -- Reste en attente ; on demande des précisions à l'affilié.
    update public.affiliate_promo_codes
      set decision_reason = nullif(trim(p_reason), ''), decided_at = now(), decided_by = auth.uid()
      where id = p_id;
    perform public._affiliate_notify(v_row.affiliate_id, 'promo_code_info_requested',
      'Informations demandées', 'Pour ta demande de code ' || v_code || ' : ' ||
      coalesce(nullif(trim(p_reason), ''), 'merci de préciser ta demande.'),
      jsonb_build_object('promo_code_id', p_id));
    begin
      perform public._log_admin_action('affiliate_promo_request_info', v_aff_user, p_id,
        v_before, (select to_jsonb(c) from public.affiliate_promo_codes c where id = p_id),
        coalesce(nullif(trim(p_reason), ''), 'demande infos code'), null);
    exception when undefined_function then null; end;
    return jsonb_build_object('success', true, 'status', 'pending');
  else
    return jsonb_build_object('success', false, 'error', 'UNKNOWN_ACTION');
  end if;

  update public.affiliate_promo_codes
    set status = v_new_status, code = v_code,
        decided_at = now(), decided_by = auth.uid(),
        decision_reason = nullif(trim(p_reason), '')
    where id = p_id;

  perform public._affiliate_notify(v_row.affiliate_id,
    'promo_code_' || v_new_status, v_title, v_body, jsonb_build_object('promo_code_id', p_id, 'code', v_code));

  begin
    perform public._log_admin_action('affiliate_promo_' || p_action, v_aff_user, p_id,
      v_before, (select to_jsonb(c) from public.affiliate_promo_codes c where id = p_id),
      coalesce(nullif(trim(p_reason), ''), 'décision code ' || p_action), null);
  exception when undefined_function then null; end;

  return jsonb_build_object('success', true, 'status', v_new_status, 'code', v_code);
end; $$;
revoke execute on function public.admin_decide_promo_code(uuid, text, text, text) from public;
grant execute on function public.admin_decide_promo_code(uuid, text, text, text) to authenticated;
