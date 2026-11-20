// ============================================================================
// ReproBench — supprimer un compte créé par erreur (fonction serverless)
//
// • Compte sans aucun enregistrement (créé par erreur) : supprimé pour de bon.
// • Compte avec un historique (déclarations, opérations, ancien Suivi) :
//   le login est supprimé (« soft delete » Supabase : plus aucune connexion
//   possible) et la fiche passe en inactive. Les heures déjà déclarées
//   restent dans les totaux et les exports.
// • « Tout effacer » (purge: true) : le compte ET tout son historique sont
//   supprimés définitivement (supabase/suppression-complete.sql).
// ============================================================================

const { requireAdmin, canActOn, validId } = require('./_auth');

module.exports = async function handler(req, res) {
  const ctx = await requireAdmin(req, res); if (!ctx) return;
  const { userId, purge } = req.body || {};
  if (!validId(userId)) return res.status(400).json({ error: 'Collaborateur invalide.' });
  if (userId === ctx.caller.id) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  if (!(await canActOn(ctx, userId))) return res.status(403).json({ error: 'Ce compte est Admin : seul le super admin peut le supprimer.' });

  const { admin } = ctx;
  if (purge === true) {
    const { data: u0 } = await admin.auth.admin.getUserById(userId);
    const { data: done, error: pErr } = await admin.rpc('purge_collaborateur', { p_user: userId });
    if (pErr) {
      const missing = /purge_collaborateur|PGRST202|does not exist|Could not find/i.test(pErr.message || '');
      return res.status(missing ? 409 : 500).json({ error: missing ? 'Suppression complète pas encore installée : lancez supabase/suppression-complete.sql dans Supabase.' : 'Suppression impossible : ' + pErr.message });
    }
    const { error: dErr } = await admin.auth.admin.deleteUser(userId);
    if (dErr && !/not found/i.test(dErr.message)) return res.status(400).json({ error: 'Historique effacé, mais le compte n\'a pas pu être supprimé : ' + dErr.message });
    if (u0 && u0.user && u0.user.email) await admin.from('login_guard').delete().eq('email', u0.user.email.toLowerCase());
    return res.status(200).json({ ok: true, purged: true, counts: done || {} });
  }
  const count = async (table) => {
    const { count: n, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if (error && !/does not exist|schema cache/i.test(error.message)) throw error;
    return n || 0;
  };
  let used;
  try {
    const [d, o, j] = await Promise.all([count('declarations'), count('operations'), count('jobs')]);
    used = d + o + j;
  } catch (e) { return res.status(500).json({ error: 'Vérification impossible : ' + e.message }); }
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const email = u && u.user && u.user.email ? u.user.email.toLowerCase() : null;
  if (used > 0) {
    const { error } = await admin.auth.admin.deleteUser(userId, true); // soft delete : l'historique garde son auteur
    if (error) return res.status(400).json({ error: error.message });
    await admin.from('collaborateurs').update({ active: false }).eq('user_id', userId);
    if (email) await admin.from('login_guard').delete().eq('email', email);
    return res.status(200).json({ ok: true, archived: true, records: used });
  }
  const { error } = await admin.auth.admin.deleteUser(userId); // la fiche suit (on delete cascade)
  if (error) return res.status(400).json({ error: error.message });
  await admin.from('collaborateurs').delete().eq('user_id', userId);
  if (email) await admin.from('login_guard').delete().eq('email', email);
  return res.status(200).json({ ok: true, archived: false });
};
