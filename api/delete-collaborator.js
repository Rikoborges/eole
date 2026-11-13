// ============================================================================
// ReproBench — supprimer un compte créé par erreur (fonction serverless)
//
// • Compte sans aucun enregistrement (créé par erreur) : supprimé pour de bon.
// • Compte avec un historique (déclarations, opérations, ancien Suivi) :
//   le login est supprimé (« soft delete » Supabase : plus aucune connexion
//   possible) et la fiche passe en inactive. Les heures déjà déclarées
//   restent dans les totaux et les exports.
// ============================================================================

const { requireAdmin, canActOn, validId } = require('./_auth');

module.exports = async function handler(req, res) {
  const ctx = await requireAdmin(req, res); if (!ctx) return;
  const { userId } = req.body || {};
  if (!validId(userId)) return res.status(400).json({ error: 'Collaborateur invalide.' });
  if (userId === ctx.caller.id) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  if (!(await canActOn(ctx, userId))) return res.status(403).json({ error: 'Ce compte est Admin : seul le super admin peut le supprimer.' });

  const { admin } = ctx;
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
