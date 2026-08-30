/* =========================================================
   ReproBench — script.js
   Français en priorité (fr-name), PT/EN en légende
   Registro de Serviço agora usa Supabase (banco Postgres + login)
   ========================================================= */

const SUPABASE_URL = 'https://ddyekeeuaynqipdmlqhq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SBtxarlyHjUf8PcsPaik4w_t-CTwkqJ';

if(typeof supabase === 'undefined'){
  const errEl = document.getElementById('authError');
  if(errEl){
    errEl.hidden = false;
    errEl.style.color = 'var(--warn)';
    errEl.textContent = 'La bibliothèque Supabase n\'a pas chargé (extension du navigateur ou connexion bloquée). Essayez en navigation privée.';
  }
  throw new Error('Supabase SDK non chargé — vérifiez les extensions du navigateur ou la connexion internet.');
}

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* E-mails autorisés à voir l'onglet Admin — ajoutez le(s) vôtre(s) ici.
   Note : ceci masque juste l'onglet dans l'interface. Les données ne sont pas
   filtrées par utilisateur côté base (le Suivi affiche déjà l'historique de
   toute l'équipe) — ce n'est donc pas une barrière de sécurité, seulement
   une organisation de l'écran. */
const ADMIN_EMAILS = ['rico3036@gmail.com'];

/* Désactivé temporairement pendant qu'on règle le Storage (photos manquantes
   dans le bucket "job-photos"). Remettre à true pour réactiver la capture
   et l'affichage des photos — tout le code reste en place, rien n'est perdu. */
const PHOTOS_ENABLED = false;

function updateAdminTabVisibility(email){
  const isAdmin = !!email && ADMIN_EMAILS.some(e => e.toLowerCase() === email.toLowerCase());
  document.getElementById('tab-admin-btn').hidden = !isAdmin;
}

/* --- Autenticação --- */
function initAuth(){
  // Conecta os botões IMEDIATAMENTE — antes de qualquer chamada de rede,
  // pra garantir que clicar sempre funciona mesmo se algo mais falhar.
  document.getElementById('btnLogin').addEventListener('click', handleLogin);
  document.getElementById('btnLogout').addEventListener('click', handleLogout);

  // onAuthStateChange sozinho já cobre tudo: dispara "INITIAL_SESSION" assim que
  // registra (cobre o carregamento da página) e depois "SIGNED_IN"/"SIGNED_OUT"
  // conforme o usuário loga/desloga. Não precisa checar a sessão duas vezes.
  sb.auth.onAuthStateChange((_event, session) => {
    if(session){
      showApp();
      updateAdminTabVisibility(session.user.email);
    } else {
      showAuthGate();
    }
  });
}

async function handleLogin(){
  const errEl = document.getElementById('authError');
  errEl.style.color = 'var(--copper-text)';
  errEl.textContent = 'Connexion en cours…';
  errEl.hidden = false;

  try{
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;

    if(!email || !password){
      errEl.style.color = 'var(--warn)';
      errEl.textContent = 'Remplissez email et mot de passe.';
      return;
    }

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error){
      errEl.style.color = 'var(--warn)';
      errEl.textContent = 'Erreur : ' + error.message;
    } else {
      errEl.hidden = true;
    }
  }catch(e){
    errEl.style.color = 'var(--warn)';
    errEl.textContent = 'Erreur inattendue : ' + e.message;
    console.error(e);
  }
}

async function handleLogout(){
  if(!confirm('Se déconnecter ?')) return;
  await sb.auth.signOut();
}

function showApp(){
  document.getElementById('auth-gate').hidden = true;
  document.getElementById('app-shell').hidden = false;
}
function showAuthGate(){
  document.getElementById('app-shell').hidden = true;
  document.getElementById('auth-gate').hidden = false;
}
initAuth();

