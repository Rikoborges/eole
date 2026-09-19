// ============================================================================
// ReproBench — liste des comptes techniciens (fonction serverless Vercel)
//
// Même raison d'être que api/create-technician.js : lister les comptes du
// Supabase Auth demande la clé "service_role", qui ne doit jamais atterrir
// dans script.js. Cette fonction tourne côté serveur, vérifie elle-même que
// l'appelant est admin, puis renvoie une version simplifiée de la liste
// (jamais le mot de passe, bien sûr — Supabase ne le stocke même pas en clair).
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ddyekeeuaynqipdmlqhq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SBtxarlyHjUf8PcsPaik4w_t-CTwkqJ'; // gitleaks:allow

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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

  const adminClient = createClient(SUPABASE_URL, serviceRoleKey);
  const { data, error } = await adminClient.auth.admin.listUsers({ perPage: 200 });
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  const technicians = data.users
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: (u.user_metadata && u.user_metadata.name) || null,
      createdAt: u.created_at,
    }))
    .sort((a, b) => (a.email || '').localeCompare(b.email || ''));

  return res.status(200).json({ technicians });
};
