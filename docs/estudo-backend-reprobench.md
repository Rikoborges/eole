# ReproBench: o back-end, para estudar e apresentar

> Material de estudo para a apresentação do diploma Full Stack, parte back-end.
> Tudo aqui vem do código real do projeto (repositório `eole`), que está em produção em `eole-reco.vercel.app`.

---

## 1. O projeto em uma frase

**ReproBench** é uma aplicação web usada num atelier de recondicionamento de impressoras na França. Cada técnico declara o tempo passado em cada tarefa e máquina. O responsável acompanha a produtividade, valida as fichas semanais e corrige erros.

**Problema resolvido:** antes, tudo era feito numa ficha Excel preenchida de memória no fim do dia. Agora os dados entram na hora, são verificados pelo banco e ficam rastreáveis.

---

## 2. Arquitetura (o desenho para mostrar no slide)

```
 Navegador (PWA)                     Vercel                          Supabase
 HTML/CSS/JS puro   ── HTTPS ──>  Funções serverless (Node)  ──>  Auth (login, JWT)
 supabase-js                      /api/login                      PostgreSQL
   │                              /api/create-technician            ├─ tabelas
   │                              /api/reset-password               ├─ RLS (quem vê o quê)
   │                              /api/delete-collaborator          ├─ triggers (regras)
   │                              /api/list-technicians             └─ funções RPC
   └────────── leitura/escrita direta, protegida por RLS ────────>  Realtime (painel ao vivo)
```

**Ideia central para dizer ao júri:**
> "A segurança não depende do front. O navegador fala direto com o banco, mas o **PostgreSQL decide** o que cada um pode ler e escrever, com Row Level Security. O pouco que exige privilégio de administrador passa por funções serverless que guardam a chave secreta."

### Por que essa arquitetura?

| Escolha | Motivo | Alternativa que descartei |
|---|---|---|
| **Supabase** (Postgres gerenciado) | Banco relacional de verdade, auth pronto, RLS, gratuito para o porte | Firebase (NoSQL, regras mais fracas para dados relacionais) |
| **Regras no banco** (triggers, RLS) | Valem para qualquer cliente, não dá para contornar pelo DevTools | Validar só no JS do front (inseguro) |
| **Vercel Functions** | Só 6 rotas precisam de privilégio. Não precisa manter um servidor Express rodando 24 h | API Node/Express completa (mais custo e manutenção) |
| **JS puro no front** | Leve, rápido no PC velho do atelier | React (desnecessário para o porte) |

---

## 3. Modelo de dados (as tabelas principais)

```
auth.users (Supabase)      ← conta de login
   │ 1:1
collaborateurs             ← ficha: nome, métier, format horário (37 h/39 h), role (collaborateur | responsable), active
   │ 1:N
operations                 ← uma máquina numa etapa: serial (matrícula), modelo, status (encours | pause | final | abandon | annulee)
   │ 1:N
declarations               ← uma linha de tempo: dia, atividade OU hors-production, quantidade, horas, nota, cancelled, saisi_par

activites, standards       ← catálogo de tarefas + tempo-padrão (histórico por data: valid_from)
printer_models             ← modelos de impressora
validations_semaine        ← assinatura do técnico + validação do responsável (trava a semana)
journal                    ← histórico de modificações (quem, quando, antes → depois)
login_guard                ← tentativas de senha erradas (anti força-bruta)
chronos_user, inbox_vus    ← estado do cronômetro e da caixa "À traiter"
```

**Pontos de modelagem para explicar:**
- **Nunca se apaga uma declaração:** ela é anulada (`cancelled = true`). Isso preserva o histórico, o que é exigência trabalhista na França.
- **O tempo-padrão é copiado** para a declaração (`std_value`) no momento do registro. Se o padrão mudar amanhã, os cálculos antigos não mudam.
- **Restrição de unicidade parcial:** um número de série só pode ser usado uma vez por etapa. Máquinas abandonadas ou anuladas ficam fora dessa regra.
  ```sql
  create unique index operations_serial_etape_unique
    on operations (upper(serial), activite_id)
    where serial is not null and status in ('encours','pause','final');
  ```
