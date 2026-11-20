-- ============================================================================
-- ReproBench — « À traiter » : éléments vus / traités par le responsable
-- Quand le responsable clique « OK » sur une ligne, elle sort de la liste et
-- est rangée dans « Traités » (il peut la remettre). Gardé par personne,
-- sur le serveur : même état sur le PC et le téléphone.
-- Idempotent. À lancer après supabase/atelier-schema.sql.
-- ============================================================================

create table if not exists inbox_vus (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_key text not null,
  label text,
  seen_at timestamptz not null default now(),
  primary key (user_id, item_key)
);
alter table inbox_vus enable row level security;
drop policy if exists inbox_vus_own on inbox_vus;
create policy inbox_vus_own on inbox_vus for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on inbox_vus to authenticated;

select 'À traiter : mémoire installée' as resultat;
