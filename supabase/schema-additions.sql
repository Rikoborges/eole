-- ============================================================
-- ReproBench — colunas extras na tabela jobs
--
-- Como usar: Supabase Dashboard → SQL Editor → New query → cole e Run.
-- Idempotente (IF NOT EXISTS), pode rodar de novo sem problema.
-- ============================================================

-- Foto da máquina pronta, tirada no fim do serviço (opcional)
alter table jobs add column if not exists photo_url_final text;

-- Etapa oficial selecionada no fim do serviço (antes ficava colada no note)
alter table jobs add column if not exists etape text;
