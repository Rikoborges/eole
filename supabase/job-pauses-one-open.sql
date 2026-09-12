-- ============================================================================
-- ReproBench — garantir só uma pausa aberta por serviço
--
-- closeOpenPause() fecha TODAS as pausas em aberto de um job de uma vez
-- (.eq('job_id', jobId).is('end_at', null), sem limite). Hoje isso nunca
-- deveria acontecer (a UI só abre uma pausa por vez), mas nada no banco
-- impede duas pausas abertas ao mesmo tempo se algo der errado (duplo clique
-- em rede lenta, etc.). Esse índice único transforma essa garantia em regra
-- do banco, não só em comportamento esperado da UI.
--
-- Idempotente: pode rodar de novo sem problema.
-- ============================================================================

create unique index if not exists job_pauses_one_open
  on job_pauses (job_id)
  where end_at is null;
