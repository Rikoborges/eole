-- ============================================================================
-- ReproBench — Import de l'historique de l'ancien Suivi (table jobs) dans
-- l'outil de déclaration (tables declarations / operations)
--
-- • Ne supprime ni ne modifie RIEN dans jobs : c'est une copie.
-- • Idempotent : relancé, il n'importe que ce qui ne l'a pas encore été
--   (chaque déclaration importée garde l'identifiant du job d'origine).
-- • À lancer APRÈS supabase/atelier-schema.sql.
--
-- Règles de conversion :
--   - seuls les services TERMINÉS sont importés ; jour = jour de début
--     (heure de Paris) ; temps = temps actif du chrono
--     (sinon fin − début), arrondi au centième, plafonné à 12 h
--   - étape = activité du même nom dans le métier du collaborateur
--     (Technicien par défaut si la fiche n'a pas encore de métier)
--   - Réunion, Formation, Congés, 5S → hors production du même nom
--   - Déballage → « Déballage pour MAT NEUF » (Aide technique)
--   - Installation / Mise en route d'imprimante neuve → activités créées si
--     besoin (sans standard, le responsable peut les désactiver)
--   - service sans étape → hors production « Autre » avec marque et modèle
--     en commentaire
--   - étapes avec matricule → opération FINALISÉE marquée « importée »
--     (l'ancien Suivi n'avait pas de N° de série : pas d'alerte pour elles)
--   - un enregistrement sans temps (quantité seule) ne peut pas être
--     importé : il est compté dans le rapport final
-- ============================================================================

alter table declarations add column if not exists import_job_id text;
create unique index if not exists declarations_import_job_key on declarations (import_job_id) where import_job_id is not null;
alter table operations add column if not exists imported boolean not null default false;
-- la vue doit être recréée pour inclure la nouvelle colonne
drop view if exists operations_avec_temps;
create view operations_avec_temps
with (security_invoker = true) as
select o.*,
       coalesce(sum(d.hours) filter (where not d.cancelled), 0)::numeric(6,2) as total_hours,
       max(d.work_date) filter (where not d.cancelled) as last_work_date
from operations o
left join declarations d on d.operation_id = o.id
group by o.id;
grant select on operations_avec_temps to authenticated;

-- Les standards de départ valent aussi pour l'historique d'avant 2026
update standards s set valid_from = date '2000-01-01'
where s.valid_from = date '2026-01-01' and s.created_by is null
  and not exists (select 1 from standards x where x.activite_id = s.activite_id and x.valid_from = date '2000-01-01');

-- Activités de l'ancien Suivi qui n'existent pas encore
insert into activites (metier_id, name, requires_machine, sort) values
  ('TECH', 'Installation imprimante neuve', false, 20),
  ('TECH', 'Mise en route imprimante neuve', false, 21)
on conflict (metier_id, name) do nothing;

-- Fiches manquantes (comptes qui n'ont jamais ouvert la nouvelle version)
insert into collaborateurs (user_id, display_name)
select distinct j.user_id, coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1))
from jobs j join auth.users u on u.id = j.user_id
on conflict (user_id) do nothing;

do $$
declare
  j record; v_date date; v_hours numeric; v_metier text; v_act activites%rowtype;
  v_hp uuid; v_op uuid; v_note text; v_etape text;
  n_ok int := 0; n_skip_time int := 0; n_skip_other int := 0;
begin
  for j in
    select * from jobs
    where finished_at is not null and user_id is not null
      and not exists (select 1 from declarations d where d.import_job_id = jobs.id::text)
    order by started_at
  loop
    v_date := (j.started_at at time zone 'Europe/Paris')::date;
    v_hours := round(coalesce(nullif(j.active_seconds, 0), extract(epoch from (j.finished_at - j.started_at))) / 3600.0, 2);
    if v_hours is null or v_hours < 0.01 then n_skip_time := n_skip_time + 1; continue; end if;
    v_hours := least(v_hours, 12);
    v_etape := nullif(trim(coalesce(j.etape, '')), '');
    v_note := nullif(trim(concat_ws(' · ', nullif(trim(concat_ws(' ', j.brand, j.model)), ''), nullif(trim(j.note), ''))), '');
    select coalesce(metier_id, 'TECH') into v_metier from collaborateurs where user_id = j.user_id;
    v_act := null; v_hp := null; v_op := null;

    if v_etape is null then
      select id into v_hp from hors_production where label = 'Autre';
    elsif v_etape in ('Réunion', 'Formation', 'Congés', '5S') then
      select id into v_hp from hors_production where label = v_etape;
    else
      if v_etape = 'Déballage' then v_etape := 'Déballage pour MAT NEUF'; end if;
      select * into v_act from activites where name = v_etape order by (metier_id = v_metier) desc, (metier_id = 'TECH') desc limit 1;
    end if;

    if v_act.id is null and v_hp is null then n_skip_other := n_skip_other + 1; continue; end if;

    if v_act.id is not null and v_act.requires_machine then
      insert into operations (user_id, activite_id, serial, model_id, status, started_on, finished_on, imported)
      values (j.user_id, v_act.id, null,
              (select id from printer_models pm where lower(pm.model) = lower(trim(j.model)) limit 1),
              'final', v_date, v_date, true)
      returning id into v_op;
    end if;

    insert into declarations (user_id, work_date, activite_id, hors_production_id, operation_id, quantity, hours, note, import_job_id, created_at)
    values (j.user_id, v_date, v_act.id, v_hp, v_op,
            case when v_act.id is not null and not v_act.requires_machine then greatest(coalesce(j.quantite, 1), 1) else 0 end,
            v_hours, v_note, j.id::text, j.finished_at);

    if v_op is not null then
      update operations set final_declaration_id = (select id from declarations where import_job_id = j.id::text) where id = v_op;
    end if;
    n_ok := n_ok + 1;
  end loop;
  raise notice 'Import terminé : % services importés, % sans temps (non importables), % avec une étape inconnue.', n_ok, n_skip_time, n_skip_other;
end $$;

-- Rapport : ce qui a été importé, par personne
select coalesce(c.display_name, u.email) as collaborateur,
       count(*) as declarations_importees,
       round(sum(d.hours), 2) as heures,
       min(d.work_date) as du, max(d.work_date) as au
from declarations d
join auth.users u on u.id = d.user_id
left join collaborateurs c on c.user_id = d.user_id
where d.import_job_id is not null
group by 1 order by 1;