- **CHECK constraints:** `hours > 0 and hours <= 12`, e é obrigatório ter uma atividade **ou** um motivo hors-production, nunca os dois:
  ```sql
  constraint declaration_activite_ou_hp check ((activite_id is null) <> (hors_production_id is null))
  ```

---

## 4. Segurança: Row Level Security (o coração do back)

Com RLS, cada `SELECT`, `INSERT` ou `UPDATE` passa por uma **policy**. O banco sabe quem está conectado pela função `auth.uid()`, que lê o JWT.

```sql
-- Cada um vê o que é seu; o responsável vê tudo
create policy declarations_select on declarations
  for select using (user_id = auth.uid() or is_responsable());

-- O técnico só cria para si mesmo, nunca no futuro, e só dentro do prazo de correção
create policy declarations_insert_own on declarations
  for insert with check (user_id = auth.uid() and not cancelled
                         and work_date >= correction_floor() and work_date <= atelier_today());
```

**`correction_floor()`** é uma regra configurável pelo responsável: o técnico pode corrigir só no mesmo dia, por 24 h, durante a semana ou por 7 dias. A regra fica numa tabela e o banco aplica.

**`is_responsable()`** é `security definer`: roda com os direitos do dono da função. Isso evita um loop infinito, porque a policy da tabela `collaborateurs` precisaria consultar a própria `collaborateurs`.

### As duas chaves do Supabase (pergunta clássica de banca)

| Chave | Onde fica | O que pode |
|---|---|---|
| `anon` / publishable | No front, pública | Só o que as policies RLS permitem |
| `service_role` | **Só** nas variáveis de ambiente da Vercel | Ignora o RLS (é "root") |

> "A chave pública pode vazar sem problema, porque o RLS protege os dados. A chave `service_role` nunca vai para o navegador nem para o Git."

---

## 5. Regras de negócio no banco (triggers)

Um **trigger** é uma função que roda automaticamente antes ou depois de um INSERT/UPDATE. Exemplos reais do projeto:

| Trigger | O que garante |
|---|---|
| `declarations_before_write` | Copia o tempo-padrão; proíbe mudar o dono de uma declaração; proíbe "ressuscitar" uma declaração anulada; registra quem anulou |
| `declarations_after_cancel` | Se a última declaração de uma máquina é anulada, a máquina volta para "em espera" |
| `operations_before_write` | Exige um motivo para abandonar uma máquina; uma operação fechada não reabre |
| `lock_validated_week` | Depois que o responsável valida a semana, o técnico não consegue mais mexer |
| `journal_declarations` | Grava cada correção no histórico (antes → depois), e ninguém pode apagar o histórico |
| `declarations_saisi_par` | Grava quem digitou de verdade (`auth.uid()`), mesmo que o front envie outro valor |

Exemplo simples para mostrar:
```sql
create or replace function declarations_saisi_par()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then new.saisi_par := auth.uid();   -- impossível falsificar
  else new.saisi_par := old.saisi_par; end if;            -- e impossível alterar depois
  return new;
end $$;
```

---

## 6. Funções RPC (transações)

Algumas ações mexem em várias tabelas ao mesmo tempo. Elas viram uma **função SQL chamada pelo front** (`sb.rpc(...)`), que roda numa **transação única**: ou tudo dá certo, ou nada é gravado.

`declare_machine_step`, em uma única chamada:
1. cria a operação (a máquina), se for nova;
2. grava a declaração de tempo do dia;
3. marca a máquina como finalizada ou em espera.

```js
// front
await sb.rpc('declare_machine_step', { p_activite, p_operation, p_serial, p_model, p_hours, p_note, p_finalize });
```

Ela é `security invoker`: roda com os direitos de quem chama, então as policies RLS continuam valendo.

Outras RPC do projeto: `sign_week`, `validate_week`, `unvalidate_week`, `lookup_serial`, `declare_machine_step_for`.

