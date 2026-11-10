/* =========================================================================
   ReproBench — mot de passe : changer le sien, et changement obligatoire
   après un mot de passe provisoire donné par le responsable.

   • Bouton 🔑 dans l'en-tête : « Changer mon mot de passe » (avec l'ancien).
   • À la connexion, si la fiche porte must_change_password, une fenêtre
     bloquante demande de choisir un nouveau mot de passe.
   Dépend de script.js (sb, escapeHtml, getMyUserId).
   ========================================================================= */
(function(){
  'use strict';
  const COMMON = ['12345678', '123456789', '1234567890', 'azertyui', 'azerty123', 'motdepasse', 'password', 'password1', 'qwertyui', '00000000', '11111111', 'atelier1', 'eole1234', 'reprobench'];

  function checkNew(p1, p2, login){
    if(p1.length < 8) return 'Au moins 8 caractères.';
    if(p1 !== p2) return 'Les deux mots de passe ne sont pas identiques.';
    const low = p1.toLowerCase();
    if(COMMON.includes(low) || /^(.)\1+$/.test(p1)) return 'Mot de passe trop facile à deviner : choisissez-en un autre.';
    if(login && low.includes(login.split('@')[0].toLowerCase())) return 'Le mot de passe ne doit pas contenir votre identifiant.';
    if(/^atelier-/i.test(p1)) return 'Choisissez votre propre mot de passe (pas le provisoire).';
    return null;
  }

  let dlg = null;
  function open(forced){
    if(dlg) dlg.remove();
    dlg = document.createElement('div');
    dlg.className = 'pw-overlay';
    dlg.innerHTML = `<div class="pw-box sx-card" role="dialog" aria-modal="true" aria-labelledby="pwTitle">
      <h2 class="sx-h2" id="pwTitle">${forced ? 'Choisissez votre mot de passe' : 'Changer mon mot de passe'}</h2>
      <p class="sx-small">${forced ? 'Vous vous êtes connecté avec un mot de passe provisoire. Choisissez maintenant le vôtre : vous seul le connaîtrez.' : 'Au moins 8 caractères. Évitez les suites simples (12345678, azerty…).'}</p>
      ${forced ? '' : '<label class="field-label" for="pwOld">Mot de passe actuel</label><input type="password" id="pwOld" autocomplete="current-password">'}
      <label class="field-label" for="pwNew1">Nouveau mot de passe</label><input type="password" id="pwNew1" autocomplete="new-password" minlength="8">
      <label class="field-label" for="pwNew2">Confirmer</label><input type="password" id="pwNew2" autocomplete="new-password" minlength="8">
      <p class="sx-error" id="pwErr" hidden></p>
      <div class="sx-row sx-mt"><button type="button" class="btn-primary" id="pwSave">Enregistrer</button>${forced ? '' : '<button type="button" class="btn-secondary" id="pwCancel">Annuler</button>'}</div>
    </div>`;
    document.body.appendChild(dlg);
    const err = msg => { const e = dlg.querySelector('#pwErr'); e.textContent = msg; e.hidden = !msg; };
    (dlg.querySelector('#pwOld') || dlg.querySelector('#pwNew1')).focus();
    const cancel = dlg.querySelector('#pwCancel');
    if(cancel) cancel.onclick = () => { dlg.remove(); dlg = null; };
    dlg.querySelector('#pwSave').onclick = async () => {
      const btn = dlg.querySelector('#pwSave');
      const { data: { session } } = await sb.auth.getSession();
      if(!session){ err('Session expirée : reconnectez-vous.'); return; }
      const email = session.user.email;
      const p1 = dlg.querySelector('#pwNew1').value, p2 = dlg.querySelector('#pwNew2').value;
      const problem = checkNew(p1, p2, email); if(problem){ err(problem); return; }
      btn.disabled = true; err('');
      try{
        if(!forced){
          const old = dlg.querySelector('#pwOld').value;
          if(!old){ err('Indiquez votre mot de passe actuel.'); btn.disabled = false; return; }
          const check = await sb.auth.signInWithPassword({ email, password: old });
          if(check.error){ err('Mot de passe actuel incorrect.'); btn.disabled = false; return; }
        }
        const { error } = await sb.auth.updateUser({ password: p1 });
        if(error){ err(/same/i.test(error.message) ? 'Le nouveau mot de passe doit être différent de l\'ancien.' : 'Erreur : ' + error.message); btn.disabled = false; return; }
        await sb.rpc('clear_must_change_password');
        dlg.remove(); dlg = null;
        const t = document.createElement('div'); t.className = 'sx-toast'; t.setAttribute('role', 'status'); t.textContent = 'Mot de passe enregistré.';
        document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
      }catch(e){ err('Erreur inattendue : ' + e.message); btn.disabled = false; }
    };
  }
  window.openPasswordDialog = open;

  const btn = document.getElementById('btnPassword');
  if(btn) btn.addEventListener('click', () => open(false));

  // Mot de passe provisoire ? On impose le changement dès la connexion.
  sb.auth.onAuthStateChange((_event, session) => {
    if(!session) return;
    setTimeout(async () => {
      const { data, error } = await sb.from('collaborateurs').select('must_change_password').eq('user_id', session.user.id).maybeSingle();
      if(!error && data && data.must_change_password && !dlg) open(true);
    }, 0);
  });
})();