/* ======================= DONNÉES : PIÈCES ======================= */
const PARTS = [
  { cat:"limpeza", fr:"Tambour", pt:"Tambor", en:"Drum unit", shape:"roller",
    desc:"Cylindre photosensible qui forme l'image. Très sensible aux rayures et à la lumière directe." },
  { cat:"limpeza", fr:"Racle de nettoyage", pt:"Lâmina de limpeza", en:"Cleaning blade", shape:"blade", photoQuery:"cleaning blade printer drum part",
    desc:"Racle le toner résiduel du tambour après le transfert." },
  { cat:"limpeza", fr:"Brosse de nettoyage", pt:"Escova de limpeza", en:"Cleaning brush", shape:"brush", photoQuery:"cleaning brush printer copier part",
    desc:"Enlève la poussière et les résidus de toner des rouleaux et surfaces." },
  { cat:"limpeza", fr:"Rouleau de charge", pt:"Rolo de carga", en:"Charge roller", shape:"roller", photoQuery:"charge roller printer part",
    desc:"Applique une charge électrique uniforme sur le tambour avant l'exposition." },
  { cat:"limpeza", fr:"Filtre à ozone", pt:"Filtro de ozônio", en:"Ozone filter", shape:"filter", photoQuery:"ozone filter printer copier part",
    desc:"Retient l'ozone généré pendant le processus de charge électrique." },
  { cat:"limpeza", fr:"Vitre du scanner", pt:"Vidro do scanner", en:"Scanner glass", shape:"glass", photoQuery:"scanner glass copier part",
    desc:"Surface de lecture optique ; la poussière ici crée des lignes sur la copie." },
  { cat:"limpeza", fr:"Miroir du scanner", pt:"Espelho do scanner", en:"Scanner mirror", shape:"glass", photoQuery:"scanner mirror assembly copier part",
    desc:"Réfléchit la lumière du document jusqu'au capteur. Nettoyage délicat." },
  { cat:"limpeza", fr:"Lentille / objectif CCD", pt:"Lente / lente CCD", en:"Lens / CCD lens", shape:"sensor", photoQuery:"CCD lens scanner copier part",
    desc:"Fait la mise au point de l'image sur le capteur de lecture." },
  { cat:"limpeza", fr:"Bac de récupération de toner", pt:"Recipiente de resíduo de toner", en:"Waste toner box", shape:"box", photoQuery:"waste toner box printer part",
    desc:"Collecte le toner excédentaire racié du tambour/de la toile." },

  { cat:"montagem", fr:"Chargeur automatique de documents (ADF)", pt:"Alimentador automático de documentos", en:"Automatic Document Feeder (ADF)", shape:"tray", photoQuery:"automatic document feeder ADF copier assembly", top:1,
    desc:"Tire les feuilles automatiquement pour la numérisation/copie. 1ère étape du démontage officiel." },
  { cat:"montagem", fr:"Cartouche de toner", pt:"Cartucho de toner", en:"Toner cartridge", shape:"cartridge", photoQuery:"toner cartridge printer part", top:2,
    desc:"Réservoir de toner qui alimente l'unité d'image. 2ème étape du démontage officiel." },
  { cat:"montagem", fr:"Toile de transfert (CTI)", pt:"Correia de transferência", en:"Transfer belt", shape:"belt", top:3,
    desc:"Transporte l'image de toner jusqu'au papier (équipements couleur). Sigle courant : \"CTI\". 3ème étape du démontage officiel." },
  { cat:"montagem", fr:"Bloc développeur (BD)", pt:"Unidade de imagem (bloco developer)", en:"Developer block / imaging unit", shape:"box", top:4,
    desc:"Ensemble qui applique le toner sur le tambour. Sigle courant : \"BD\". 4ème étape du démontage officiel." },
  { cat:"montagem", fr:"Baguette laser", pt:"Barra/unidade laser", en:"Laser scan unit", shape:"laser", top:5,
    desc:"Unité optique qui trace l'image sur le tambour photosensible. 5ème étape du démontage officiel — pièce sensible, évitez poussière et rayures sur la vitre de protection." },
  { cat:"montagem", fr:"Four (fusor)", pt:"Fusor", en:"Fuser unit", shape:"box", top:6,
    desc:"Chauffe et presse le toner sur le papier pour le fixer. Appelé \"four\" dans le jargon technique." },
  { cat:"montagem", fr:"Patin K7", pt:"Patim K7 (separador)", en:"K7 separator pad", shape:"pad", top:7,
    desc:"Patin séparateur en caoutchouc qui empêche l'entraînement de plusieurs feuilles à la fois depuis le bac principal. Pièce d'usure fréquente — changement systématique au reconditionnement (checklist officielle)." },
  { cat:"montagem", fr:"Patin ADF", pt:"Patim ADF (separador)", en:"ADF separator pad", shape:"pad", top:8,
    desc:"Patin séparateur du chargeur automatique de documents (ADF), empêche l'entraînement de plusieurs feuilles pendant la numérisation. Changement systématique au reconditionnement (checklist officielle)." },
  { cat:"montagem", fr:"Rouleau du four", pt:"Rolo do fusor", en:"Fuser roller", shape:"roller", photoQuery:"fuser roller printer part",
    desc:"Rouleau chauffant/presseur à l'intérieur du four." },
  { cat:"montagem", fr:"Rouleau de transfert", pt:"Rolo de transferência", en:"Transfer roller", shape:"roller", photoQuery:"transfer roller printer part", top:9,
    desc:"Transfère le toner du tambour vers le papier." },
  { cat:"montagem", fr:"Rouleau d'alimentation", pt:"Rolo de alimentação", en:"Feed roller", shape:"roller", photoQuery:"feed roller printer part",
    desc:"Tire le papier du bac vers l'intérieur du parcours." },
  { cat:"montagem", fr:"Galet d'entraînement (pickup)", pt:"Rolo de captação (pickup)", en:"Pickup roller", shape:"roller", photoQuery:"pickup roller printer part",
    desc:"Premier rouleau à toucher la pile de papier, démarre l'alimentation." },
  { cat:"montagem", fr:"Bac à papier", pt:"Bandeja de papel", en:"Paper tray", shape:"tray", photoQuery:"paper tray printer copier part",
    desc:"Compartiment amovible de stockage du papier." },
  { cat:"montagem", fr:"Engrenage", pt:"Engrenagem", en:"Gear", shape:"gear", photoQuery:"printer gear part copier",
    desc:"Transmet le mouvement entre le moteur et les rouleaux/tambour." },
  { cat:"montagem", fr:"Ressort", pt:"Mola", en:"Spring", shape:"spring", photoQuery:"printer spring part copier",
    desc:"Maintient la pression sur les rouleaux, capots et mécanismes de verrouillage." },
  { cat:"montagem", fr:"Nappe / câble plat", pt:"Cabo flat / nappe", en:"Flat cable / ribbon cable", shape:"cable", photoQuery:"flat ribbon cable printer part",
    desc:"Câble plat qui relie les cartes aux capteurs/moteurs." },
  { cat:"montagem", fr:"Vis", pt:"Parafuso", en:"Screw", shape:"screw", photoQuery:"printer copier screw part kit",
    desc:"Fixation standard des châssis et modules. Vérifier en particulier la vis de fixation du socle K7 (checklist officielle)." },
  { cat:"montagem", fr:"Châssis", pt:"Chassi", en:"Chassis / frame", shape:"frame", photoQuery:"printer copier chassis frame part",
    desc:"Structure métallique/plastique qui soutient tous les modules." },
  { cat:"montagem", fr:"Kit d'entretien", pt:"Kit de manutenção", en:"Maintenance kit", shape:"box", photoQuery:"maintenance kit printer copier",
    desc:"Ensemble de pièces d'usure remplacées ensemble (rouleaux, four, etc.)." },
  { cat:"montagem", fr:"Écran / panneau de contrôle", pt:"Painel de controle", en:"Control panel", shape:"screen", top:10,
    desc:"Écran/clavier de commande de l'équipement." },

  { cat:"eletrica", fr:"Carte mère", pt:"Placa-mãe", en:"Mainboard", shape:"board",
    desc:"Carte principale qui contrôle toute la machine. Terme courant : \"carte\"." },
  { cat:"eletrica", fr:"Carte contrôleur", pt:"Placa controladora", en:"Controller board", shape:"board", photoQuery:"controller board printer copier part",
    desc:"Contrôle des modules spécifiques (image, moteur, réseau)." },
  { cat:"eletrica", fr:"Bloc d'alimentation", pt:"Fonte de alimentação", en:"Power supply unit (PSU)", shape:"plug", photoQuery:"power supply unit printer copier part",
    desc:"Convertit l'énergie du réseau électrique pour les composants internes." },
  { cat:"eletrica", fr:"Moteur principal", pt:"Motor principal", en:"Main motor", shape:"gear", photoQuery:"main drive motor printer copier part",
    desc:"Actionne le système d'engrenages et de rouleaux." },
  { cat:"eletrica", fr:"Capteur de papier", pt:"Sensor de papel", en:"Paper sensor", shape:"sensor", photoQuery:"paper sensor printer part",
    desc:"Détecte la présence/le passage du papier ; cause fréquente de bourrage détecté à tort." },
  { cat:"eletrica", fr:"Contacts électriques", pt:"Contatos elétricos", en:"Electrical contacts", shape:"cable", photoQuery:"toner cartridge electrical contacts printer",
    desc:"Points de contact entre la cartouche/l'unité et la machine." },
];

