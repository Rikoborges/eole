-- ============================================================================
-- ReproBench — Sécurité de connexion
--
--  • 5 mots de passe faux de suite → compte bloqué 15 min (puis 30, 60…,
--    au plus 24 h). Le responsable peut débloquer tout de suite.
--  • Mot de passe provisoire (création ou réinitialisation par le
--    responsable) : la personne doit choisir le sien à la première connexion.
--
-- À lancer APRÈS supabase/atelier-schema.sql. Idempotent.
-- Le comptage se fait côté serveur (api/login.js, clé service_role) : la
-- table login_guard n'a AUCUNE policy, donc aucun navigateur ne peut la lire
-- ni la modifier directement.
-- ============================================================================

alter table collaborateurs add column if not exists must_change_password boolean not null default false;

create table if not exists login_guard (
  email text primary key,              -- adresse de connexion, en minuscules
  failures int not null default 0,     -- erreurs depuis la dernière réussite / le dernier blocage
  lock_count int not null default 0,   -- nombre de blocages successifs (durée progressive)
  locked_until timestamptz,
  last_failure timestamptz
);
alter table login_guard enable row level security;

-- Le collaborateur confirme qu'il a choisi son propre mot de passe
create or replace function clear_must_change_password()
returns void language sql security definer set search_path = public as $$
  update collaborateurs set must_change_password = false where user_id = auth.uid();
$$;
revoke all on function clear_must_change_password() from public, anon;
grant execute on function clear_must_change_password() to authenticated;

-- Le responsable voit qui est bloqué
create or replace function login_guard_status()
returns table (user_id uuid, failures int, locked_until timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, g.failures, g.locked_until
  from login_guard g join auth.users u on lower(u.email) = g.email
  where is_responsable();
$$;
revoke all on function login_guard_status() from public, anon;
grant execute on function login_guard_status() to authenticated;

-- Le responsable débloque un compte
create or replace function unlock_login(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_responsable() then raise exception 'Réservé au responsable.'; end if;
  delete from login_guard where email = (select lower(email) from auth.users where id = p_user);
end $$;
revoke all on function unlock_login(uuid) from public, anon;
grant execute on function unlock_login(uuid) to authenticated;

select 'securite-connexion installée' as resultat;
