-- ============================================================================
-- ReproBench — bucket "avatars" (photo de profil de chaque technicien)
--
-- Comment l'utiliser :
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Collez tout ce fichier et cliquez "Run"
--
-- Chemin des fichiers : "<user_id>/avatar.jpg" — chacun ne peut lire/écrire
-- que dans son propre dossier, sauf l'admin qui peut tout lire (même schéma
-- de sécurité que le bucket "job-photos" déjà en place).
--
-- Idempotent : peut être relancé sans problème.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%avatars%'
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;

create policy "avatars_read_own_or_admin" on storage.objects
  for select using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_admin())
  );

create policy "avatars_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- VÉRIFICATION
-- ============================================================
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%avatars%';
