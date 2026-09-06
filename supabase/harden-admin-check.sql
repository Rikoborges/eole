-- ============================================================================
-- ReproBench — reforço: checagem de admin sai do código, fica só no banco
--
-- Antes, o app tinha a lista de e-mails admin escrita no script.js (visível
-- por qualquer um que abrisse "Ver código-fonte" da página). Agora o app só
-- pergunta ao banco "sou admin?" via a função is_admin() (já criada pelo
-- setup-complete.sql), sem guardar e-mail nenhum no lado do cliente.
--
-- Rode isto depois do setup-complete.sql. Garante que só quem está logado
-- pode fazer essa pergunta (não é segredo a resposta ser "não", mas não há
-- motivo pra deixar visitantes anônimos nem chamarem a função).
-- ============================================================================

revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- Verificação
select grantee, privilege_type
from information_schema.role_routine_grants
where routine_name = 'is_admin';
