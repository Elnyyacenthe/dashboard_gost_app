-- ============================================================
--  PlugBet Affiliation — Messagerie / Tickets (Phase 4)
-- ============================================================
--  Système de tickets (affilié <-> équipe PlugBet) : catégories, priorité,
--  fil chronologique, pièces jointes, notifications. Idempotent, additif.
--  Écritures via RPC SECURITY DEFINER (la RLS des messages est admin-only).
-- ============================================================

-- Bucket des pièces jointes (public en lecture ; écriture authentifiée).
insert into storage.buckets (id, name, public)
values ('affiliate-attachments', 'affiliate-attachments', true)
on conflict (id) do nothing;

drop policy if exists aff_attach_read on storage.objects;
create policy aff_attach_read on storage.objects
  for select using (bucket_id = 'affiliate-attachments');
drop policy if exists aff_attach_insert on storage.objects;
create policy aff_attach_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'affiliate-attachments');

-- ── Affilié : créer un ticket (ticket + 1er message) ──
create or replace function public.affiliate_create_ticket(
  p_category text, p_subject text, p_priority text, p_body text, p_attachments jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_aff public.affiliates; v_tid uuid;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); end if;
  select * into v_aff from public.affiliates where user_id = v_uid;
  if v_aff.id is null then return jsonb_build_object('success', false, 'error', 'NOT_AFFILIATE'); end if;
  if p_category not in ('new_code','payment','withdrawal','registration','complaint','question','other') then
    return jsonb_build_object('success', false, 'error', 'INVALID_CATEGORY'); end if;
  if coalesce(p_priority,'normal') not in ('low','normal','high','urgent') then
    return jsonb_build_object('success', false, 'error', 'INVALID_PRIORITY'); end if;
  if coalesce(trim(p_subject),'') = '' or coalesce(trim(p_body),'') = '' then
    return jsonb_build_object('success', false, 'error', 'EMPTY', 'message', 'Sujet et message requis.'); end if;

  insert into public.affiliate_tickets(affiliate_id, category, subject, priority, status, unread_admin, unread_affiliate)
  values (v_aff.id, p_category, trim(p_subject), coalesce(p_priority,'normal'), 'open', true, false)
  returning id into v_tid;

  insert into public.affiliate_ticket_messages(ticket_id, author_id, author_role, body, attachments)
  values (v_tid, v_uid, 'affiliate', trim(p_body), coalesce(p_attachments, '[]'::jsonb));

  return jsonb_build_object('success', true, 'ticket_id', v_tid);
end; $$;
revoke execute on function public.affiliate_create_ticket(text, text, text, text, jsonb) from public;
grant execute on function public.affiliate_create_ticket(text, text, text, text, jsonb) to authenticated;

-- ── Affilié : répondre à son ticket ──
create or replace function public.affiliate_reply_ticket(
  p_ticket_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_t public.affiliate_tickets;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); end if;
  select * into v_t from public.affiliate_tickets where id = p_ticket_id;
  if v_t.id is null or not public._is_affiliate_owner(v_t.affiliate_id) then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND'); end if;
  if coalesce(trim(p_body),'') = '' then return jsonb_build_object('success', false, 'error', 'EMPTY'); end if;

  insert into public.affiliate_ticket_messages(ticket_id, author_id, author_role, body, attachments)
  values (p_ticket_id, v_uid, 'affiliate', trim(p_body), coalesce(p_attachments, '[]'::jsonb));

  update public.affiliate_tickets
    set status = case when status = 'closed' then 'open' else status end,
        unread_admin = true, updated_at = now()
    where id = p_ticket_id;
  return jsonb_build_object('success', true);
end; $$;
revoke execute on function public.affiliate_reply_ticket(uuid, text, jsonb) from public;
grant execute on function public.affiliate_reply_ticket(uuid, text, jsonb) to authenticated;