---

## 7. API serverless (Vercel Functions, Node.js)

Só existe API própria para o que **precisa da chave service_role**:

| Rota | Função |
|---|---|
| `POST /api/login` | Login com limite de tentativas (anti força-bruta) |
| `POST /api/create-technician` | Criar conta (só admin) |
| `POST /api/reset-password` | Gerar senha provisória (só admin) |
| `POST /api/delete-collaborator` | Desativar, ou apagar tudo (só admin) |
| `POST /api/list-technicians` | Listar contas com e-mail (só admin) |

### Padrão de cada rota admin (`api/_auth.js`)
1. Aceita só `POST`; outro método recebe **405**.
2. Lê o token `Authorization: Bearer <JWT>`. Sem token: **401**.
3. Pergunta ao Supabase quem é o usuário e se é admin. Se não for: **403**.
4. Só então cria o cliente com `service_role` e executa.
5. Um admin "por ficha" (o Marc) não consegue agir sobre outro admin (`canActOn`). Isso impede que alguém tome a conta de outro admin trocando a senha dele.

### Login anti força-bruta (`api/login.js`)
- 5 senhas erradas seguidas bloqueiam a conta por 15 min. Os bloqueios seguintes duram 30 min, depois 60 min, e assim por diante (**backoff exponencial**), até no máximo 24 h.
- O contador fica na tabela `login_guard`, que **não tem nenhuma policy**: só o servidor consegue ler e escrever nela.
- Se o login dá certo, o servidor devolve `access_token` e `refresh_token`, e o front instala a sessão com `setSession()`.
- Códigos HTTP usados: 400, 401, 405, 423 (*Locked*) e 503.

---

## 8. Outras camadas de segurança

- **Cabeçalhos HTTP** (`vercel.json`): `X-Frame-Options: DENY` (contra clickjacking), `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
- **CSP** (Content-Security-Policy): o navegador só carrega scripts do próprio site e de uma CDN autorizada.
- **SRI** (Subresource Integrity): o script da CDN tem um hash `sha384`. Se alguém alterar o arquivo lá, o navegador recusa.
- **XSS:** todo texto do usuário passa por `escapeHtml()` antes de entrar no HTML.
- **Senha provisória obrigatória:** no primeiro login a pessoa é forçada a escolher a própria senha.
- **RGPD:** o cronômetro nunca liga sozinho (sem vigilância escondida), e os dados ficam na UE.

---

## 9. Tempo real e offline

- **Supabase Realtime:** o painel do responsável atualiza sozinho quando um técnico declara (publicação `supabase_realtime` nas tabelas `declarations` e `operations`).
- **PWA:** o *service worker* (`sw.js`) guarda os arquivos em cache. O app pode ser instalado no celular, e uma faixa avisa quando a internet cai.

---

## 10. Testes (mostra profissionalismo)

| Nível | Como |
|---|---|
| **Banco** | PostgreSQL 16 local com o mesmo schema. Scripts SQL testam as policies: o técnico **não consegue** declarar para outro, o `saisi_par` não pode ser falsificado, a semana validada fica travada |
| **Interface (e2e)** | Playwright com um Supabase falso em memória. Cerca de 15 suítes cobrem login, declaração, cronômetro, ficha da semana, admin e FAQ |
| **Produção** | Cada pull request gera um deploy de pré-visualização na Vercel antes de ir para o ar |

---

## 11. Fluxo de trabalho / deploy (CI/CD)

```
branch de desenvolvimento → commit → push → Pull Request no GitHub
   → Vercel gera um deploy de pré-visualização (link de teste)
   → merge na main → Vercel publica em produção (eole-reco.vercel.app)
