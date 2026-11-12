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
--   - un enregistrement sans temps (quantité seule) reçoit un temps estimé
--     = quantité × standard, signalé en commentaire ; sans standard il
--     n'est pas importé (compté dans le contrôle final)
--   - étape machine avec une quantité N → N opérations, temps réparti
--   - relancer ce fichier ajoute ce qui a été fait dans l'ancien Suivi
--     depuis le dernier import, sans doublon
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
  v_hp uuid; v_op uuid; v_note text; v_etape text; v_std numeric; v_n int; v_k int; v_h numeric; v_decl uuid;
  n_ok int := 0; n_est int := 0; n_skip_time int := 0; n_skip_other int := 0;
begin
  for j in
    select * from jobs
    where finished_at is not null and user_id is not null
      and not exists (select 1 from declarations d where d.import_job_id = jobs.id::text)
    order by started_at
  loop
    v_date := (j.started_at at time zone 'Europe/Paris')::date;
    v_hours := round(coalesce(nullif(j.active_seconds, 0), extract(epoch from (j.finished_at - j.started_at))) / 3600.0, 2);
    v_etape := nullif(trim(coalesce(j.etape, '')), '');
    v_note := nullif(trim(concat_ws(' · ', nullif(trim(concat_ws(' ', j.brand, j.model)), ''), nullif(trim(j.note), ''))), '');
    select coalesce(metier_id, 'TECH') into v_metier from collaborateurs where user_id = j.user_id;
    v_act := null; v_hp := null; v_op := null; v_std := null;

    if v_etape is null then
      select id into v_hp from hors_production where label = 'Autre';
    elsif v_etape in ('Réunion', 'Formation', 'Congés', '5S') then
      select id into v_hp from hors_production where label = v_etape;
    else
      if v_etape = 'Déballage' then v_etape := 'Déballage pour MAT NEUF'; end if;
      select * into v_act from activites where name = v_etape order by (metier_id = v_metier) desc, (metier_id = 'TECH') desc limit 1;
    end if;
    if v_act.id is null and v_hp is null then n_skip_other := n_skip_other + 1; continue; end if;

    -- Enregistrement rapide « quantité seule » (pas de temps) : temps estimé = quantité × standard
    if (v_hours is null or v_hours < 0.01) and v_act.id is not null and coalesce(j.quantite, 0) > 0 then
      select hours_per_unit into v_std from standards
      where activite_id = v_act.id and valid_from <= v_date and hours_per_unit > 0
      order by valid_from desc limit 1;
      if v_std is not null then
        v_hours := round(j.quantite * v_std, 2);
        v_note := concat_ws(' · ', v_note, 'temps estimé (quantité × standard)');
        n_est := n_est + 1;
      end if;
    end if;
    if v_hours is null or v_hours < 0.01 then n_skip_time := n_skip_time + 1; continue; end if;
    v_hours := least(v_hours, 12);

    if v_act.id is not null and v_act.requires_machine then
      -- 1 machine = 1 opération : une quantité de N machines devient N opérations, temps réparti
      v_n := greatest(coalesce(j.quantite, 1), 1);
      for v_k in 1..v_n loop
        v_h := greatest(round(v_hours / v_n, 2), 0.01);
        insert into operations (user_id, activite_id, serial, model_id, status, started_on, finished_on, imported)
        values (j.user_id, v_act.id, null,
                (select id from printer_models pm where lower(pm.model) = lower(trim(j.model)) limit 1),
                'final', v_date, v_date, true)
        returning id into v_op;
        insert into declarations (user_id, work_date, activite_id, operation_id, quantity, hours, note, import_job_id, created_at)
        values (j.user_id, v_date, v_act.id, v_op, 0, v_h, v_note,
                case when v_k = 1 then j.id::text else j.id::text || '#' || v_k end, j.finished_at)
        returning id into v_decl;
        update operations set final_declaration_id = v_decl where id = v_op;
      end loop;
    else
      insert into declarations (user_id, work_date, activite_id, hors_production_id, quantity, hours, note, import_job_id, created_at)
      values (j.user_id, v_date, v_act.id, v_hp,
              case when v_act.id is not null then greatest(coalesce(j.quantite, 1), 1) else 0 end,
              v_hours, v_note, j.id::text, j.finished_at);
    end if;
    n_ok := n_ok + 1;
  end loop;
  raise notice 'Import terminé : % services importés (dont % au temps estimé), % sans temps ni standard, % avec une étape inconnue.', n_ok, n_est, n_skip_time, n_skip_other;
end $$;

-- Contrôle : pour chaque personne, ce qui reste dans l'ancien Suivi et pourquoi
select coalesce(c.display_name, u.email) as collaborateur,
       count(*) as services_anciens,
       count(*) filter (where exists (select 1 from declarations d where d.import_job_id = j.id::text)) as importes,
       count(*) filter (where j.finished_at is null) as encore_en_cours_dans_l_ancien,
       count(*) filter (where j.finished_at is not null and not exists (select 1 from declarations d where d.import_job_id = j.id::text)) as non_importables
from jobs j
join auth.users u on u.id = j.user_id
left join collaborateurs c on c.user_id = j.user_id
group by 1 order by 1;

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
