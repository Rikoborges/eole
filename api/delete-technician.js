// ============================================================================
// ReproBench — suppression d'un compte technicien (fonction serverless Vercel)
//
// Même raison d'être que api/create-technician.js : supprimer un compte du
// Supabase Auth demande la clé "service_role", qui ne doit jamais atterrir
// dans script.js. Cette fonction tourne côté serveur, vérifie elle-même que
// l'appelant est admin, puis supprime le compte.
//
// Suppression "douce" (soft delete) : le technicien ne peut plus se connecter
// et disparaît de la liste, mais ses services déjà enregistrés (table jobs)
// restent dans l'historique — les heures passées ne sont pas perdues.
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ddyekeeuaynqipdmlqhq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SBtxarlyHjUf8PcsPaik4w_t-CTwkqJ'; // gitleaks:allow

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY manquante dans les variables d\'environnement Vercel.');
    return res.status(500).json({ error: 'Configuration serveur incomplète (clé manquante).' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: isAdmin, error: adminCheckError } = await callerClient.rpc('is_admin');
  if (adminCheckError || !isAdmin) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }

  const { userId } = req.body || {};
  if (typeof userId !== 'string' || !userId) {
    return res.status(400).json({ error: 'Identifiant du compte manquant.' });
  }

  // Un admin ne peut pas supprimer son propre compte par erreur.
  const { data: callerData } = await callerClient.auth.getUser(token);
  if (callerData && callerData.user && callerData.user.id === userId) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  }

  const adminClient = createClient(SUPABASE_URL, serviceRoleKey);
  const { error } = await adminClient.auth.admin.deleteUser(userId, true);
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.status(200).json({ ok: true });
};
