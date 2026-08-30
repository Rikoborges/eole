# ReproBench

App pessoal de apoio para trabalho de reconditionnement de impressoras/copiadoras.

## O que tem
- Peças: referência PT/FR/EN de componentes de impressora/copiadora
- Registro: cronômetro de serviço com foto do pedido e histórico
- Análise: estatísticas de horas e marcas
- Admin: visão geral de todos os técnicos (acesso restrito)

## Como abrir
Abre o index.html direto no navegador, sem instalação.

## Configuração do banco (Supabase)
Rode `supabase/setup-complete.sql` no SQL Editor do Supabase — cria as colunas
que faltam e restringe cada técnico aos próprios registros, liberando acesso
total só para os e-mails listados em `ADMIN_EMAILS` (topo de `script.js`, deve
bater com o e-mail dentro do próprio SQL). Pode rodar de novo sem problema.

Os arquivos `rls-admin-vs-own.sql` e `schema-additions.sql` ficam só de
histórico — o `setup-complete.sql` já inclui tudo o que eles faziam.
