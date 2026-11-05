# ReproBench

App de apoio para trabalho de reconditionnement (recondicionamento) de
impressoras e copiadoras: referência de peças, acompanhamento diário de
serviço, análise de indicadores e uma visão geral para administradores.

Interface em francês (idioma de trabalho), com nomes/legendas em PT/EN nas
peças. Roda direto no navegador, sem instalação — é um site estático
(HTML + CSS + JS puro) com banco de dados na nuvem (Supabase).

---

## Funcionalidades

### 🧑‍🔧 / 🧭 Modo Collaborateur e modo Responsable
Cabeçalho compacto com o nome do app e, **só para quem é responsable**, o
botão **Collaborateur / Responsable**. Abas do collaborateur: Saisir ·
Ma semaine · Suivi · Pièces. Abas do responsable: Atelier · Opérations ·
Collaborateurs · Activités · Machines · Paramètres. A criação de contas fica
em Paramètres › Collaborateurs (só admins). O modo escolhido fica guardado no
navegador; um responsable abre em modo Responsable.

### ✍️ Saisir (Declarar) — nova aba principal
Tela de declaração de atividade do cahier des charges (precisa do
`supabase/atelier-schema.sql`). Em 5 passos: atividade → quantidade (ou
N° de série + modelo, com busca 🔍) → tempo (botões rápidos ou "1h30",
"45 min") → status → validar. Mostra o objetivo do dia segundo o formato
37 h / 39 h e o "reste à déclarer". Etapas com matricule: 1 matricule = 1
quantidade, contada só na finalização; podem ficar "à poursuivre" e ser
retomadas em outro dia ("Mes étapes en cours"). O mesmo N° de série não
pode ser lançado duas vezes na mesma etapa. Dias anteriores consultáveis
(‹ ›); correção só dentro do prazo definido pelo responsável; uma
declaração nunca é apagada, só anulada (fica riscada). Código em `saisie.js`.

