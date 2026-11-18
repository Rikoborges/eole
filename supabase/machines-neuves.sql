-- ============================================================================
-- ReproBench — Machines neuves : Installation et Mise en route
-- Crée (ou remet) les deux activités dans le métier Technicien, avec
-- matricule + modèle comme le nettoyage, et la checklist d'installation.
-- Idempotent : peut être relancé sans risque.
-- ============================================================================

insert into activites (metier_id, name, requires_machine, sort, active)
values ('TECH', 'Installation imprimante neuve', true, 20, true),
       ('TECH', 'Mise en route imprimante neuve', true, 21, true)
on conflict (metier_id, name) do update
  set requires_machine = true, active = true;

update activites set checklist = 'installation'
where metier_id = 'TECH' and name in ('Installation imprimante neuve', 'Mise en route imprimante neuve');

-- Vérification 1 : les deux activités
select name, metier_id, requires_machine as matricule, checklist, active
from activites where name in ('Installation imprimante neuve', 'Mise en route imprimante neuve');

-- Vérification 2 : le métier de chaque personne (seuls les « TECH » voient ces boutons)
select display_name as collaborateur, coalesce(metier_id, '— à choisir —') as metier, active
from collaborateurs order by display_name;
