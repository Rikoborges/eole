-- ============================================================================
-- ReproBench — Journal des modifications (traçabilité)
-- Chaque correction ou annulation d'une déclaration, et chaque changement
-- important d'une opération machine (matricule, modèle, abandon, annulation),
-- est enregistré automatiquement : qui, quand, avant → après.
-- Personne ne peut modifier ni effacer le journal (aucune policy d'écriture).
-- Idempotent. À lancer après supabase/atelier-schema.sql.
-- ============================================================================

create table if not exists journal (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,                         -- qui a fait la modification
  user_id uuid,                       -- à qui appartient la ligne modifiée
  table_name text not null,           -- 'declarations' ou 'operations'
  row_id uuid not null,
  action text not null,               -- 'modification', 'annulation', 'suppression'
  before jsonb,
  after jsonb
);
create index if not exists journal_user_at on journal (user_id, at desc);
create index if not exists journal_row on journal (row_id);
alter table journal enable row level security;

drop policy if exists journal_read on journal;
create policy journal_read on journal
  for select to authenticated
  using (user_id = auth.uid() or is_responsable());
grant select on journal to authenticated;

create or replace function journal_declarations()
returns trigger language plpgsql security definer set search_path = public as $$
declare b jsonb; a jsonb;
begin
  if tg_op = 'DELETE' then
    insert into journal (actor, user_id, table_name, row_id, action, before)
    values (auth.uid(), old.user_id, 'declarations', old.id, 'suppression', to_jsonb(old));
    return old;
  end if;
  b := jsonb_build_object('work_date', old.work_date, 'activite_id', old.activite_id, 'hors_production_id', old.hors_production_id,
         'quantity', old.quantity, 'hours', old.hours, 'note', old.note, 'cancelled', old.cancelled, 'checklist', old.checklist);
  a := jsonb_build_object('work_date', new.work_date, 'activite_id', new.activite_id, 'hors_production_id', new.hors_production_id,
         'quantity', new.quantity, 'hours', new.hours, 'note', new.note, 'cancelled', new.cancelled, 'checklist', new.checklist);
  if a is distinct from b then
    insert into journal (actor, user_id, table_name, row_id, action, before, after)
    values (auth.uid(), new.user_id, 'declarations', new.id,
            case when new.cancelled and not old.cancelled then 'annulation' else 'modification' end, b, a);
  end if;
  return new;
end $$;

create or replace function journal_operations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Le passage normal « à poursuivre → finalisée » n'est pas une correction : on ne garde que l'important
  if old.serial is distinct from new.serial or old.model_id is distinct from new.model_id
     or (old.status is distinct from new.status and (new.status in ('abandon', 'annulee') or old.status in ('abandon', 'annulee', 'final'))) then
    insert into journal (actor, user_id, table_name, row_id, action, before, after)
    values (auth.uid(), new.user_id, 'operations', new.id,
            case when new.status = 'annulee' and old.status <> 'annulee' then 'annulation' else 'modification' end,
            jsonb_build_object('serial', old.serial, 'model_id', old.model_id, 'status', old.status, 'activite_id', old.activite_id),
            jsonb_build_object('serial', new.serial, 'model_id', new.model_id, 'status', new.status, 'activite_id', new.activite_id,
                               'motif_id', new.motif_id, 'close_comment', new.close_comment));
  end if;
  return new;
end $$;

drop trigger if exists declarations_journal on declarations;
create trigger declarations_journal after update or delete on declarations
  for each row execute function journal_declarations();
drop trigger if exists operations_journal on operations;
create trigger operations_journal after update on operations
  for each row execute function journal_operations();

select 'journal installé' as resultat;
