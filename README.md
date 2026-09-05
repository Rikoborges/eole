# ReproBench

App de apoio para trabalho de reconditionnement (recondicionamento) de
impressoras e copiadoras: referência de peças, acompanhamento diário de
serviço, análise de indicadores e uma visão geral para administradores.

Interface em francês (idioma de trabalho), com nomes/legendas em PT/EN nas
peças. Roda direto no navegador, sem instalação — é um site estático
(HTML + CSS + JS puro) com banco de dados na nuvem (Supabase).

---

## Funcionalidades

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
- Cronômetro com pausas nomeadas (Matin/Déjeuner/Après-midi ou manual)
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

### 📊 Analyse
- Cartões de resumo: total de serviços, total de horas, média por serviço
- Gráfico de horas trabalhadas (semana ou mês)
- Gráfico de distribuição por marca de impressora
- Gráfico de distribuição por Étape

### 👤 Admin (acesso restrito)
Visível só para os e-mails configurados em `ADMIN_EMAILS` (topo do
`script.js`). Mostra tudo de todos os técnicos: resumo geral, busca e
lista completa de serviços com as fotos (inicial e final), num visualizador
em tela cheia.

Também tem um painel para **gerenciar os modelos de impressora** sugeridos
no autocomplete do Suivi — adicionar ou remover direto pela tela, sem
precisar mexer no código.

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

⚠️ **Importante:** a lista de e-mails dentro de `is_admin()` (no SQL) e a
constante `ADMIN_EMAILS` (no topo do `script.js`) precisam ser **idênticas**.
Se adicionar um admin num lugar, adicione no outro também.

Os arquivos `rls-admin-vs-own.sql` e `schema-additions.sql` ficam na pasta
só como histórico — não precisa rodá-los, o `setup-complete.sql` já inclui
tudo o que eles faziam.

**Depois** de rodar o `setup-complete.sql`, rode também `supabase/printer-models.sql`
— ele cria a tabela `printer_models` (modelos de impressora por marca, hoje
gerenciável pelo Admin) e já vem populada com os modelos que estavam fixos
no código antes. Depende da função `is_admin()` criada pelo script anterior.

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
supabase/
  setup-complete.sql     ⭐ rodar primeiro (colunas + segurança)
  printer-models.sql     ⭐ rodar depois (tabela de modelos + admin)
  rls-admin-vs-own.sql   histórico, não precisa rodar
  schema-additions.sql   histórico, não precisa rodar
```

## Como abrir

Basta abrir `index.html` num navegador, ou publicar a pasta em qualquer
hospedagem estática (o projeto já está publicado via Vercel).
