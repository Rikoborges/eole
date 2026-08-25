-- ============================================================
-- ReproBench — Admin voit tout, chaque technicien ne voit que le sien
--
-- Comment l'utiliser :
--   1. Ouvrez le projet sur https://supabase.com/dashboard
--   2. Menu "SQL Editor" → "New query"
--   3. Collez tout ce fichier et cliquez "Run"
--   4. Faites la vérification tout en bas du fichier
--
-- La liste d'e-mails admin ci-dessous DOIT être la même que ADMIN_EMAILS
-- au début de script.js — sinon l'onglet Admin dans l'app ne correspondra
-- plus à qui peut vraiment tout voir dans la base.
-- ============================================================

create or replace function is_admin()
returns boolean
language sql
stable
as $$
  select (auth.jwt() ->> 'email') = any (array['rico3036@gmail.com']);
$$;

-- ------------------------------------------------------------
-- Table jobs
-- ------------------------------------------------------------
alter table jobs enable row level security;

-- Retire les anciennes règles permissives si elles existent (noms les plus
-- courants créés automatiquement par Supabase). Si votre règle actuelle a un
-- autre nom, effacez-la manuellement dans Authentication → Policies avant
-- de continuer, sinon elle restera active en plus de la nouvelle.
drop policy if exists "Enable read access for all users" on jobs;
drop policy if exists "jobs_select_all" on jobs;

drop policy if exists "jobs_select_own_or_admin" on jobs;
create policy "jobs_select_own_or_admin" on jobs
  for select
  using (user_id = auth.uid() or is_admin());

drop policy if exists "jobs_insert_own" on jobs;
create policy "jobs_insert_own" on jobs
  for insert
  with check (user_id = auth.uid());

drop policy if exists "jobs_update_own_or_admin" on jobs;
create policy "jobs_update_own_or_admin" on jobs
  for update
  using (user_id = auth.uid() or is_admin());

drop policy if exists "jobs_delete_own_or_admin" on jobs;
create policy "jobs_delete_own_or_admin" on jobs
  for delete
  using (user_id = auth.uid() or is_admin());

-- ------------------------------------------------------------
-- Table job_pauses (n'a pas de user_id — on remonte jusqu'à jobs)
-- ------------------------------------------------------------
alter table job_pauses enable row level security;

drop policy if exists "Enable read access for all users" on job_pauses;

drop policy if exists "job_pauses_select_own_or_admin" on job_pauses;
create policy "job_pauses_select_own_or_admin" on job_pauses
  for select
  using (
    exists (
      select 1 from jobs j
      where j.id = job_pauses.job_id
        and (j.user_id = auth.uid() or is_admin())
    )
  );

drop policy if exists "job_pauses_insert_own" on job_pauses;
create policy "job_pauses_insert_own" on job_pauses
  for insert
  with check (
    exists (
      select 1 from jobs j
      where j.id = job_pauses.job_id and j.user_id = auth.uid()
    )
  );

drop policy if exists "job_pauses_update_own" on job_pauses;
create policy "job_pauses_update_own" on job_pauses
  for update
  using (
    exists (
      select 1 from jobs j
      where j.id = job_pauses.job_id and j.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- Storage : bucket "job-photos" (chemin = "<user_id>/<job>.jpg")
-- Sans ceci, l'admin ne peut pas générer le lien temporaire des
-- photos des autres techniciens (chaque photo est dans le
-- dossier de son propriétaire).
-- ------------------------------------------------------------
drop policy if exists "job_photos_read_own" on storage.objects;

drop policy if exists "job_photos_read_own_or_admin" on storage.objects;
create policy "job_photos_read_own_or_admin" on storage.objects
  for select
  using (
    bucket_id = 'job-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or is_admin()
    )
  );

-- ============================================================
-- VÉRIFICATION — collez ceci séparément après avoir lancé le script
-- ci-dessus, pour confirmer qu'aucune règle permissive n'est restée :
--
--   select tablename, policyname, cmd, qual
--   from pg_policies
--   where tablename in ('jobs', 'job_pauses')
--      or (tablename = 'objects' and qual ilike '%job-photos%');
--
-- Chaque ligne "select" doit contenir "auth.uid()" ou "is_admin()" dans sa
-- condition. Si une règle plus ancienne apparaît avec juste "true", c'est
-- elle qui laisse tout le monde tout voir — effacez-la dans
-- Authentication → Policies.
-- ============================================================