SQL novo → arquivo idempotente em supabase/*.sql → executado no SQL Editor
```

**Idempotente** quer dizer que dá para rodar o mesmo SQL várias vezes sem quebrar nada (`create table if not exists`, `drop policy if exists`, `on conflict do nothing`).

---

## 12. Perguntas prováveis do júri (com resposta curta)

1. **"Onde está o seu back-end, se o front fala direto com o banco?"**
   O back-end está em três lugares: no PostgreSQL (RLS, triggers e RPC, que concentram as regras de negócio), nas funções serverless da Vercel (as operações privilegiadas) e no Supabase Auth (JWT).

2. **"O que impede um usuário de mudar o `user_id` pelo DevTools?"**
   A policy `with check (user_id = auth.uid())`. O `auth.uid()` vem do JWT assinado, e o usuário não consegue forjar isso.

3. **"Por que não um Express/NestJS?"**
   Porque seriam poucas rotas privilegiadas. As funções serverless custam zero quando não são usadas e não precisam de servidor para manter. As regras ficam no banco e valem para qualquer cliente.

4. **"Como você garante a integridade dos dados?"**
   Com constraints (CHECK, UNIQUE parcial, FK), com triggers, com transações nas RPC e com a regra de nunca apagar (anular + journal).

5. **"E se a chave service_role vazar?"**
   Ela fica só na Vercel e nunca no código. Se vazar: gero uma chave nova no Supabase, atualizo a variável na Vercel e faço um novo deploy.

6. **"Como fica o RGPD?"**
   Cada um vê só os próprios dados. As "horas de conexão" ficam ocultas e só o responsável vê. O cronômetro é opcional. A conta pode ser apagada por completo (purge).

7. **"Como você testou?"**
   Com testes SQL num Postgres local e com testes e2e Playwright (seção 10).

8. **"Qual foi a maior dificuldade?"**
   Sugestão: a importação do histórico do sistema antigo (dados só com quantidade), ou o cronômetro sincronizado entre aparelhos sem nunca ligar sozinho.

---

## 13. Plano de estudo (7 dias)

| Dia | Estudar | Exercício prático |
|---|---|---|
| 1 | SQL básico: tabelas, FK, CHECK, UNIQUE | Ler `supabase/atelier-schema.sql`, seção 3, e desenhar o diagrama das tabelas |
| 2 | Autenticação e JWT | Explicar com suas palavras o caminho do `api/login.js` |
| 3 | **RLS** | No SQL Editor: entrar como técnico e tentar ler a declaração de outro (deve vir vazio) |
| 4 | Triggers | Ler `declarations_before_write` e explicar cada `if` |
| 5 | RPC e transações | Explicar `declare_machine_step`: por que ser uma função só? |
| 6 | Serverless + HTTP (status 401/403/405/423) | Desenhar o fluxo de `requireAdmin` |
| 7 | Ensaio | Fazer o pitch em voz alta (seção 14) e responder às perguntas da seção 12 sem olhar |

---

## 14. Pitch de 3 minutos (em francês, para a apresentação)

> **Contexte.** ReproBench remplace la fiche Excel de l'atelier de reconditionnement d'imprimantes. Chaque technicien déclare son temps par tâche et par machine ; le responsable suit la production et valide les semaines.
>
> **Architecture.** Le front est une PWA en JavaScript. Le back repose sur **Supabase**, c'est-à-dire PostgreSQL avec authentification JWT, et sur des **fonctions serverless Vercel** en Node.js pour les opérations d'administration.
>
> **Sécurité.** La règle principale : *le serveur ne fait jamais confiance au client*. Chaque requête passe par des **policies Row Level Security** : un technicien ne voit et ne modifie que ses propres données, dans un délai de correction paramétrable. La clé administrateur `service_role` n'existe que côté serveur. La connexion est protégée contre la force brute (blocage progressif, code HTTP 423).
>
> **Intégrité.** Les règles métier sont dans la base : triggers, contraintes et fonctions transactionnelles. Rien n'est supprimé : on annule, et un journal garde chaque modification (qui, quand, avant, après). Une semaine validée est verrouillée.
>
> **Qualité.** Tests SQL sur PostgreSQL local, tests de bout en bout avec Playwright, déploiement continu GitHub → Vercel avec un environnement de prévisualisation.
>
> **Résultat.** L'application est en production et utilisée chaque jour par l'atelier.
