// ============================================================================
// ReproBench — contrôle commun des fonctions serveur réservées aux Admins
//
// Admin = super admin (is_admin : liste d'e-mails) OU fiche « Admin »
// (collaborateurs.role = 'responsable', fonction is_responsable).
// Un Admin « par la fiche » ne peut agir que sur les comptes Collaborateur :
// seuls les super admins touchent aux comptes Admin (pas de prise de contrôle
// d'un autre Admin par réinitialisation de mot de passe).
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ddyekeeuaynqipdmlqhq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SBtxarlyHjUf8PcsPaik4w_t-CTwkqJ'; // gitleaks:allow

// Renvoie { caller, admin } ou envoie la réponse d'erreur et renvoie null.
async function requireAdmin(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Méthode non autorisée.' }); return null; }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) { res.status(500).json({ error: 'Configuration serveur incomplète (clé manquante).' }); return null; }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Non authentifié.' }); return null; }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const [{ data: userData, error: userErr }, superRes, respRes] = await Promise.all([
    callerClient.auth.getUser(token), callerClient.rpc('is_admin'), callerClient.rpc('is_responsable')
  ]);
  if (userErr || !userData || !userData.user) { res.status(401).json({ error: 'Session expirée : reconnectez-vous.' }); return null; }
  const isSuper = !superRes.error && superRes.data === true;
  const isResp = isSuper || (!respRes.error && respRes.data === true);
  if (!isResp) { res.status(403).json({ error: 'Accès réservé aux administrateurs.' }); return null; }

  const admin = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });
  return { caller: { id: userData.user.id, isSuper }, admin };
}

// Un Admin « par la fiche » ne peut pas agir sur un compte Admin.
async function canActOn(ctx, userId) {
  if (ctx.caller.isSuper) return true;
  const { data } = await ctx.admin.from('collaborateurs').select('role').eq('user_id', userId).maybeSingle();
  return !!data && data.role === 'collaborateur';
}

const validId = v => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

module.exports = { requireAdmin, canActOn, validId, SUPABASE_URL, SUPABASE_ANON_KEY };
