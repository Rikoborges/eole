/* =========================================================
   ReproBench — script.js
   Français en priorité (fr-name), PT/EN en légende
   Registro de Serviço agora usa Supabase (banco Postgres + login)
   ========================================================= */

const SUPABASE_URL = 'https://ddyekeeuaynqipdmlqhq.supabase.co';
// Clé publique "publishable" (préfixe sb_publishable_) : conçue pour être exposée
// côté client, comme la clé publique Stripe. Elle n'autorise rien par elle-même —
// la sécurité réelle des données dépend des politiques Row Level Security (RLS)
// activées sur les tables "jobs", "job_pauses" et "settings" dans Supabase.
const SUPABASE_KEY = 'sb_publishable_SBtxarlyHjUf8PcsPaik4w_t-CTwkqJ'; // gitleaks:allow

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

/* Désactivé temporairement pendant qu'on règle le Storage (photos manquantes
   dans le bucket "job-photos"). Remettre à true pour réactiver la capture
   et l'affichage des photos — tout le code reste en place, rien n'est perdu. */
const PHOTOS_ENABLED = false;

/* La liste des e-mails admin ne vit plus ici (avant : ADMIN_EMAILS, visible
   par n'importe qui ouvrant le code source). On demande directement à la
   base, via la fonction is_admin() déjà utilisée par les policies RLS —
   une seule source de vérité, rien à garder synchronisé, et l'e-mail admin
   ne quitte jamais le serveur. */
let isAdminUser = null; // null = pas encore demandé à la base
async function amIAdmin(){
  if(isAdminUser === null){
    const { data, error } = await sb.rpc('is_admin');
    if(error) console.error('Erreur is_admin:', error);
    isAdminUser = !error && !!data;
  }
  return isAdminUser;
}

async function updateAdminTabVisibility(){
  document.getElementById('tab-admin-btn').hidden = !(await amIAdmin());
}

/* Qui est connecté. Lu depuis la session locale (pas d'appel réseau).
   Sert à filtrer "mes" données : un admin voit toute l'équipe grâce aux
   policies RLS, donc sans ce filtre son Suivi mélangerait les services
   des autres avec les siens. */
let currentUserId = null;
async function getMyUserId(){
  if(currentUserId) return currentUserId;
  const { data: { session } } = await sb.auth.getSession();
  return session ? session.user.id : null;
}

/* Quand une autre personne se connecte sur le même navigateur (sans recharger
   la page), on oublie tout ce qui était propre au compte précédent. */
function resetPerUserState(){
  isAdminUser = null;
  teamMembersCache = null;
  techniciansCache = null;
  analyseState.userId = null;
  histMode = 'day';
  histWeekStart = startOfWeek(new Date());
}

