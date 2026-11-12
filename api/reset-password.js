// ============================================================================
// ReproBench — le responsable donne un mot de passe provisoire (serverless)
//
// Pour un collaborateur qui a oublié son mot de passe (pas d'e-mail pour
// « mot de passe oublié »). Le serveur génère un mot de passe provisoire,
// débloque le compte et oblige la personne à choisir le sien à la prochaine
// connexion. Réservé aux Admins (voir api/_auth.js).
// ============================================================================

const crypto = require('crypto');
const { requireAdmin, canActOn, validId } = require('./_auth');

function temporaryPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnpqrstuvwxyz';
  const pick = s => s[crypto.randomInt(s.length)];
  return 'Atelier-' + pick(letters) + pick(lower) + pick(lower) + String(crypto.randomInt(1000, 10000));
}

module.exports = async function handler(req, res) {
  const ctx = await requireAdmin(req, res); if (!ctx) return;
  const { userId } = req.body || {};
  if (!validId(userId)) return res.status(400).json({ error: 'Collaborateur invalide.' });
  if (!(await canActOn(ctx, userId))) return res.status(403).json({ error: 'Ce compte est Admin : seul le super admin peut changer son mot de passe.' });

  const { admin } = ctx;
  const password = temporaryPassword();
  const { data, error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return res.status(400).json({ error: error.message });

  await admin.from('collaborateurs').update({ must_change_password: true }).eq('user_id', userId);
  if (data && data.user && data.user.email) await admin.from('login_guard').delete().eq('email', data.user.email.toLowerCase());

  return res.status(200).json({ ok: true, password });
};
