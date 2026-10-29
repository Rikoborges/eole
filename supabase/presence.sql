-- ============================================================================
-- ReproBench — temps de connexion (présence) par technicien et par jour
--
-- Une ligne par personne et par jour : heure de la première activité dans
-- l'app (first_seen) et de la dernière (last_seen, rafraîchie toutes les
-- minutes tant que l'app est ouverte). Le technicien voit son propre temps
-- (bouton ⏱ en haut), l'admin voit toute l'équipe (onglet Admin).
--
-- Les heures sont écrites UNIQUEMENT par la fonction touch_presence(), avec
-- l'horloge du serveur (now()) : personne ne peut envoyer une heure inventée
-- depuis le navigateur, il n'y a d'ailleurs aucune policy insert/update.
--
-- Dépend de is_admin() (setup-complete.sql). Idempotent.
-- ============================================================================

create table if not exists presence (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, day)
);

alter table presence enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'presence'
  loop
    execute format('drop policy %I on public.presence', pol.policyname);
  end loop;
end $$;

-- Lecture : ses propres lignes, ou tout si admin. Pas d'insert/update/delete
-- direct — tout passe par touch_presence() ci-dessous.
create policy "presence_select_own_or_admin" on presence
  for select using (user_id = auth.uid() or is_admin());

-- "Je suis là" : crée la ligne du jour (heure de France) ou met à jour
-- last_seen. security definer pour pouvoir écrire malgré l'absence de
-- policy d'écriture, mais limité à auth.uid() — on ne touche que soi-même.
create or replace function touch_presence()
returns presence
language plpgsql
security definer
set search_path = public
as $$
declare result presence;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into presence (user_id, day, first_seen, last_seen)
  values (auth.uid(), (now() at time zone 'Europe/Paris')::date, now(), now())
  on conflict (user_id, day) do update set last_seen = now()
  returning * into result;
  return result;
end;
$$;

revoke all on function touch_presence() from public;
revoke all on function touch_presence() from anon;
grant execute on function touch_presence() to authenticated;

-- Vérification
select policyname, cmd from pg_policies where tablename = 'presence';
