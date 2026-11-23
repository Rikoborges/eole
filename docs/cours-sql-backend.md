# Cours SQL & back-end — préparation au Titre Pro DWWM (bloc back-end)

> Support de révision construit à partir d'un projet réel : **ReproBench** (application de déclaration d'activité pour un atelier de reconditionnement d'imprimantes, en production).
> Base : **PostgreSQL** (via Supabase). Serveur : **fonctions Node.js** (Vercel).
> Chaque notion = **cours court → exemple du projet → à retenir**. Exercices corrigés à la fin.

---

## Sommaire

1. Ce que le jury évalue
2. Concevoir une base : Merise (MCD, MLD, MPD)
3. La normalisation (1FN, 2FN, 3FN)
4. SQL — Définir les données (DDL)
5. SQL — Manipuler les données (DML)
6. SQL — Interroger les données (SELECT, jointures, agrégats)
7. Requêtes avancées (sous-requêtes, CTE, vues, fenêtres)
8. Transactions et ACID
9. Index et performances
10. Programmer dans la base (fonctions, triggers)
11. Sécurité des données
12. Composants d'accès aux données (le code qui parle à la base)
13. Composants métier côté serveur
14. Documenter le déploiement
15. Exercices corrigés
16. Questions du jury (avec réponses)
17. Anglais technique
18. Glossaire
19. Planning de révision

---

## 1. Ce que le jury évalue

**Bloc RNCP37674BC02 — Développer la partie back-end d'une application web ou web mobile sécurisée**

| Compétence | Dans ReproBench |
|---|---|
| Mettre en place une base de données relationnelle | Schéma PostgreSQL : 15 tables, clés étrangères, contraintes |
| Développer des composants d'accès aux données SQL | Requêtes via supabase-js, fonctions SQL (RPC), vues |
| Développer des composants métier côté serveur | Fonctions serverless Node.js (connexion, gestion des comptes), triggers |
| Documenter le déploiement | GitHub → Vercel, scripts SQL idempotents, variables d'environnement |

**Épreuve du bloc (1 h 20)** : présentation du projet 20 min (dossier imprimé + diaporama) → entretien technique 30 min → questionnaire professionnel 30 min (documentation en anglais).

> **Phrase clé à placer :** « Le serveur ne fait jamais confiance au client : les règles de sécurité et d'intégrité sont appliquées par la base elle-même. »

---

## 2. Concevoir une base : la méthode Merise

Les jurys français attendent souvent la méthode **Merise**, en 3 niveaux :

| Niveau | Question | Contenu |
|---|---|---|
| **MCD** (Modèle Conceptuel de Données) | *Quoi ?* | Entités, associations, cardinalités. Indépendant de toute technique |
| **MLD** (Modèle Logique de Données) | *Comment, en relationnel ?* | Tables, clés primaires, clés étrangères |
| **MPD** (Modèle Physique de Données) | *Avec quel SGBD ?* | Le script SQL réel (types PostgreSQL, index…) |

### 2.1 Vocabulaire du MCD

- **Entité** : un objet du métier (COLLABORATEUR, MACHINE, DÉCLARATION).
- **Propriété** (attribut) : une information de l'entité (nom, date, heures).
- **Identifiant** : propriété unique qui distingue chaque occurrence (souligné).
- **Association** : lien entre entités, nommé par un verbe (« déclare », « concerne »).
- **Cardinalités** `(min, max)` : combien de fois une occurrence participe à l'association. Valeurs : `0,1` · `1,1` · `0,n` · `1,n`.

### 2.2 MCD de ReproBench (simplifié)

```
COLLABORATEUR (0,n) ──── déclare ────(1,1) DÉCLARATION (0,n) ──── porte sur ────(1,1) ACTIVITÉ
      │                                        │
    (0,n)                                    (0,1)
      │                                        │
   travaille                              se rattache à
      │                                        │
    (1,1)                                    (0,n)
   OPÉRATION (machine dans une étape) ─────────┘
      │ (1,1)
   concerne
      │ (0,n)
   MODÈLE D'IMPRIMANTE

ACTIVITÉ (0,n) ──── a pour standard ────(1,1) STANDARD (avec date de validité)
COLLABORATEUR (1,1) ──── exerce ────(0,n) MÉTIER
```

**Lecture d'une cardinalité** : « Un collaborateur déclare **0 à n** déclarations ; une déclaration est faite par **1 et 1 seul** collaborateur. »

### 2.3 Passage MCD → MLD (règles à connaître par cœur)

| Cas | Règle | Exemple |
|---|---|---|
| Association **1,1 — 0,n** (ou 1,n) | La clé de l'entité côté **n** devient **clé étrangère** dans l'entité côté **1,1** | `declarations.user_id` → `collaborateurs` |
| Association **0,n — 0,n** (plusieurs à plusieurs) | Création d'une **table de jonction** dont la clé primaire est composée des deux clés | (ex. si une déclaration pouvait concerner plusieurs machines : `declaration_machine(declaration_id, operation_id)`) |
| Association **0,1 — 1,1** | Clé étrangère du côté 0,1 ou fusion des tables | `collaborateurs.user_id` = clé primaire ET étrangère vers `auth.users` (relation 1-1) |

### 2.4 MLD de ReproBench (extrait)