/* Icônes SVG offline — style dessin technique (traits + ombrage léger) */
const ICONS = {
  roller: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="7" width="16" height="10" rx="5" fill="currentColor" fill-opacity="0.12"/>
    <line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/>
    <ellipse cx="4" cy="12" rx="1.2" ry="5"/><ellipse cx="20" cy="12" rx="1.2" ry="5"/>
    <line x1="8" y1="8.2" x2="8" y2="15.8"/><line x1="12" y1="7.6" x2="12" y2="16.4"/><line x1="16" y1="8.2" x2="16" y2="15.8"/>
  </svg>`,
  blade: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 18 L16 4 L21 8 L9 22 Z" fill="currentColor" fill-opacity="0.12"/>
    <line x1="6" y1="16.5" x2="17.5" y2="5"/>
    <path d="M3 21l2-4" />
  </svg>`,
  brush: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="10" y="2.5" width="4" height="8" rx="1" fill="currentColor" fill-opacity="0.12"/>
    <rect x="8.5" y="10.2" width="7" height="2" rx="0.5"/>
    <path d="M8 12.2h8l-1.1 9.3a1 1 0 0 1-1 .9H10.1a1 1 0 0 1-1-.9z" fill="currentColor" fill-opacity="0.08"/>
    <line x1="9.6" y1="14.5" x2="9.3" y2="20"/><line x1="12" y1="14.5" x2="12" y2="20.3"/><line x1="14.4" y1="14.5" x2="14.7" y2="20"/>
  </svg>`,
  filter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="currentColor" fill-opacity="0.06"/>
    <line x1="3.5" y1="8.3" x2="20.5" y2="8.3"/><line x1="3.5" y1="12" x2="20.5" y2="12"/><line x1="3.5" y1="15.7" x2="20.5" y2="15.7"/>
    <line x1="8.3" y1="3.5" x2="8.3" y2="20.5"/><line x1="12" y1="3.5" x2="12" y2="20.5"/><line x1="15.7" y1="3.5" x2="15.7" y2="20.5"/>
  </svg>`,
  glass: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="1.5" fill="currentColor" fill-opacity="0.08"/>
    <line x1="6" y1="16.5" x2="11" y2="7.5"/><line x1="9" y1="16.5" x2="13.5" y2="9"/>
    <circle cx="4.3" cy="6.3" r="0.6" fill="currentColor" stroke="none"/><circle cx="19.7" cy="17.7" r="0.6" fill="currentColor" stroke="none"/>
  </svg>`,
  cartridge: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3.5" y="9" width="17" height="10.5" rx="2" fill="currentColor" fill-opacity="0.12"/>
    <rect x="7.5" y="4" width="9" height="5.5" rx="1"/>
    <rect x="6" y="12" width="4.5" height="4.5" rx="0.6" fill="currentColor" fill-opacity="0.25" stroke-width="1"/>
    <line x1="13" y1="12" x2="18" y2="12"/><line x1="13" y1="15.2" x2="18" y2="15.2"/>
  </svg>`,
  belt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="6.5" cy="12" r="4" fill="currentColor" fill-opacity="0.1"/>
    <circle cx="17.5" cy="12" r="4" fill="currentColor" fill-opacity="0.1"/>
    <circle cx="6.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="12" r="1" fill="currentColor" stroke="none"/>
    <path d="M6.5 8v-.3a11 11 0 0 1 11 0V8" />
    <path d="M6.5 16v.3a11 11 0 0 0 11 0V16" />
    <path d="M15.5 6.5l1.8 1-1 1.6" />
  </svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3.6" fill="currentColor" fill-opacity="0.12"/>
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>
    <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M19 5l-2.1 2.1M7.1 16.9L5 19M19 19l-2.1-2.1M7.1 7.1L5 5"/>
    <path d="M15.6 4.6l1 2.8M7.4 16.6l1 2.8M19.4 8.4l-2.8 1M4.6 15.4l2.8-1M19.4 15.6l-2.8-1M4.6 8.6l2.8 1M15.6 19.4l1-2.8M7.4 7.4l1-2.8"/>
  </svg>`,
  spring: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="3" r="1.1" fill="currentColor" fill-opacity="0.25"/>
    <path d="M12 4v1.2l6 1.8-6 1.8 6 1.8-6 1.8 6 1.8-6 1.8v1.2"/>
    <circle cx="12" cy="21" r="1.1" fill="currentColor" fill-opacity="0.25"/>
  </svg>`,
  cable: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2.5" y="9" width="14" height="6" rx="1" fill="currentColor" fill-opacity="0.12"/>
    <path d="M16.5 9l4 1.2v3.6l-4 1.2z" fill="currentColor" fill-opacity="0.2"/>
    <line x1="5.5" y1="9" x2="5.5" y2="15"/><line x1="8.5" y1="9" x2="8.5" y2="15"/><line x1="11.5" y1="9" x2="11.5" y2="15"/><line x1="14.5" y1="9" x2="14.5" y2="15"/>
  </svg>`,
  screw: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="7" r="5" fill="currentColor" fill-opacity="0.12"/>
    <line x1="7.5" y1="7" x2="16.5" y2="7"/><line x1="12" y1="2.5" x2="12" y2="11.5"/>
    <path d="M9.5 12l-1.3 9M14.5 12l1.3 9M12 12v9.3" stroke-width="1.2"/>
  </svg>`,
  frame: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5"/>
    <rect x="3" y="3" width="18" height="18" fill="currentColor" fill-opacity="0.05" stroke="none"/>
    <line x1="3" y1="3" x2="8" y2="8" stroke-width="1"/><line x1="21" y1="3" x2="16" y2="8" stroke-width="1"/>
    <line x1="3" y1="21" x2="8" y2="16" stroke-width="1"/><line x1="21" y1="21" x2="16" y2="16" stroke-width="1"/>
  </svg>`,
  board: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3.5" width="18" height="17" rx="1.2" fill="currentColor" fill-opacity="0.06"/>
    <rect x="6" y="6.5" width="6" height="6" rx="0.6" fill="currentColor" fill-opacity="0.2"/>
    <circle cx="17" cy="7.5" r="1"/><circle cx="17" cy="11" r="1"/>
    <path d="M12 8h3M12 11h3M6 15h12M6 17.5h8"/>
  </svg>`,
  tray: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 5h8l3 5H5z" fill="currentColor" fill-opacity="0.1"/>
    <rect x="3.5" y="10" width="17" height="8.5" rx="1" fill="currentColor" fill-opacity="0.1"/>
    <line x1="6.5" y1="12.5" x2="17.5" y2="12.5" stroke-width="1"/><line x1="6.5" y1="15" x2="17.5" y2="15" stroke-width="1"/>
  </svg>`,
  screen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="12.5" rx="1.2" fill="currentColor" fill-opacity="0.1"/>
    <line x1="9" y1="20.5" x2="15" y2="20.5"/><line x1="12" y1="16.5" x2="12" y2="20.5"/>
    <rect x="5.5" y="6.3" width="7" height="1.6" rx="0.5" fill="currentColor" fill-opacity="0.3" stroke="none"/>
    <line x1="5.5" y1="9.8" x2="14.5" y2="9.8" stroke-width="1"/><line x1="5.5" y1="12.3" x2="11" y2="12.3" stroke-width="1"/>
    <circle cx="18" cy="10.5" r="1.1" fill="currentColor" fill-opacity="0.3" stroke="none"/>
  </svg>`,
  plug: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="8" width="13" height="10" rx="2" fill="currentColor" fill-opacity="0.12"/>
    <line x1="8.5" y1="8" x2="8.5" y2="4.5"/><line x1="14.5" y1="8" x2="14.5" y2="4.5"/>
    <path d="M18 12c2.5 0 3.5 1 3.5 1.8S20.5 15.5 18 15.5" stroke-width="1.3"/>
    <circle cx="9.5" cy="13" r="0.9" fill="currentColor" stroke="none"/><circle cx="13.5" cy="13" r="0.9" fill="currentColor" stroke="none"/>
  </svg>`,
  sensor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" fill="currentColor" fill-opacity="0.2"/>
    <circle cx="12" cy="12" r="6" stroke-dasharray="1.5 2.2"/>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
  </svg>`,
  laser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="10" width="6" height="4" rx="1" fill="currentColor" fill-opacity="0.18"/>
    <path d="M9 12h4" stroke-width="1.3"/>
    <path d="M13 12l8-6M13 12l8 3M13 12l8 6" stroke-width="1" stroke-dasharray="1.2 1.6"/>
    <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
  </svg>`,
  pad: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="7" width="16" height="10" rx="3" fill="currentColor" fill-opacity="0.14"/>
    <path d="M7 10.3c1.5 1 2.5-1 4-1s2.5 2 4 2 2.5-2 4-2" stroke-width="1.1"/>
    <path d="M7 14c1.5 1 2.5-1 4-1s2.5 2 4 2 2.5-2 4-2" stroke-width="1.1"/>
  </svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 8l9-5 9 5-9 5-9-5z" fill="currentColor" fill-opacity="0.16"/>
    <path d="M3 8v8l9 5 9-5V8" fill="currentColor" fill-opacity="0.06"/>
    <line x1="12" y1="13" x2="12" y2="21"/><line x1="3" y1="8" x2="12" y2="13"/><line x1="21" y1="8" x2="12" y2="13"/>
  </svg>`,
};
function iconFor(shape){ return ICONS[shape] || ICONS.box; }

/* Modèles connus par marque — juste des suggestions (datalist), le champ reste libre.
   Complétez cette liste au fil du temps avec les modèles que vous croisez le plus. */
const MODELS_BY_BRAND = {
  Canon: ['iR-ADV C256i','iR-ADV C257i','iR-ADV C259i','iR-ADV C3525i','iR-ADV C3530i','iR-ADV C5535i','iR-ADV C5540i','iR2625i','iR2630i','iR2635i','iR2645i','iR-ADV DX C3826i','iR-ADV DX C3830i','iR-ADV DX C5850i'],
  Toshiba: ['e-STUDIO2523A','e-STUDIO2528A','e-STUDIO3528A','e-STUDIO5528A','e-STUDIO2515AC','e-STUDIO2518A','e-STUDIO3018A','e-STUDIO2020AC','e-STUDIO4525AC'],
  Kyocera: ['TASKalfa 2553ci','TASKalfa 2554ci','TASKalfa 3212i','TASKalfa 3253ci','TASKalfa 3552ci','TASKalfa 4053ci','TASKalfa 5053ci'],
  'Konica Minolta': ['bizhub 227','bizhub 287','bizhub 367','bizhub C258','bizhub C308','bizhub C368','bizhub C458','bizhub C558','bizhub C658'],
  Sharp: ['MX-2614N','MX-2651','MX-3051','MX-3114N','MX-3551','MX-4051','MX-M3550'],
  Ricoh: ['MP C3003','MP C3503','MP C4503','MP C5503','IM 350F','IM C3000','IM C3500','IM C4500'],
};