### 📅 Semaine — Ma fiche + Mes résultats
**Ma fiche**: a ficha do Excel da semana, preenchida sozinha a partir das
declarações (atividade × dia, horas e quantidades, objetivo, "reste à
déclarer"), com ‹ › para as semanas anteriores. **Mes résultats**: attendu,
déclaré, hors production, théorique, écart e efficience (semana, 4 ou 8
semanas), pontos de maîtrise por atividade (mínimo 5 operações, tendência
↗ → ↘) e gráfico de efficience das 8 últimas semanas. Etapas com
matricule contam só quando finalizadas, com o tempo somado de todos os
dias. Se o responsável desligar "resultats_visibles", o collaborateur vê
só a ficha. Código em `semaine.js`.

### 🧭 Pilotage (só para o Responsable des Ateliers)
Aba que só aparece para quem é responsable (`is_responsable()`: os admins +
quem tiver o direito "responsable" na ficha). Cinco visões:
- **Atelier**: período (semana com ‹ ›, 4 ou 8 semanas), filtros métier e
  37 h / 39 h, os números do cahier des charges, tabela da equipe
  (clicável), "Où passe le temps", alertas (tempo incompleto ou acima,
  matricule/modelo faltando, étape parada há 2 dias úteis ou mais, fichas
  sem métier/formato), atividade ao vivo (Realtime) e exports Excel
  (détail, par collaborateur, par activité, opérations).
- **Opérations**: étapes com matricule em curso / finalizadas / encerradas;
  "Clôturer : abandonnée" ou "Supprimer" (= anular e arquivar) com motivo
  obrigatório ("Autre" exige comentário). Nada é apagado.
- **Collaborateurs**: resultados de uma pessoa, pontos de maîtrise,
  tendência, étapes em curso, alertas e horário de conexão (escondido).
- **Activités**: melhores resultados e maiores écarts por étape, filtro
  por marca de máquina, em curso e abandonos.
- **Machines**: rastreabilidade por N° de série, tempo dia a dia e total.

- **Paramètres**: tudo o que o cahier des charges pede sem programador —
  fichas dos collaborateurs (nome, métier, formato, intérim, direitos,
  ativo), atividades e **standards com histórico** (o novo valor vale a
  partir de hoje; o passado não muda), métiers, formatos horários, motivos
  hors production e de abandono, modelos de máquina (busca, inclusão,
  exclusão se nunca usado) e regras de saisie (prazo de correção,
  "Mes résultats" visível, cronômetro opcional, fotos do Suivi).

O "attendu" de cada pessoa começa no primeiro dia em que ela declarou, para
o início do uso (ou a chegada de um intérim) não aparecer como horas
faltando. Código em `pilotage.js`.

### 🌗 Tema claro / escuro
Botão ◐ / ☀ / ☾ no topo: automático (padrão, segue o aparelho), claro ou
escuro. Contraste reforçado e rótulos em letra normal para leitura o dia todo. A escolha fica guardada no navegador (`theme.js`).

### 🔧 Pièces (Peças)
Catálogo de referência de componentes de impressora/copiadora, com nome em
francês, português e inglês, categoria (Nettoyage / Montage / Électrique),
descrição técnica e busca. Inclui um "Top 10" com a ordem oficial de
desmontagem e um guia rápido de segurança/boas práticas.

### 🖨️ Suivi (Acompanhamento) — dois fluxos diferentes

**1. Nouveau Service (com cronômetro)** — para trabalho numa impressora
específica:
- Foto do bon de commande (pedido), com leitura automática por IA
  (tenta preencher marca/modelo sozinho a partir da foto)
- Marca + Modelo, com sugestão automática de modelos reais por marca
  (lista guardada no banco, editável pelo admin — ver seção Admin)
- Cronômetro com pausas nomeadas (Matin/Déjeuner/Après-midi ou manual).
  O tempo conta desde o início, mas fica **escondido** — o botão
  "⏱ Voir le chrono" mostra/esconde. Nos serviços em pausa, o ⏱ de cada
  máquina mostra o tempo já passado nela
- Botão para pausar e ir cuidar de outro serviço, podendo retomar depois
  (mais de um serviço pode ficar em pausa ao mesmo tempo)
- Ao terminar: foto da máquina pronta, checklist oficial de 12 itens,
  Étape oficial (Test machine, Démontage, Vaisselle, Nettoyage, Partie
  technique, Contrôle qualité, Saisie SAGE, Emballage, Installation/Mise
  en route de impressora nova), quantidade (QTE) e nota livre

**2. Enregistrement rapide (sem cronômetro)** — para o que não é trabalho
numa máquina específica: basta escolher a data, a Étape (qualquer uma da
lista, incluindo Réunion/Formation/Congés/5S), uma quantidade (opcional) e
uma nota, e salvar. Aparece na hora no histórico, sem precisar rodar
cronômetro nenhum — é o equivalente digital de preencher uma célula QTE da
planilha de papel.

Todo o histórico mostra as duas coisas juntas, e cada técnico só vê os
próprios registros (ver seção RGPD/Segurança abaixo).

**Ma semaine** — além de "Aujourd'hui", o técnico vê a semana inteira
(segunda → domingo, com ‹ › para semanas anteriores), agrupada por dia, com
total por dia, total da semana e barra de progresso até 35h. Cada entrada
pode ser corrigida (étape, quantidade, nota, duração de um registro rápido)
num formulário próprio, e um dia esquecido pode ser preenchido pelo botão
"+ Ajouter". Exporta a semana em CSV (abre direto no Excel).

### 📊 Analyse
- Filtro de período: Semana / Mês / Tudo, navegável com ‹ ›
- Admin: filtro **Technicien** (um só ou toda a equipe) — o técnico comum
  só vê a si mesmo
- Cartões de resumo: horas, máquinas, média por máquina, dias trabalhados,
  com variação vs período anterior
- Gráficos de horas, por marca e por Étape (étapes de tempo em horas)
- Lista detalhada das entradas do período + export CSV (Excel)

### 👤 Admin (acesso restrito)
Visível só para os e-mails cadastrados na função `is_admin()` do banco
(SQL, ver seção abaixo) — o app pergunta ao Supabase "sou admin?" em vez de
guardar essa lista no código. Mostra um resumo geral (serviços, horas,
número de técnicos) direto ao abrir; a lista detalhada com os serviços de
cada técnico (fotos incluídas) só aparece depois de clicar em "Voir tous
les services de l'équipe" — ninguém fica exposto por padrão.

A tabela da semana (navegável com ‹ ›) lista todos os técnicos, inclusive
quem não registrou nada; tocar num nome abre a Analyse só daquela pessoa.
A lista de serviços tem filtro por técnico e export CSV.

Também tem dois painéis de gestão:
- **Gerenciar os modelos de impressora** sugeridos no autocomplete do Suivi
  — adicionar ou remover direto pela tela, sem precisar mexer no código.
- **Adicionar um técnico** — cria uma conta de login (e-mail + senha) direto
  pela tela, sem precisar entrar no painel do Supabase. Depende da variável
  de ambiente `SUPABASE_SERVICE_ROLE_KEY` na Vercel (ver seção "Configuração
  do servidor" abaixo) — sem ela, o botão mostra um erro em vez de travar
  silenciosamente.

---

## Configuração do banco (Supabase)

O projeto usa [Supabase](https://supabase.com) (Postgres + Auth + Storage).
As credenciais públicas (URL + chave "publishable") já estão no `script.js`
— isso é normal e esperado, a segurança de verdade vem das políticas RLS,
não do sigilo dessa chave.

**Passo único:** abra o SQL Editor do seu projeto Supabase e rode o
conteúdo de `supabase/setup-complete.sql`. Ele:
1. Cria as colunas que o app precisa na tabela `jobs` (`etape`, `quantite`,
   `photo_url_final`) — seguro rodar de novo, não duplica nada
2. Restringe `jobs`, `job_pauses` e `settings` por Row Level Security: cada
   técnico só vê/edita os próprios registros
3. Libera acesso total (todos os técnicos, todas as fotos) só para os
   e-mails definidos dentro da função `is_admin()` do próprio script
4. No final, mostra uma tabela de verificação com as colunas e políticas
   criadas, pra conferir que deu certo

⚠️ **Importante:** a lista de e-mails admin vive **só** dentro da função
`is_admin()`, no SQL (`setup-complete.sql`). O `script.js` não guarda mais
nenhum e-mail — ele só chama `is_admin()` pelo Supabase e mostra ou esconde
a aba Admin conforme a resposta. Pra adicionar ou trocar um admin, edite a
função `is_admin()` direto no SQL Editor do Supabase e rode de novo; não há
nada para sincronizar no código do site.

Os arquivos `rls-admin-vs-own.sql` e `schema-additions.sql` ficam na pasta
só como histórico — não precisa rodá-los, o `setup-complete.sql` já inclui
tudo o que eles faziam.

**Depois** de rodar o `setup-complete.sql`, rode também `supabase/printer-models.sql`
— ele cria a tabela `printer_models` (modelos de impressora por marca, hoje
gerenciável pelo Admin) e já vem populada com os modelos que estavam fixos
no código antes. Depende da função `is_admin()` criada pelo script anterior.

Em seguida rode `supabase/machine-models.sql` — ele acrescenta a coluna
`famille` (código CA0…) na `printer_models` e carrega os **248 modelos da
base da oficina** (Désignation + Famille + Marque, incluindo HP). Os modelos
antigos continuam lá; nada é apagado. Pode rodar de novo sem duplicar. O
cabeçalho do arquivo lista o que foi limpo (5 linhas duplicadas, 4 modelos
Sharp marcados como Canon) e o que ainda falta confirmar com a oficina.

Depois rode `supabase/atelier-schema.sql` — a **base da nova ferramenta de
declaração de atividade** (cahier des charges do Responsable des Ateliers):
métiers, formatos 37 h / 39 h, atividades com **standards com histórico**,
motivos hors production e de abandono, regras de correção, a ficha de cada
collaborateur (métier, formato, intérim, direitos), **operações com
matricule** (vários dias, status en cours / à poursuivre / finalisée /
abandonnée / annulée) e as **declarações**, que nunca são apagadas (só
anuladas). O próprio banco copia o standard em vigor em cada declaração e
aplica as regras (matricule único por étape, prazo de correção, só o
responsável abandona). Também liga o tempo real nessas duas tabelas.

Rode também `supabase/presence.sql` — cria a tabela `presence` (primeira e
última atividade de cada técnico por dia, com a hora do **servidor**, não
do navegador). O técnico vê o próprio tempo no botão ⏱ do topo; o admin vê
a equipe inteira em Admin → "Présence aujourd'hui". Sem esse script o
botão ⏱ simplesmente não aparece.

**Por último**, rode `supabase/harden-admin-check.sql` — ele restringe quem
pode até *perguntar* "sou admin?" ao banco (só usuários logados, nunca
visitantes anônimos).

### 🔒 Blindagem extra (feita em código + o que só dá pra fazer no painel)

Feito em código/SQL:
- `ADMIN_EMAILS` removido do `script.js` — o e-mail do admin nunca mais
  trafega no HTML/JS que qualquer visitante pode abrir em "Ver código-fonte"
- `vercel.json` adiciona cabeçalhos de segurança HTTP em toda resposta do
  site (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`)
- `supabase/harden-admin-check.sql` tranca a função `is_admin()` para só
  usuários autenticados poderem chamá-la
- O `<script>` do Supabase no `index.html` usa versão fixa + Subresource
  Integrity (`integrity="sha384-..."`), então o navegador recusa rodar o
  arquivo se o CDN algum dia servir um conteúdo diferente do esperado

Só dá pra fazer no painel do Supabase (nenhum código resolve isso):
- **Authentication → Providers → Email → desligar "Allow new users to
  sign up"**. Enquanto isso estiver ligado, qualquer pessoa pode criar a
  própria conta direto pela API pública do Supabase, mesmo sem passar pelo
  app — é o único jeito de garantir que só você autoriza quem entra. Com
  isso desligado, a única forma de criar conta nova é pelo botão "Adicionar
  um técnico" do Admin (abaixo) ou manualmente no painel.

---

## Configuração do servidor (Vercel) — criar técnico pelo Admin

O botão "Adicionar um técnico" do Admin precisa de uma chave secreta do
Supabase que **nunca pode entrar no repositório nem no `script.js`** — ela
dá acesso total ao banco, ao contrário da chave pública já usada no app.

**Passo a passo:**
1. No painel do Supabase: **Settings → API → Project API keys → service_role**
   (não confundir com a chave "anon"/"publishable", essa já está em
   `script.js` e é pública). Copie o valor.
2. No painel da Vercel: abra o projeto → **Settings → Environment Variables**
   → adicione uma variável chamada `SUPABASE_SERVICE_ROLE_KEY` com o valor
   copiado, marcada para o ambiente **Production** (e Preview, se quiser
   testar em branches).
3. Faça um novo deploy (qualquer push já dispara um, ou clique "Redeploy"
   na Vercel) para a variável entrar em vigor.

Sem essa variável configurada, o botão continua visível mas mostra uma
mensagem de erro ao tentar criar a conta — não falha silenciosamente.

A função que faz isso vive em `api/create-technician.js` (roda só no
servidor da Vercel, nunca no navegador) e confere com o próprio Supabase se
quem está chamando é mesmo admin antes de criar qualquer conta.

---

## RGPD / Privacidade

- Tela de login tem um aviso explicando o que é coletado (nome, horários,
  marca/modelo, fotos, notas) e por quê
- Cada técnico pode exportar os próprios dados em JSON a qualquer momento
  (botão "Exporter mes données" no Suivi)
- Acesso aos dados é restrito por técnico via RLS (ver seção acima) — o
  admin é a única exceção, com acesso total

O que ainda depende de decisão/ação humana (não é código): definir prazo de
retenção dos dados, verificar a região de hospedagem do projeto Supabase, e
formalizar um aviso de privacidade caso o app seja usado comercialmente ou
vendido para terceiros.

---

## Estrutura dos arquivos

```
index.html              estrutura da página (todas as telas)
style.css               visual (paleta petróleo + cobre, mobile-first)
script.js               toda a lógica (dados, telas, gráficos, Supabase)
favicon.svg             ícone do site
vercel.json             cabeçalhos de segurança HTTP (deploy na Vercel)
package.json            dependência da função serverless (api/)
api/
  create-technician.js      ⚠️ roda só no servidor — cria login de técnico
supabase/
  setup-complete.sql        ⭐ rodar 1º (colunas + segurança)
  printer-models.sql        ⭐ rodar 2º (tabela de modelos + admin)
  machine-models.sql        ⭐ rodar depois do 2º (248 modelos da oficina + código famille)
  atelier-schema.sql        ⭐ base da declaração de atividade (cahier des charges)
  import-jobs.sql           copia o histórico do Suivi antigo (jobs) para as telas novas, sem apagar nada
  harden-admin-check.sql    ⭐ rodar 3º (tranca quem pode chamar is_admin())
  presence.sql              ⭐ tempo de conexão por técnico (botão ⏱ + Admin)
  rls-admin-vs-own.sql      histórico, não precisa rodar
  schema-additions.sql      histórico, não precisa rodar
```

## Como abrir

Basta abrir `index.html` num navegador, ou publicar a pasta em qualquer
hospedagem estática (o projeto já está publicado via Vercel).
