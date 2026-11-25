/* =========================================================================
   ReproBench — « Vos données » : notice d'information (RGPD) présentée à la
   première connexion. La personne coche « J'ai pris connaissance » ; la base
   enregistre la date et la version (supabase/info-donnees.sql).
   Changer INFO_VERSION quand le texte change : la notice revient pour tous.
   Dépend de script.js (sb) et icons.js (ico).
   ========================================================================= */
(function(){
  'use strict';
  const INFO_VERSION = '2026-11';
  const TEXT = `
    <p>Pour suivre l'activité de l'atelier, ReproBench enregistre :</p>
    <ul>
      <li>votre nom, votre métier et votre format horaire ;</li>
      <li>vos déclarations : activités, quantités, temps passé, N° de série et modèle des machines, commentaires ;</li>
      <li>les corrections faites sur vos déclarations (qui, quand) ;</li>
      <li>l'heure de votre première et de votre dernière utilisation de l'application dans la journée ;</li>
      <li>le chronomètre, seulement si vous choisissez de l'utiliser ; votre photo de profil, si vous en ajoutez une.</li>
    </ul>
    <p><b>Qui les voit ?</b> Vous, et le responsable de l'atelier. Elles ne sont ni vendues, ni communiquées à l'extérieur de l'entreprise.</p>
    <p><b>Pourquoi ?</b> Remplacer la fiche d'heures, suivre la production et organiser le travail de l'atelier.</p>
    <p><b>Vos droits :</b> consulter et télécharger vos données (Ma semaine › « Toutes mes données »), demander une correction ou leur suppression auprès du responsable.</p>`;
  window.INFO_DONNEES_HTML = TEXT;

  let dlg = null;
  function open(){
    if(dlg) return;
    dlg = document.createElement('div');
    dlg.className = 'pw-overlay';
    dlg.innerHTML = `<div class="pw-box sx-card info-box" role="dialog" aria-modal="true" aria-labelledby="infoTitle">
      <h2 class="sx-h2" id="infoTitle">${ico('lock', 18)} Vos données</h2>
      <div class="info-text">${TEXT}</div>
      <label class="info-ack"><input type="checkbox" id="infoAck"> <span>J'ai lu et pris connaissance de ces informations.</span></label>
      <p class="sx-error" id="infoErr" hidden></p>
      <div class="sx-row sx-mt"><button type="button" class="btn-primary" id="infoOk" disabled>Continuer</button><button type="button" class="btn-secondary" id="infoOut">Se déconnecter</button></div>
    </div>`;
    document.body.appendChild(dlg);
    const ok = dlg.querySelector('#infoOk'), box = dlg.querySelector('#infoAck');
    box.addEventListener('change', () => { ok.disabled = !box.checked; });
    box.focus();
    dlg.querySelector('#infoOut').onclick = async () => { dlg.remove(); dlg = null; await sb.auth.signOut(); };
    ok.onclick = async () => {
      ok.disabled = true;
      const { error } = await sb.rpc('ack_info_donnees', { p_version: INFO_VERSION });
      if(error){ const e = dlg.querySelector('#infoErr'); e.textContent = 'Enregistrement impossible : réessayez.'; e.hidden = false; ok.disabled = false; return; }
      dlg.remove(); dlg = null;
    };
  }

  // Appelé à la connexion (après le changement de mot de passe obligatoire)
  window.checkInfoDonnees = async function(userId){
    const { data, error } = await sb.from('collaborateurs').select('info_vue_version').eq('user_id', userId).maybeSingle();
    if(error || !data) return;                     // SQL pas encore installé, ou pas de fiche : on ne bloque pas
    if(data.info_vue_version !== INFO_VERSION) open();
  };
  window.INFO_VERSION = INFO_VERSION;
})();