function updateModelSuggestions(){
  const brand = document.getElementById('fieldBrand').value;
  const models = MODELS_BY_BRAND[brand] || [];
  document.getElementById('modelsList').innerHTML =
    models.map(m => `<option value="${escapeHtml(m)}"></option>`).join('');
}
document.getElementById('fieldBrand').addEventListener('change', updateModelSuggestions);

const CAT_LABEL = { limpeza:"Nettoyage", montagem:"Montage", eletrica:"Électrique" };

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');
const searchEl = document.getElementById('search');
const chipButtons = document.querySelectorAll('.chip');
let activeCat = 'all';

function normalize(s){
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

/* Escapa texto digitado pelo usuário antes de injetar em innerHTML — proteção contra XSS */
/* Titre d'un job dans les listes : marque·modèle pour un service imprimante,
   ou juste l'étape pour une activité interne (réunion, formation...). */
function jobTitleLine(job){
  if(job.brand) return `${escapeHtml(job.brand)} · ${escapeHtml(job.model)}`;
  const qte = job.quantite != null ? ` · Qté ${job.quantite}` : '';
  return `${escapeHtml(job.etape || 'Activité')}${qte}`;
}

function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderParts(){
  const q = normalize(searchEl.value.trim());
  let filtered;
  if(activeCat === 'top'){
    filtered = PARTS.filter(p => p.top).sort((a, b) => a.top - b.top);
    if(q) filtered = filtered.filter(p => normalize(`${p.fr} ${p.pt} ${p.en} ${p.desc}`).includes(q));
  } else {
    filtered = PARTS.filter(p => {
      if(activeCat !== 'all' && p.cat !== activeCat) return false;
      if(!q) return true;
      return normalize(`${p.fr} ${p.pt} ${p.en} ${p.desc}`).includes(q);
    });
  }

  listEl.innerHTML = '';
  countEl.textContent = `${filtered.length} pièce(s)`;
  emptyEl.hidden = filtered.length > 0;

  filtered.forEach(p => {
    const li = document.createElement('li');
    li.className = `card cat-${p.cat}`;

    const photoQuery = encodeURIComponent(p.photoQuery || `${p.en} printer part`);
    const photoUrl = `https://www.google.com/search?tbm=isch&q=${photoQuery}`;
    const photoBlock = p.refPhoto
      ? `<a href="${p.refPhoto}" target="_blank" rel="noopener">
           <img class="ref-photo" src="${p.refPhoto}" alt="${p.fr}" loading="lazy">
         </a>
         <p class="ref-badge">📷 photo de référence (nécessite internet)</p>`
      : `<a class="photo-link" href="${photoUrl}" target="_blank" rel="noopener">
           <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
             <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
           </svg>
           Voir des photos
         </a>`;

    li.innerHTML = `
      <div class="card-top">
        <div class="card-title">
          <span class="part-icon" aria-hidden="true">${iconFor(p.shape)}</span>
          <p class="fr-name">${p.fr}</p>
        </div>
        <div class="card-badges">
          ${p.top ? `<span class="top-badge">★ ${p.top}</span>` : ''}
          <span class="tag">${CAT_LABEL[p.cat]}</span>
        </div>
      </div>
      <div class="lang-row">
        <span class="lang-item"><span class="lang-flag">PT</span>${p.pt}</span>
        <span class="lang-item"><span class="lang-flag">EN</span>${p.en}</span>
      </div>
      <p class="desc">${p.desc}</p>
      ${photoBlock}
    `;
    listEl.appendChild(li);
  });
}

searchEl.addEventListener('input', renderParts);
chipButtons.forEach(chip => {
  chip.addEventListener('click', () => {
    chipButtons.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeCat = chip.dataset.cat;
    renderParts();
  });
});
renderParts();

/* ======================= NAVIGATION PAR ONGLETS ======================= */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById('view-' + tab.dataset.view).classList.add('active');

    if(tab.dataset.view === 'registro') initRegistro();
    if(tab.dataset.view === 'analyse') initAnalyse();
    if(tab.dataset.view === 'admin') initAdmin();
  });
});

/* ======================= SUIVI DE SERVICE ======================= */

/* --- Accès aux données (Supabase / Postgres) --- */

async function getJobById(id){
  const { data, error } = await sb
    .from('jobs')
    .select('*, job_pauses(*)')
    .eq('id', id)
    .maybeSingle();
  if(error){ console.error('Erreur getJobById:', error); return null; }
  return data ? mapJobFromDb(data) : null;
}

/* Tous les services non terminés visibles pour l'utilisateur connecté — un
   technicien peut avoir plusieurs services ouverts (un en cours, d'autres en
   pause) ; un admin voit ceux de toute l'équipe grâce aux policies RLS. */
async function getOpenJobs(){
  const { data, error } = await sb
    .from('jobs')
    .select('*, job_pauses(*)')
    .is('finished_at', null)
    .order('started_at', { ascending: false });
  if(error){ console.error('Erreur getOpenJobs:', error); return []; }
  return data.map(mapJobFromDb);
}

async function getHistory(){
  const { data, error } = await sb
    .from('jobs')
    .select('*')
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false });
  if(error){ console.error('Erreur getHistory:', error); return []; }
  return data.map(mapJobFromDb);
}

function mapJobFromDb(row){
  return {
    id: row.id,
    name: row.technician,
    brand: row.brand,
    model: row.model,
    photoBase64: row.photo_url,
    photoFinalBase64: row.photo_url_final,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    activeSeconds: row.active_seconds,
    note: row.note,
    etape: row.etape,
    quantite: row.quantite,
    pausedIntervals: (row.job_pauses || []).map(p => ({
      id: p.id, start: p.start_at, end: p.end_at, label: p.label
    })),
    status: (row.job_pauses || []).some(p => !p.end_at) ? 'paused' : 'running'
  };
}

async function createJob({ name, brand, model, photoUrl, startedAt }){
  const { data: userData } = await sb.auth.getUser();
  const { data, error } = await sb
    .from('jobs')
    .insert({
      user_id: userData.user.id,
      technician: name, brand, model,
      photo_url: photoUrl,
      started_at: startedAt
    })
    .select()
    .single();
  if(error){ console.error('Erreur createJob:', error); return null; }
  return mapJobFromDb(data);
}

/* Enregistrement rapide (quantité) : pas de chronomètre, pas de marque/modèle —
   juste une étape + une quantité pour un jour donné, sauvegardé déjà "terminé"
   (started_at = finished_at) pour apparaître tout de suite dans l'historique.
   brand/model restent '' plutôt que null pour rester compatibles avec une
   éventuelle contrainte NOT NULL. */
async function createQuickLogEntry({ name, etape, quantite, note, when }){
  const { data: userData } = await sb.auth.getUser();
  const { error } = await sb
    .from('jobs')
    .insert({
      user_id: userData.user.id,
      technician: name, brand: '', model: '',
      etape, quantite, note: note || null,
      started_at: when, finished_at: when, active_seconds: 0
    });
  if(error){ console.error('Erreur createQuickLogEntry:', error); return false; }
  return true;
}

async function addPause(jobId, label, startAt){
  const { data, error } = await sb
    .from('job_pauses')
    .insert({ job_id: jobId, label, start_at: startAt })
    .select()
    .single();
  if(error){ console.error('Erreur addPause:', error); return null; }
  return data.id;
}

async function closeOpenPause(jobId, endAt){
  const { error } = await sb
    .from('job_pauses')
    .update({ end_at: endAt })
    .eq('job_id', jobId)
    .is('end_at', null);
  if(error) console.error('Erreur closeOpenPause:', error);
}