```
METIERS (id, label, active, sort)
COLLABORATEURS (#user_id, display_name, #metier_id, #format_id, role, active)
ACTIVITES (id, #metier_id, name, requires_machine, uses_quantity)
STANDARDS (id, #activite_id, hours_per_unit, valid_from)
OPERATIONS (id, #user_id, #activite_id, serial, #model_id, status, started_on, finished_on, std_value)
DECLARATIONS (id, #user_id, work_date, #activite_id, #hors_production_id, #operation_id,
              quantity, hours, std_value, note, cancelled, #saisi_par)
```
Convention : **souligné** = clé primaire, **#** = clé étrangère.

> **À retenir :** le MCD parle le langage du métier (le responsable d'atelier doit pouvoir le lire), le MLD parle le langage des tables.

---

## 3. La normalisation

Objectif : **éviter la redondance** et les **anomalies** (mise à jour, insertion, suppression).

### Point de départ : l'ancienne fiche Excel de l'atelier

| Technicien | Métier | Date | Activité | Standard | Quantité | Heures |
|---|---|---|---|---|---|---|
| Paul | Technicien | 03/11 | Emballage | 0,08 | 3 | 0,25 |
| Paul | Technicien | 03/11 | Contrôle qualité, Emballage | 0,25 ; 0,08 | 2 ; 1 | 0,75 |

Problèmes : plusieurs valeurs dans une cellule, le métier de Paul répété sur chaque ligne, le standard répété sur chaque ligne.

### 1FN — Première forme normale
**Chaque attribut est atomique** (une seule valeur par case) et il existe une clé primaire.
→ On sépare « Contrôle qualité, Emballage » en deux lignes. On ajoute un identifiant `id`.

### 2FN — Deuxième forme normale
1FN + **chaque attribut non-clé dépend de TOUTE la clé** (pas d'une partie seulement). Ne concerne que les clés composées.
→ Si la clé était `(technicien, date, activité)`, le **métier** ne dépend que du technicien : on le sort dans une table `collaborateurs`.

### 3FN — Troisième forme normale
2FN + **aucun attribut non-clé ne dépend d'un autre attribut non-clé** (pas de dépendance transitive).
→ Le **standard** dépend de l'activité, pas de la déclaration : on le sort dans une table `standards`.

### Résultat
`collaborateurs`, `activites`, `standards`, `declarations` : chaque information est stockée **une seule fois**.

### La dénormalisation volontaire (question piège !)
Dans ReproBench, `declarations.std_value` **recopie** le standard au moment de la saisie. C'est une entorse volontaire à la 3FN :
> « Si le responsable change le standard demain, les déclarations passées doivent garder la valeur de l'époque. Ce n'est pas une redondance, c'est un **historique** : la valeur dépend de la déclaration *à sa date*. »

Savoir justifier une dénormalisation montre qu'on maîtrise la normalisation.

---

## 4. SQL — Définir les données (DDL)

**DDL** = *Data Definition Language* : `CREATE`, `ALTER`, `DROP`, `TRUNCATE`.

### 4.1 Créer une table

```sql
create table if not exists declarations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id),
  work_date   date not null default current_date,
  activite_id uuid references activites(id),
  hors_production_id uuid references hors_production(id),
  quantity    int  not null default 0 check (quantity >= 0),
  hours       numeric(5,2) not null check (hours > 0 and hours <= 12),
  note        text,
  cancelled   boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint declaration_activite_ou_hp
    check ((activite_id is null) <> (hors_production_id is null))
);
```

### 4.2 Les types PostgreSQL utiles

| Type | Usage | Exemple ReproBench |
|---|---|---|
| `int`, `bigint` | entiers | `quantity` |
| `numeric(p,s)` | décimal **exact** (jamais `float` pour de l'argent ou des heures) | `hours numeric(5,2)` |
| `text`, `varchar(n)` | texte | `note` |
| `boolean` | vrai/faux | `cancelled` |
| `date`, `timestamptz` | date ; date+heure **avec fuseau** | `work_date`, `created_at` |
| `uuid` | identifiant unique non devinable | `id` |
| `jsonb` | document JSON indexable | `regles_saisie.value` |
| `type[]` | tableau | `day_hours numeric[]` |

> **Pourquoi `uuid` plutôt qu'un `serial` (1, 2, 3…) ?** Un identifiant séquentiel est devinable (`/declarations/42` → on essaie 43). L'UUID ne l'est pas, et il peut être généré côté client sans conflit.

### 4.3 Les contraintes (le cœur de l'intégrité)

| Contrainte | Rôle | Exemple |
|---|---|---|
| `PRIMARY KEY` | identifiant unique, non nul | `id uuid primary key` |
| `FOREIGN KEY` / `REFERENCES` | intégrité référentielle | `activite_id references activites(id)` |
| `NOT NULL` | valeur obligatoire | `hours … not null` |
| `UNIQUE` | pas de doublon | `unique (metier_id, name)` |
| `CHECK` | règle sur la valeur | `check (hours > 0 and hours <= 12)` |
| `DEFAULT` | valeur par défaut | `default now()` |

### 4.4 Les options des clés étrangères

```sql
user_id uuid references auth.users(id) on delete cascade
```
| Option | Effet si la ligne parente est supprimée |
|---|---|
| `NO ACTION` / `RESTRICT` (défaut) | suppression **refusée** tant qu'il reste des enfants |
| `CASCADE` | les enfants sont **supprimés aussi** |
| `SET NULL` | la clé étrangère des enfants passe à `NULL` |

> Dans ReproBench, les déclarations ne sont **jamais supprimées** (traçabilité, droit du travail) : on utilise `RESTRICT` sur les données métier, et une procédure contrôlée pour la purge RGPD.

### 4.5 Modifier une table

```sql
alter table declarations add column if not exists saisi_par uuid references auth.users(id);
alter table activites add column if not exists uses_quantity boolean not null default true;
alter table declarations drop column note;          -- supprime la colonne (et ses données !)
alter table activites rename column name to libelle;
```

### 4.6 Scripts idempotents
Un script **idempotent** peut être exécuté plusieurs fois sans erreur ni effet en double : `create table if not exists`, `add column if not exists`, `drop policy if exists`, `insert … on conflict do nothing`. Indispensable pour déployer en toute sécurité.

---

## 5. SQL — Manipuler les données (DML)

**DML** = *Data Manipulation Language* : `INSERT`, `UPDATE`, `DELETE`.

```sql
-- Insérer
insert into hors_production (label, sort) values ('Réunion', 1), ('Formation', 2);

-- Insérer et récupérer la ligne créée
insert into declarations (user_id, activite_id, quantity, hours)
values ('…uuid…', '…uuid…', 3, 0.25)
returning id, std_value;

-- Mettre à jour (TOUJOURS avec un WHERE !)
update declarations set note = 'attente pièce' where id = '…uuid…';

-- « Supprimer » à la façon ReproBench : on annule
update declarations set cancelled = true where id = '…uuid…';

-- Supprimer vraiment
delete from inbox_vus where user_id = '…uuid…';
```

### L'UPSERT (insérer ou mettre à jour)
```sql
insert into validations_semaine (user_id, week_monday, signed_at)
values ('…uuid…', '2026-11-23', now())
on conflict (user_id, week_monday) do update set signed_at = now();
```
Utilisé dans ReproBench pour la signature de la semaine : une seule ligne par collaborateur et par semaine.

> **Piège classique :** un `UPDATE` ou un `DELETE` sans `WHERE` touche **toute la table**.

---

## 6. SQL — Interroger les données

**DQL** = *Data Query Language* : `SELECT`.

### 6.1 Ordre d'écriture vs ordre d'exécution

| On écrit | La base exécute |
|---|---|
| `SELECT` | 1. `FROM` / `JOIN` |
| `FROM` | 2. `WHERE` |
| `WHERE` | 3. `GROUP BY` |
| `GROUP BY` | 4. `HAVING` |
| `HAVING` | 5. `SELECT` |
| `ORDER BY` | 6. `ORDER BY` |
| `LIMIT` | 7. `LIMIT` |

→ C'est pourquoi on ne peut pas utiliser un alias du `SELECT` dans le `WHERE`.

### 6.2 Filtrer et trier
```sql
select work_date, hours, note
from declarations
where user_id = '…uuid…'
  and work_date between '2026-11-16' and '2026-11-20'
  and not cancelled
  and note ilike '%pièce%'        -- ilike = like insensible à la casse (PostgreSQL)
order by work_date desc
limit 20;
```
Opérateurs : `=`, `<>`, `<`, `>=`, `between`, `in (…)`, `like`, `ilike`, `is null`, `is not null`, `and`, `or`, `not`.

> **NULL** n'est égal à rien, même pas à NULL : on écrit `is null`, jamais `= null`.

### 6.3 Les jointures

```sql
-- INNER JOIN : seulement les lignes qui ont une correspondance des deux côtés
select c.display_name, a.name as activite, d.hours
from declarations d
join collaborateurs c on c.user_id = d.user_id
join activites a      on a.id = d.activite_id
where d.work_date = current_date;

-- LEFT JOIN : toutes les lignes de gauche, même sans correspondance
-- (les déclarations hors production ont activite_id NULL : on les garde)
select d.hours, a.name as activite, h.label as hors_prod
from declarations d
left join activites a       on a.id = d.activite_id
left join hors_production h on h.id = d.hors_production_id;
```

| Jointure | Résultat |
|---|---|
| `INNER JOIN` | intersection |
| `LEFT JOIN` | tout à gauche + correspondances (NULL sinon) |
| `RIGHT JOIN` | tout à droite + correspondances |
| `FULL JOIN` | tout des deux côtés |
| `CROSS JOIN` | produit cartésien (toutes les combinaisons) |

**Trouver ce qui n'a pas de correspondance** (anti-jointure) :
```sql
-- Collaborateurs actifs qui n'ont rien déclaré aujourd'hui
select c.display_name
from collaborateurs c
left join declarations d
  on d.user_id = c.user_id and d.work_date = current_date and not d.cancelled
where c.active and d.id is null;
```

### 6.4 Agrégats et GROUP BY

Fonctions : `count`, `sum`, `avg`, `min`, `max`.

```sql
-- Heures déclarées par collaborateur cette semaine
select c.display_name, sum(d.hours) as total_heures, count(*) as nb_declarations
from declarations d
join collaborateurs c on c.user_id = d.user_id
where not d.cancelled
  and d.work_date >= date_trunc('week', current_date)
group by c.display_name
having sum(d.hours) < 39          -- HAVING filtre APRÈS le regroupement
order by total_heures;
```

> **Règle :** toute colonne du `SELECT` qui n'est pas dans une fonction d'agrégat doit être dans le `GROUP BY`.
> **WHERE vs HAVING :** `WHERE` filtre les **lignes** avant le regroupement ; `HAVING` filtre les **groupes** après.

**FILTER** (PostgreSQL) — agréger sous condition, utilisé dans ReproBench :
```sql
select o.id,
       coalesce(sum(d.hours) filter (where not d.cancelled), 0) as total_hours
from operations o
left join declarations d on d.operation_id = o.id
group by o.id;
```
`coalesce(x, 0)` remplace NULL par 0 (une machine sans déclaration a une somme NULL).

---

## 7. Requêtes avancées

### 7.1 Sous-requêtes
```sql
-- Le standard en vigueur pour une activité à une date (fonction standard_at du projet)
select hours_per_unit
from standards
where activite_id = '…uuid…' and valid_from <= '2026-11-23'
order by valid_from desc
limit 1;

-- Sous-requête avec EXISTS
select c.display_name from collaborateurs c
where exists (select 1 from operations o
              where o.user_id = c.user_id and o.status = 'pause');
```

### 7.2 CTE (WITH) — rendre une requête lisible
```sql
with semaine as (
  select user_id, sum(hours) as total
  from declarations
  where not cancelled and work_date >= date_trunc('week', current_date)
  group by user_id
)
select c.display_name, s.total, f.contract_hours,
       f.contract_hours - s.total as reste
from semaine s
join collaborateurs c   on c.user_id = s.user_id
join formats_horaires f on f.id = c.format_id;
```

### 7.3 Les vues
Une **vue** est une requête enregistrée, utilisée comme une table.
```sql
create view operations_avec_temps
with (security_invoker = true) as        -- la vue respecte les droits de l'utilisateur
select o.*,
       coalesce(sum(d.hours) filter (where not d.cancelled), 0)::numeric(6,2) as total_hours,
       max(d.work_date) filter (where not d.cancelled) as last_work_date
from operations o
left join declarations d on d.operation_id = o.id
group by o.id;
```
Avantages : simplifie le code client, centralise le calcul, peut masquer des colonnes.

### 7.4 Fonctions de fenêtrage (bonus apprécié)
```sql
-- Classement des collaborateurs par heures déclarées, sans perdre le détail
select display_name, total,
       rank() over (order by total desc) as rang
from (select c.display_name, sum(d.hours) as total
      from declarations d join collaborateurs c on c.user_id = d.user_id
      group by c.display_name) t;
```

---

## 8. Transactions et ACID

Une **transaction** est un groupe d'opérations exécuté **entièrement ou pas du tout**.

```sql
begin;
  insert into operations (user_id, activite_id, serial, status) values (…) returning id;
  insert into declarations (user_id, activite_id, operation_id, hours) values (…);
  update operations set status = 'final' where id = …;
commit;      -- ou rollback; pour tout annuler
```

| Lettre | Propriété | Explication |
|---|---|---|
| **A** | Atomicité | tout ou rien |
| **C** | Cohérence | la base passe d'un état valide à un autre état valide (contraintes respectées) |
| **I** | Isolation | les transactions simultanées ne se voient pas à moitié faites |
| **D** | Durabilité | une fois validée (`commit`), la donnée survit à une panne |

**Dans ReproBench** : la fonction `declare_machine_step` crée la machine, enregistre le temps et met à jour le statut **dans une seule transaction**. Si l'enregistrement du temps échoue (ex. 15 h saisies → refusé par le `CHECK`), la machine n'est pas créée non plus.

---

## 9. Index et performances

Un **index** est une structure (arbre B par défaut) qui accélère la recherche, comme l'index d'un livre.

```sql
create index declarations_user_date on declarations (user_id, work_date);
```
Cette requête, la plus fréquente de l'application, devient rapide :
```sql
select * from declarations where user_id = '…' and work_date = '2026-11-23';
```

**Index unique partiel** (règle métier + performance) :
```sql
create unique index operations_serial_etape_unique
  on operations (upper(serial), activite_id)
  where serial is not null and status in ('encours', 'pause', 'final');
```
→ un N° de série ne peut servir qu'une fois par étape, sauf si l'opération a été abandonnée ou annulée.

| ✅ Indexer | ❌ Éviter |
|---|---|
| clés étrangères, colonnes des `WHERE`, `JOIN`, `ORDER BY` fréquents | petites tables, colonnes rarement filtrées, trop d'index (chaque `INSERT` devient plus lent) |

**Analyser une requête** :
```sql
explain analyze select * from declarations where user_id = '…' and work_date = current_date;
```
`Seq Scan` = lecture de toute la table (lent sur de gros volumes) ; `Index Scan` = utilisation de l'index.

---

## 10. Programmer dans la base

### 10.1 Fonctions
```sql
-- Fonction SQL simple : la date du jour à l'heure de Paris (le serveur est en UTC)
create or replace function atelier_today()
returns date language sql stable as $$
  select (now() at time zone 'Europe/Paris')::date
$$;
```
- `stable` : même résultat pendant une requête (optimisation).
- `language plpgsql` : pour de la logique avec variables, `if`, boucles, exceptions.

### 10.2 Fonction appelée par le client (RPC)
```sql
create or replace function sign_week(p_monday date)
returns void language plpgsql security invoker as $$
begin
  if auth.uid() is null then raise exception 'Non connecté.'; end if;
  if extract(isodow from p_monday) <> 1 then raise exception 'Date de début de semaine invalide.'; end if;
  insert into validations_semaine (user_id, week_monday, signed_at)
  values (auth.uid(), p_monday, now())
  on conflict (user_id, week_monday) do update set signed_at = now()
    where validations_semaine.validated_at is null;
end $$;
```
Côté JavaScript : `await sb.rpc('sign_week', { p_monday: '2026-11-23' })`.

### 10.3 SECURITY INVOKER vs SECURITY DEFINER

| | S'exécute avec les droits de… | Usage |
|---|---|---|
| `security invoker` (défaut) | l'utilisateur qui appelle | cas général : les règles d'accès s'appliquent |
| `security definer` | le **propriétaire** de la fonction | lire une donnée protégée de façon contrôlée (ex. `is_responsable()`) — à utiliser avec prudence et `set search_path` |

### 10.4 Triggers (déclencheurs)
Un **trigger** exécute une fonction automatiquement `before`/`after` un `insert`/`update`/`delete`.

```sql
-- Le journal des modifications : qui, quand, avant → après
create or replace function journal_declarations()
returns trigger language plpgsql security definer as $$
begin
  if new is distinct from old then
    insert into journal (actor, user_id, table_name, row_id, action, before, after)
    values (auth.uid(), new.user_id, 'declarations', new.id,
            case when new.cancelled and not old.cancelled then 'annulation' else 'modification' end,
            to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;

create trigger declarations_journal
  after update on declarations
  for each row execute function journal_declarations();
```

| Trigger du projet | Règle métier garantie |
|---|---|
| `declarations_before_write` | recopie le standard ; interdit de changer le propriétaire ; interdit de réactiver une déclaration annulée |
| `operations_before_write` | motif obligatoire pour abandonner une machine ; une opération clôturée ne rouvre pas |
| `lock_validated_week` | semaine validée par le responsable = verrouillée |
| `journal_declarations` | traçabilité de chaque correction |
| `declarations_saisi_par` | enregistre qui a réellement saisi (impossible à falsifier) |

Dans un trigger : `NEW` = la ligne après modification, `OLD` = avant ; `TG_OP` = `'INSERT'`, `'UPDATE'` ou `'DELETE'`. Un `BEFORE` trigger peut **modifier** `NEW` ou **refuser** l'opération (`raise exception`).

> **Pourquoi des règles dans la base plutôt que dans le code ?** Elles s'appliquent quel que soit le client (navigateur, script, outil d'admin) et ne peuvent pas être contournées depuis les outils de développement du navigateur.

---

## 11. Sécurité des données

### 11.1 L'injection SQL (question quasi certaine)

**Code vulnérable** — la saisie est collée dans la requête :
```js
// ❌ NE JAMAIS FAIRE
const sql = "select * from users where login = '" + login + "' and password = '" + pwd + "'";
```
Si l'utilisateur tape `' or '1'='1` comme mot de passe → la condition est toujours vraie → connexion sans mot de passe.

**Parade : requêtes préparées / paramétrées** — la valeur est envoyée **séparément** de la requête, elle n'est jamais interprétée comme du SQL :
```js
// ✅ node-postgres
await client.query('select * from declarations where user_id = $1 and work_date = $2', [userId, date]);

// ✅ supabase-js (ReproBench) : le query builder paramètre automatiquement
await sb.from('declarations').select('*').eq('user_id', userId).eq('work_date', date);
```
Autres défenses : validation des entrées côté serveur (types, formats : `validId` vérifie qu'un identifiant est bien un UUID), principe du moindre privilège.

### 11.2 Le principe du moindre privilège — rôles et GRANT
```sql
revoke all on function declare_machine_step_for(uuid, uuid, uuid, text, uuid, numeric, text, boolean) from public, anon;
grant execute on function declare_machine_step_for(uuid, uuid, uuid, text, uuid, numeric, text, boolean) to authenticated;
grant select on operations_avec_temps to authenticated;
```
Rôles Supabase : `anon` (visiteur non connecté), `authenticated` (connecté), `service_role` (administrateur, côté serveur uniquement).

### 11.3 Row Level Security (RLS) — la sécurité ligne par ligne
Le contrôle d'accès est fait **par la base, pour chaque ligne**.
```sql
alter table declarations enable row level security;

-- Lecture : ses propres lignes, ou tout si responsable
create policy declarations_select on declarations
  for select using (user_id = auth.uid() or is_responsable());

-- Création : seulement pour soi, pas dans le futur, dans le délai de correction
create policy declarations_insert_own on declarations
  for insert with check (user_id = auth.uid() and not cancelled
                         and work_date >= correction_floor() and work_date <= atelier_today());
```
- `using (…)` : quelles lignes existantes l'utilisateur peut **voir / modifier**.
- `with check (…)` : quelles lignes il a le droit **d'écrire**.
- `auth.uid()` : l'identifiant extrait du **jeton JWT signé** → impossible à falsifier depuis le navigateur.

> **Démonstration à faire devant le jury :** connecté en technicien, tenter `insert` avec le `user_id` d'un collègue → `new row violates row-level security policy`.

### 11.4 Mots de passe
- Jamais stockés en clair : **hachés** avec un algorithme lent et salé (**bcrypt**, géré par Supabase Auth).
- Protection contre la force brute : table `login_guard` (5 échecs → blocage 15 min, puis 30, 60… : backoff exponentiel), accessible uniquement côté serveur.
- Mot de passe provisoire → changement obligatoire à la première connexion.

### 11.5 Secrets
- La clé `service_role` est stockée **uniquement** dans les variables d'environnement Vercel, jamais dans le code ni dans Git.
- La clé publique (`anon`) peut être exposée : elle ne donne que ce que les policies RLS autorisent.

### 11.6 RGPD
Minimisation des données, accès limité (chacun ne voit que ses données), traçabilité, droit à l'effacement (fonction de purge complète d'un collaborateur), hébergement des données dans l'UE.

---

## 12. Composants d'accès aux données

Un **composant d'accès aux données** isole le code qui parle à la base (couche « DAO » / « repository »). Le reste de l'application ne manipule pas de SQL directement.

### Avec supabase-js (front ReproBench)
```js
// Lecture avec filtres
const { data, error } = await sb.from('declarations')
  .select('*')
  .eq('user_id', uid)
  .eq('work_date', today)
  .order('created_at');

// Insertion, en récupérant la ligne créée
const r = await sb.from('declarations')
  .insert({ user_id: uid, activite_id, quantity, hours, note })
  .select().single();

// Appel d'une fonction SQL (transaction)
const { data: id, error: e } = await sb.rpc('declare_machine_step', { p_activite, p_operation, p_serial, p_model, p_hours, p_note, p_finalize });
```

### Gestion des erreurs : traduire les codes PostgreSQL
```js
function dbError(error){
  if (error.code === '23505') return 'Ce N° de série est déjà enregistré pour cette étape.';   // unique_violation
  if (error.code === '42501') return 'Enregistrement refusé : le délai de correction est peut-être dépassé.'; // RLS
  return error.message;
}
```
| Code SQLSTATE | Signification |
|---|---|
| `23505` | violation d'unicité |
| `23503` | violation de clé étrangère |
| `23514` | violation d'une contrainte `CHECK` |
| `23502` | `NOT NULL` violé |
| `42501` | droits insuffisants (RLS) |

### Équivalent avec Node.js + `pg` (à savoir écrire au tableau)
```js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function declarationsDuJour(userId, date) {
  const { rows } = await pool.query(
    'select * from declarations where user_id = $1 and work_date = $2 and not cancelled order by created_at',
    [userId, date]
  );
  return rows;
}
```

---

## 13. Composants métier côté serveur

Dans ReproBench, une fonction serverless Node.js gère ce qui exige des **droits administrateur**.

### Exemple : la connexion protégée (`api/login.js`, simplifié)
```js
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
  const { login, password } = req.body || {};
  if (typeof login !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Champs manquants.' });

  const guard = await lireCompteurEchecs(login);                 // table login_guard
  if (guard && guard.locked_until > new Date()) return res.status(423).json({ error: 'Compte bloqué.' });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) { await incrementerEchecs(login); return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' }); }

  await effacerEchecs(login);
  return res.status(200).json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
};
```

### Contrôle d'accès commun aux routes d'administration
1. Méthode `POST` uniquement → sinon **405**
2. Jeton `Authorization: Bearer <JWT>` présent → sinon **401**
3. L'appelant est-il administrateur ? → sinon **403**
4. Un admin « simple » ne peut pas agir sur un autre admin (empêche la prise de contrôle d'un compte)
5. Alors seulement : client avec la clé `service_role`

### Codes HTTP à connaître
| Code | Sens |
|---|---|
| 200 / 201 | OK / créé |
| 400 | requête invalide |
| 401 | non authentifié |
| 403 | authentifié mais interdit |
| 404 | introuvable |
| 405 | méthode non autorisée |
| 409 | conflit (doublon) |
| 423 | ressource verrouillée |
| 500 / 503 | erreur serveur / service indisponible |

---

## 14. Documenter le déploiement

Compétence évaluée à part entière. Plan type d'une documentation de déploiement :

1. **Prérequis** : compte GitHub, compte Vercel, projet Supabase.
2. **Base de données** : exécuter dans l'ordre les scripts `supabase/*.sql` dans le SQL Editor (idempotents, rejouables).
3. **Variables d'environnement** (Vercel) : `SUPABASE_SERVICE_ROLE_KEY` (secret).
4. **Déploiement continu** : `push` sur une branche → Pull Request → déploiement de **prévisualisation** (URL de test) → fusion sur `main` → **production**.
5. **Vérifications après déploiement** : connexion, déclaration test, état du déploiement sur Vercel.
6. **Sauvegarde / restauration** : sauvegardes automatiques Supabase ; export manuel :
   ```bash
   pg_dump "$DATABASE_URL" > sauvegarde.sql
   psql "$DATABASE_URL" < sauvegarde.sql
   ```
7. **Retour arrière** : redéployer la version précédente depuis Vercel (« Promote to production »).
8. **Sécurité** : en-têtes HTTP (`X-Frame-Options`, `nosniff`, CSP), HTTPS automatique.

---

## 15. Exercices corrigés

> Faites-les sur papier d'abord, puis vérifiez. Schéma : section 2.4.

**Ex. 1** — Lister les activités du métier `TECH` qui demandent un matricule, triées par nom.
```sql
select name from activites
where metier_id = 'TECH' and requires_machine
order by name;
```

**Ex. 2** — Nombre de déclarations non annulées par jour sur les 7 derniers jours.
```sql
select work_date, count(*) as nb
from declarations
where not cancelled and work_date >= current_date - 6
group by work_date
order by work_date;
```

**Ex. 3** — Total d'heures par collaborateur (nom affiché) pour le mois en cours.
```sql
select c.display_name, sum(d.hours) as heures
from declarations d
join collaborateurs c on c.user_id = d.user_id
where not d.cancelled and d.work_date >= date_trunc('month', current_date)
group by c.display_name
order by heures desc;
```

**Ex. 4** — Les machines en attente (`pause`) depuis plus de 3 jours, avec le nom du collaborateur.
```sql
select o.serial, c.display_name, o.started_on
from operations o
join collaborateurs c on c.user_id = o.user_id
where o.status = 'pause' and o.started_on < current_date - 3
order by o.started_on;
```

**Ex. 5** — Les collaborateurs actifs sans aucune déclaration aujourd'hui (anti-jointure).
```sql
select c.display_name
from collaborateurs c
where c.active
  and not exists (select 1 from declarations d
                  where d.user_id = c.user_id and d.work_date = current_date and not d.cancelled);
```

**Ex. 6** — Les jours où un collaborateur a déclaré plus de 8 h (HAVING).
```sql
select user_id, work_date, sum(hours) as total
from declarations
where not cancelled
group by user_id, work_date
having sum(hours) > 8;
```

**Ex. 7** — Efficience par activité : temps théorique (quantité × standard) / temps réel.
```sql
select a.name,
       sum(d.quantity * d.std_value) as theorique,
       sum(d.hours) as reel,
       round(sum(d.quantity * d.std_value) / nullif(sum(d.hours), 0), 2) as efficience
from declarations d
join activites a on a.id = d.activite_id
where not d.cancelled and d.std_value is not null and d.operation_id is null
group by a.name;
```
`nullif(x, 0)` évite la division par zéro (renvoie NULL si x = 0).

**Ex. 8** — Ajouter une contrainte : une note fait au maximum 500 caractères.
```sql
alter table declarations add constraint note_longueur check (length(note) <= 500);
```

**Ex. 9** — Créer une table `pannes` (une machine peut avoir plusieurs pannes ; une panne a un type et une description).
```sql
create table pannes (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references operations(id) on delete cascade,
  type text not null check (type in ('mécanique', 'électronique', 'logiciel')),
  description text,
  created_at timestamptz not null default now()
);
create index pannes_operation on pannes (operation_id);
```

**Ex. 10** — Écrire la policy : chacun ne voit que les pannes de **ses** machines, le responsable voit tout.
```sql
alter table pannes enable row level security;
create policy pannes_select on pannes for select using (
  is_responsable()
  or exists (select 1 from operations o where o.id = pannes.operation_id and o.user_id = auth.uid())
);
```

**Ex. 11** — Trigger : passer automatiquement le N° de série en majuscules.
```sql
create or replace function serial_majuscules() returns trigger language plpgsql as $$
begin
  new.serial := upper(trim(new.serial));
  return new;
end $$;
create trigger operations_serial_maj before insert or update on operations
  for each row execute function serial_majuscules();
```

**Ex. 12** — Transaction : transférer une machine d'un collaborateur à un autre et tracer l'action ; tout annuler en cas d'erreur.
```sql
begin;
  update operations set user_id = '…nouveau…' where id = '…op…';
  insert into journal (actor, user_id, table_name, row_id, action) values (auth.uid(), '…nouveau…', 'operations', '…op…', 'transfert');
commit;
```
*(Dans ReproBench, ce transfert est volontairement interdit par un trigger : « le collaborateur d'une opération ne peut pas changer ». Savoir le dire est un plus.)*

**Ex. 13** — Expliquer la différence entre ces deux requêtes.
```sql
select count(*) from declarations;          -- compte toutes les lignes
select count(note) from declarations;       -- compte les lignes où note n'est PAS NULL
```

**Ex. 14** — Repérer la faille et la corriger.
```js
app.get('/declarations', async (req, res) => {
  const r = await pool.query(`select * from declarations where user_id = '${req.query.user}'`);
  res.json(r.rows);
});
```
Deux failles : **injection SQL** (concaténation) et **contrôle d'accès absent** (n'importe qui lit les données de n'importe qui). Correction : requête paramétrée (`$1`) **et** `user_id` pris dans le jeton authentifié, pas dans l'URL.

**Ex. 15** — Normaliser : une table `commandes(id, client_nom, client_email, produit1, produit2, produit3, total)`.
Solution : `clients(id, nom, email)`, `produits(id, libelle, prix)`, `commandes(id, #client_id, date)`, `lignes_commande(#commande_id, #produit_id, quantite)` ; le `total` se **calcule** (pas stocké, sinon dépendance transitive), sauf choix justifié d'historiser le prix.

---

## 16. Questions du jury (et réponses courtes)

1. **Pourquoi une base relationnelle ?** Les données sont fortement liées (collaborateur → déclarations → machines → modèles) ; il faut des garanties d'intégrité (clés étrangères, contraintes) et des transactions.
2. **Différence entre clé primaire et clé étrangère ?** La clé primaire identifie une ligne de façon unique ; la clé étrangère référence la clé primaire d'une autre table et garantit que la référence existe.
3. **Comment empêchez-vous l'injection SQL ?** Requêtes paramétrées (query builder supabase-js), validation des entrées côté serveur, moindre privilège.
4. **Où est le back-end si le navigateur parle directement à la base ?** Dans la base (RLS, contraintes, triggers, fonctions transactionnelles), dans les fonctions serverless (opérations administrateur) et dans le service d'authentification (JWT).
5. **Qu'est-ce que RLS ?** Des règles d'accès évaluées par PostgreSQL pour chaque ligne, basées sur l'utilisateur identifié par son jeton.
6. **Qu'est-ce qu'une transaction ? Exemple ?** Un ensemble d'opérations tout-ou-rien (ACID) ; exemple : `declare_machine_step`.
7. **Pourquoi ne supprimez-vous jamais une déclaration ?** Traçabilité et obligations liées au temps de travail : on annule, et le journal conserve l'historique.
8. **À quoi sert un index ? Inconvénient ?** Accélérer les recherches ; ralentit les écritures et occupe de l'espace.
9. **Expliquez la 3FN avec votre projet.** Le standard dépend de l'activité, pas de la déclaration → table `standards`. Exception assumée : `std_value` historisé.
10. **Comment sont stockés les mots de passe ?** Hachés (bcrypt) par Supabase Auth ; jamais en clair ; protection contre la force brute.
11. **WHERE ou HAVING ?** `WHERE` avant le regroupement (lignes), `HAVING` après (groupes).
12. **Comment déployez-vous une modification de la base ?** Script SQL idempotent versionné dans Git, exécuté dans le SQL Editor, testé auparavant sur un PostgreSQL local.
13. **Comment avez-vous testé ?** Scripts SQL de test sur PostgreSQL local (accès refusés attendus), tests de bout en bout Playwright, environnement de prévisualisation.
14. **Que se passe-t-il si deux personnes saisissent le même N° de série en même temps ?** L'index unique garantit qu'une seule insertion réussit ; l'autre reçoit l'erreur `23505`, traduite en message clair.

---

## 17. Anglais technique (questionnaire professionnel)

L'épreuve : lire une documentation technique en anglais, répondre à 2 questions en anglais (réponses courtes).

### Vocabulaire
| Anglais | Français |
|---|---|
| table, row, column | table, ligne, colonne |
| primary key / foreign key | clé primaire / clé étrangère |
| constraint | contrainte |
| query / to query | requête / interroger |
| to insert / update / delete | insérer / modifier / supprimer |
| join | jointure |
| index | index |
| transaction, rollback, commit | transaction, annulation, validation |
| trigger | déclencheur |
| stored procedure / function | procédure stockée / fonction |
| policy / row level security | règle / sécurité au niveau des lignes |
| to grant / to revoke | accorder / retirer (un droit) |
| prepared statement | requête préparée |
| SQL injection | injection SQL |
| hashed password | mot de passe haché |
| environment variable | variable d'environnement |
| deployment | déploiement |
| backup / restore | sauvegarde / restauration |
| deprecated | obsolète (à ne plus utiliser) |
| default value | valeur par défaut |
| nullable | qui peut être NULL |

### Exemple d'exercice
> *Documentation : "Row Level Security policies are applied to every query. A `USING` expression filters which existing rows are visible, while a `WITH CHECK` expression validates rows being inserted or updated. If no policy exists for a table with RLS enabled, no rows are visible."*

**Q1. What is the difference between USING and WITH CHECK?**
→ *USING filters the existing rows a user can see or modify; WITH CHECK validates the new rows a user tries to insert or update.*

**Q2. What happens if RLS is enabled but there is no policy?**
→ *No rows are visible: access is denied by default.*

### Tournures utiles
- *It is used to…* (Il sert à…)
- *This prevents…* (Cela empêche…)
- *By default, …* (Par défaut, …)
- *You must… / You should not…*

Entraînement : lire 10 minutes par jour la documentation officielle de PostgreSQL ou de Supabase (en anglais) et résumer un paragraphe en une phrase anglaise.

---

## 18. Glossaire

- **SGBD/SGBDR** : système de gestion de base de données (relationnelle) — PostgreSQL, MySQL.
- **DDL / DML / DQL / DCL** : définition / manipulation / interrogation / contrôle des droits (`GRANT`, `REVOKE`).
- **Cardinalité** : nombre minimum et maximum de participations à une association.
- **Intégrité référentielle** : toute clé étrangère pointe vers une ligne existante.
- **Idempotent** : rejouable sans effet supplémentaire.
- **JWT** : jeton signé qui prouve l'identité de l'utilisateur.
- **RPC** : appel d'une fonction de la base depuis le client.
- **Serverless** : code exécuté à la demande sans gérer de serveur.
- **ORM** : outil qui traduit des objets en SQL (Prisma, Sequelize). ReproBench utilise un *query builder* (supabase-js), plus proche du SQL.
- **Seeds / migrations** : données de départ / scripts de modification du schéma versionnés.

---

## 19. Planning de révision (2 semaines)

| Jour | Sujet | Action |
|---|---|---|
| 1 | Merise | Refaire le MCD de ReproBench de mémoire |
| 2 | MCD → MLD | Appliquer les règles de passage, puis comparer au vrai schéma |
| 3 | Normalisation | Normaliser l'Ex. 15 + expliquer la dénormalisation de `std_value` |
| 4 | DDL & contraintes | Écrire `declarations` de mémoire avec toutes ses contraintes |
| 5 | SELECT, WHERE, ORDER | Ex. 1, 2, 13 |
| 6 | Jointures | Ex. 3, 4, 5 |
| 7 | GROUP BY / HAVING | Ex. 6, 7 |
| 8 | Transactions & index | Expliquer ACID à voix haute + Ex. 12 |
| 9 | Fonctions & triggers | Ex. 11 + expliquer `declarations_before_write` |
| 10 | Sécurité | Ex. 10, 14 + démonstration RLS |
| 11 | Serveur & HTTP | Réexpliquer `api/login.js` et les codes HTTP |
| 12 | Déploiement | Rédiger sa documentation de déploiement (section 14) |
| 13 | Anglais | Section 17 + 2 lectures de documentation |
| 14 | Oral blanc | Présentation 20 min chronométrée + les 14 questions de la section 16 |
