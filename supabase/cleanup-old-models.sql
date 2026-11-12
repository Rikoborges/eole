-- ============================================================================
-- ReproBench — Retirer l'ancienne liste de modèles (avant la base de l'atelier)
--
-- Garde : les modèles de la base officielle (avec code famille CA0…) et tout
-- modèle ajouté à partir du 05/11/2026 (par exemple dans Paramètres).
-- Retire : les anciens modèles sans code famille, créés avant cette date.
-- Un ancien modèle déjà utilisé sur une machine (opérations) est conservé,
-- pour ne pas casser l'historique ; la liste en fin de script les montre.
--
-- Étape 1 (facultative) : lancer seulement le SELECT ci-dessous pour voir
-- ce qui sera retiré. Étape 2 : lancer tout le fichier.
-- ============================================================================

-- Aperçu de ce qui va être retiré
select brand, model, created_at
from printer_models pm
where pm.famille is null
  and pm.created_at < timestamptz '2026-11-05 00:00:00+01'
  and not exists (select 1 from operations o where o.model_id = pm.id)
order by brand, model;

delete from printer_models pm
where pm.famille is null
  and pm.created_at < timestamptz '2026-11-05 00:00:00+01'
  and not exists (select 1 from operations o where o.model_id = pm.id);

-- Anciens modèles gardés parce qu'une machine les utilise déjà (normalement aucun)
select pm.brand, pm.model, count(o.id) as machines
from printer_models pm join operations o on o.model_id = pm.id
where pm.famille is null and pm.created_at < timestamptz '2026-11-05 00:00:00+01'
group by pm.brand, pm.model;

-- Résultat : nombre de modèles par marque
select brand, count(*) as modeles from printer_models group by brand order by brand;
