// ============================================================================
// ReproBench — création de compte technicien (fonction serverless Vercel)
//
// Pourquoi ce fichier existe : créer un compte de connexion (email + mot de
// passe) demande la clé "service_role" du Supabase, qui donne un accès total
// à la base — elle ne doit JAMAIS être écrite dans script.js, qui est envoyé
// tel quel au navigateur de n'importe qui. Cette fonction tourne uniquement
// côté serveur (Vercel), lit la clé depuis une variable d'environnement, et
// vérifie elle-même que l'appelant est admin avant de créer quoi que ce soit.
//
// Configuration nécessaire dans Vercel (Project Settings → Environment
// Variables) : SUPABASE_SERVICE_ROLE_KEY (Settings → API du projet Supabase,
// section "service_role" — jamais la clé "anon"/"publishable").
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

// URL + clé publique : les mêmes valeurs, déjà publiques, que dans script.js.
// Aucun risque à les avoir ici aussi — la sécurité vient des policies RLS et
// de la vérification is_admin() ci-dessous, pas du secret de ces valeurs.
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

  // Client "au nom de l'appelant" : sert uniquement à vérifier is_admin()
  // avec les droits réels de cette personne — jamais à créer le compte.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: isAdmin, error: adminCheckError } = await callerClient.rpc('is_admin');
  if (adminCheckError || !isAdmin) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }

  const { email, password, name } = req.body || {};
  if (typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail invalide.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit avoir au moins 8 caractères.' });
  }

  // Seul ce client-là, créé avec service_role, a le droit de créer des comptes.
  const adminClient = createClient(SUPABASE_URL, serviceRoleKey);
  const { data, error } = await adminClient.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: typeof name === 'string' && name.trim() ? { name: name.trim() } : undefined,
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.status(200).json({ ok: true, userId: data.user.id, email: data.user.email });
};
