-- ============================================================================
-- ReproBench — Suppression définitive d'un collaborateur (« tout effacer »)
--
-- Utilisée par api/delete-collaborator.js quand le responsable choisit
-- « Tout effacer » : le compte ET tout ce que la personne a fait
-- (déclarations, étapes machine, ancien Suivi, fiches signées, chronos,
-- historique) sont supprimés. Irréversible.
-- L'autre choix, « Supprimer l'accès », garde l'historique (inchangé).
--
-- La fonction n'est appelable que par le serveur (clé service_role).
-- Idempotent. À lancer après les autres fichiers supabase/*.sql.
-- ============================================================================

-- Le verrou des semaines validées laisse passer la suppression complète
create or replace function lock_validated_week()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_day date;
begin
  if coalesce(current_setting('reprobench.purge', true), '') = 'on' or is_responsable() then return coalesce(new, old); end if;
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

create or replace function purge_collaborateur(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_decl int := 0; n_ops int := 0; n_jobs int := 0;
begin
  perform set_config('reprobench.purge', 'on', true);  -- seulement pour cette transaction

  -- liens depuis les lignes des autres (si la personne avait clôturé / annulé / validé)
  update operations set closed_by = null where closed_by = p_user and user_id <> p_user;
  update declarations set cancelled_by = null where cancelled_by = p_user and user_id <> p_user;
  if to_regclass('public.validations_semaine') is not null then
    execute 'update validations_semaine set validated_by = null where validated_by = $1 and user_id <> $1' using p_user;
    execute 'delete from validations_semaine where user_id = $1' using p_user;
  end if;

  update operations set final_declaration_id = null where user_id = p_user;
  delete from declarations where user_id = p_user;  get diagnostics n_decl = row_count;
  delete from operations   where user_id = p_user;  get diagnostics n_ops  = row_count;

  if to_regclass('public.jobs') is not null then       -- ancien Suivi
    if to_regclass('public.job_pauses') is not null then
      execute 'delete from job_pauses where job_id in (select id from jobs where user_id = $1)' using p_user;
    end if;
    execute 'delete from jobs where user_id = $1' using p_user;
    get diagnostics n_jobs = row_count;
  end if;
  if to_regclass('public.journal') is not null then execute 'delete from journal where user_id = $1' using p_user; end if;
  if to_regclass('public.chronos_user') is not null then execute 'delete from chronos_user where user_id = $1' using p_user; end if;
  if to_regclass('public.presence') is not null then execute 'delete from presence where user_id = $1' using p_user; end if;
  delete from collaborateurs where user_id = p_user;

  return jsonb_build_object('declarations', n_decl, 'operations', n_ops, 'suivi', n_jobs);
end $$;

revoke all on function purge_collaborateur(uuid) from public, anon, authenticated;
grant execute on function purge_collaborateur(uuid) to service_role;

select 'suppression complète installée' as resultat;
