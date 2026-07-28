-- ============================================================
--  PlugBet Affiliation — Centre marketing (Phase 5a)
-- ============================================================
--  Ressources marketing (logos, flyers, bannières, QR, stories, vidéos…)
--  déposées par l'admin, téléchargeables par les affiliés. Idempotent.
-- ============================================================

-- Bucket public : lecture par tous, écriture réservée aux admins.
insert into storage.buckets (id, name, public)
values ('affiliate-marketing', 'affiliate-marketing', true)
on conflict (id) do nothing;

drop policy if exists aff_mkt_read on storage.objects;
create policy aff_mkt_read on storage.objects
  for select using (bucket_id = 'affiliate-marketing');
drop policy if exists aff_mkt_write on storage.objects;
create policy aff_mkt_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'affiliate-marketing' and (public.is_admin() or public.is_super_admin()));
drop policy if exists aff_mkt_delete on storage.objects;
create policy aff_mkt_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'affiliate-marketing' and (public.is_admin() or public.is_super_admin()));

-- ── Admin : ajouter une ressource ──
create or replace function public.admin_add_marketing_asset(
  p_title text, p_category text, p_description text, p_file_url text,
  p_thumbnail_url text, p_format text, p_dimensions text, p_file_size bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.is_admin() or public.is_super_admin()) then
    return jsonb_build_object('success', false, 'error', 'NOT_ADMIN'); end if;
  if p_category not in ('logo','flyer','poster','banner','qr','story','facebook_cover',
                        'tiktok_video','facebook_video','instagram_video','media_pack') then
    return jsonb_build_object('success', false, 'error', 'INVALID_CATEGORY'); end if;
  if coalesce(trim(p_title),'') = '' or coalesce(trim(p_file_url),'') = '' then
    return jsonb_build_object('success', false, 'error', 'MISSING_FIELDS'); end if;

  insert into public.affiliate_marketing_assets(
    title, category, description, file_url, thumbnail_url, format, dimensions, file_size, created_by)
  values (trim(p_title), p_category, nullif(trim(p_description), ''), trim(p_file_url),
          nullif(trim(p_thumbnail_url), ''), nullif(trim(p_format), ''),
          nullif(trim(p_dimensions), ''), p_file_size, auth.uid())
  returning id into v_id;

  begin
    perform public._log_admin_action('affiliate_asset_add', null, v_id, null,
      jsonb_build_object('title', p_title, 'category', p_category), 'ajout ressource marketing', null);
  exception when undefined_function then null; end;
  return jsonb_build_object('success', true, 'id', v_id);
end; $$;
revoke execute on function public.admin_add_marketing_asset(text, text, text, text, text, text, text, bigint) from public;
grant execute on function public.admin_add_marketing_asset(text, text, text, text, text, text, text, bigint) to authenticated;

-- ── Admin : supprimer une ressource (soft-delete) ──
create or replace function public.admin_delete_marketing_asset(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_super_admin()) then
    return jsonb_build_object('success', false, 'error', 'NOT_ADMIN'); end if;
  update public.affiliate_marketing_assets set is_active = false where id = p_id;
  begin
    perform public._log_admin_action('affiliate_asset_delete', null, p_id, null, null, 'suppression ressource', null);
  exception when undefined_function then null; end;
  return jsonb_build_object('success', true);
end; $$;
revoke execute on function public.admin_delete_marketing_asset(uuid) from public;
grant execute on function public.admin_delete_marketing_asset(uuid) to authenticated;