async function finishJobInDb(jobId, finishedAt, activeSeconds, note, etape, quantite, photoFinalUrl){
  const fields = { finished_at: finishedAt, active_seconds: Math.round(activeSeconds), note, etape: etape || null, quantite: quantite ?? null };
  if(photoFinalUrl) fields.photo_url_final = photoFinalUrl;
  const { error } = await sb.from('jobs').update(fields).eq('id', jobId);
  if(error) console.error('Erreur finishJobInDb:', error);
}

async function updateJobFields(jobId, fields){
  const { error } = await sb.from('jobs').update(fields).eq('id', jobId);
  if(error) console.error('Erreur updateJobFields:', error);
}

async function deleteJobInDb(jobId){
  const { error } = await sb.from('jobs').delete().eq('id', jobId);
  if(error) console.error('Erreur deleteJobInDb:', error);
}

async function getSetting(key){
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if(error || !data) return null;
  return data.value;
}
async function setSetting(key, value){
  const { data: userData } = await sb.auth.getUser();
  const { error } = await sb.from('settings').upsert({ user_id: userData.user.id, key, value });
  if(error) console.error('Erreur setSetting:', error);
}

async function uploadJobPhoto(jobIdOrTemp, base64DataUrl){
  const { data: userData } = await sb.auth.getUser();
  const blob = dataUrlToBlob(base64DataUrl);
  const path = `${userData.user.id}/${jobIdOrTemp}.jpg`;
  const { error } = await sb.storage.from('job-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if(error){ console.error('Erreur uploadJobPhoto:', error); return null; }
  return path; // guardamos só o caminho — o link de exibição é gerado na hora, temporário
}

/* Bucket privado: gère un lien temporaire (1h) só quando for exibir a foto */
async function resolvePhotoUrl(path){
  if(!path) return null;
  const { data, error } = await sb.storage.from('job-photos').createSignedUrl(path, 3600);
  if(error){ console.error('Erreur resolvePhotoUrl:', error); return null; }
  return data.signedUrl;
}

/* Si la photo ne peut pas être résolue (fichier manquant, etc.), remplace
   l'<img> par un placeholder au lieu de laisser une image vide/cassée. */
function showResolvedPhoto(img, url){
  if(url){ img.src = url; return; }
  const placeholder = document.createElement('div');
  placeholder.className = img.className;
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.title = 'Photo indisponible';
  placeholder.textContent = '📷';
  img.replaceWith(placeholder);
}

/* --- Temps : calcul par timestamp réel, jamais par compteur --- */
function getActiveSeconds(job, now){
  const started = new Date(job.startedAt).getTime();
  const totalMs = now.getTime() - started;
  let pausedMs = 0;
  (job.pausedIntervals || []).forEach(iv => {
    const start = new Date(iv.start).getTime();
    const end = iv.end ? new Date(iv.end).getTime() : now.getTime();
    pausedMs += (end - start);
  });
  return Math.max(0, (totalMs - pausedMs) / 1000);
}
function fmtHMS(totalSeconds){
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}
function fmtHShort(totalSeconds){
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

/* --- Conversion data URL -> Blob (sans fetch, car bloqué par la CSP connect-src) --- */
function dataUrlToBlob(dataUrl){
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* --- Compression d'image avant upload --- */
function compressImage(file, maxWidth, quality){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier échouée'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Chargement de l\'image échoué'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* --- Lecture automatique (OCR via IA) --- */
async function tryOCR(base64){
  const statusEl = document.getElementById('ocrStatus');
  statusEl.hidden = false;
  statusEl.textContent = 'Lecture de la photo…';
  try{
    const mediaType = base64.substring(5, base64.indexOf(';'));
    const rawBase64 = base64.split(',')[1];
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: rawBase64 } },
            { type: "text", text: "Ceci est la photo d'un bon de commande de reconditionnement d'imprimante. Réponds UNIQUEMENT avec un JSON au format {\"brand\":\"...\",\"model\":\"...\"} avec la marque (Canon, Toshiba, Kyocera, Konica Minolta, Sharp, Ricoh, ou celle écrite sur le papier) et le modèle de l'imprimante identifiés. Si un champ est illisible, laisse une chaîne vide. N'écris rien d'autre que le JSON." }
          ]
        }]
      })
    });
    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if(textBlock){
      const clean = textBlock.text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      const brandSelect = document.getElementById('fieldBrand');
      if(parsed.brand){
        const opt = Array.from(brandSelect.options).find(o => o.value.toLowerCase() === parsed.brand.toLowerCase());
        brandSelect.value = opt ? opt.value : 'Autre';
        updateModelSuggestions();
      }
      if(parsed.model) document.getElementById('fieldModel').value = parsed.model;
      statusEl.textContent = '✓ Suggestion remplie — vérifiez avant de démarrer';
    } else {
      statusEl.textContent = 'Lecture automatique impossible — remplissez à la main.';
    }
  }catch(err){
    statusEl.textContent = 'Lecture automatique impossible — remplissez à la main.';
  }
}

/* --- États de l'écran Suivi --- */
let regInited = false;
let tickInterval = null;
let pendingPhotoBase64 = null;
let pendingPhotoFinalBase64 = null;
let activeJobId = null;

function showState(name){
  ['idle', 'form', 'activity', 'running', 'finish'].forEach(s => {
    document.getElementById('state-' + s).hidden = (s !== name);
  });
}

async function initRegistro(){
  if(regInited) return;
  regInited = true;
  wireFormEvents();
  wireActivityEvents();
  wireRunningStaticEvents();
  wireFinishEvents();
  wireExportEvent();
  await refreshIdleView();
}

function renderPausedList(pausedJobs){
  const section = document.getElementById('paused-section');
  const listEl = document.getElementById('paused-list');
  section.hidden = pausedJobs.length === 0;
  listEl.innerHTML = '';

  pausedJobs.forEach(job => {
    const li = document.createElement('li');
    li.className = 'job-card';
    const thumb = job.photoBase64
      ? `<img class="job-thumb" data-photo-path="${escapeHtml(job.photoBase64)}" alt="Photo du bon">`
      : `<div class="job-thumb" aria-hidden="true">📷</div>`;
    const lastPause = job.pausedIntervals[job.pausedIntervals.length - 1];
    li.innerHTML = `
      ${PHOTOS_ENABLED ? `<div class="job-thumbs">${thumb}</div>` : ''}
      <div class="job-info">
        <p class="job-model">${jobTitleLine(job)}</p>
        <p class="job-meta">⏸ ${lastPause ? escapeHtml(lastPause.label) : 'En pause'}${job.name ? ' · ' + escapeHtml(job.name) : ''}</p>
      </div>
      <div class="job-actions">
        <button type="button" class="btn-resume" data-id="${job.id}">▶ Reprendre</button>
      </div>`;
    listEl.appendChild(li);
  });

  listEl.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const job = pausedJobs.find(j => j.id === btn.dataset.id);
      if(job) showRunning(job);
    });
  });

  listEl.querySelectorAll('img[data-photo-path]').forEach(async (img) => {
    const url = await resolvePhotoUrl(img.dataset.photoPath);
    if(url) img.src = url;
  });
}