-- ── Affilié : fermer / marquer lu ──
create or replace function public.affiliate_close_ticket(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.affiliate_tickets;
begin
  select * into v_t from public.affiliate_tickets where id = p_ticket_id;
  if v_t.id is null or not public._is_affiliate_owner(v_t.affiliate_id) then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND'); end if;
  update public.affiliate_tickets set status = 'closed', closed_at = now(), updated_at = now() where id = p_ticket_id;
  return jsonb_build_object('success', true);
end; $$;
revoke execute on function public.affiliate_close_ticket(uuid) from public;
grant execute on function public.affiliate_close_ticket(uuid) to authenticated;

create or replace function public.affiliate_mark_ticket_read(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.affiliate_tickets;
begin
  select * into v_t from public.affiliate_tickets where id = p_ticket_id;
  if v_t.id is null or not public._is_affiliate_owner(v_t.affiliate_id) then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND'); end if;
  update public.affiliate_tickets set unread_affiliate = false where id = p_ticket_id;
  return jsonb_build_object('success', true);
end; $$;
revoke execute on function public.affiliate_mark_ticket_read(uuid) from public;
grant execute on function public.affiliate_mark_ticket_read(uuid) to authenticated;

-- ── Admin : répondre / changer le statut / marquer lu ──
create or replace function public.admin_reply_ticket(
  p_ticket_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.affiliate_tickets;
begin
  if not (public.is_admin() or public.is_super_admin()) then return jsonb_build_object('success', false, 'error', 'NOT_ADMIN'); end if;
  select * into v_t from public.affiliate_tickets where id = p_ticket_id;
  if v_t.id is null then return jsonb_build_object('success', false, 'error', 'NOT_FOUND'); end if;
  if coalesce(trim(p_body),'') = '' then return jsonb_build_object('success', false, 'error', 'EMPTY'); end if;

  insert into public.affiliate_ticket_messages(ticket_id, author_id, author_role, body, attachments)
  values (p_ticket_id, auth.uid(), 'staff', trim(p_body), coalesce(p_attachments, '[]'::jsonb));

  update public.affiliate_tickets
    set status = 'answered', unread_affiliate = true, unread_admin = false, updated_at = now()
    where id = p_ticket_id;

  perform public._affiliate_notify(v_t.affiliate_id, 'ticket_reply',
    'Réponse à ton ticket', 'L''équipe PlugBet a répondu à « ' || v_t.subject || ' ».',
    jsonb_build_object('ticket_id', p_ticket_id));
  return jsonb_build_object('success', true);
end; $$;
revoke execute on function public.admin_reply_ticket(uuid, text, jsonb) from public;
grant execute on function public.admin_reply_ticket(uuid, text, jsonb) to authenticated;

create or replace function public.admin_set_ticket_status(p_ticket_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_super_admin()) then return jsonb_build_object('success', false, 'error', 'NOT_ADMIN'); end if;
  if p_status not in ('open','pending','answered','closed') then return jsonb_build_object('success', false, 'error', 'INVALID_STATUS'); end if;
  update public.affiliate_tickets
    set status = p_status, closed_at = case when p_status = 'closed' then now() else closed_at end, updated_at = now()
    where id = p_ticket_id;
  return jsonb_build_object('success', true);
end; $$;
revoke execute on function public.admin_set_ticket_status(uuid, text) from public;
grant execute on function public.admin_set_ticket_status(uuid, text) to authenticated;

create or replace function public.admin_mark_ticket_read(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_super_admin()) then return jsonb_build_object('success', false, 'error', 'NOT_ADMIN'); end if;
  update public.affiliate_tickets set unread_admin = false where id = p_ticket_id;
  return jsonb_build_object('success', true);
end; $$;
revoke execute on function public.admin_mark_ticket_read(uuid) from public;
grant execute on function public.admin_mark_ticket_read(uuid) to authenticated;

-- Vue admin : tickets + identité + compteurs.
create or replace view public.admin_affiliate_tickets_view as
select t.*, up.username, up.email,
  (select count(*) from public.affiliate_ticket_messages m where m.ticket_id = t.id) as message_count,
  (select max(created_at) from public.affiliate_ticket_messages m where m.ticket_id = t.id) as last_message_at
from public.affiliate_tickets t
join public.affiliates a on a.id = t.affiliate_id
join public.user_profiles up on up.id = a.user_id;
alter view public.admin_affiliate_tickets_view set (security_invoker = on);
grant select on public.admin_affiliate_tickets_view to authenticated;
