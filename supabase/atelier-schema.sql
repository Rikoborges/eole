-- ============================================================================
-- ReproBench — Outil de déclaration d'activité de l'atelier (PARTIE 1 : base)
--
-- Crée tout ce dont le cahier des charges a besoin côté base de données :
--   • référentiels paramétrables par le Responsable des Ateliers :
--     métiers, formats horaires, activités, standards (avec historique),
--     motifs hors production, motifs d'abandon, règles de saisie
--   • fiche de chaque collaborateur (métier, format, intérim, droits)
--   • opérations machine (matricule + modèle, statut, sur plusieurs jours)
--   • déclarations (temps + quantité, jamais supprimées : annulées)
--
-- COMMENT UTILISER :
--   1. Avoir déjà lancé setup-complete.sql, printer-models.sql,
--      harden-admin-check.sql et machine-models.sql
--   2. Supabase → SQL Editor → coller TOUT ce fichier → Run
--
-- Idempotent : peut être relancé sans dupliquer les données ni écraser les
-- réglages déjà modifiés par le Responsable.
--
-- Sécurité (RLS) :
--   • tout compte connecté LIT les référentiels
--   • seul un responsable MODIFIE les référentiels et les fiches
--   • chaque collaborateur ne voit et ne déclare que pour lui-même
--   • personne ne peut supprimer une déclaration ou une opération : on annule
--   • le standard appliqué est recopié par la base elle-même (le navigateur ne
--     peut pas le fausser) et n'est jamais recalculé après coup
-- ============================================================================


-- ############################################################################
-- ##  1. QUI EST RESPONSABLE ?
-- ############################################################################
-- Responsable = admin existant (fonction is_admin(), e-mails dans le SQL)
-- OU fiche collaborateur avec le droit « responsable ». On ne touche pas à
-- is_admin() : les e-mails déjà autorisés (dont celui du Responsable des
-- Ateliers) restent valables.