async function refreshIdleView(){
  document.getElementById('reg-loading').hidden = false;

  const openJobs = await getOpenJobs();
  const running = openJobs.find(j => j.status === 'running');
  if(running){
    document.getElementById('reg-loading').hidden = true;
    showRunning(running);
    return;
  }

  renderPausedList(openJobs.filter(j => j.status === 'paused'));

  const history = await getHistory();
  const todayStr = new Date().toDateString();
  const todaySeconds = history
    .filter(j => new Date(j.finishedAt).toDateString() === todayStr)
    .reduce((sum, j) => sum + (j.activeSeconds || 0), 0);
  document.getElementById('today-total-val').textContent = fmtHShort(todaySeconds);

  const listEl2 = document.getElementById('history-list');
  const emptyEl2 = document.getElementById('history-empty');
  listEl2.innerHTML = '';
  emptyEl2.hidden = history.length > 0;

  history.forEach(job => {
    const li = document.createElement('li');
    li.className = 'job-card';
    const dateStr = new Date(job.finishedAt).toLocaleDateString('fr-FR');
    const thumb = job.photoBase64
      ? `<img class="job-thumb" data-photo-path="${escapeHtml(job.photoBase64)}" alt="Photo du bon">`
      : `<div class="job-thumb" aria-hidden="true">📷</div>`;
    const thumbFinal = job.photoFinalBase64
      ? `<img class="job-thumb" data-photo-path="${escapeHtml(job.photoFinalBase64)}" alt="Photo machine terminée">`
      : '';
    li.innerHTML = `
      ${PHOTOS_ENABLED ? `<div class="job-thumbs">${thumb}${thumbFinal}</div>` : ''}
      <div class="job-info">
        <p class="job-model">${jobTitleLine(job)}</p>
        <p class="job-meta">${job.activeSeconds ? fmtHShort(job.activeSeconds) + ' · ' : ''}${dateStr}${job.name ? ' · ' + escapeHtml(job.name) : ''}</p>
        ${(job.brand && job.etape) ? `<p class="job-etape">${escapeHtml(job.etape)}${job.quantite != null ? ' · Qté ' + job.quantite : ''}</p>` : ''}
        ${job.note ? `<p class="job-note">« ${escapeHtml(job.note)} »</p>` : ''}
      </div>
      <div class="job-actions">
        <button type="button" data-act="edit" data-id="${job.id}" aria-label="Modifier">✎</button>
        <button type="button" data-act="del" data-id="${job.id}" aria-label="Supprimer">🗑</button>
      </div>`;
    listEl2.appendChild(li);
  });

  // Resolve os links temporários das fotos em paralelo, sem travar a lista
  listEl2.querySelectorAll('img[data-photo-path]').forEach(async (img) => {
    const url = await resolvePhotoUrl(img.dataset.photoPath);
    if(url) img.src = url;
  });

  listEl2.querySelectorAll('button[data-act="del"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Supprimer cet enregistrement ?')) return;
      await deleteJobInDb(btn.dataset.id);
      refreshIdleView();
    });
  });
  listEl2.querySelectorAll('button[data-act="edit"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const job = history.find(j => j.id === btn.dataset.id);
      if(!job) return;
      const newBrand = prompt('Marque :', job.brand); if(newBrand === null) return;
      const newModel = prompt('Modèle :', job.model); if(newModel === null) return;
      const newNote = prompt('Note :', job.note || ''); if(newNote === null) return;
      await updateJobFields(job.id, { brand: newBrand, model: newModel, note: newNote });
      refreshIdleView();
    });
  });

  clearInterval(tickInterval);
  showState('idle');
  document.getElementById('reg-loading').hidden = true;
}

/* --- Export RGPD : mes propres données, au format JSON --- */
function wireExportEvent(){
  document.getElementById('btnExportData').addEventListener('click', async () => {
    const btn = document.getElementById('btnExportData');
    btn.disabled = true;
    btn.textContent = 'Préparation…';
    try{
      await exportMyData();
    }catch(err){
      console.error('Erreur export RGPD:', err);
      alert('Impossible de préparer l\'export. Réessayez.');
    }finally{
      btn.disabled = false;
      btn.textContent = '⬇ Exporter mes données';
    }
  });
}

async function exportMyData(){
  const { data: userData } = await sb.auth.getUser();
  const [openJobs, history, lastName] = await Promise.all([
    getOpenJobs(),
    getHistory(),
    getSetting('last_name')
  ]);

  const jobs = [...openJobs, ...history];

  const payload = {
    exported_at: new Date().toISOString(),
    account_email: userData.user.email,
    saved_name_preference: lastName || null,
    // Les photos ne sont pas incluses ici (liens temporaires, pas de fichier stable) —
    // demandez-les séparément si besoin.
    services: jobs.map(j => ({
      id: j.id,
      technician_name: j.name,
      brand: j.brand,
      model: j.model,
      started_at: j.startedAt,
      finished_at: j.finishedAt,
      active_seconds: j.activeSeconds,
      etape: j.etape,
      quantite: j.quantite,
      note: j.note,
      has_initial_photo: !!j.photoBase64,
      has_final_photo: !!j.photoFinalBase64
    }))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* --- Formulaire "Nouveau Service" --- */
function wireFormEvents(){
  document.getElementById('photoCaptureBlock').hidden = !PHOTOS_ENABLED;
  document.getElementById('btnNewJob').addEventListener('click', async () => {
    pendingPhotoBase64 = null;
    const preview = document.getElementById('photoPreview');
    preview.removeAttribute('src');
    document.getElementById('ocrStatus').hidden = true;
    document.getElementById('fieldBrand').value = '';
    document.getElementById('fieldModel').value = '';
    updateModelSuggestions();
    document.getElementById('fieldName').value = (await getSetting('last_name')) || '';
    showState('form');
  });

  document.getElementById('btnCancelForm').addEventListener('click', () => showState('idle'));

  document.getElementById('photoBtn').addEventListener('click', () => {
    document.getElementById('photoInput').click();
  });

  document.getElementById('photoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    try{
      const base64 = await compressImage(file, 800, 0.6);
      pendingPhotoBase64 = base64;
      document.getElementById('photoPreview').src = base64;
      await tryOCR(base64);
    }catch(err){
      alert('Impossible de traiter la photo. Réessayez ou saisissez les informations à la main.');
    }
  });

  document.getElementById('jobForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('fieldName').value.trim();
    const brand = document.getElementById('fieldBrand').value;
    const model = document.getElementById('fieldModel').value.trim();
    if(!name || !brand || !model) return; // required + :has() já dá feedback visual

    const submitBtn = document.getElementById('btnStart');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Démarrage…';

    try{
      await setSetting('last_name', name);
      const startedAt = new Date().toISOString();

      let photoUrl = null;
      if(pendingPhotoBase64){
        photoUrl = await uploadJobPhoto('tmp_' + Date.now(), pendingPhotoBase64);
      }

      const job = await createJob({ name, brand, model, photoUrl, startedAt });
      if(!job){
        alert('Impossible de démarrer le service (erreur de connexion). Réessayez.');
        return;
      }
      showRunning(job);
    }catch(err){
      console.error('Erreur au démarrage du service:', err);
      alert('Impossible de démarrer le service (erreur inattendue). Réessayez.');
    }finally{
      submitBtn.disabled = false;
      submitBtn.textContent = 'Démarrer';
    }
  });
}

/* --- Formulaire "Enregistrement rapide" (quantité, sans chronomètre) --- */
function wireActivityEvents(){
  document.getElementById('btnNewActivity').addEventListener('click', async () => {
    document.getElementById('activityType').value = '';
    document.getElementById('activityQte').value = '';
    document.getElementById('activityNote').value = '';
    document.getElementById('activityDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('activityName').value = (await getSetting('last_name')) || '';
    showState('activity');
  });

  document.getElementById('btnCancelActivity').addEventListener('click', () => showState('idle'));

  document.getElementById('activityForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('activityName').value.trim();
    const etape = document.getElementById('activityType').value;
    const dateStr = document.getElementById('activityDate').value;
    if(!name || !etape || !dateStr) return;

    const qteRaw = document.getElementById('activityQte').value;
    const quantite = qteRaw !== '' ? parseInt(qteRaw, 10) : null;
    const note = document.getElementById('activityNote').value.trim();

    const submitBtn = document.getElementById('btnSaveActivity');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enregistrement…';

    try{
      await setSetting('last_name', name);
      const when = new Date(dateStr + 'T12:00:00').toISOString();
      const ok = await createQuickLogEntry({ name, etape, quantite, note, when });
      if(!ok){
        alert('Impossible d\'enregistrer (erreur de connexion). Réessayez.');
        return;
      }
      showState('idle');
      refreshIdleView();
    }catch(err){
      console.error('Erreur enregistrement rapide:', err);
      alert('Impossible d\'enregistrer (erreur inattendue). Réessayez.');
    }finally{
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enregistrer';
    }
  });
}

