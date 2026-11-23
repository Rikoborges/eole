/* =========================================================================
   ReproBench — Aide (FAQ) : bouton « ? » dans l'en-tête
   Questions fréquentes, avec recherche. La partie « Responsable » n'apparaît
   que pour les comptes Admin. Dépend de icons.js (ico) et script.js (escapeHtml).
   ========================================================================= */
(function(){
  'use strict';

  // Chaque entrée : [question, réponse en HTML simple]
  const FAQ = [
    { title: 'Connexion et compte', items: [
      ['Comment me connecter ?', 'Tapez votre <b>identifiant</b> (par exemple <i>paul.durand</i>, sans @) et votre mot de passe, puis « Se connecter ». La première fois, l\'application vous demande de choisir votre propre mot de passe.'],
      ['J\'ai oublié mon mot de passe', 'Demandez au responsable : il vous donne un <b>mot de passe provisoire</b> (Paramètres › Collaborateurs › Réinitialiser). À la connexion, vous choisirez le vôtre.'],
      ['Mon compte est bloqué', 'Après <b>5 mots de passe faux</b>, le compte se bloque 15 minutes. Attendez, ou demandez au responsable de le débloquer tout de suite.'],
      ['Changer mon mot de passe', 'Bouton <b>clé</b> en haut à droite. Il faut l\'ancien mot de passe, puis deux fois le nouveau (8 caractères au moins).'],
      ['Installer ReproBench sur mon téléphone', '<b>Android (Chrome)</b> : menu ⋮ › « Installer l\'application ». <b>iPhone (Safari)</b> : bouton Partager › « Sur l\'écran d\'accueil ». L\'icône ReproBench s\'ouvre ensuite en plein écran.'],
      ['Clair ou sombre ?', 'Le bouton soleil / lune en haut à droite change le thème : automatique (comme le téléphone), clair, ou sombre.']
    ]},
    { title: 'Déclarer mon activité', items: [
      ['Comment déclarer une tâche ?', 'Onglet <b>Saisir</b> : 1. choisissez l\'activité (ou « Hors production ») ; 2. la quantité, ou le matricule et le modèle pour une machine ; 3. le temps ; 4. « Valider ». Le haut de l\'écran montre ce qui reste à déclarer aujourd\'hui.'],
      ['Comment écrire le temps ?', 'Au choix : <b>1,5</b> · <b>1h30</b> · <b>45 min</b>, ou les boutons rapides 0,25 · 0,50 · 1,00… Le temps se compte en heures décimales : 1,50 = 1 h 30.'],
      ['Je me suis trompé juste après « Valider »', 'Pendant <b>8 secondes</b>, le message en bas propose <b>« Annuler »</b> : la déclaration est annulée et le formulaire revient rempli pour corriger.'],
      ['Corriger ou annuler une déclaration', 'Dans la liste du jour (« Aujourd\'hui · … · Afficher ») : <b>Modifier</b> ou <b>Annuler cette déclaration</b>. Une déclaration annulée reste visible, barrée. Vous pouvez corriger les <b>7 derniers jours</b> (selon la règle choisie par le responsable).'],
      ['J\'ai oublié de déclarer un jour', 'Dans la liste du jour, revenez au bon jour avec la flèche <b>‹</b>, puis « <b>+ Ajouter une déclaration ce jour-là</b> ». Les étapes avec matricule se déclarent le jour même seulement.'],
      ['Réunion, formation, congés…', 'Choisissez <b>Hors production</b> en haut du formulaire, puis le motif. Ce temps compte dans la journée, sans compter contre vous.'],
      ['Que veut dire « Temps attendu » ?', 'C\'est le temps standard prévu pour l\'activité (fixé par le responsable). Il sert de repère : vous déclarez toujours le temps réellement passé.']
    ]},
    { title: 'Machines et matricules', items: [
      ['Où trouver le N° de série (matricule) ?', 'Sur l\'étiquette de la machine. Tapez-le tel quel, sans espaces. Si la machine est déjà connue, le modèle se remplit tout seul.'],
      ['L\'étiquette est illisible', 'Cochez « <b>Étiquette illisible, compléter plus tard</b> ». Le responsable verra une alerte pour compléter ensuite.'],
      ['La machine n\'est pas finie', 'Choisissez « <b>Mettre en attente / À poursuivre</b> » avant de valider : le temps compte aujourd\'hui, la machine pas encore. Elle reste dans « <b>Mes étapes en cours</b> » : « Reprendre l\'étape » quand vous y revenez, puis « Finaliser » quand elle est terminée.'],
      ['« Ce N° de série est déjà enregistré pour cette étape »', 'Cette étape a déjà été faite (ou est en cours) sur cette machine. Si elle est à vous et pas finie, utilisez « Reprendre l\'étape ».'],
      ['Le modèle n\'est pas dans la liste', 'Tapez quelques caractères (ex. <i>3525</i>, <i>IRAC</i>). S\'il n\'existe vraiment pas, demandez au responsable de l\'ajouter (Paramètres › Modèles machines).'],
      ['Pourquoi une checklist ?', 'Pour les étapes de reconditionnement et d\'installation, la checklist officielle s\'affiche quand vous finalisez. Cochez ce qui a été fait.']
    ]},
    { title: 'Chrono (facultatif)', items: [
      ['Le chrono est-il obligatoire ?', 'Non. <b>Rien ne démarre tout seul</b>. Si vous le voulez, cliquez sur « <b>Chrono</b> » à côté de « Temps consacré » : il compte et remplit le temps pour vous. Vous pouvez toujours taper le temps vous-même.'],
      ['Je change de tâche en cours de route', 'Choisissez l\'autre activité : le chrono de la première se met en pause et apparaît dans « <b>Tâches en pause</b> ». Un clic dessus pour y revenir : son chrono repart là où il s\'était arrêté.'],
      ['Cacher le chrono', 'Sur la ligne du chrono : « Afficher » pour le voir en grand, la croix pour le cacher complètement. Caché, il continue de compter ; l\'icône chrono à côté de « Temps consacré » le fait revenir.'],
      ['Le chrono suit-il sur mon téléphone ?', 'Oui : commencé sur le PC de l\'atelier, il continue sur le téléphone avec le même temps. En vous déconnectant, tous vos chronos se mettent en pause.']
    ]},
    { title: 'Ma semaine et ma fiche', items: [
      ['Que montre « Ma semaine » ?', '<b>Ma fiche</b> : vos heures jour par jour, comme l\'ancienne fiche Excel, avec l\'objectif et ce qui reste à déclarer. <b>Mes résultats</b> : temps déclaré comparé au temps attendu. Les flèches changent de semaine.'],
      ['Le vendredi : « Votre semaine est-elle juste ? »', 'Le vendredi, Saisir montre vos 5 jours : coche = complet, en orange = il manque du temps. Touchez un jour pour le corriger, puis « <b>Signer ma semaine</b> ».'],
      ['Signer ma semaine', 'Vous confirmez que vos déclarations sont justes. Le responsable la <b>valide</b> ensuite : elle est alors <b>verrouillée</b>. Pour corriger une semaine validée, demandez-lui de la rouvrir.'],
      ['Télécharger ou imprimer ma fiche', 'Ma semaine › « <b>Fiche de la semaine (Excel)</b> », ou « <b>Voir la fiche</b> » pour l\'imprimer ou l\'enregistrer en PDF (bouton « Imprimer » dans la fenêtre).']
    ]},
    { title: 'Données et confidentialité', items: [
      ['Qui voit mes déclarations ?', 'Vous et le responsable de l\'atelier. Vos collègues ne voient pas vos déclarations.'],
      ['Mes données personnelles', 'Ma semaine › « <b>Toutes mes données (RGPD)</b> » télécharge tout ce qui vous concerne. Pour toute question, adressez-vous au responsable.'],
      ['Pas de réseau', 'Un bandeau « Hors ligne » apparaît en haut. Attendez le retour du réseau avant de valider une déclaration.']
    ]},
    { admin: true, title: 'Pour le responsable', items: [
      ['Un collaborateur remplit sur papier (pas d\'ordinateur ni de téléphone)', 'Collaborateurs › ouvrez sa fiche › <b>Déclarer pour…</b>. L\'onglet Saisir s\'ouvre à son nom (bandeau en haut) : saisissez sa fiche papier comme d\'habitude, puis <b>Terminer</b>. Chaque ligne est marquée « saisie par le responsable ». Le chrono et la signature de semaine restent personnels.'],
      ['Par où commencer chaque jour ?', 'L\'onglet <b>À traiter</b> regroupe ce qui demande une action : fiches à valider, journées incomplètes, machines en attente depuis longtemps, matricules à compléter, comptes bloqués. « OK » range une ligne dans « Traités ».'],
      ['Créer un compte', 'Paramètres › Collaborateurs › « Créer un compte » : nom, identifiant (ou laissé vide : il est créé depuis le nom) et mot de passe provisoire. Puis choisissez le <b>métier</b> et le <b>format horaire</b> : sans eux, la personne ne peut pas déclarer.'],
      ['Mot de passe oublié ou compte bloqué', 'Paramètres › Collaborateurs, colonne Accès : <b>Débloquer</b>, ou <b>Réinitialiser</b> (le mot de passe provisoire s\'affiche une seule fois : notez-le).'],
      ['Valider une semaine', 'À traiter, ou Collaborateurs › la personne › « Fiches de la semaine » › <b>Valider</b>. La semaine est verrouillée ; « Rouvrir » la déverrouille.'],
      ['Supprimer un collaborateur', 'Paramètres › Collaborateurs › Supprimer : « <b>Supprimer l\'accès, garder l\'historique</b> » (quelqu\'un qui part) ou « <b>Tout effacer</b> » (compte de test ou erreur, irréversible).'],
      ['Changer un standard, une activité, une règle', 'Paramètres : Activités et standards (un nouveau standard garde l\'historique), Formats horaires, Hors production, Motifs, Modèles machines, Règles de saisie (délai de correction, chrono…).'],
      ['Suivre une machine', 'Onglet <b>Machines</b> : tapez le N° de série pour voir toute sa vie (étapes, personnes, temps, checklists, corrections). Dans Opérations, un clic sur le matricule ouvre la même fiche.'],
      ['Exports Excel', 'Atelier › Exports Excel (période et filtres affichés), et fiche de chaque semaine en Excel ou PDF.']
    ]}
  ];

  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const strip = h => h.replace(/<[^>]+>/g, '');
  let box = null, q = '';

  function isAdmin(){ const r = document.getElementById('roleSwitch'); return !!r && !r.hidden; }

  function list(){
    const words = norm(q).split(/\s+/).filter(Boolean);
    const groups = FAQ.filter(g => !g.admin || isAdmin()).map(g => ({ g, items: g.items.filter(([qq, a]) => !words.length || words.every(w => norm(qq + ' ' + strip(a)).includes(w))) })).filter(x => x.items.length);
    if(!groups.length) return '<p class="faq-empty">Aucune réponse trouvée. Essayez un autre mot, ou demandez au responsable.</p>';
    return groups.map(({ g, items }) => `<section class="faq-group"><h3>${escapeHtml(g.title)}</h3>
      ${items.map(([qq, a]) => `<details class="faq-item" ${words.length ? 'open' : ''}><summary><span>${escapeHtml(qq)}</span><span class="chev" aria-hidden="true">›</span></summary><div class="faq-a">${a}</div></details>`).join('')}</section>`).join('');
  }

  function open(){
    if(box){ box.remove(); }
    q = '';
    box = document.createElement('div');
    box.className = 'faq-overlay';
    box.innerHTML = `<div class="faq-box" role="dialog" aria-modal="true" aria-labelledby="faqTitle">
      <div class="faq-head"><h2 id="faqTitle">Aide</h2><button type="button" class="faq-close" aria-label="Fermer l'aide">${ico('x', 20)}</button></div>
      <div class="sx-msearch faq-search"><span class="sx-loupe" aria-hidden="true">${ico('search')}</span><input type="text" enterkeyhint="search" id="faqQ" placeholder="Rechercher : mot de passe, matricule, chrono…" aria-label="Rechercher dans l'aide" autocomplete="off"></div>
      <div class="faq-list" id="faqList">${list()}</div>
      <p class="faq-foot">Pas de réponse ? Demandez au responsable de l'atelier.</p></div>`;
    document.body.appendChild(box);
    const close = () => { box.remove(); box = null; document.removeEventListener('keydown', onKey); const b = document.getElementById('btnHelp'); if(b) b.focus(); };
    const onKey = e => { if(e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    box.querySelector('.faq-close').onclick = close;
    box.addEventListener('click', e => { if(e.target === box) close(); });
    const input = box.querySelector('#faqQ');
    input.addEventListener('input', () => { q = input.value; box.querySelector('#faqList').innerHTML = list(); });
    input.focus();
  }
  window.openHelp = open;
  ['btnHelp', 'btnHelpLogin'].forEach(id => { const b = document.getElementById(id); if(b) b.addEventListener('click', open); });
})();
