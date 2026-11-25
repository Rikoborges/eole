-- ============================================================================
-- ReproBench — Information sur les données (RGPD)
-- À la première connexion, chaque personne lit la notice « Vos données » et
-- coche « J'ai pris connaissance ». La base garde la date et la version lue :
-- preuve que l'information a été donnée. Si le texte change (nouvelle
-- version), la notice est présentée à nouveau.
-- Idempotent. À lancer après atelier-schema.sql.
-- ============================================================================

alter table collaborateurs add column if not exists info_vue_at timestamptz;
alter table collaborateurs add column if not exists info_vue_version text;

-- Chacun enregistre SA lecture (il n'a pas le droit de modifier sa fiche directement)
create or replace function ack_info_donnees(p_version text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non connecté.'; end if;
  update collaborateurs set info_vue_at = now(), info_vue_version = left(p_version, 20)
   where user_id = auth.uid();
end $$;
revoke all on function ack_info_donnees(text) from public, anon;
grant execute on function ack_info_donnees(text) to authenticated;

select 'information données installée' as resultat;