/* --- Écran cronomètre --- */
function showRunning(job){
  showState('running');
  activeJobId = job.id;

  const thumb = document.getElementById('runningThumb');
  thumb.removeAttribute('src');
  if(PHOTOS_ENABLED && job.photoBase64){
    resolvePhotoUrl(job.photoBase64).then(url => { if(url) thumb.src = url; });
  }

  const startedTime = new Date(job.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const titleLine = job.brand
    ? `${escapeHtml(job.brand)} · ${escapeHtml(job.model)}`
    : escapeHtml(job.etape || 'Activité');
  document.getElementById('runningBrand').innerHTML =
    `${titleLine}<small>${escapeHtml(job.name)} · démarré à ${startedTime}</small>`;

  clearInterval(tickInterval);
  tickInterval = setInterval(() => tick(job), 1000);
  tick(job);

  document.getElementById('btnPause').onclick = async () => {
    const btn = document.getElementById('btnPause');
    btn.disabled = true;
    if(job.status === 'running'){
      await addPause(job.id, 'Manuelle', new Date().toISOString());
    } else {
      await closeOpenPause(job.id, new Date().toISOString());
    }
    const fresh = await getJobById(job.id);
    btn.disabled = false;
    if(fresh) showRunning(fresh);
  };

  document.querySelectorAll('.btn-shortcut').forEach(btn => {
    btn.onclick = async () => {
      if(job.status === 'paused') return;
      btn.disabled = true;
      await addPause(job.id, btn.dataset.label, new Date().toISOString());
      const fresh = await getJobById(job.id);
      btn.disabled = false;
      if(fresh) showRunning(fresh);
    };
  });

  document.getElementById('btnSwitchService').onclick = async () => {
    const btn = document.getElementById('btnSwitchService');
    btn.disabled = true;
    if(job.status === 'running'){
      await addPause(job.id, 'Changement de service', new Date().toISOString());
    }
    clearInterval(tickInterval);
    btn.disabled = false;
    refreshIdleView();
  };

  document.getElementById('btnFinish').onclick = () => {
    document.getElementById('finishNote').value = '';
    document.getElementById('finishEtape').value = '';
    document.getElementById('finishQte').value = '';
    document.querySelectorAll('#autoControlList input[type="checkbox"]').forEach(cb => cb.checked = false);
    pendingPhotoFinalBase64 = null;
    document.getElementById('photoFinalPreview').removeAttribute('src');
    updateChecklistCount();
    document.getElementById('finishPrinterExtras').hidden = !job.brand;
    showState('finish');
  };
}

function tick(job){
  const now = new Date();
  const active = getActiveSeconds(job, now);
  document.getElementById('timerDisplay').textContent = fmtHMS(active);

  const statusEl = document.getElementById('timerStatus');
  if(job.status === 'paused'){
    const last = job.pausedIntervals[job.pausedIntervals.length - 1];
    statusEl.textContent = `⏸ Pause — ${last ? last.label : ''}`;
    statusEl.classList.add('paused');
  } else {
    statusEl.textContent = '● En cours';
    statusEl.classList.remove('paused');
  }

  document.getElementById('warnBanner').hidden = !(job.status === 'running' && active > 6 * 3600);
}

/* --- Note finale + salvamento --- */
function wireRunningStaticEvents(){ /* les handlers dynamiques sont (re)liés dans showRunning() */ }

function updateChecklistCount(){
  const boxes = document.querySelectorAll('#autoControlList input[type="checkbox"]');
  const checked = document.querySelectorAll('#autoControlList input[type="checkbox"]:checked');
  document.getElementById('checklistCount').textContent = `${checked.length} / ${boxes.length} vérifiés`;
}

function wireFinishEvents(){
  document.getElementById('photoFinalBlock').hidden = !PHOTOS_ENABLED;
  document.getElementById('autoControlList').addEventListener('change', updateChecklistCount);

  document.getElementById('photoFinalBtn').addEventListener('click', () => {
    document.getElementById('photoFinalInput').click();
  });

  document.getElementById('photoFinalInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    try{
      const base64 = await compressImage(file, 800, 0.6);
      pendingPhotoFinalBase64 = base64;
      document.getElementById('photoFinalPreview').src = base64;
    }catch(err){
      alert('Impossible de traiter la photo. Réessayez ou continuez sans photo.');
    }
  });

  document.getElementById('btnBackToRunning').addEventListener('click', async () => {
    const current = await getJobById(activeJobId);
    if(current) showRunning(current);
  });

  document.getElementById('finishForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('btnSaveFinish');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enregistrement…';

    const current = await getJobById(activeJobId);
    if(!current){ submitBtn.disabled = false; submitBtn.textContent = 'Enregistrer'; return; }

    const now = new Date();
    if(current.status === 'paused'){
      await closeOpenPause(current.id, now.toISOString());
      const last = current.pausedIntervals[current.pausedIntervals.length - 1];
      if(last && !last.end) last.end = now.toISOString();
    }

    const activeSeconds = getActiveSeconds(current, now);
    // Activité interne : l'étape a été fixée au démarrage et le select est masqué —
    // on la garde telle quelle plutôt que de lire un champ vide.
    const isActivityJob = !current.brand;
    const etape = isActivityJob ? current.etape : document.getElementById('finishEtape').value;
    const qteRaw = document.getElementById('finishQte').value;
    const quantite = (!isActivityJob && qteRaw !== '') ? parseInt(qteRaw, 10) : null;
    const note = document.getElementById('finishNote').value.trim();

    let photoFinalUrl = null;
    if(pendingPhotoFinalBase64){
      photoFinalUrl = await uploadJobPhoto('tmp_final_' + Date.now(), pendingPhotoFinalBase64);
    }
    await finishJobInDb(current.id, now.toISOString(), activeSeconds, note, etape, quantite, photoFinalUrl);
    pendingPhotoFinalBase64 = null;
    activeJobId = null;

    submitBtn.disabled = false;
    submitBtn.textContent = 'Enregistrer';
    clearInterval(tickInterval);
    refreshIdleView();
  });
}

/* ======================= ANALYSE ======================= */
const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
const DAYS_FR = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];

let analyseInited = false;
let currentPeriod = 'semaine';
let cachedHistory = [];

async function initAnalyse(){
  document.getElementById('analyse-loading').hidden = false;
  document.getElementById('analyse-content').hidden = true;

  cachedHistory = await getHistory();

  renderSummary(cachedHistory);
  renderTimeChart(currentPeriod);
  renderBrandChart(cachedHistory);
  renderEtapeChart(cachedHistory);

  if(!analyseInited){
    analyseInited = true;
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        renderTimeChart(currentPeriod);
      });
    });
  }

  document.getElementById('analyse-loading').hidden = true;
  document.getElementById('analyse-content').hidden = false;
}

function renderSummary(history){
  const totalJobs = history.length;
  const totalSeconds = history.reduce((sum, j) => sum + (j.activeSeconds || 0), 0);
  const avgSeconds = totalJobs ? totalSeconds / totalJobs : 0;

  document.getElementById('summaryGrid').innerHTML = `
    <div class="summary-card">
      <p class="summary-value">${totalJobs}</p>
      <p class="summary-label">Services</p>
    </div>
    <div class="summary-card">
      <p class="summary-value">${fmtHShort(totalSeconds)}</p>
      <p class="summary-label">Total d'heures</p>
    </div>
    <div class="summary-card">
      <p class="summary-value">${fmtHShort(avgSeconds)}</p>
      <p class="summary-label">Moyenne / service</p>
    </div>
  `;
}

function aggregateByDay(history, days){
  const buckets = [];
  const today = new Date();
  for(let i = days - 1; i >= 0; i--){
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({ key: d.toDateString(), label: DAYS_FR[d.getDay()], hours: 0, count: 0 });
  }
  history.forEach(job => {
    const key = new Date(job.finishedAt).toDateString();
    const bucket = buckets.find(b => b.key === key);
    if(bucket){
      bucket.hours += (job.activeSeconds || 0) / 3600;
      bucket.count += 1;
    }
  });
  return buckets;
}

