-- ============================================================================
-- ReproBench — Chronos enregistrés sur le serveur
-- Un enregistrement par collaborateur avec la liste de ses chronos (tâche,
-- séance en cours, cumul déjà déclaré). Le chrono suit la personne : commencé
-- sur le PC de l'atelier, il continue sur le téléphone.
-- Idempotent. À lancer après supabase/atelier-schema.sql.
-- ============================================================================

create table if not exists chronos_user (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table chronos_user enable row level security;

drop policy if exists chronos_own on chronos_user;
create policy chronos_own on chronos_user
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on chronos_user to authenticated;

select 'chronos installés' as resultat;
