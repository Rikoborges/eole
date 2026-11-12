// ============================================================================
// ReproBench — le responsable donne un mot de passe provisoire (serverless)
//
// Pour un collaborateur qui a oublié son mot de passe (pas d'e-mail pour
// « mot de passe oublié »). Le serveur génère un mot de passe provisoire,
// débloque le compte et oblige la personne à choisir le sien à la prochaine
// connexion. Réservé aux admins (même contrôle que create-technician).
// ============================================================================

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ddyekeeuaynqipdmlqhq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SBtxarlyHjUf8PcsPaik4w_t-CTwkqJ'; // gitleaks:allow

function temporaryPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnpqrstuvwxyz';
  const pick = s => s[crypto.randomInt(s.length)];
  return 'Atelier-' + pick(letters) + pick(lower) + pick(lower) + String(crypto.randomInt(1000, 10000));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée.' }); }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: 'Configuration serveur incomplète (clé manquante).' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });

  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin');
  if (adminErr || !isAdmin) return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });

  const { userId } = req.body || {};
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: 'Collaborateur invalide.' });

  const admin = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });
  const password = temporaryPassword();
  const { data, error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return res.status(400).json({ error: error.message });

  await admin.from('collaborateurs').update({ must_change_password: true }).eq('user_id', userId);
  if (data && data.user && data.user.email) await admin.from('login_guard').delete().eq('email', data.user.email.toLowerCase());

  return res.status(200).json({ ok: true, password });
};
