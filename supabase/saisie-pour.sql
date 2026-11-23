-- ============================================================================
-- ReproBench — « Déclarer pour… » : le responsable saisit à la place d'un
-- collaborateur qui n'a ni ordinateur ni téléphone (fiche papier).
--  • Le responsable peut créer des déclarations et des étapes machine au nom
--    d'un collaborateur (jusqu'à aujourd'hui, jamais dans le futur).
--  • Chaque ligne garde qui l'a saisie (colonne saisi_par, remplie par la
--    base, impossible à falsifier) : l'appli affiche « saisie par … ».
-- Idempotent. À lancer après atelier-schema.sql.
-- ============================================================================

alter table declarations add column if not exists saisi_par uuid references auth.users(id);

-- saisi_par = la personne connectée, toujours (même si l'appli envoie autre chose)
create or replace function declarations_saisi_par()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.saisi_par := auth.uid();
  else new.saisi_par := old.saisi_par; end if;
  return new;
end $$;
drop trigger if exists declarations_saisi_par on declarations;
create trigger declarations_saisi_par before insert or update on declarations
  for each row execute function declarations_saisi_par();

-- Le responsable peut créer pour un autre (les policies « own » restent inchangées)
drop policy if exists declarations_insert_resp on declarations;
create policy declarations_insert_resp on declarations
  for insert with check (is_responsable() and not cancelled and work_date <= atelier_today());
drop policy if exists operations_insert_resp on operations;
create policy operations_insert_resp on operations
  for insert with check (is_responsable() and status in ('encours', 'pause', 'final'));

-- Étape avec matricule au nom d'un collaborateur (même logique que declare_machine_step)
create or replace function declare_machine_step_for(
  p_user uuid, p_activite uuid, p_operation uuid, p_serial text, p_model uuid,
  p_hours numeric, p_note text, p_finalize boolean)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare v_op uuid := p_operation; v_decl uuid;
begin
  if not is_responsable() then raise exception 'Réservé au responsable.'; end if;
  if v_op is null then
    insert into operations (user_id, activite_id, serial, model_id, status)
    values (p_user, p_activite, nullif(upper(trim(p_serial)), ''), p_model, 'pause')
    returning id into v_op;
  elsif not exists (select 1 from operations where id = v_op and user_id = p_user) then
    raise exception 'Cette étape appartient à un autre collaborateur.';
  end if;
  insert into declarations (user_id, activite_id, operation_id, hours, note)
  values (p_user, p_activite, v_op, p_hours, nullif(trim(p_note), ''))
  returning id into v_decl;
  update operations
     set status = case when p_finalize then 'final' else 'pause' end,
         final_declaration_id = case when p_finalize then v_decl else null end
   where id = v_op;
  if not found then raise exception 'Opération introuvable ou déjà clôturée.'; end if;
  return v_decl;
end $$;
revoke all on function declare_machine_step_for(uuid, uuid, uuid, text, uuid, numeric, text, boolean) from public, anon;
grant execute on function declare_machine_step_for(uuid, uuid, uuid, text, uuid, numeric, text, boolean) to authenticated;

select '« Déclarer pour… » installé' as resultat;
