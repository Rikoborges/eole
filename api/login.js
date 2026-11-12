// ============================================================================
// ReproBench — connexion avec limite d'essais (fonction serverless Vercel)
//
// 5 mots de passe faux de suite → blocage 15 min, puis 30, 60… (max 24 h).
// Le compteur vit dans la table login_guard (aucune policy : seul ce serveur,
// avec la clé service_role, peut la lire et l'écrire). En cas de réussite, on
// renvoie la session Supabase au navigateur, qui l'installe avec setSession().
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ddyekeeuaynqipdmlqhq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SBtxarlyHjUf8PcsPaik4w_t-CTwkqJ'; // gitleaks:allow
const LOGIN_DOMAIN = 'eole-reco.vercel.app';
const MAX_FAILURES = 5;
const BASE_LOCK_MIN = 15;
const MAX_LOCK_MIN = 24 * 60;

const minutesLeft = until => Math.max(1, Math.ceil((new Date(until) - Date.now()) / 60000));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée.' }); }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(503).json({ error: 'config', fallback: true });

  const { login, password } = req.body || {};
  if (typeof login !== 'string' || typeof password !== 'string' || !login.trim() || !password) {
    return res.status(400).json({ error: 'Remplissez identifiant et mot de passe.' });
  }
  let email = login.trim().toLowerCase();
  if (!email.includes('@')) email += '@' + LOGIN_DOMAIN;

  const admin = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });
  const { data: guard, error: guardErr } = await admin.from('login_guard').select('*').eq('email', email).maybeSingle();
  if (guardErr) return res.status(503).json({ error: 'config', fallback: true }); // table pas encore installée

  if (guard && guard.locked_until && new Date(guard.locked_until) > new Date()) {
    return res.status(423).json({ error: `Trop d'essais. Compte bloqué encore ${minutesLeft(guard.locked_until)} min, ou demandez au responsable de le débloquer.` });
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    const badCredentials = error.status === 400 || /invalid login credentials/i.test(error.message || '');
    if (!badCredentials) return res.status(error.status || 400).json({ error: error.message });

    let failures = (guard ? guard.failures : 0) + 1;
    let lockCount = guard ? guard.lock_count : 0;
    let lockedUntil = null;
    if (failures >= MAX_FAILURES) {
      lockCount += 1;
      const minutes = Math.min(BASE_LOCK_MIN * 2 ** (lockCount - 1), MAX_LOCK_MIN);
      lockedUntil = new Date(Date.now() + minutes * 60000).toISOString();
      failures = 0;
    }
    await admin.from('login_guard').upsert({ email, failures, lock_count: lockCount, locked_until: lockedUntil, last_failure: new Date().toISOString() });
    if (lockedUntil) {
      return res.status(423).json({ error: `Trop d'essais. Compte bloqué ${minutesLeft(lockedUntil)} min, ou demandez au responsable de le débloquer.` });
    }
    const left = MAX_FAILURES - failures;
    return res.status(401).json({ error: `Identifiant ou mot de passe incorrect. Encore ${left} essai${left > 1 ? 's' : ''} avant blocage.` });
  }

  if (guard) await admin.from('login_guard').delete().eq('email', email);
  return res.status(200).json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
};
