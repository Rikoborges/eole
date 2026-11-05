-- ============================================================================
-- ReproBench — table printer_models
--
-- Remplace le catalogue de modèles autrefois figé dans script.js
-- (MODELS_BY_BRAND) : maintenant en base, gérable depuis l'onglet Admin
-- sans toucher au code. Dépend de la fonction is_admin() déjà créée par
-- supabase/setup-complete.sql — lancez ce script-là en premier.
--
-- Idempotent : peut être relancé sans dupliquer les données.
-- ============================================================================

create table if not exists printer_models (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (brand, model)
);

alter table printer_models enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'printer_models'
  loop
    execute format('drop policy %I on public.printer_models', pol.policyname);
  end loop;
end $$;

-- Tout compte connecté peut lire (nécessaire pour l'autocomplétion du champ Modèle)
create policy "printer_models_select_authenticated" on printer_models
  for select using (auth.uid() is not null);

-- Seuls les comptes admin (is_admin()) peuvent ajouter/modifier/supprimer
create policy "printer_models_insert_admin" on printer_models
  for insert with check (is_admin());

create policy "printer_models_update_admin" on printer_models
  for update using (is_admin());

create policy "printer_models_delete_admin" on printer_models
  for delete using (is_admin());

-- (L'ancienne liste de modèles de départ a été retirée le 05/11/2026 : la base
-- officielle de l'atelier est chargée par supabase/machine-models.sql. Relancer
-- ce fichier ne remet donc plus les anciens modèles.)

-- Vérification
select brand, count(*) as nb_modeles from printer_models group by brand order by brand;
