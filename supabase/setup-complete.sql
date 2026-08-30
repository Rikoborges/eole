-- ============================================================================
-- ReproBench — SCRIPT COMPLET (colonnes + sécurité)
--
-- COMMENT UTILISER :
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Collez TOUT ce fichier
--   3. ⚠️ MODIFIEZ LA LIGNE DE L'E-MAIL ADMIN juste en dessous
--   4. Cliquez "Run"
--
-- Ce script peut être relancé autant de fois que nécessaire, sans casser
-- l'existant (colonnes en IF NOT EXISTS, policies recréées à l'identique).
-- ============================================================================


-- ############################################################################
-- ##  1. E-MAIL(S) ADMIN  —  LA SEULE LIGNE À MODIFIER
-- ############################################################################
-- Mettez ici le(s) e-mail(s) qui doivent tout voir. Pour en ajouter plusieurs :
--   array['premier@exemple.com', 'deuxieme@exemple.com']
--
-- ⚠️ Cette liste doit être IDENTIQUE à ADMIN_EMAILS en haut de script.js

create or replace function is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (auth.jwt() ->> 'email') = any (array['rico3036@gmail.com']),
    false
  );
$$;


-- ############################################################################
-- ##  2. COLONNES SUPPLÉMENTAIRES SUR jobs
-- ############################################################################

-- Photo de la machine terminée, prise à la fin du service (optionnel)
alter table jobs add column if not exists photo_url_final text;

-- Étape officielle choisie à la fin du service
alter table jobs add column if not exists etape text;

-- Quantité (colonne QTE de la feuille de suivi papier)
alter table jobs add column if not exists quantite integer;


-- ############################################################################
-- ##  3. SÉCURITÉ : table jobs
-- ############################################################################
alter table jobs enable row level security;

-- Efface TOUTES les anciennes règles sur jobs, quel que soit leur nom.
-- Sans ça, une vieille règle permissive ("true") laisserait tout le monde
-- tout voir, même après avoir créé les bonnes règles ci-dessous.
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'jobs'
  loop
    execute format('drop policy %I on public.jobs', pol.policyname);
  end loop;
end $$;

create policy "jobs_select_own_or_admin" on jobs
  for select using (user_id = auth.uid() or is_admin());

create policy "jobs_insert_own" on jobs
  for insert with check (user_id = auth.uid());

create policy "jobs_update_own_or_admin" on jobs
  for update using (user_id = auth.uid() or is_admin());

create policy "jobs_delete_own_or_admin" on jobs
  for delete using (user_id = auth.uid() or is_admin());


-- ############################################################################
-- ##  4. SÉCURITÉ : table job_pauses  (pas de user_id → on remonte à jobs)
-- ############################################################################
alter table job_pauses enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'job_pauses'
  loop
    execute format('drop policy %I on public.job_pauses', pol.policyname);
  end loop;
end $$;

create policy "job_pauses_select_own_or_admin" on job_pauses
  for select using (
    exists (select 1 from jobs j
            where j.id = job_pauses.job_id
              and (j.user_id = auth.uid() or is_admin()))
  );

create policy "job_pauses_insert_own" on job_pauses
  for insert with check (
    exists (select 1 from jobs j
            where j.id = job_pauses.job_id and j.user_id = auth.uid())
  );

create policy "job_pauses_update_own" on job_pauses
  for update using (
    exists (select 1 from jobs j
            where j.id = job_pauses.job_id and j.user_id = auth.uid())
  );

create policy "job_pauses_delete_own" on job_pauses
  for delete using (
    exists (select 1 from jobs j
            where j.id = job_pauses.job_id and j.user_id = auth.uid())
  );


-- ############################################################################
-- ##  5. SÉCURITÉ : table settings  (préférences par technicien)
-- ############################################################################
alter table settings enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'settings'
  loop
    execute format('drop policy %I on public.settings', pol.policyname);
  end loop;
end $$;

-- Ici PAS de is_admin() : les préférences personnelles restent privées,
-- l'admin n'a aucune raison de lire le nom pré-rempli des autres.
create policy "settings_select_own" on settings
  for select using (user_id = auth.uid());

create policy "settings_insert_own" on settings
  for insert with check (user_id = auth.uid());

create policy "settings_update_own" on settings
  for update using (user_id = auth.uid());


-- ############################################################################
-- ##  6. SÉCURITÉ : photos (bucket "job-photos")
-- ############################################################################
-- Chemin des fichiers : "<user_id>/<nom>.jpg" — le 1er dossier est le
-- propriétaire. L'admin doit pouvoir lire les dossiers des autres pour
-- afficher leurs photos dans l'onglet Admin.

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%job-photos%'
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;

create policy "job_photos_read_own_or_admin" on storage.objects
  for select using (
    bucket_id = 'job-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_admin())
  );

-- INSERT + UPDATE : nécessaires pour l'envoi des photos (upsert côté app).
-- Chacun n'écrit que dans son propre dossier.
create policy "job_photos_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "job_photos_update_own" on storage.objects
  for update using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "job_photos_delete_own" on storage.objects
  for delete using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ############################################################################
-- ##  7. VÉRIFICATION  (s'affiche dans les résultats après "Run")
-- ############################################################################

-- Les 3 colonnes doivent apparaître :
select 'COLONNES' as verif, column_name
from information_schema.columns
where table_name = 'jobs'
  and column_name in ('etape', 'quantite', 'photo_url_final')

union all

-- Chaque ligne doit contenir auth.uid() ou is_admin() dans sa condition :
select 'POLICY ' || tablename, policyname
from pg_policies
where (schemaname = 'public' and tablename in ('jobs', 'job_pauses', 'settings'))
   or (schemaname = 'storage' and tablename = 'objects'
       and coalesce(qual, '') || coalesce(with_check, '') ilike '%job-photos%')
order by 1, 2;
