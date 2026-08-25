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
Antes de usar em equipe, rode `supabase/rls-admin-vs-own.sql` no SQL Editor do
Supabase — ele restringe cada técnico aos próprios registros e libera acesso
total só para os e-mails listados em `ADMIN_EMAILS` (topo de `script.js`).
