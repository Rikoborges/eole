-- ============================================================================
-- ReproBench — Fiche de la semaine : signature du collaborateur, validation
-- du responsable, semaine verrouillée ensuite.
--
--  • Le collaborateur « signe » sa semaine (il confirme ses déclarations).
--  • Le responsable « valide » : la semaine est verrouillée, plus aucune
--    déclaration ne peut y être ajoutée, modifiée ou annulée par le
--    collaborateur. Seul le responsable peut corriger ou rouvrir la semaine.
--
-- Idempotent. À lancer après supabase/atelier-schema.sql.
-- ============================================================================

create table if not exists validations_semaine (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_monday date not null check (extract(isodow from week_monday) = 1),
  signed_at timestamptz,
  validated_at timestamptz,
  validated_by uuid references auth.users(id),
  primary key (user_id, week_monday)
);
alter table validations_semaine enable row level security;

drop policy if exists validations_read on validations_semaine;
create policy validations_read on validations_semaine
  for select to authenticated
  using (user_id = auth.uid() or is_responsable());
-- Pas de policy d'écriture : tout passe par les fonctions ci-dessous.
grant select on validations_semaine to authenticated;

-- Le collaborateur signe sa semaine
create or replace function sign_week(p_monday date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non connecté.'; end if;
  if extract(isodow from p_monday) <> 1 then raise exception 'Date de début de semaine invalide.'; end if;
  insert into validations_semaine (user_id, week_monday, signed_at) values (auth.uid(), p_monday, now())
  on conflict (user_id, week_monday) do update set signed_at = now()
    where validations_semaine.validated_at is null;
end $$;

-- Le responsable valide (et verrouille) une semaine
create or replace function validate_week(p_user uuid, p_monday date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_responsable() then raise exception 'Réservé au responsable.'; end if;
  if extract(isodow from p_monday) <> 1 then raise exception 'Date de début de semaine invalide.'; end if;
  insert into validations_semaine (user_id, week_monday, validated_at, validated_by) values (p_user, p_monday, now(), auth.uid())
  on conflict (user_id, week_monday) do update set validated_at = now(), validated_by = auth.uid();
end $$;

-- Le responsable rouvre une semaine validée
create or replace function unvalidate_week(p_user uuid, p_monday date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_responsable() then raise exception 'Réservé au responsable.'; end if;
  update validations_semaine set validated_at = null, validated_by = null where user_id = p_user and week_monday = p_monday;
end $$;

revoke all on function sign_week(date) from public, anon;
revoke all on function validate_week(uuid, date) from public, anon;
revoke all on function unvalidate_week(uuid, date) from public, anon;
grant execute on function sign_week(date) to authenticated;
grant execute on function validate_week(uuid, date) to authenticated;
grant execute on function unvalidate_week(uuid, date) to authenticated;

-- Verrou : une semaine validée ne bouge plus (sauf par le responsable)
create or replace function lock_validated_week()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_day date;
begin
  if is_responsable() then return coalesce(new, old); end if;
  foreach v_day in array array[case when tg_op <> 'INSERT' then old.work_date end, case when tg_op <> 'DELETE' then new.work_date end] loop
    continue when v_day is null;
    v_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    if exists (select 1 from validations_semaine v
               where v.user_id = v_user and v.week_monday = date_trunc('week', v_day)::date and v.validated_at is not null) then
      raise exception 'Semaine validée par le responsable : demandez-lui de la rouvrir pour la modifier.';
    end if;
  end loop;
  return coalesce(new, old);
end $$;

drop trigger if exists declarations_lock_validated on declarations;
create trigger declarations_lock_validated
  before insert or update or delete on declarations
  for each row execute function lock_validated_week();

select 'validation de semaine installée' as resultat;
