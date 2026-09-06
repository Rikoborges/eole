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

-- Reprise des modèles déjà connus dans l'app (sans doublon grâce à la contrainte unique)
insert into printer_models (brand, model) values
  ('Canon','iR-ADV C256i'), ('Canon','iR-ADV C257i'), ('Canon','iR-ADV C259i'),
  ('Canon','iR-ADV C3525i'), ('Canon','iR-ADV C3530i'), ('Canon','iR-ADV C5535i'),
  ('Canon','iR-ADV C5540i'), ('Canon','iR2625i'), ('Canon','iR2630i'),
  ('Canon','iR2635i'), ('Canon','iR2645i'), ('Canon','iR-ADV DX C3826i'),
  ('Canon','iR-ADV DX C3830i'), ('Canon','iR-ADV DX C5850i'),
  ('Toshiba','e-STUDIO2523A'), ('Toshiba','e-STUDIO2528A'), ('Toshiba','e-STUDIO3528A'),
  ('Toshiba','e-STUDIO5528A'), ('Toshiba','e-STUDIO2515AC'), ('Toshiba','e-STUDIO2518A'),
  ('Toshiba','e-STUDIO3018A'), ('Toshiba','e-STUDIO2020AC'), ('Toshiba','e-STUDIO4525AC'),
  ('Kyocera','TASKalfa 2553ci'), ('Kyocera','TASKalfa 2554ci'), ('Kyocera','TASKalfa 3212i'),
  ('Kyocera','TASKalfa 3253ci'), ('Kyocera','TASKalfa 3552ci'), ('Kyocera','TASKalfa 4053ci'),
  ('Kyocera','TASKalfa 5053ci'),
  ('Konica Minolta','bizhub 227'), ('Konica Minolta','bizhub 287'), ('Konica Minolta','bizhub 367'),
  ('Konica Minolta','bizhub C258'), ('Konica Minolta','bizhub C308'), ('Konica Minolta','bizhub C368'),
  ('Konica Minolta','bizhub C458'), ('Konica Minolta','bizhub C558'), ('Konica Minolta','bizhub C658'),
  ('Sharp','MX-2614N'), ('Sharp','MX-2651'), ('Sharp','MX-3051'),
  ('Sharp','MX-3114N'), ('Sharp','MX-3551'), ('Sharp','MX-4051'), ('Sharp','MX-M3550'),
  ('Ricoh','MP C3003'), ('Ricoh','MP C3503'), ('Ricoh','MP C4503'), ('Ricoh','MP C5503'),
  ('Ricoh','IM 350F'), ('Ricoh','IM C3000'), ('Ricoh','IM C3500'), ('Ricoh','IM C4500')
on conflict (brand, model) do nothing;

-- Vérification
select brand, count(*) as nb_modeles from printer_models group by brand order by brand;