create table if not exists metiers (
  id text primary key,
  label text not null,
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists formats_horaires (
  id text primary key,
  label text not null,
  contract_hours numeric(4,1) not null,
  day_hours numeric(4,2)[] not null check (array_length(day_hours, 1) = 5),
  active boolean not null default true
);

create table if not exists collaborateurs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  metier_id text references metiers(id),
  format_id text references formats_horaires(id),
  interim boolean not null default false,
  role text not null default 'collaborateur' check (role in ('collaborateur', 'responsable')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- security definer : lit la fiche sans repasser par les policies (sinon boucle)
create or replace function is_responsable()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(is_admin(), false)
      or exists (select 1 from collaborateurs c
                 where c.user_id = auth.uid() and c.role = 'responsable' and c.active);
$$;
revoke all on function is_responsable() from public;
revoke all on function is_responsable() from anon;
grant execute on function is_responsable() to authenticated;


-- ############################################################################
-- ##  2. RÉFÉRENTIELS
-- ############################################################################

create table if not exists activites (
  id uuid primary key default gen_random_uuid(),
  metier_id text not null references metiers(id),
  name text not null,
  requires_machine boolean not null default false,  -- matricule obligatoire, 1 matricule = 1 quantité
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (metier_id, name)
);

-- Historique des standards : on n'écrase jamais, on ajoute une ligne datée.
create table if not exists standards (
  id uuid primary key default gen_random_uuid(),
  activite_id uuid not null references activites(id) on delete cascade,
  hours_per_unit numeric(6,2) check (hours_per_unit is null or hours_per_unit >= 0),  -- null = pas de standard
  valid_from date not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (activite_id, valid_from)
);

create table if not exists hors_production (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists motifs_abandon (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  requires_comment boolean not null default false,
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists regles_saisie (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Standard en vigueur pour une activité à une date donnée
create or replace function standard_at(p_activite uuid, p_date date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select s.hours_per_unit from standards s
  where s.activite_id = p_activite and s.valid_from <= p_date
  order by s.valid_from desc
  limit 1;
$$;

-- Date d'aujourd'hui à l'heure de l'atelier (pas celle du serveur, en UTC)
create or replace function atelier_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Europe/Paris')::date $$;

-- Premier jour encore modifiable par le collaborateur, selon la règle choisie
create or replace function correction_floor()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce((select value #>> '{}' from regles_saisie where key = 'correction'), 'day')
           when 'h24'  then atelier_today() - 1
           when 'week' then date_trunc('week', atelier_today())::date
           when 'none' then atelier_today() + 1
           else atelier_today()
         end;
$$;


-- ############################################################################
-- ##  3. OPÉRATIONS MACHINE ET DÉCLARATIONS
-- ############################################################################

create table if not exists operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  activite_id uuid not null references activites(id),
  serial text,                              -- N° de série (null si étiquette illisible : alerte)
  model_id uuid references printer_models(id),
  status text not null default 'pause'
    check (status in ('encours', 'pause', 'final', 'abandon', 'annulee')),
  started_on date not null default atelier_today(),
  finished_on date,
  std_value numeric(6,2),                   -- standard recopié au démarrage
  final_declaration_id uuid,
  motif_id uuid references motifs_abandon(id),
  close_comment text,
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un N° de série ne peut servir qu'une fois par étape (hors opérations
-- abandonnées ou annulées, qui libèrent le matricule).
create unique index if not exists operations_serial_etape_unique
  on operations (upper(serial), activite_id)
  where serial is not null and status in ('encours', 'pause', 'final');
create index if not exists operations_user_status on operations (user_id, status);

create table if not exists declarations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  work_date date not null default atelier_today(),
  activite_id uuid references activites(id),
  hors_production_id uuid references hors_production(id),
  operation_id uuid references operations(id),
  quantity int not null default 0 check (quantity >= 0),
  hours numeric(5,2) not null check (hours > 0 and hours <= 12),
  std_value numeric(6,2),                   -- standard recopié par la base
  note text,
  cancelled boolean not null default false,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint declaration_activite_ou_hp check ((activite_id is null) <> (hors_production_id is null))
);
create index if not exists declarations_user_date on declarations (user_id, work_date);
create index if not exists declarations_operation on declarations (operation_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'operations_final_declaration_fk') then
    alter table operations add constraint operations_final_declaration_fk
      foreign key (final_declaration_id) references declarations(id);
  end if;
end $$;


-- ############################################################################
-- ##  4. RÈGLES APPLIQUÉES PAR LA BASE (triggers)
-- ############################################################################

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Déclaration : standard recopié, cohérence machine / quantité, auteur de l'annulation
create or replace function declarations_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_machine boolean; v_op operations%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then raise exception 'Le collaborateur d''une déclaration ne peut pas changer.'; end if;
    if old.cancelled and not new.cancelled then raise exception 'Une déclaration annulée ne peut pas être réactivée.'; end if;
    if new.cancelled and not old.cancelled then
      new.cancelled_by := auth.uid(); new.cancelled_at := now();
    end if;
  end if;

  if new.activite_id is not null then
    select requires_machine into v_machine from activites where id = new.activite_id;
    if v_machine then
      if new.operation_id is null then raise exception 'Cette étape demande un matricule : la déclaration doit être liée à une opération.'; end if;
      select * into v_op from operations where id = new.operation_id;
      if v_op.user_id <> new.user_id or v_op.activite_id <> new.activite_id then
        raise exception 'Opération incohérente avec la déclaration.';
      end if;
      new.quantity := 0;                        -- la machine est comptée par l'opération finalisée
      new.std_value := v_op.std_value;
    else
      if new.operation_id is not null then raise exception 'Cette étape ne se rattache pas à une machine.'; end if;
      if new.quantity < 1 then raise exception 'La quantité doit être au moins 1.'; end if;
      if tg_op = 'INSERT' or new.activite_id is distinct from old.activite_id or new.work_date is distinct from old.work_date then
        new.std_value := standard_at(new.activite_id, new.work_date);
      else
        new.std_value := old.std_value;         -- jamais recalculé après coup
      end if;
    end if;
  else
    new.quantity := 0; new.std_value := null; new.operation_id := null;
  end if;
  return new;
end $$;

-- Annuler la dernière déclaration d'une opération : l'opération est annulée ;
-- annuler celle qui l'avait finalisée : l'opération repasse « à poursuivre ».
create or replace function declarations_after_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cancelled and not old.cancelled and new.operation_id is not null then
    if not exists (select 1 from declarations where operation_id = new.operation_id and not cancelled) then
      update operations set status = 'annulee', close_comment = 'Seule déclaration annulée',
             closed_by = auth.uid(), closed_at = now()
       where id = new.operation_id and status <> 'annulee';
    else
      update operations set status = 'pause', finished_on = null, final_declaration_id = null
       where id = new.operation_id and final_declaration_id = new.id;
    end if;
  end if;
  return new;
end $$;

-- Opération : standard recopié au démarrage, clôture contrôlée
create or replace function operations_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_machine boolean; v_comment boolean;
begin
  if tg_op = 'INSERT' then
    select requires_machine into v_machine from activites where id = new.activite_id;
    if not coalesce(v_machine, false) then raise exception 'Seules les étapes avec matricule créent une opération.'; end if;
    new.std_value := standard_at(new.activite_id, new.started_on);
    new.serial := nullif(upper(trim(new.serial)), '');
  else
    if new.user_id <> old.user_id or new.activite_id <> old.activite_id then
      raise exception 'Le collaborateur et l''étape d''une opération ne peuvent pas changer.';
    end if;
    new.std_value := old.std_value;
    if old.status in ('abandon', 'annulee') and new.status <> old.status then
      raise exception 'Une opération clôturée ne peut pas être rouverte.';
    end if;
  end if;

  if new.status = 'final' and new.finished_on is null then new.finished_on := atelier_today(); end if;
  if new.status in ('encours', 'pause') then new.finished_on := null; end if;

  if new.status in ('abandon', 'annulee') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if new.motif_id is null and new.close_comment is null then
      raise exception 'Un motif est obligatoire pour clôturer une opération.';
    end if;
    select requires_comment into v_comment from motifs_abandon where id = new.motif_id;
    if coalesce(v_comment, false) and coalesce(trim(new.close_comment), '') = '' then
      raise exception 'Ce motif demande un commentaire.';
    end if;
    new.closed_by := coalesce(new.closed_by, auth.uid()); new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end $$;

-- Opération annulée (suppression) : ses temps sont retirés des totaux mais
-- gardés dans l'historique (déclarations annulées, jamais effacées).
create or replace function operations_after_annulee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'annulee' and old.status is distinct from 'annulee' then
    update declarations set cancelled = true where operation_id = new.id and not cancelled;
  end if;
  return new;
end $$;

-- Toute nouvelle connexion reçoit une fiche (métier / format à attribuer par le responsable)
create or replace function create_collaborateur_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into collaborateurs (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists collaborateurs_touch on collaborateurs;
create trigger collaborateurs_touch before update on collaborateurs for each row execute function touch_updated_at();
drop trigger if exists operations_touch on operations;
create trigger operations_touch before update on operations for each row execute function touch_updated_at();
drop trigger if exists declarations_touch on declarations;
create trigger declarations_touch before update on declarations for each row execute function touch_updated_at();

drop trigger if exists declarations_rules on declarations;
create trigger declarations_rules before insert or update on declarations for each row execute function declarations_before_write();
drop trigger if exists declarations_cancel on declarations;
create trigger declarations_cancel after update on declarations for each row execute function declarations_after_cancel();
drop trigger if exists operations_rules on operations;
create trigger operations_rules before insert or update on operations for each row execute function operations_before_write();
drop trigger if exists operations_annulee on operations;
create trigger operations_annulee after update on operations for each row execute function operations_after_annulee();

drop trigger if exists on_auth_user_created_collaborateur on auth.users;
create trigger on_auth_user_created_collaborateur after insert on auth.users
  for each row execute function create_collaborateur_for_new_user();


-- ############################################################################
-- ##  5. SÉCURITÉ (RLS)
-- ############################################################################

do $$
declare t text; pol record;
begin
  foreach t in array array['metiers','formats_horaires','collaborateurs','activites','standards',
                           'hors_production','motifs_abandon','regles_saisie','operations','declarations']
  loop
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;

-- Référentiels : lecture pour tout compte connecté, écriture responsable
do $$
declare t text;
begin
  foreach t in array array['metiers','formats_horaires','activites','standards','hors_production','motifs_abandon','regles_saisie']
  loop
    execute format('create policy %I on public.%I for select using (auth.uid() is not null)', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (is_responsable())', t || '_insert_resp', t);
    execute format('create policy %I on public.%I for update using (is_responsable())', t || '_update_resp', t);
  end loop;
end $$;
-- (aucune policy DELETE : on désactive au lieu de supprimer ; sauf motifs/hors production)
create policy hors_production_delete_resp on hors_production for delete using (is_responsable());
create policy motifs_abandon_delete_resp on motifs_abandon for delete using (is_responsable());

-- Fiches collaborateurs : chacun lit la sienne, le responsable gère tout
create policy collaborateurs_select on collaborateurs
  for select using (user_id = auth.uid() or is_responsable());
create policy collaborateurs_insert_resp on collaborateurs
  for insert with check (is_responsable());
create policy collaborateurs_update_resp on collaborateurs
  for update using (is_responsable());

-- Opérations : le collaborateur crée et fait avancer les siennes (jusqu'à
-- « finalisée ») ; abandon et annulation réservés au responsable.
create policy operations_select on operations
  for select using (user_id = auth.uid() or is_responsable());
create policy operations_insert_own on operations
  for insert with check (user_id = auth.uid() and status in ('encours', 'pause', 'final'));
create policy operations_update_own on operations
  for update using (user_id = auth.uid() and status in ('encours', 'pause'))
  with check (user_id = auth.uid() and status in ('encours', 'pause', 'final'));
create policy operations_update_resp on operations
  for update using (is_responsable());

-- Déclarations : le collaborateur déclare pour lui, corrige dans le délai
-- autorisé ; le responsable corrige tout. Pas de suppression : on annule.
create policy declarations_select on declarations
  for select using (user_id = auth.uid() or is_responsable());
create policy declarations_insert_own on declarations
  for insert with check (user_id = auth.uid() and not cancelled and work_date >= correction_floor() and work_date <= atelier_today());
create policy declarations_update_own on declarations
  for update using (user_id = auth.uid() and not cancelled and work_date >= correction_floor())
  with check (user_id = auth.uid() and work_date >= correction_floor() and work_date <= atelier_today());
create policy declarations_update_resp on declarations
  for update using (is_responsable());


-- ############################################################################
-- ##  6. VUE : temps cumulé par opération (respecte les droits de chacun)
-- ############################################################################
create or replace view operations_avec_temps
with (security_invoker = true) as
select o.*,
       coalesce(sum(d.hours) filter (where not d.cancelled), 0)::numeric(6,2) as total_hours,
       max(d.work_date) filter (where not d.cancelled) as last_work_date
from operations o
left join declarations d on d.operation_id = o.id
group by o.id;


-- ############################################################################
-- ##  6b. FONCTIONS APPELÉES PAR L'ÉCRAN « SAISIR »
-- ############################################################################

-- Ce que l'atelier sait déjà d'un N° de série : modèle et étapes déjà faites
-- (par tout le monde). Ne renvoie que ces informations, rien d'autre.
create or replace function lookup_serial(p_serial text)
returns table (activite_id uuid, activite text, status text, model_id uuid,
               collaborateur text, started_on date, is_mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select o.activite_id, a.name, o.status, o.model_id, c.display_name, o.started_on,
         o.user_id = auth.uid()
  from operations o
  join activites a on a.id = o.activite_id
  left join collaborateurs c on c.user_id = o.user_id
  where auth.uid() is not null
    and o.serial = upper(trim(p_serial))
    and o.status <> 'annulee'
  order by o.created_at desc
  limit 20;
$$;
revoke all on function lookup_serial(text) from public;
revoke all on function lookup_serial(text) from anon;
grant execute on function lookup_serial(text) to authenticated;

-- Déclarer du temps sur une étape avec matricule, en une seule transaction :
-- crée l'opération si besoin, enregistre le temps du jour, puis la laisse
-- « à poursuivre » ou la finalise. Security invoker : les policies RLS
-- s'appliquent exactement comme pour un appel direct.
create or replace function declare_machine_step(
  p_activite uuid, p_operation uuid, p_serial text, p_model uuid,
  p_hours numeric, p_note text, p_finalize boolean)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare v_op uuid := p_operation; v_decl uuid;
begin
  if v_op is null then
    insert into operations (activite_id, serial, model_id, status)
    values (p_activite, nullif(upper(trim(p_serial)), ''), p_model, 'pause')
    returning id into v_op;
  end if;
  insert into declarations (activite_id, operation_id, hours, note)
  values (p_activite, v_op, p_hours, nullif(trim(p_note), ''))
  returning id into v_decl;
  update operations
     set status = case when p_finalize then 'final' else 'pause' end,
         final_declaration_id = case when p_finalize then v_decl else null end
   where id = v_op;
  if not found then raise exception 'Opération introuvable ou déjà clôturée.'; end if;
  return v_decl;
end $$;
revoke all on function declare_machine_step(uuid, uuid, text, uuid, numeric, text, boolean) from public;
revoke all on function declare_machine_step(uuid, uuid, text, uuid, numeric, text, boolean) from anon;
grant execute on function declare_machine_step(uuid, uuid, text, uuid, numeric, text, boolean) to authenticated;


-- ############################################################################
-- ##  7. TEMPS RÉEL (le tableau de bord se met à jour sans recharger)
-- ############################################################################
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['declarations', 'operations'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;


-- ############################################################################
-- ##  8. DONNÉES DE DÉPART (cahier des charges V1) — sans écraser l'existant
-- ############################################################################
insert into metiers (id, label, sort) values
  ('TECH', 'Technicienne / Technicien', 1),
  ('AIDE', 'Aide technique', 2)
on conflict (id) do nothing;

insert into formats_horaires (id, label, contract_hours, day_hours) values
  ('37', '37 h', 37, array[8, 8, 8, 8, 4]::numeric(4,2)[]),
  ('39', '39 h', 39, array[8, 8, 8, 8, 6]::numeric(4,2)[])
on conflict (id) do nothing;

insert into activites (metier_id, name, requires_machine, sort) values
  ('TECH', 'Test machine + effacement des données', false, 1),
  ('TECH', 'Démontage des carters', false, 2),
  ('TECH', 'Vaisselle des carters démontés', false, 3),
  ('TECH', 'Nettoyage du multifonction + Remise en état complet', true, 4),
  ('TECH', 'Partie technique machine nettoyée', true, 5),
  ('TECH', 'Partie technique machine FULL', true, 6),
  ('TECH', 'Contrôle qualité', false, 7),
  ('TECH', 'Saisie dans SAGE', false, 8),
  ('TECH', 'Emballage', false, 9),
  ('AIDE', 'Test machine + effacement des données', false, 1),
  ('AIDE', 'Démontage des carters', false, 2),
  ('AIDE', 'Vaisselle des carters démontés', false, 3),
  ('AIDE', 'Nettoyage du multifonction + Remise en état complet', true, 4),
  ('AIDE', 'Emballage', false, 5),
  ('AIDE', 'Déballage pour MAT NEUF', false, 6)
on conflict (metier_id, name) do nothing;

-- Standards initiaux (fiches Excel 39H et AIDE TECH), valables depuis le 01/01/2026
insert into standards (activite_id, hours_per_unit, valid_from)
select a.id, v.std, date '2026-01-01'
from (values
  ('TECH', 'Test machine + effacement des données', 0.08),
  ('TECH', 'Démontage des carters', 0.08),
  ('TECH', 'Vaisselle des carters démontés', 0.42),
  ('TECH', 'Nettoyage du multifonction + Remise en état complet', 2.25),
  ('TECH', 'Partie technique machine nettoyée', 1.75),
  ('TECH', 'Partie technique machine FULL', 4.00),
  ('TECH', 'Contrôle qualité', 0.25),
  ('TECH', 'Saisie dans SAGE', 0.08),
  ('TECH', 'Emballage', 0.08),
  ('AIDE', 'Test machine + effacement des données', 0.08),
  ('AIDE', 'Démontage des carters', 0.08),
  ('AIDE', 'Vaisselle des carters démontés', 0.42),
  ('AIDE', 'Nettoyage du multifonction + Remise en état complet', 2.00),
  ('AIDE', 'Emballage', 0.08),
  ('AIDE', 'Déballage pour MAT NEUF', null)
) as v(metier, name, std)
join activites a on a.metier_id = v.metier and a.name = v.name
on conflict (activite_id, valid_from) do nothing;

insert into hors_production (label, sort) values
  ('Réunion', 1), ('Formation', 2), ('5S', 3), ('Accompagnement d''un collaborateur', 4),
  ('Intervention spécifique', 5), ('Absence', 6), ('Congés', 7),
  ('Activité atelier exceptionnelle', 8), ('Autre', 9)
on conflict (label) do nothing;

insert into motifs_abandon (label, requires_comment, sort) values
  ('Machine irréparable', false, 1), ('Pièce indisponible', false, 2),
  ('Changement d''orientation du matériel', false, 3), ('Erreur de saisie', false, 4),
  ('Autre', true, 5)
on conflict (label) do nothing;

insert into regles_saisie (key, value) values
  ('correction', '"day"'),          -- day | h24 | week | none
  ('chrono', 'false'),              -- chrono facultatif masqué par défaut
  ('resultats_visibles', 'true'),   -- le collaborateur voit « Mes résultats »
  ('photos_suivi', 'true')          -- photos, checklist et lecture IA du Suivi
on conflict (key) do nothing;

-- Une fiche pour chaque compte déjà existant (métier / format à compléter)
insert into collaborateurs (user_id, display_name)
select u.id, coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1))
from auth.users u
on conflict (user_id) do nothing;


-- ############################################################################
-- ##  9. VÉRIFICATION
-- ############################################################################
select 'métiers' as element, count(*) as nombre from metiers
union all select 'formats horaires', count(*) from formats_horaires
union all select 'activités', count(*) from activites
union all select 'standards', count(*) from standards
union all select 'motifs hors production', count(*) from hors_production
union all select 'motifs d''abandon', count(*) from motifs_abandon
union all select 'collaborateurs', count(*) from collaborateurs
union all select 'collaborateurs sans métier ou format', count(*) from collaborateurs where metier_id is null or format_id is null;