function aggregateByMonth(history, months){
  const buckets = [];
  const today = new Date();
  for(let i = months - 1; i >= 0; i--){
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS_FR[d.getMonth()], hours: 0, count: 0 });
  }
  history.forEach(job => {
    const d = new Date(job.finishedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const bucket = buckets.find(b => b.key === key);
    if(bucket){
      bucket.hours += (job.activeSeconds || 0) / 3600;
      bucket.count += 1;
    }
  });
  return buckets;
}

function renderTimeChart(period){
  const data = period === 'mois'
    ? aggregateByMonth(cachedHistory, 6)
    : aggregateByDay(cachedHistory, 7);

  const barUnit = 52, gap = 14;
  const chartH = 120, baseline = 138, totalH = 176;
  const W = data.length * (barUnit + gap);
  const maxHours = Math.max(...data.map(d => d.hours), 1);

  let bars = '';
  data.forEach((d, i) => {
    const x = i * (barUnit + gap) + gap / 2;
    const barH = d.hours > 0 ? Math.max(4, (d.hours / maxHours) * chartH) : 0;
    const y = baseline - barH;
    const hoursLabel = d.hours > 0 ? fmtHShort(d.hours * 3600) : '–';
    bars += `
      <rect class="bar-fill" x="${x}" y="${y}" width="${barUnit}" height="${barH}" rx="4"></rect>
      <text class="bar-value" x="${x + barUnit / 2}" y="${y - 6}" text-anchor="middle">${hoursLabel}</text>
      <text class="bar-label" x="${x + barUnit / 2}" y="${baseline + 16}" text-anchor="middle">${d.label}</text>
      ${d.count > 0 ? `<text class="bar-label" x="${x + barUnit / 2}" y="${baseline + 30}" text-anchor="middle">${d.count} imp.</text>` : ''}
    `;
  });

  document.getElementById('timeChart').innerHTML = `
    <svg class="time-chart-svg" viewBox="0 0 ${W} ${totalH}" role="img" aria-label="Graphique des heures travaillées">
      <line x1="0" y1="${baseline}" x2="${W}" y2="${baseline}" stroke="var(--line)" stroke-width="1"></line>
      ${bars}
    </svg>
  `;
}

function renderBrandChart(history){
  const counts = {};
  history.forEach(job => { if(job.brand) counts[job.brand] = (counts[job.brand] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const brandChartEl = document.getElementById('brandChart');
  if(entries.length === 0){
    brandChartEl.innerHTML = `<p class="empty">Aucune donnée pour l'instant.</p>`;
    return;
  }

  const max = Math.max(...entries.map(e => e[1]));
  brandChartEl.innerHTML = entries.map(([brand, count]) => `
    <div class="hbar-row">
      <span class="hbar-label">${escapeHtml(brand)}</span>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${(count / max) * 100}%">
          <span class="hbar-count">${count}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderEtapeChart(history){
  const counts = {};
  history.forEach(job => { if(job.etape) counts[job.etape] = (counts[job.etape] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const etapeChartEl = document.getElementById('etapeChart');
  if(entries.length === 0){
    etapeChartEl.innerHTML = `<p class="empty">Aucune étape enregistrée pour l'instant.</p>`;
    return;
  }

  const max = Math.max(...entries.map(e => e[1]));
  etapeChartEl.innerHTML = entries.map(([etape, count]) => `
    <div class="hbar-row">
      <span class="hbar-label">${escapeHtml(etape)}</span>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${(count / max) * 100}%">
          <span class="hbar-count">${count}</span>
        </div>
      </div>
    </div>
  `).join('');
}

/* ======================= ADMIN (vue d'ensemble équipe) ======================= */
let adminInited = false;
let adminAllJobs = [];

async function initAdmin(){
  document.getElementById('admin-loading').hidden = false;
  document.getElementById('admin-content').hidden = true;

  const [history, currentJobs] = await Promise.all([getHistory(), getOpenJobs()]);
  adminAllJobs = [...currentJobs, ...history];

  renderAdminSummary(adminAllJobs);
  renderAdminList(adminAllJobs);

  if(!adminInited){
    adminInited = true;
    document.getElementById('adminSearch').addEventListener('input', () => renderAdminList(adminAllJobs));
    document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
    document.getElementById('lightbox').addEventListener('click', (e) => {
      if(e.target.id === 'lightbox') closeLightbox();
    });
  }

  document.getElementById('admin-loading').hidden = true;
  document.getElementById('admin-content').hidden = false;
}

function renderAdminSummary(jobs){
  const finished = jobs.filter(j => j.finishedAt);
  const totalSeconds = finished.reduce((sum, j) => sum + (j.activeSeconds || 0), 0);
  const technicians = new Set(jobs.map(j => j.name).filter(Boolean));

  document.getElementById('adminSummaryGrid').innerHTML = `
    <div class="summary-card">
      <p class="summary-value">${finished.length}</p>
      <p class="summary-label">Services terminés</p>
    </div>
    <div class="summary-card">
      <p class="summary-value">${fmtHShort(totalSeconds)}</p>
      <p class="summary-label">Total d'heures</p>
    </div>
    <div class="summary-card">
      <p class="summary-value">${technicians.size}</p>
      <p class="summary-label">Techniciens</p>
    </div>
  `;
}

function renderAdminList(jobs){
  const q = normalize(document.getElementById('adminSearch').value.trim());
  const filtered = jobs.filter(j => {
    if(!q) return true;
    return normalize(`${j.name || ''} ${j.brand || ''} ${j.model || ''} ${j.etape || ''} ${j.note || ''}`).includes(q);
  });

  const listEl3 = document.getElementById('adminList');
  const emptyEl3 = document.getElementById('adminEmpty');
  document.getElementById('adminCount').textContent = `${filtered.length} service(s)`;
  listEl3.innerHTML = '';
  emptyEl3.hidden = filtered.length > 0;

  filtered.forEach(job => {
    const li = document.createElement('li');
    li.className = 'job-card';
    const isRunning = !job.finishedAt;
    const dateStr = job.finishedAt ? new Date(job.finishedAt).toLocaleDateString('fr-FR') : null;

    const thumb = job.photoBase64
      ? `<img class="job-thumb" data-photo-path="${escapeHtml(job.photoBase64)}" alt="Photo du bon">`
      : `<div class="job-thumb" aria-hidden="true">📷</div>`;
    const thumbFinal = job.photoFinalBase64
      ? `<img class="job-thumb" data-photo-path="${escapeHtml(job.photoFinalBase64)}" alt="Photo machine terminée">`
      : '';

    const metaParts = [];
    if(job.name) metaParts.push(escapeHtml(job.name));
    if(job.activeSeconds) metaParts.push(fmtHShort(job.activeSeconds));
    metaParts.push(isRunning ? '● en cours' : dateStr);

    li.innerHTML = `
      ${PHOTOS_ENABLED ? `<div class="job-thumbs">${thumb}${thumbFinal}</div>` : ''}
      <div class="job-info">
        <p class="job-model">${jobTitleLine(job)}</p>
        <p class="job-meta">${metaParts.join(' · ')}</p>
        ${(job.brand && job.etape) ? `<p class="job-etape">${escapeHtml(job.etape)}${job.quantite != null ? ' · Qté ' + job.quantite : ''}</p>` : ''}
        ${job.note ? `<p class="job-note">« ${escapeHtml(job.note)} »</p>` : ''}
      </div>`;
    listEl3.appendChild(li);
  });

  listEl3.querySelectorAll('img[data-photo-path]').forEach(async (img) => {
    const url = await resolvePhotoUrl(img.dataset.photoPath);
    if(!url) return;
    img.src = url;
    img.classList.add('zoomable');
    img.addEventListener('click', () => openLightbox(url));
  });
}

function openLightbox(url){
  document.getElementById('lightboxImg').src = url;
  document.getElementById('lightbox').hidden = false;
}
function closeLightbox(){
  document.getElementById('lightbox').hidden = true;
  document.getElementById('lightboxImg').removeAttribute('src');
}