-- ============================================================================
-- ReproBench — Une semaine pour corriger
-- Nouvelle règle « 7 jours » : le collaborateur peut ajouter, corriger ou
-- annuler ses déclarations des 7 derniers jours (le lundi, il corrige encore
-- la semaine écoulée). Une semaine validée par le responsable reste
-- verrouillée (supabase/validation-semaine.sql).
-- Cette mise à jour active la règle ; le responsable peut la changer ensuite
-- dans Admin › Paramètres › Règles de saisie.
-- Idempotent. À lancer après supabase/atelier-schema.sql.
-- ============================================================================

create or replace function correction_floor()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce((select value #>> '{}' from regles_saisie where key = 'correction'), 'day')
           when 'h24'   then atelier_today() - 1
           when 'week'  then date_trunc('week', atelier_today())::date
           when 'days7' then atelier_today() - 6
           when 'none'  then atelier_today() + 1
           else atelier_today()
         end;
$$;

update regles_saisie set value = '"days7"' where key = 'correction';
insert into regles_saisie (key, value) select 'correction', '"days7"'
where not exists (select 1 from regles_saisie where key = 'correction');

select 'correction sur 7 jours activée' as resultat;