/* --- Autenticação --- */
function initAuth(){
  // Conecta os botões IMEDIATAMENTE — antes de qualquer chamada de rede,
  // pra garantir que clicar sempre funciona mesmo se algo mais falhar.
  document.getElementById('btnLogin').addEventListener('click', handleLogin);
  document.getElementById('btnLogout').addEventListener('click', handleLogout);
  wireAccountEvents();

  // onAuthStateChange sozinho já cobre tudo: dispara "INITIAL_SESSION" assim que
  // registra (cobre o carregamento da página) e depois "SIGNED_IN"/"SIGNED_OUT"
  // conforme o usuário loga/desloga. Não precisa checar a sessão duas vezes.
  sb.auth.onAuthStateChange((_event, session) => {
    const newUserId = session ? session.user.id : null;
    if(newUserId !== currentUserId){
      currentUserId = newUserId;
      resetPerUserState();
    }
    if(session){
      showApp();
      updateAdminTabVisibility();
      updateAccountProfile(session);
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

/* --- Photo de profil (avatar) ---
   Même schéma que les photos de service : bucket privé + lien signé
   temporaire, chemin fixe "<user_id>/avatar.jpg" (upsert à chaque envoi,
   donc toujours un seul fichier par personne). */
async function uploadAvatar(base64DataUrl){
  const { data: userData } = await sb.auth.getUser();
  if(!userData.user) return null;
  const blob = dataUrlToBlob(base64DataUrl);
  const path = `${userData.user.id}/avatar.jpg`;
  const { error } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if(error){ console.error('Erreur uploadAvatar:', error); return null; }
  return path;
}

async function resolveAvatarUrl(userId){
  const { data, error } = await sb.storage.from('avatars').createSignedUrl(`${userId}/avatar.jpg`, 3600);
  if(error) return null; // normal quand la personne n'a encore jamais envoyé de photo
  return data.signedUrl;
}

function showAvatarImage(url){
  const img = document.getElementById('avatarImg');
  const fallback = document.getElementById('avatarFallback');
  if(url){
    img.src = url;
    img.hidden = false;
    fallback.hidden = true;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    fallback.hidden = false;
  }
}

async function updateAccountProfile(session){
  const user = session.user;
  const name = (user.user_metadata && user.user_metadata.name) || user.email || '';
  document.getElementById('accountName').textContent = name;
  document.getElementById('avatarFallback').textContent = name.trim().charAt(0).toUpperCase() || '?';

  const url = await resolveAvatarUrl(user.id);
  showAvatarImage(url);
}

let accountEventsInited = false;
function wireAccountEvents(){
  if(accountEventsInited) return;
  accountEventsInited = true;

  document.getElementById('avatarBtn').addEventListener('click', () => {
    document.getElementById('avatarInput').click();
  });

  document.getElementById('avatarInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo depois
    if(!file) return;

    try{
      const base64 = await compressImage(file, 300, 0.7);
      const path = await uploadAvatar(base64);
      if(!path){
        alert("Impossible d'envoyer la photo. Réessayez.");
        return;
      }
      const { data: userData } = await sb.auth.getUser();
      if(userData.user) showAvatarImage(await resolveAvatarUrl(userData.user.id));
    }catch(err){
      console.error('Erreur avatar:', err);
      alert('Impossible de traiter la photo. Réessayez.');
    }
  });
}

/* État propre au compte connecté — déclaré ici, avant initAuth(), parce que
   resetPerUserState() y touche dès le premier événement de connexion. */
let histMode = 'day';                        // Suivi : 'day' | 'week'
let histWeekStart = startOfWeek(new Date()); // Suivi : lundi de la semaine affichée
const analyseState = { mode: 'week', anchor: new Date(), userId: null, fromAdmin: false }; // userId : 'all' | uuid | null (= défaut)
let teamMembersCache = null;
let techniciansCache = null;
let adminSubview = 'overview'; // 'overview' | 'technicians' — sous-page affichée dans l'onglet Admin

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

/* Modèles connus par marque — vivent dans la table Supabase "printer_models"
   (gérable depuis l'onglet Admin), plus figés en dur ici. Chargés une seule
   fois et mis en cache ; invalidé quand l'admin ajoute/supprime un modèle. */
let printerModelsCache = null;

async function loadPrinterModels(){
  if(printerModelsCache) return printerModelsCache;
  const { data, error } = await sb.from('printer_models').select('brand, model').order('model');
  if(error){ console.error('Erreur loadPrinterModels:', error); return {}; }
  const byBrand = {};
  data.forEach(row => {
    (byBrand[row.brand] ||= []).push(row.model);
  });
  printerModelsCache = byBrand;
  return byBrand;
}

async function updateModelSuggestions(){
  const brand = document.getElementById('fieldBrand').value;
  const byBrand = await loadPrinterModels();
  const models = byBrand[brand] || [];
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
function switchTab(view){
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.view === view;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');

  if(view === 'registro') initRegistro();
  if(view === 'analyse') initAnalyse();
  if(view === 'admin') initAdmin();
}
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // Un clic direct sur l'onglet (pas un renvoi depuis l'Admin) quitte le mode "un seul technicien".
    if(tab.dataset.view === 'analyse') analyseState.fromAdmin = false;
    switchTab(tab.dataset.view);
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
   pause) ; un admin voit ceux de toute l'équipe grâce aux policies RLS.
   Passez userId pour ne garder que ceux d'une personne (indispensable dans le
   Suivi d'un admin, sinon il "reprendrait" le chrono d'un collègue). */
async function getOpenJobs({ userId } = {}){
  let query = sb
    .from('jobs')
    .select('*, job_pauses(*)')
    .is('finished_at', null);
  if(userId) query = query.eq('user_id', userId);
  const { data, error } = await query.order('started_at', { ascending: false });
  if(error){ console.error('Erreur getOpenJobs:', error); return []; }
  return data.map(mapJobFromDb);
}

/* Services terminés, filtrés côté base (pas dans le navigateur) :
   - userId : une seule personne (sinon tout ce que RLS autorise)
   - from / to (Date) : période [from, to[ sur finished_at */
async function getHistory({ userId, from, to } = {}){
  let query = sb
    .from('jobs')
    .select('*')
    .not('finished_at', 'is', null);
  if(userId) query = query.eq('user_id', userId);
  if(from) query = query.gte('finished_at', from.toISOString());
  if(to) query = query.lt('finished_at', to.toISOString());
  const { data, error } = await query
    .order('finished_at', { ascending: false })
    .limit(2000); // garde-fou : évite de télécharger un historique illimité
  if(error){ console.error('Erreur getHistory:', error); return []; }
  return data.map(mapJobFromDb);
}

function mapJobFromDb(row){
  return {
    id: row.id,
    userId: row.user_id,
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

/* Enregistrement rapide : pas de chronomètre, pas de marque/modèle —
   juste une étape + une quantité (ou une durée pour les étapes de temps,
   voir TIME_ETAPES) pour un jour donné, sauvegardé déjà "terminé"
   (started_at = finished_at) pour apparaître tout de suite dans l'historique.
   brand/model restent '' plutôt que null pour rester compatibles avec une
   éventuelle contrainte NOT NULL. */
async function createQuickLogEntry({ name, etape, quantite, seconds = 0, note, when }){
  const { data: userData } = await sb.auth.getUser();
  // Étape de temps : on recule started_at de la durée saisie pour que
  // started_at → finished_at corresponde bien au temps déclaré.
  const startedAt = new Date(new Date(when).getTime() - seconds * 1000).toISOString();
  const { error } = await sb
    .from('jobs')
    .insert({
      user_id: userData.user.id,
      technician: name, brand: '', model: '',
      etape, quantite, note: note || null,
      started_at: startedAt, finished_at: when, active_seconds: seconds
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
  if(error){ console.error('Erreur updateJobFields:', error); return false; }
  return true;
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

async function uploadJobPhoto(jobId, base64DataUrl, kind){
  const { data: userData } = await sb.auth.getUser();
  const blob = dataUrlToBlob(base64DataUrl);
  // Chemin stable basé sur le job réel — jamais d'id temporaire orphelin.
  const path = `${userData.user.id}/${jobId}/${kind}.jpg`;
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

/* Date du jour au format d'un <input type="date"> (YYYY-MM-DD), dans le fuseau
   local du navigateur — pas toISOString(), qui donne la date UTC et affiche
   la veille entre minuit et ~2h du matin heure de France. */
function localDateInputValue(date){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* --- Périodes (semaine du lundi au dimanche, comme en France) --- */
function startOfDay(date){
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfWeek(date){
  const d = startOfDay(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // getDay() : 0 = dimanche
  return d;
}
function addDays(date, n){
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function fmtDayMonth(date){
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
function weekRangeLabel(monday){
  return `${fmtDayMonth(monday)} → ${fmtDayMonth(addDays(monday, 6))}`;
}
function sumSeconds(jobs){
  return jobs.reduce((sum, j) => sum + (j.activeSeconds || 0), 0);
}

/* --- Export Excel (CSV) ---
   Séparateur ";" + BOM UTF-8 : c'est ce qu'Excel en français ouvre
   directement, accents compris, sans passer par l'assistant d'import. */
function csvCell(value){
  let str = value === null || value === undefined ? '' : String(value);
  // Anti "injection de formule" : une note qui commence par = + - @ serait
  // exécutée comme une formule par Excel.
  if(/^[=+\-@]/.test(str)) str = "'" + str;
  return /[";\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadJobsCsv(jobs, filename, labelFor = (job) => job.name){
  const header = ['Date', 'Technicien', 'Marque', 'Modèle', 'Étape', 'Quantité', 'Durée (h)', 'Durée', 'Note'];
  const rows = [...jobs]
    .sort((a, b) => new Date(a.finishedAt) - new Date(b.finishedAt))
    .map(j => [
      j.finishedAt ? new Date(j.finishedAt).toLocaleDateString('fr-FR') : 'en cours',
      labelFor(j) || '',
      j.brand || '',
      j.model || '',
      j.etape || '',
      j.quantite ?? '',
      ((j.activeSeconds || 0) / 3600).toFixed(2).replace('.', ','),
      j.activeSeconds ? fmtHShort(j.activeSeconds) : '',
      j.note || ''
    ]);
  const csv = '\uFEFF' + [header, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
        await updateModelSuggestions();
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
  // Les écouteurs ne se posent qu'une fois, mais les données doivent être
  // rechargées à chaque visite de l'onglet (comme Analyse et Admin le font
  // déjà) — sinon l'historique reste figé sur ce qu'il était au premier
  // chargement de la page.
  if(!regInited){
    regInited = true;
    wireFormEvents();
    wireActivityEvents();
    wireRunningStaticEvents();
    wireFinishEvents();
    wireExportEvent();
    wirePasswordChangeEvent();
    wireHistoryEvents();
  }
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

  const myId = await getMyUserId();
  const openJobs = await getOpenJobs({ userId: myId });
  const running = openJobs.find(j => j.status === 'running');
  if(running){
    document.getElementById('reg-loading').hidden = true;
    showRunning(running);
    return;
  }

  renderPausedList(openJobs.filter(j => j.status === 'paused'));
  await renderMyHistory(myId);

  clearInterval(tickInterval);
  showState('idle');
  document.getElementById('reg-loading').hidden = true;
}

/* --- Carte d'une entrée (Suivi, Analyse, Admin : même rendu partout) ---
   editable : boutons ✎ / 🗑 (seulement pour ses propres entrées)
   showName : affiche le technicien (listes d'équipe) */
function jobCardElement(job, { editable = false, showName = false, nameLabel = null } = {}){
  const li = document.createElement('li');
  li.className = 'job-card';
  const isRunning = !job.finishedAt;

  const thumb = job.photoBase64
    ? `<img class="job-thumb" data-photo-path="${escapeHtml(job.photoBase64)}" alt="Photo du bon">`
    : `<div class="job-thumb" aria-hidden="true">📷</div>`;
  const thumbFinal = job.photoFinalBase64
    ? `<img class="job-thumb" data-photo-path="${escapeHtml(job.photoFinalBase64)}" alt="Photo machine terminée">`
    : '';

  const metaParts = [];
  if(showName && (nameLabel || job.name)) metaParts.push(escapeHtml(nameLabel || job.name));
  if(job.activeSeconds) metaParts.push(fmtHShort(job.activeSeconds));
  metaParts.push(isRunning ? '● en cours' : new Date(job.finishedAt).toLocaleDateString('fr-FR'));

  li.innerHTML = `
    ${PHOTOS_ENABLED ? `<div class="job-thumbs">${thumb}${thumbFinal}</div>` : ''}
    <div class="job-info">
      <p class="job-model">${jobTitleLine(job)}</p>
      <p class="job-meta">${metaParts.join(' · ')}</p>
      ${(job.brand && job.etape) ? `<p class="job-etape">${escapeHtml(job.etape)}${job.quantite != null ? ' · Qté ' + job.quantite : ''}</p>` : ''}
      ${job.note ? `<p class="job-note">« ${escapeHtml(job.note)} »</p>` : ''}
    </div>
    ${editable ? `
    <div class="job-actions">
      <button type="button" data-act="edit" data-id="${escapeHtml(job.id)}" aria-label="Modifier">✎</button>
      <button type="button" data-act="del" data-id="${escapeHtml(job.id)}" aria-label="Supprimer">🗑</button>
    </div>` : ''}`;
  return li;
}

/* Remplace les data-photo-path par des liens temporaires, en parallèle,
   sans bloquer l'affichage de la liste. */
function hydratePhotos(container, { zoomable = false } = {}){
  container.querySelectorAll('img[data-photo-path]').forEach(async (img) => {
    const url = await resolvePhotoUrl(img.dataset.photoPath);
    if(!url) return;
    img.src = url;
    if(zoomable){
      img.classList.add('zoomable');
      img.addEventListener('click', () => openLightbox(url));
    }
  });
}

/* --- Historique du technicien : "Aujourd'hui" ou "Ma semaine" --- */
const WEEKLY_TARGET_HOURS = 35; // durée légale hebdo en France — ajustez si besoin
let myHistoryJobs = []; // ce qui est affiché, pour retrouver l'entrée à modifier

async function renderMyHistory(myId){
  const today = startOfDay(new Date());
  const weekFrom = histWeekStart;
  const weekTo = addDays(histWeekStart, 7);

  const [todayJobs, weekJobs] = await Promise.all([
    getHistory({ userId: myId, from: today, to: addDays(today, 1) }),
    histMode === 'week' ? getHistory({ userId: myId, from: weekFrom, to: weekTo }) : null
  ]);
  document.getElementById('today-total-val').textContent = fmtHShort(sumSeconds(todayJobs));

  const isWeek = histMode === 'week';
  myHistoryJobs = isWeek ? weekJobs : todayJobs;

  document.getElementById('histTitle').textContent = isWeek ? 'Ma semaine' : "Aujourd'hui";
  document.querySelectorAll('[data-hist]').forEach(btn => {
    const on = btn.dataset.hist === histMode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  document.getElementById('histWeekNav').hidden = !isWeek;
  document.getElementById('btnExportWeek').hidden = !isWeek || myHistoryJobs.length === 0;
  document.getElementById('histWeekLabel').textContent = `Semaine du ${weekRangeLabel(weekFrom)}`;
  // Pas de semaine "future" : rien à y voir.
  document.getElementById('histNext').disabled = weekFrom >= startOfWeek(new Date());

  const container = document.getElementById('history-groups');
  const emptyEl = document.getElementById('history-empty');
  const summaryEl = document.getElementById('histWeekSummary');
  container.innerHTML = '';

  if(!isWeek){
    summaryEl.hidden = true;
    emptyEl.hidden = myHistoryJobs.length > 0;
    const ul = document.createElement('ul');
    ul.className = 'history-list';
    myHistoryJobs.forEach(job => ul.appendChild(jobCardElement(job, { editable: true })));
    container.appendChild(ul);
    hydratePhotos(container);
    return;
  }

  emptyEl.hidden = true;
  const totalSec = sumSeconds(myHistoryJobs);
  const machines = myHistoryJobs.filter(j => j.brand).length;
  const pct = Math.min(100, (totalSec / 3600) / WEEKLY_TARGET_HOURS * 100);
  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <div>Total : <b>${fmtHShort(totalSec)}</b> / ${WEEKLY_TARGET_HOURS}h · ${machines} machine(s)</div>
    <div class="progress" role="progressbar" aria-label="Heures de la semaine" aria-valuemin="0" aria-valuemax="${WEEKLY_TARGET_HOURS}" aria-valuenow="${(totalSec / 3600).toFixed(1)}">
      <div class="progress-fill" style="width:${pct}%"></div>
    </div>`;

  // Une section par jour, du lundi au dimanche. Le week-end n'apparaît que
  // s'il y a quelque chose dedans ; un jour de semaine vide reste visible,
  // avec un bouton pour rattraper un oubli.
  const todayStr = new Date().toDateString();
  for(let i = 0; i < 7; i++){
    const day = addDays(weekFrom, i);
    if(day > new Date()) break;
    const dayJobs = myHistoryJobs
      .filter(j => new Date(j.finishedAt).toDateString() === day.toDateString())
      .sort((a, b) => new Date(a.finishedAt) - new Date(b.finishedAt));
    const isWeekend = i >= 5;
    if(isWeekend && dayJobs.length === 0) continue;

    const section = document.createElement('section');
    section.className = 'day-group' + (day.toDateString() === todayStr ? ' is-today' : '');
    const dayName = day.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
    section.innerHTML = `
      <div class="day-head">
        <span class="day-head-title">${escapeHtml(dayName)}${sumSeconds(dayJobs) > 0 ? `<b>${fmtHShort(sumSeconds(dayJobs))}</b>` : ''}</span>
        <button type="button" class="day-add" data-add-date="${localDateInputValue(day)}">+ Ajouter</button>
      </div>`;
    if(dayJobs.length === 0){
      section.insertAdjacentHTML('beforeend', '<p class="day-empty">Rien d\'enregistré ce jour-là.</p>');
    } else {
      const ul = document.createElement('ul');
      ul.className = 'history-list';
      dayJobs.forEach(job => ul.appendChild(jobCardElement(job, { editable: true })));
      section.appendChild(ul);
    }
    container.appendChild(section);
  }
  hydratePhotos(container);
}

let historyEventsInited = false;
function wireHistoryEvents(){
  if(historyEventsInited) return;
  historyEventsInited = true;

  document.querySelectorAll('[data-hist]').forEach(btn => {
    btn.addEventListener('click', async () => {
      histMode = btn.dataset.hist;
      if(histMode === 'week') histWeekStart = startOfWeek(new Date());
      await renderMyHistory(await getMyUserId());
    });
  });
  document.getElementById('histPrev').addEventListener('click', async () => {
    histWeekStart = addDays(histWeekStart, -7);
    await renderMyHistory(await getMyUserId());
  });
  document.getElementById('histNext').addEventListener('click', async () => {
    histWeekStart = addDays(histWeekStart, 7);
    await renderMyHistory(await getMyUserId());
  });
  document.getElementById('btnExportWeek').addEventListener('click', () => {
    downloadJobsCsv(myHistoryJobs, `ma-semaine-${localDateInputValue(histWeekStart)}.csv`);
  });

  // Un seul écouteur pour toutes les cartes (délégation) : pas besoin de
  // rebrancher des handlers à chaque rafraîchissement de la liste.
  document.getElementById('history-groups').addEventListener('click', async (e) => {
    const addBtn = e.target.closest('button[data-add-date]');
    if(addBtn){ openActivityForm(addBtn.dataset.addDate); return; }

    const btn = e.target.closest('button[data-act]');
    if(!btn) return;
    const job = myHistoryJobs.find(j => j.id === btn.dataset.id);
    if(!job) return;
    if(btn.dataset.act === 'edit'){
      openEditDialog(job, () => refreshIdleView());
    } else if(btn.dataset.act === 'del'){
      if(!confirm('Supprimer cet enregistrement ?')) return;
      await deleteJobInDb(job.id);
      refreshIdleView();
    }
  });
}

/* --- Modifier une entrée (remplace les anciens prompt() successifs) ---
   Pour une entrée chronométrée, la durée n'est pas modifiable : elle vient
   du chrono. Pour un enregistrement rapide "de temps" (Réunion, Congés…),
   on peut corriger la durée saisie. */
let editingJob = null;
let onEditSaved = null;

function editIsTimeEntry(){
  return editingJob && !editingJob.brand && TIME_ETAPES.has(document.getElementById('editEtape').value);
}
function updateEditFields(){
  const isTime = editIsTimeEntry();
  document.getElementById('editQteBlock').hidden = isTime;
  document.getElementById('editDureeBlock').hidden = !isTime;
}

function openEditDialog(job, onSaved){
  editingJob = job;
  onEditSaved = onSaved;
  const isMachine = !!job.brand;

  document.getElementById('editWhen').textContent =
    new Date(job.finishedAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    + (job.activeSeconds ? ` · ${fmtHShort(job.activeSeconds)}` : '');
  document.getElementById('editMachineFields').hidden = !isMachine;
  document.getElementById('editBrand').value = job.brand || '';
  document.getElementById('editModel').value = job.model || '';
  document.getElementById('editEtape').value = job.etape || '';
  document.getElementById('editQte').value = job.quantite ?? '';
  const secs = job.activeSeconds || 0;
  document.getElementById('editHeures').value = Math.floor(secs / 3600) || '';
  document.getElementById('editMinutes').value = Math.round((secs % 3600) / 60) || '';
  document.getElementById('editNote').value = job.note || '';
  document.getElementById('editStatus').hidden = true;
  updateEditFields();

  document.getElementById('editDialog').showModal();
}

function wireEditDialog(){
  const dialog = document.getElementById('editDialog');
  // Une seule liste d'étapes à maintenir : on recopie celle de l'enregistrement rapide.
  const etapeSelect = document.getElementById('editEtape');
  etapeSelect.innerHTML = document.getElementById('activityType').innerHTML;
  etapeSelect.options[0].textContent = '— Aucune —';
  etapeSelect.addEventListener('change', updateEditFields);

  document.getElementById('btnCancelEdit').addEventListener('click', () => dialog.close());

  document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if(!editingJob) return;
    const job = editingJob;
    const statusEl = document.getElementById('editStatus');
    const showError = (msg) => { statusEl.textContent = msg; statusEl.hidden = false; };

    const isMachine = !!job.brand;
    const etape = etapeSelect.value;
    const fields = { etape: etape || null, note: document.getElementById('editNote').value.trim() || null };

    if(isMachine){
      const brand = document.getElementById('editBrand').value;
      const model = document.getElementById('editModel').value.trim();
      if(!brand || !model) return showError('Marque et modèle sont obligatoires.');
      fields.brand = brand;
      fields.model = model;
    } else if(!etape){
      return showError('Choisissez une étape.');
    }

    if(editIsTimeEntry()){
      const h = parseInt(document.getElementById('editHeures').value, 10) || 0;
      const m = parseInt(document.getElementById('editMinutes').value, 10) || 0;
      const seconds = h * 3600 + m * 60;
      if(seconds <= 0) return showError('Indiquez la durée (heures et/ou minutes).');
      fields.active_seconds = seconds;
      fields.started_at = new Date(new Date(job.finishedAt).getTime() - seconds * 1000).toISOString();
      fields.quantite = null;
    } else {
      const qteRaw = document.getElementById('editQte').value;
      fields.quantite = qteRaw !== '' ? parseInt(qteRaw, 10) : null;
      // Enregistrement rapide passé d'une étape "de temps" à une étape "de
      // quantité" : l'ancienne durée n'a plus de sens.
      if(!isMachine && job.activeSeconds){
        fields.active_seconds = 0;
        fields.started_at = job.finishedAt;
      }
    }

    const saveBtn = document.getElementById('btnSaveEdit');
    saveBtn.disabled = true;
    const ok = await updateJobFields(job.id, fields);
    saveBtn.disabled = false;
    if(!ok) return showError("Impossible d'enregistrer (erreur de connexion). Réessayez.");

    dialog.close();
    editingJob = null;
    if(onEditSaved) onEditSaved();
  });
}
wireEditDialog();

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

/* --- Changement de mot de passe : chaque technicien change le sien ---
   sb.auth.updateUser() marche direto avec a sessão já logada, sem precisar
   de service_role nem de nenhuma função no servidor. */
function wirePasswordChangeEvent(){
  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('passwordStatus');
    const pass1 = document.getElementById('newPassword1').value;
    const pass2 = document.getElementById('newPassword2').value;

    statusEl.hidden = false;
    statusEl.classList.remove('error');

    if(pass1 !== pass2){
      statusEl.classList.add('error');
      statusEl.textContent = 'Les mots de passe ne correspondent pas.';
      return;
    }

    statusEl.textContent = 'Mise à jour…';
    const { error } = await sb.auth.updateUser({ password: pass1 });
    if(error){
      console.error('Erreur updateUser (mot de passe):', error);
      statusEl.classList.add('error');
      statusEl.textContent = 'Erreur lors de la mise à jour. Réessayez.';
      return;
    }

    statusEl.classList.remove('error');
    statusEl.textContent = 'Mot de passe mis à jour !';
    document.getElementById('passwordForm').reset();
  });
}

async function exportMyData(){
  const { data: userData } = await sb.auth.getUser();
  // Filtré sur moi : pour un admin, RLS renverrait aussi toute l'équipe.
  const myId = userData.user.id;
  const [openJobs, history, lastName] = await Promise.all([
    getOpenJobs({ userId: myId }),
    getHistory({ userId: myId }),
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
  downloadBlob(blob, `mes-donnees-${localDateInputValue(new Date())}.json`);
}

/* --- Formulaire "Nouveau Service" ---
   Partagé par "+ Nouveau Service" et "+ Installation imprimante neuve" : même
   chronomètre, même formulaire (marque/modèle) — la seule différence se fait
   à la fin, où le technicien choisit l'étape (voir updateAutoControlVisibility). */
async function openNewJobForm(){
  pendingPhotoBase64 = null;
  const preview = document.getElementById('photoPreview');
  preview.removeAttribute('src');
  document.getElementById('ocrStatus').hidden = true;
  document.getElementById('fieldBrand').value = '';
  document.getElementById('fieldModel').value = '';
  await updateModelSuggestions();
  document.getElementById('fieldName').value = (await getSetting('last_name')) || '';
  showState('form');
}

function wireFormEvents(){
  document.getElementById('photoCaptureBlock').hidden = !PHOTOS_ENABLED;
  document.getElementById('btnNewJob').addEventListener('click', openNewJobForm);
  document.getElementById('btnNewInstall').addEventListener('click', openNewJobForm);

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

      const job = await createJob({ name, brand, model, photoUrl: null, startedAt });
      if(!job){
        alert('Impossible de démarrer le service (erreur de connexion). Réessayez.');
        return;
      }

      // La photo est envoyée seulement une fois le job créé — le chemin utilise
      // son id réel (job.id/bon.jpg), plus jamais un id temporaire orphelin.
      if(pendingPhotoBase64){
        const photoUrl = await uploadJobPhoto(job.id, pendingPhotoBase64, 'bon');
        if(photoUrl) await updateJobFields(job.id, { photo_url: photoUrl });
        job.photoBase64 = photoUrl;
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

/* --- Formulaire "Enregistrement rapide" (quantité ou durée, sans chronomètre) --- */

/* Étapes qui se mesurent en temps, pas en quantité : on demande une durée
   (heures + minutes) au lieu d'une "Qté". */
const TIME_ETAPES = new Set(['Déballage', 'Réunion', 'Formation', 'Congés', '5S']);

function updateActivityFieldsForEtape(){
  const isTime = TIME_ETAPES.has(document.getElementById('activityType').value);
  document.getElementById('activityQteBlock').hidden = isTime;
  document.getElementById('activityDureeBlock').hidden = !isTime;
}

/* dateStr (YYYY-MM-DD) : pré-remplit la date — utilisé par "+ Ajouter" d'un
   jour de la vue "Ma semaine", pour rattraper un oubli. */
async function openActivityForm(dateStr){
  document.getElementById('activityType').value = '';
  document.getElementById('activityQte').value = '';
  document.getElementById('activityHeures').value = '';
  document.getElementById('activityMinutes').value = '';
  updateActivityFieldsForEtape();
  document.getElementById('activityNote').value = '';
  document.getElementById('activityDate').value = dateStr || localDateInputValue(new Date());
  document.getElementById('activityDate').max = localDateInputValue(new Date());
  document.getElementById('activityName').value = (await getSetting('last_name')) || '';
  showState('activity');
}

function wireActivityEvents(){
  document.getElementById('activityType').addEventListener('change', updateActivityFieldsForEtape);

  document.getElementById('btnNewActivity').addEventListener('click', () => openActivityForm());

  document.getElementById('btnCancelActivity').addEventListener('click', () => showState('idle'));

  document.getElementById('activityForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('activityName').value.trim();
    const etape = document.getElementById('activityType').value;
    const dateStr = document.getElementById('activityDate').value;
    if(!name || !etape || !dateStr) return;

    const isTime = TIME_ETAPES.has(etape);
    let quantite = null;
    let seconds = 0;
    if(isTime){
      const h = parseInt(document.getElementById('activityHeures').value, 10) || 0;
      const m = parseInt(document.getElementById('activityMinutes').value, 10) || 0;
      seconds = (h * 3600) + (m * 60);
      if(seconds <= 0){
        alert('Indiquez la durée (heures et/ou minutes).');
        return;
      }
    }else{
      const qteRaw = document.getElementById('activityQte').value;
      quantite = qteRaw !== '' ? parseInt(qteRaw, 10) : null;
    }
    const note = document.getElementById('activityNote').value.trim();

    const submitBtn = document.getElementById('btnSaveActivity');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enregistrement…';

    try{
      await setSetting('last_name', name);
      const when = new Date(dateStr + 'T12:00:00').toISOString();
      const ok = await createQuickLogEntry({ name, etape, quantite, seconds, note, when });
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
    document.querySelectorAll('#autoControlList input[type="checkbox"], #autoControlInstallList input[type="checkbox"]').forEach(cb => cb.checked = false);
    pendingPhotoFinalBase64 = null;
    document.getElementById('photoFinalPreview').removeAttribute('src');
    updateChecklistCount('autoControlList', 'checklistCount');
    updateChecklistCount('autoControlInstallList', 'checklistInstallCount');
    updateAutoControlVisibility();
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

function updateChecklistCount(listId, countId){
  const boxes = document.querySelectorAll(`#${listId} input[type="checkbox"]`);
  const checked = document.querySelectorAll(`#${listId} input[type="checkbox"]:checked`);
  document.getElementById(countId).textContent = `${checked.length} / ${boxes.length} vérifiés`;
}

/* Deux checklists différentes selon le type de travail : celle de nettoyage
   (tambour/carters/etc.) pour un reconditionnement, celle d'installation pour
   une imprimante neuve — une seule visible à la fois, selon l'étape choisie. */
const ETAPES_INSTALLATION = new Set(['Installation imprimante neuve', 'Mise en route imprimante neuve']);
function updateAutoControlVisibility(){
  const etape = document.getElementById('finishEtape').value;
  const isInstall = ETAPES_INSTALLATION.has(etape);
  document.getElementById('autoControlBlock').hidden = isInstall;
  document.getElementById('autoControlInstallBlock').hidden = !isInstall;
}

function wireFinishEvents(){
  document.getElementById('photoFinalBlock').hidden = !PHOTOS_ENABLED;
  document.getElementById('autoControlList').addEventListener('change', () => updateChecklistCount('autoControlList', 'checklistCount'));
  document.getElementById('autoControlInstallList').addEventListener('change', () => updateChecklistCount('autoControlInstallList', 'checklistInstallCount'));
  document.getElementById('finishEtape').addEventListener('change', updateAutoControlVisibility);

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
    // Valeur suspecte (NaN si started_at est invalide, ou quasi 0 sur un service
    // qui tournait) : mieux vaut demander confirmation que d'écraser silencieusement
    // des heures de travail réelles avec une donnée cassée.
    if(!Number.isFinite(activeSeconds) || activeSeconds < 1){
      const proceed = confirm('Le temps calculé pour ce service semble incorrect (proche de zéro). Enregistrer quand même ?');
      if(!proceed){
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enregistrer';
        return;
      }
    }
    // Activité interne : l'étape a été fixée au démarrage et le select est masqué —
    // on la garde telle quelle plutôt que de lire un champ vide.
    const isActivityJob = !current.brand;
    const etape = isActivityJob ? current.etape : document.getElementById('finishEtape').value;
    const qteRaw = document.getElementById('finishQte').value;
    const quantite = (!isActivityJob && qteRaw !== '') ? parseInt(qteRaw, 10) : null;
    const note = document.getElementById('finishNote').value.trim();

    let photoFinalUrl = null;
    if(pendingPhotoFinalBase64){
      photoFinalUrl = await uploadJobPhoto(current.id, pendingPhotoFinalBase64, 'final');
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

/* Filtres : QUI (un technicien ou toute l'équipe — choix réservé à l'admin,
   un technicien ne voit de toute façon que lui-même) et QUAND (semaine,
   mois ou tout, avec ‹ › pour remonter dans le temps). État dans
   analyseState, déclaré en haut du fichier. */
let analyseInited = false;
let analyseJobs = [];
let analyseRequestId = 0; // ignore une réponse arrivée après un clic plus récent

function periodRange(mode, anchor){
  if(mode === 'week'){
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7), label: `Semaine du ${weekRangeLabel(from)}` };
  }
  if(mode === 'month'){
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    const label = from.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return { from, to, label: label.charAt(0).toUpperCase() + label.slice(1) };
  }
  return { from: null, to: null, label: "Tout l'historique" };
}

function shiftAnchor(anchor, mode, step){
  if(mode === 'week') return addDays(anchor, 7 * step);
  if(mode === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
  return anchor;
}

/* Barres du graphique d'heures, selon la période :
   semaine → 7 jours · mois → une barre par semaine · tout → 6 derniers mois */
function chartBuckets(mode, range){
  const buckets = [];
  if(mode === 'week'){
    for(let i = 0; i < 7; i++){
      const d = addDays(range.from, i);
      buckets.push({ from: d, to: addDays(d, 1), label: DAYS_FR[d.getDay()], sub: String(d.getDate()) });
    }
  } else if(mode === 'month'){
    let start = range.from;
    while(start < range.to){
      const end = new Date(Math.min(addDays(startOfWeek(start), 7), range.to));
      buckets.push({ from: start, to: end, label: `${start.getDate()}–${addDays(end, -1).getDate()}`, sub: '' });
      start = end;
    }
  } else {
    const today = new Date();
    for(let i = 5; i >= 0; i--){
      const from = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const to = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
      buckets.push({ from, to, label: MONTHS_FR[from.getMonth()], sub: '' });
    }
  }
  return buckets;
}

async function initAnalyse(){
  if(!analyseInited){
    analyseInited = true;
    document.querySelectorAll('.period-btn[data-period]').forEach(btn => {
      btn.addEventListener('click', () => {
        analyseState.mode = btn.dataset.period;
        analyseState.anchor = new Date();
        loadAndRenderAnalyse();
      });
    });
    document.getElementById('analysePrev').addEventListener('click', () => {
      analyseState.anchor = shiftAnchor(analyseState.anchor, analyseState.mode, -1);
      loadAndRenderAnalyse();
    });
    document.getElementById('analyseNext').addEventListener('click', () => {
      analyseState.anchor = shiftAnchor(analyseState.anchor, analyseState.mode, 1);
      loadAndRenderAnalyse();
    });
    document.getElementById('analyseTech').addEventListener('change', (e) => {
      analyseState.userId = e.target.value;
      loadAndRenderAnalyse();
    });
    document.getElementById('btnExportAnalyse').addEventListener('click', exportAnalyseCsv);
    document.getElementById('btnAnalyseBack').addEventListener('click', () => {
      analyseState.fromAdmin = false;
      document.getElementById('btnAnalyseBack').hidden = true;
      switchTab('admin'); // adminSubview reste sur 'technicians', inchangé depuis le clic qui a mené ici
    });
  }

  const [myId, isAdmin] = await Promise.all([getMyUserId(), amIAdmin()]);
  if(analyseState.userId === null) analyseState.userId = isAdmin ? 'all' : myId;
  document.getElementById('analyseTechField').hidden = !isAdmin;
  if(isAdmin) await populateAnalyseTechSelect(myId);

  await loadAndRenderAnalyse();
}

async function populateAnalyseTechSelect(myId){
  const members = await getTeamMembers();
  const select = document.getElementById('analyseTech');
  select.innerHTML = `<option value="all">Toute l'équipe</option>` + members.map(m =>
    `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}${m.id === myId ? ' (moi)' : ''}${m.removed ? ' (compte supprimé)' : ''}</option>`
  ).join('');
  select.value = analyseState.userId;
  if(select.value !== analyseState.userId) analyseState.userId = 'all'; // personne introuvable
}

async function loadAndRenderAnalyse(){
  const requestId = ++analyseRequestId;
  document.getElementById('analyse-loading').hidden = false;
  document.getElementById('analyse-content').hidden = true;
  document.getElementById('btnAnalyseBack').hidden = !(analyseState.fromAdmin && analyseState.userId && analyseState.userId !== 'all');

  const { mode, anchor } = analyseState;
  const range = periodRange(mode, anchor);
  const prevRange = mode === 'all' ? null : periodRange(mode, shiftAnchor(anchor, mode, -1));
  const userId = analyseState.userId === 'all' ? undefined : analyseState.userId;

  document.querySelectorAll('.period-btn[data-period]').forEach(btn => {
    const on = btn.dataset.period === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  document.getElementById('analysePeriodLabel').textContent = range.label;
  document.getElementById('analysePrev').hidden = mode === 'all';
  document.getElementById('analyseNext').hidden = mode === 'all';
  document.getElementById('analyseNext').disabled = !!range.to && range.to > new Date();

  const [jobs, prevJobs] = await Promise.all([
    getHistory({ userId, from: range.from, to: range.to }),
    prevRange ? getHistory({ userId, from: prevRange.from, to: prevRange.to }) : null
  ]);
  if(requestId !== analyseRequestId) return; // un clic plus récent a pris le relais

  analyseJobs = jobs;
  renderSummary(jobs, prevJobs, mode);
  renderTimeChart(jobs, chartBuckets(mode, range));
  renderBrandChart(jobs);
  renderEtapeChart(jobs);
  renderAnalyseEntries(jobs);

  document.getElementById('analyse-loading').hidden = true;
  document.getElementById('analyse-content').hidden = false;
}

function computeStats(jobs){
  const machines = jobs.filter(j => j.brand);
  const machineSeconds = sumSeconds(machines);
  return {
    seconds: sumSeconds(jobs),
    machines: machines.length,
    // Moyenne sur les machines seulement : une réunion d'1h ou un "Emballage x 12"
    // sans durée faussaient l'ancienne "moyenne / service".
    avgMachine: machines.length ? machineSeconds / machines.length : 0,
    days: new Set(jobs.map(j => new Date(j.finishedAt).toDateString())).size
  };
}

function deltaHtml(cur, prev, periodWord){
  if(prev === null || prev === undefined) return '';
  if(prev === 0) return cur > 0 ? `<p class="summary-delta">nouveau vs ${periodWord}</p>` : '';
  const pct = Math.round((cur - prev) / prev * 100);
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '=';
  return `<p class="summary-delta">${arrow} ${Math.abs(pct)} % vs ${periodWord}</p>`;
}

function renderSummary(jobs, prevJobs, mode){
  const cur = computeStats(jobs);
  const prev = prevJobs ? computeStats(prevJobs) : null;
  const periodWord = mode === 'month' ? 'mois préc.' : 'sem. préc.';

  document.getElementById('summaryGrid').innerHTML = `
    <div class="summary-card">
      <p class="summary-value">${fmtHShort(cur.seconds)}</p>
      <p class="summary-label">Heures</p>
      ${deltaHtml(cur.seconds, prev && prev.seconds, periodWord)}
    </div>
    <div class="summary-card">
      <p class="summary-value">${cur.machines}</p>
      <p class="summary-label">Machines</p>
      ${deltaHtml(cur.machines, prev && prev.machines, periodWord)}
    </div>
    <div class="summary-card">
      <p class="summary-value">${fmtHShort(cur.avgMachine)}</p>
      <p class="summary-label">Moyenne / machine</p>
    </div>
    <div class="summary-card">
      <p class="summary-value">${cur.days}</p>
      <p class="summary-label">Jours travaillés</p>
    </div>
  `;
}

function renderTimeChart(jobs, buckets){
  const data = buckets.map(b => ({ ...b, hours: 0, count: 0 }));
  jobs.forEach(job => {
    const t = new Date(job.finishedAt);
    const bucket = data.find(b => t >= b.from && t < b.to);
    if(!bucket) return;
    bucket.hours += (job.activeSeconds || 0) / 3600;
    if(job.brand) bucket.count += 1;
  });

  const barUnit = 52, gap = 14;
  const chartH = 120, baseline = 138, totalH = 190;
  const W = data.length * (barUnit + gap);
  const maxHours = Math.max(...data.map(d => d.hours), 1);

  let bars = '';
  data.forEach((d, i) => {
    const x = i * (barUnit + gap) + gap / 2;
    const barH = d.hours > 0 ? Math.max(4, (d.hours / maxHours) * chartH) : 0;
    const y = baseline - barH;
    const hoursLabel = d.hours > 0 ? fmtHShort(d.hours * 3600) : '–';
    const label = d.sub ? `${d.label} ${d.sub}` : d.label;
    bars += `
      <rect class="bar-fill" x="${x}" y="${y}" width="${barUnit}" height="${barH}" rx="4"></rect>
      <text class="bar-value" x="${x + barUnit / 2}" y="${y - 6}" text-anchor="middle">${hoursLabel}</text>
      <text class="bar-label" x="${x + barUnit / 2}" y="${baseline + 16}" text-anchor="middle">${escapeHtml(label)}</text>
      ${d.count > 0 ? `<text class="bar-label" x="${x + barUnit / 2}" y="${baseline + 30}" text-anchor="middle">${d.count} mach.</text>` : ''}
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
    brandChartEl.innerHTML = `<p class="empty">Aucune machine sur cette période.</p>`;
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
  history.forEach(job => {
    if(!job.etape) return;
    // Étape de temps (Réunion, Congés…) : on compte des heures, pas des unités.
    if(TIME_ETAPES.has(job.etape)){
      counts[job.etape] = counts[job.etape] || { value: 0, isTime: true };
      counts[job.etape].value += (job.activeSeconds || 0);
      return;
    }
    // Une entrée avec une quantité (ex : "Emballage" x 12) compte pour 12, pas pour 1.
    counts[job.etape] = counts[job.etape] || { value: 0, isTime: false };
    counts[job.etape].value += job.quantite != null ? job.quantite : 1;
  });

  const etapeChartEl = document.getElementById('etapeChart');
  const all = Object.entries(counts);
  if(all.length === 0){
    etapeChartEl.innerHTML = `<p class="empty">Aucune étape enregistrée sur cette période.</p>`;
    return;
  }

  // Deux échelles différentes (unités vs heures) : chaque groupe a son propre max,
  // sinon 8h de congés écraseraient visuellement "Emballage x 3".
  const row = ([etape, { value, isTime }], max) => `
    <div class="hbar-row">
      <span class="hbar-label">${escapeHtml(etape)}</span>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${(value / max) * 100}%">
          <span class="hbar-count">${isTime ? fmtHShort(value) : value}</span>
        </div>
      </div>
    </div>`;
  const qty = all.filter(([, v]) => !v.isTime).sort((a, b) => b[1].value - a[1].value);
  const time = all.filter(([, v]) => v.isTime).sort((a, b) => b[1].value - a[1].value);
  const maxQty = Math.max(1, ...qty.map(e => e[1].value));
  const maxTime = Math.max(1, ...time.map(e => e[1].value));
  etapeChartEl.innerHTML = qty.map(e => row(e, maxQty)).join('') + time.map(e => row(e, maxTime)).join('');
}

function renderAnalyseEntries(jobs){
  const list = document.getElementById('analyseEntries');
  const isTeam = analyseState.userId === 'all';
  list.innerHTML = '';
  [...jobs]
    .sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt))
    .forEach(job => list.appendChild(jobCardElement(job, { showName: isTeam, nameLabel: memberLabel(job) })));
  hydratePhotos(list, { zoomable: true });
  document.getElementById('analyseEntriesEmpty').hidden = jobs.length > 0;
  document.getElementById('btnExportAnalyse').hidden = jobs.length === 0;
  document.getElementById('analyseEntriesTitle').textContent = `Voir le détail des entrées (${jobs.length})`;
}

function exportAnalyseCsv(){
  const { mode, anchor, userId } = analyseState;
  const range = periodRange(mode, anchor);
  const who = userId === 'all'
    ? 'equipe'
    : normalize(memberLabel({ userId }) || 'technicien').replace(/[^a-z0-9]+/g, '-');
  const when = range.from ? localDateInputValue(range.from) : 'tout';
  downloadJobsCsv(analyseJobs, `analyse-${who}-${when}.csv`, memberLabel);
}

/* Ouvre l'Analyse directement sur un technicien (depuis l'Admin). */
function openAnalyseFor(userId, anchor = new Date()){
  analyseState.userId = userId;
  analyseState.mode = 'week';
  analyseState.anchor = anchor;
  analyseState.fromAdmin = true; // affiche le bouton "‹ Retour aux techniciens"
  switchTab('analyse');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Bascule entre les deux sous-pages de l'Admin : la vue d'ensemble et la
   liste des techniciens (elle-même point d'entrée vers l'analyse d'un seul). */
function showAdminSubview(name){
  adminSubview = name;
  document.getElementById('adminOverview').hidden = name !== 'overview';
  document.getElementById('adminTechnicians').hidden = name !== 'technicians';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* --- Annuaire de l'équipe : id du compte → nom affiché ---
   Priorité : nom du compte (Admin → Ajouter un technicien), sinon le dernier
   nom tapé dans un service, sinon l'e-mail. On regroupe par compte (user_id)
   et pas par nom tapé : "Ana" et "ana " restent la même personne. */
async function getTeamMembers(){
  if(teamMembersCache) return teamMembersCache;
  const [accounts, { data: rows, error }] = await Promise.all([
    getAllTechnicians(),
    sb.from('jobs').select('user_id, technician').order('started_at', { ascending: false }).limit(2000)
  ]);
  if(error) console.error('Erreur getTeamMembers:', error);

  const typedName = new Map();
  (rows || []).forEach(r => {
    if(r.user_id && r.technician && !typedName.has(r.user_id)) typedName.set(r.user_id, r.technician.trim());
  });

  const byId = new Map();
  accounts.forEach(a => byId.set(a.id, {
    id: a.id,
    label: a.name || typedName.get(a.id) || a.email || 'Sans nom',
    removed: false
  }));
  typedName.forEach((name, id) => {
    if(!byId.has(id)) byId.set(id, { id, label: name, removed: accounts.length > 0 });
  });

  teamMembersCache = [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  return teamMembersCache;
}

function memberLabel(job){
  const m = (teamMembersCache || []).find(x => x.id === job.userId);
  return m ? m.label : job.name;
}

/* ======================= ADMIN (vue d'ensemble équipe) ======================= */
let adminInited = false;
let adminAllJobs = [];
let adminWeekStart = startOfWeek(new Date());

/* --- Gestion des modèles d'imprimante (table printer_models) --- */
async function getAllPrinterModelsFlat(){
  const { data, error } = await sb.from('printer_models').select('id, brand, model').order('brand').order('model');
  if(error){ console.error('Erreur getAllPrinterModelsFlat:', error); return []; }
  return data;
}

async function addPrinterModel(brand, model){
  const { error } = await sb.from('printer_models').insert({ brand, model });
  if(error){ console.error('Erreur addPrinterModel:', error); return false; }
  return true;
}

async function deletePrinterModel(id){
  const { error } = await sb.from('printer_models').delete().eq('id', id);
  if(error){ console.error('Erreur deletePrinterModel:', error); return false; }
  return true;
}

let modelManageInited = false;
function wireModelManageEvents(){
  if(modelManageInited) return;
  modelManageInited = true;

  document.getElementById('modelForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const brand = document.getElementById('modelFormBrand').value;
    const model = document.getElementById('modelFormModel').value.trim();
    if(!brand || !model) return;

    const ok = await addPrinterModel(brand, model);
    if(!ok){
      alert("Impossible d'ajouter ce modèle (existe peut-être déjà).");
      return;
    }
    document.getElementById('modelFormModel').value = '';
    printerModelsCache = null; // force le rechargement de l'autocomplétion
    await renderModelManageList();
  });
}

async function renderModelManageList(){
  const listEl = document.getElementById('modelManageList');
  const models = await getAllPrinterModelsFlat();
  listEl.innerHTML = models.map(m => `
    <li class="model-manage-row">
      <span>${escapeHtml(m.brand)} — ${escapeHtml(m.model)}</span>
      <button type="button" data-id="${m.id}" aria-label="Supprimer">🗑</button>
    </li>
  `).join('');

  listEl.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Supprimer ce modèle ?')) return;
      await deletePrinterModel(btn.dataset.id);
      printerModelsCache = null;
      renderModelManageList();
    });
  });
}

async function initAdmin(){
  document.getElementById('admin-loading').hidden = false;
  document.getElementById('admin-content').hidden = true;

  const [history, currentJobs] = await Promise.all([getHistory(), getOpenJobs(), getTeamMembers()]);
  adminAllJobs = [...currentJobs, ...history];

  renderAdminSummary(adminAllJobs);
  renderAdminWeek();
  populateAdminTechFilter();
  wireModelManageEvents();
  wireTechnicianForm();
  await renderModelManageList();
  await renderTechnicianManageList();

  // Les services de l'équipe ne s'affichent pas tout seuls — seulement si le
  // panneau a déjà été révélé (clic sur "Voir tous les services"), pour ne
  // pas exposer tout le monde par défaut à chaque visite de l'onglet.
  if(!document.getElementById('adminJobsPanel').hidden){
    renderAdminList(adminAllJobs);
  }

  if(!adminInited){
    adminInited = true;
    document.getElementById('btnRevealJobs').addEventListener('click', () => {
      document.getElementById('adminJobsGate').hidden = true;
      document.getElementById('adminJobsPanel').hidden = false;
      renderAdminList(adminAllJobs);
    });
    document.getElementById('adminSearch').addEventListener('input', () => renderAdminList(adminAllJobs));
    document.getElementById('adminTechFilter').addEventListener('change', () => renderAdminList(adminAllJobs));
    document.getElementById('btnExportAdmin').addEventListener('click', () => {
      downloadJobsCsv(filterAdminJobs(adminAllJobs), `services-equipe-${localDateInputValue(new Date())}.csv`, memberLabel);
    });
    document.getElementById('adminWeekPrev').addEventListener('click', () => {
      adminWeekStart = addDays(adminWeekStart, -7);
      renderAdminWeek();
    });
    document.getElementById('adminWeekNext').addEventListener('click', () => {
      adminWeekStart = addDays(adminWeekStart, 7);
      renderAdminWeek();
    });
    // Délégation : un clic sur un nom (tableau ou barre) → analyse de ce technicien seul.
    document.getElementById('technicianWeekTable').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-user]');
      if(btn) openAnalyseFor(btn.dataset.user, adminWeekStart);
    });
    document.getElementById('technicianWeekChart').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-user]');
      if(btn) openAnalyseFor(btn.dataset.user, adminWeekStart);
    });
    // Carte "Techniciens" du résumé → ouvre la sous-page liste des techniciens.
    document.getElementById('adminSummaryGrid').addEventListener('click', (e) => {
      if(e.target.closest('#adminTechCard')) showAdminSubview('technicians');
    });
    document.getElementById('btnAdminTechBack').addEventListener('click', () => showAdminSubview('overview'));
    document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
    document.getElementById('lightbox').addEventListener('click', (e) => {
      if(e.target.id === 'lightbox') closeLightbox();
    });
  }

  document.getElementById('admin-loading').hidden = true;
  document.getElementById('admin-content').hidden = false;
}

/* --- Création de compte technicien (email + mot de passe) ---
   Passe par une fonction serverless (api/create-technician.js) : la clé
   service_role du Supabase ne doit jamais atterrir dans ce fichier, qui est
   envoyé tel quel au navigateur de n'importe qui. */
let technicianFormInited = false;
function wireTechnicianForm(){
  if(technicianFormInited) return;
  technicianFormInited = true;

  document.getElementById('technicianForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('technicianStatus');
    const name = document.getElementById('technicianName').value.trim();
    const email = document.getElementById('technicianEmail').value.trim();
    const password = document.getElementById('technicianPassword').value;

    statusEl.hidden = false;
    statusEl.classList.remove('error');
    statusEl.textContent = 'Création du compte…';

    const { data: { session } } = await sb.auth.getSession();
    if(!session){
      statusEl.classList.add('error');
      statusEl.textContent = 'Session expirée — reconnectez-vous et réessayez.';
      return;
    }

    try {
      const res = await fetch('/api/create-technician', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name, email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if(!res.ok){
        statusEl.classList.add('error');
        statusEl.textContent = body.error || 'Erreur lors de la création du compte.';
        return;
      }
      statusEl.classList.remove('error');
      statusEl.textContent = `Compte créé pour ${body.email}. Partagez le mot de passe avec le technicien.`;
      document.getElementById('technicianForm').reset();
      techniciansCache = null;
      teamMembersCache = null;
      renderTechnicianManageList();
    } catch(err){
      console.error('Erreur create-technician:', err);
      statusEl.classList.add('error');
      statusEl.textContent = 'Erreur réseau — réessayez.';
    }
  });
}

/* --- Liste des comptes techniciens (avec suppression) ---
   Passe par api/list-technicians.js et api/delete-technician.js, même raison
   que la création : il faut la clé service_role pour gérer les comptes du
   Supabase Auth. */
async function getAllTechnicians(){
  if(techniciansCache) return techniciansCache;
  const { data: { session } } = await sb.auth.getSession();
  if(!session) return [];

  try {
    const res = await fetch('/api/list-technicians', {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const body = await res.json().catch(() => ({}));
    if(!res.ok){
      console.error('Erreur list-technicians:', body.error);
      return [];
    }
    techniciansCache = body.technicians || [];
    return techniciansCache;
  } catch(err){
    console.error('Erreur réseau list-technicians:', err);
    return [];
  }
}

async function renderTechnicianManageList(){
  const listEl = document.getElementById('technicianManageList');
  const technicians = await getAllTechnicians();

  if(technicians.length === 0){
    listEl.innerHTML = '<li class="model-manage-row"><span>Aucun compte trouvé (ou erreur de chargement).</span></li>';
    return;
  }

  const { data: { session } } = await sb.auth.getSession();
  const myId = session ? session.user.id : null;

  listEl.innerHTML = technicians.map(t => `
    <li class="model-manage-row">
      <span>${t.name ? escapeHtml(t.name) + ' — ' : ''}${escapeHtml(t.email || '')}</span>
      <span>
        <button type="button" data-analyse="${escapeHtml(t.id)}" aria-label="Voir l'analyse de ${escapeHtml(t.name || t.email || '')}" title="Voir son analyse">📊</button>
        ${t.id !== myId ? `<button type="button" data-id="${escapeHtml(t.id)}" data-label="${escapeHtml(t.name || t.email || '')}" aria-label="Supprimer ce technicien">🗑</button>` : ''}
      </span>
    </li>
  `).join('');

  listEl.querySelectorAll('button[data-analyse]').forEach(btn => {
    btn.addEventListener('click', () => openAnalyseFor(btn.dataset.analyse));
  });

  listEl.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm(`Supprimer le compte de ${btn.dataset.label} ?\n\nIl ne pourra plus se connecter. Ses services déjà enregistrés restent dans l'historique.`)) return;
      btn.disabled = true;
      const ok = await deleteTechnician(btn.dataset.id);
      if(!ok){ btn.disabled = false; return; }
      techniciansCache = null;
      teamMembersCache = null;
      renderTechnicianManageList();
    });
  });
}

async function deleteTechnician(userId){
  const { data: { session } } = await sb.auth.getSession();
  if(!session){
    alert('Session expirée — reconnectez-vous et réessayez.');
    return false;
  }
  try {
    const res = await fetch('/api/delete-technician', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId }),
    });
    const body = await res.json().catch(() => ({}));
    if(!res.ok){
      alert(body.error || 'Erreur lors de la suppression du compte.');
      return false;
    }
    return true;
  } catch(err){
    console.error('Erreur delete-technician:', err);
    alert('Erreur réseau — réessayez.');
    return false;
  }
}

function renderAdminSummary(jobs){
  const finished = jobs.filter(j => j.finishedAt);
  const totalSeconds = finished.reduce((sum, j) => sum + (j.activeSeconds || 0), 0);
  const technicians = new Set(jobs.map(j => j.userId).filter(Boolean));

  document.getElementById('adminSummaryGrid').innerHTML = `
    <div class="summary-card">
      <p class="summary-value">${finished.length}</p>
      <p class="summary-label">Services terminés</p>
    </div>
    <div class="summary-card">
      <p class="summary-value">${fmtHShort(totalSeconds)}</p>
      <p class="summary-label">Total d'heures</p>
    </div>
    <button type="button" class="summary-card summary-card--link" id="adminTechCard">
      <p class="summary-value">${technicians.size}</p>
      <p class="summary-label">Techniciens</p>
      <span class="summary-chev">Voir la liste ›</span>
    </button>
  `;
}

/* --- Heures par technicien, semaine calendaire (lundi → dimanche) ---
   Regroupé par compte (user_id), pas par nom tapé à la main. Les comptes
   sans aucune heure apparaissent aussi dans le tableau : c'est justement
   ce qu'on veut repérer (un oubli de saisie, une absence). */
function renderAdminWeek(){
  const from = adminWeekStart;
  const to = addDays(from, 7);
  document.getElementById('adminWeekLabel').textContent = `Semaine du ${weekRangeLabel(from)}`;
  document.getElementById('adminWeekNext').disabled = from >= startOfWeek(new Date());

  const weekJobs = adminAllJobs.filter(j => {
    if(!j.finishedAt) return false;
    const t = new Date(j.finishedAt);
    return t >= from && t < to;
  });
  renderTechnicianWeekChart(weekJobs);
  renderTechnicianWeekTable(weekJobs, from);
}

function renderTechnicianWeekChart(weekJobs){
  const totals = new Map();
  weekJobs.forEach(job => {
    if(!job.userId) return;
    totals.set(job.userId, (totals.get(job.userId) || 0) + (job.activeSeconds || 0));
  });

  const entries = [...totals.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const el = document.getElementById('technicianWeekChart');
  if(entries.length === 0){
    el.innerHTML = `<p class="empty">Aucune heure enregistrée cette semaine.</p>`;
    return;
  }

  const max = Math.max(...entries.map(e => e[1]));
  el.innerHTML = entries.map(([userId, seconds]) => `
    <button type="button" class="hbar-row hbar-row--link" data-user="${escapeHtml(userId)}">
      <span class="hbar-label">${escapeHtml(memberLabel({ userId }) || '?')}</span>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${(seconds / max) * 100}%">
          <span class="hbar-count">${fmtHShort(seconds)}</span>
        </div>
      </div>
      <span class="hbar-chev">›</span>
    </button>
  `).join('');
}

/* Grille "type Excel" : une ligne par technicien, une colonne par jour. */
function renderTechnicianWeekTable(weekJobs, monday){
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const byTech = new Map();
  // Tous les comptes actifs, même à zéro heure.
  (teamMembersCache || []).filter(m => !m.removed).forEach(m => byTech.set(m.id, {}));
  weekJobs.forEach(job => {
    if(!job.userId) return;
    if(!byTech.has(job.userId)) byTech.set(job.userId, {});
    const row = byTech.get(job.userId);
    const key = new Date(job.finishedAt).toDateString();
    row[key] = (row[key] || 0) + (job.activeSeconds || 0);
  });

  const el = document.getElementById('technicianWeekTable');
  if(byTech.size === 0){
    el.innerHTML = `<p class="empty">Aucune donnée cette semaine.</p>`;
    return;
  }

  const ids = [...byTech.keys()].sort((a, b) =>
    (memberLabel({ userId: a }) || '').localeCompare(memberLabel({ userId: b }) || '', 'fr'));
  const header = `<tr><th>Technicien</th>${days.map(d => `<th>${DAYS_FR[d.getDay()]} ${d.getDate()}</th>`).join('')}<th>Total</th></tr>`;
  const body = ids.map(id => {
    const row = byTech.get(id);
    const cells = days.map(d => row[d.toDateString()] || 0);
    const total = cells.reduce((sum, s) => sum + s, 0);
    return `
      <tr${total === 0 ? ' class="is-zero"' : ''}>
        <td><button type="button" class="link-btn" data-user="${escapeHtml(id)}">${escapeHtml(memberLabel({ userId: id }) || '?')}</button></td>
        ${cells.map(s => `<td>${s > 0 ? fmtHShort(s) : '–'}</td>`).join('')}
        <td><b>${fmtHShort(total)}</b></td>
      </tr>
    `;
  }).join('');

  el.innerHTML = `<table class="week-table">${header}${body}</table>`;
}

function populateAdminTechFilter(){
  const select = document.getElementById('adminTechFilter');
  const current = select.value;
  select.innerHTML = `<option value="">Toute l'équipe</option>` + (teamMembersCache || []).map(m =>
    `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}${m.removed ? ' (compte supprimé)' : ''}</option>`
  ).join('');
  select.value = current;
}

function filterAdminJobs(jobs){
  const q = normalize(document.getElementById('adminSearch').value.trim());
  const techId = document.getElementById('adminTechFilter').value;
  return jobs.filter(j => {
    if(techId && j.userId !== techId) return false;
    if(!q) return true;
    return normalize(`${memberLabel(j) || ''} ${j.name || ''} ${j.brand || ''} ${j.model || ''} ${j.etape || ''} ${j.note || ''}`).includes(q);
  });
}

function renderAdminList(jobs){
  const filtered = filterAdminJobs(jobs);

  const listEl3 = document.getElementById('adminList');
  document.getElementById('adminCount').textContent = `${filtered.length} service(s)`;
  document.getElementById('adminEmpty').hidden = filtered.length > 0;
  document.getElementById('btnExportAdmin').hidden = filtered.length === 0;
  listEl3.innerHTML = '';
  filtered.forEach(job => listEl3.appendChild(jobCardElement(job, { showName: true, nameLabel: memberLabel(job) })));
  hydratePhotos(listEl3, { zoomable: true });
}

function openLightbox(url){
  document.getElementById('lightboxImg').src = url;
  document.getElementById('lightbox').hidden = false;
}
function closeLightbox(){
  document.getElementById('lightbox').hidden = true;
  document.getElementById('lightboxImg').removeAttribute('src');
}