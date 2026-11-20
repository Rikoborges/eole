/* =========================================================================
   ReproBench — onglet « Saisir » : déclaration d'activité du collaborateur
   (cahier des charges de l'atelier, partie 2)

   Le collaborateur déclare ce qu'il a fait et le temps passé, en 5 étapes :
   activité → quantité (ou matricule + modèle) → temps → statut → valider.
   Les étapes avec matricule peuvent rester « à poursuivre » et être reprises
   les jours suivants ; le temps compte le jour où il a été fait.

   Dépend de script.js (chargé avant) : sb, escapeHtml, getMyUserId.
   Les règles importantes (standard recopié, matricule unique par étape,
   délai de correction, pas de suppression) sont appliquées par la base
   (supabase/atelier-schema.sql), pas seulement ici.
   ========================================================================= */
(function(){
  'use strict';

  const root = document.getElementById('saisie-root');
  if(!root) return;

  /* ---------- dates à l'heure de l'atelier ---------- */
  const TZ = 'Europe/Paris';
  const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const weekdayIdx = s => (new Date(s + 'T12:00:00Z').getUTCDay() + 6) % 7; // lundi = 0
  const dayLabel = (s, opts = { weekday: 'long', day: 'numeric', month: 'long' }) =>
    new Date(s + 'T12:00:00Z').toLocaleDateString('fr-FR', Object.assign({ timeZone: 'UTC' }, opts));
  const shortLabel = s => dayLabel(s, { weekday: 'short', day: 'numeric', month: 'short' });
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- nombres et temps ---------- */
  const r2 = v => Math.round(v * 100) / 100;
  const h2 = v => (v === null || v === undefined || isNaN(v)) ? '—' : r2(Number(v)).toFixed(2).replace('.', ',');
  const hm = v => { const m = Math.round(Math.abs(v) * 60); return `${v < 0 ? '−' : ''}${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  const sgn = v => (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + h2(Math.abs(v));
  function parseTime(raw){
    const s = String(raw || '').trim().toLowerCase().replace(',', '.');
    if(!s) return null;
    let m = s.match(/^(\d+)\s*h\s*(\d{1,2})?\s*(min|mn|m)?$/);
    if(m) return r2(+m[1] + (m[2] ? +m[2] / 60 : 0));
    m = s.match(/^(\d+(?:\.\d+)?)\s*(min|mn|m)$/);
    if(m) return r2(+m[1] / 60);
    if(/^\d+(?:\.\d+)?$/.test(s)) return r2(+s);
    return NaN;
  }
  const esc = s => escapeHtml(s);
  const norm = x => String(x || '').toUpperCase().replace(/[\s.\-]/g, '');

  /* ---------- état ---------- */
  const STATUS = {
    encours: ['blue', 'En cours'], pause: ['mid', 'À poursuivre'], final: ['ok', 'Finalisée'],
    abandon: ['bad', 'Abandonnée / Non réalisable'], annulee: ['dim', 'Annulée (archivée)']
  };
  const blankForm = () => ({ checks: [], kind: 'prod', act: null, hp: null, qte: 1, serial: '', model: null, unreadable: false,
                             tRaw: '', tManual: false, workDate: null, note: '', editId: null, opId: null, st: null, err: '' });
  const SX = {
    userId: null, ready: false, loading: false, setupError: null,
    profile: null, format: null, metierLabel: '',
    acts: [], hp: [], models: [], rules: {},
    today: null, viewDate: null,
    todayDecls: [], viewDecls: [], openOps: [], opsById: {}, freq: {},
    form: blankForm(), lastSaved: null, confirmCancel: null, busy: false,
    lookup: { serial: '', rows: [] }, mSel: 0
  };
  const actById = id => SX.acts.find(a => a.id === id);
  const hpById = id => SX.hp.find(h => h.id === id);
  const modelById = id => SX.models.find(m => m.id === id);
  const modelLabel = id => { const m = modelById(id); return m ? m.model : ''; };
  const objectiveFor = s => { const i = weekdayIdx(s); return (i < 5 && SX.format) ? Number(SX.format.day_hours[i]) : 0; };
  const dayTotal = list => r2(list.filter(d => !d.cancelled).reduce((a, d) => a + Number(d.hours), 0));

  function correctionFloor(){
    const t = SX.today, rule = SX.rules.correction || 'day';
    if(rule === 'h24') return addDays(t, -1);
    if(rule === 'week') return addDays(t, -weekdayIdx(t));
    if(rule === 'days7') return addDays(t, -6);
    if(rule === 'none') return addDays(t, 1);
    return t;
  }
  const canEdit = d => !d.cancelled && d.work_date >= correctionFloor();
  const corrLabel = () => ({ day: "jusqu'à la fin de la journée", h24: 'pendant 24 h',
                             week: "jusqu'à la fin de la semaine", days7: 'pendant 7 jours', none: 'uniquement par le responsable' })[SX.rules.correction || 'day'];

  /* ---------- message temporaire ---------- */
  let toastEl = null, toastTimer = null;
  function toast(html){
    if(!toastEl){ toastEl = document.createElement('div'); toastEl.className = 'sx-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.innerHTML = html; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4500);
  }

  // « Enregistré · Annuler » : 8 secondes pour revenir en arrière (comme Gmail)
  let undoEl = null, undoTimer = null;
  function toastUndo(html, onUndo){
    if(toastEl) toastEl.hidden = true;
    if(!undoEl){ undoEl = document.createElement('div'); undoEl.className = 'sx-toast sx-toast-undo'; undoEl.setAttribute('role', 'status'); document.body.appendChild(undoEl); }
    undoEl.innerHTML = `<span>${html}</span><button type="button" class="sx-undo">Annuler</button><span class="sx-undo-bar"></span>`;
    undoEl.hidden = false;
    const btn = undoEl.querySelector('.sx-undo');
    btn.onclick = async () => { btn.disabled = true; btn.textContent = '…'; clearTimeout(undoTimer); try{ await onUndo(); } finally { undoEl.hidden = true; } };
    clearTimeout(undoTimer); undoTimer = setTimeout(() => { undoEl.hidden = true; }, 8000);
  }

  function dbError(error){
    const msg = (error && (error.message || error.details)) || 'erreur inconnue';
    if(error && error.code === '23505') return 'Ce N° de série est déjà enregistré pour cette étape. S\'il est à vous et pas terminé, utilisez « Reprendre l\'étape ».';
    if(error && error.code === '42501') return 'Enregistrement refusé : le délai de correction est peut-être dépassé.';
    if(/relation .* does not exist|Could not find the table|PGRST205/i.test(msg)) return 'La base n\'est pas encore installée (supabase/atelier-schema.sql).';
    return msg;
  }

  /* ---------- chargement ---------- */
  async function loadRefs(){
    const uid = SX.userId;
    const [prof, acts, stds, hp, models, rules, formats, metiers] = await Promise.all([
      sb.from('collaborateurs').select('*').eq('user_id', uid).maybeSingle(),
      sb.from('activites').select('id, metier_id, name, requires_machine, uses_quantity, checklist, sort').eq('active', true).order('sort'),
      sb.from('standards').select('activite_id, hours_per_unit, valid_from').lte('valid_from', todayStr()).order('valid_from'),
      sb.from('hors_production').select('id, label, sort').eq('active', true).order('sort'),
      sb.from('printer_models').select('id, brand, model, famille').order('model'),
      sb.from('regles_saisie').select('key, value'),
      sb.from('formats_horaires').select('*'),
      sb.from('metiers').select('*')
    ]);
    const firstErr = [prof, acts, stds, hp, models, rules, formats, metiers].find(r => r.error);
    if(firstErr){ SX.setupError = dbError(firstErr.error); return false; }
    SX.setupError = null;
    SX.profile = prof.data;
    SX.rules = Object.fromEntries((rules.data || []).map(r => [r.key, r.value]));
    SX.models = models.data || [];
    SX.std = {}; (stds.data || []).forEach(x => { SX.std[x.activite_id] = x.hours_per_unit === null ? null : Number(x.hours_per_unit); });
    SX.hp = hp.data || [];
    if(SX.profile){
      SX.acts = (acts.data || []).filter(a => a.metier_id === SX.profile.metier_id);
      SX.format = (formats.data || []).find(f => f.id === SX.profile.format_id) || null;
      const m = (metiers.data || []).find(x => x.id === SX.profile.metier_id);
      SX.metierLabel = m ? m.label : '';
    }
    return true;
  }

  async function loadDay(){
    const uid = SX.userId;
    const since = addDays(SX.today, -14);
    const qs = [
      sb.from('declarations').select('*').eq('user_id', uid).eq('work_date', SX.today).order('created_at'),
      sb.from('operations_avec_temps').select('*').eq('user_id', uid).in('status', ['encours', 'pause']).order('started_on'),
      sb.from('declarations').select('activite_id').eq('user_id', uid).eq('cancelled', false).gte('work_date', since).not('activite_id', 'is', null).limit(500)
    ];
    if(SX.viewDate !== SX.today)
      qs.push(sb.from('declarations').select('*').eq('user_id', uid).eq('work_date', SX.viewDate).order('created_at'));
    const monday = addDays(SX.today, -weekdayIdx(SX.today));
    qs.push(sb.from('declarations').select('work_date, hours').eq('user_id', uid).eq('cancelled', false).gte('work_date', monday).lte('work_date', SX.today));
    qs.push(sb.from('validations_semaine').select('*').eq('user_id', uid).eq('week_monday', monday).maybeSingle());
    const res = await Promise.all(qs);
    const valRes = res.pop(), weekRes = res.pop();
    SX.weekDecls = weekRes.error ? [] : (weekRes.data || []); SX.weekVal = valRes.error ? undefined : (valRes.data || null);
    const err = res.find(r => r.error);
    if(err){ SX.setupError = dbError(err.error); return; }
    SX.todayDecls = res[0].data || [];
    SX.openOps = res[1].data || [];
    SX.freq = {};
    (res[2].data || []).forEach(d => { SX.freq[d.activite_id] = (SX.freq[d.activite_id] || 0) + 1; });
    SX.viewDecls = SX.viewDate === SX.today ? SX.todayDecls : (res[3].data || []);
    // opérations liées aux déclarations affichées (pour le statut et le cumul)
    const ids = [...new Set([...SX.todayDecls, ...SX.viewDecls].map(d => d.operation_id).filter(Boolean))];
    SX.opsById = {};
    SX.openOps.forEach(o => { SX.opsById[o.id] = o; });
    const missing = ids.filter(id => !SX.opsById[id]);
    if(missing.length){
      const { data } = await sb.from('operations_avec_temps').select('*').in('id', missing);
      (data || []).forEach(o => { SX.opsById[o.id] = o; });
    }
  }

  async function initSaisie(force){
    const uid = await getMyUserId();
    if(!uid) return;
    if(uid !== SX.userId){
      Object.assign(SX, { userId: uid, ready: false, form: blankForm(), lastSaved: null, confirmCancel: null });
    }
    if(SX.loading) return;
    if(SX.ready && !force){ render(); return; }
    SX.loading = true;
    if(!SX.ready) root.innerHTML = '<p class="loading">Chargement…</p>';
    SX.today = todayStr();
    if(!SX.viewDate || !SX.ready) SX.viewDate = SX.today;
    try{
      const ok = await loadRefs();
      if(ok && SX.profile && SX.profile.metier_id && SX.format){ await loadDay(); if(SX.rules.chrono === true) await pullChronos(); }
      SX.ready = true;
    }catch(e){
      console.error('Erreur Saisir:', e);
      SX.setupError = 'Erreur inattendue : ' + e.message;
    }finally{
      SX.loading = false;
    }
    render();
  }
  window.initSaisie = initSaisie;

  /* ---------- rendu ---------- */
  function render(){
    fillTimeFromChrono();
    if(SX.setupError){
      root.innerHTML = `<div class="sx-card sx-notice"><h2 class="sx-h2">Saisie indisponible</h2><p>${esc(SX.setupError)}</p></div>`;
      return;
    }
    if(!SX.profile || !SX.profile.metier_id || !SX.format){
      root.innerHTML = `<div class="sx-card sx-notice"><h2 class="sx-h2">Votre fiche n'est pas encore complète</h2>
        <p>Le responsable des ateliers doit indiquer votre <b>métier</b> et votre <b>format horaire</b> (37 h ou 39 h). Ensuite, vous pourrez déclarer votre activité ici.</p></div>`;
      return;
    }
    const f = SX.form, t = SX.today, obj = objectiveFor(t), tot = dayTotal(SX.todayDecls), rest = r2(obj - tot);
    const act = f.act ? actById(f.act) : null, isM = f.kind === 'prod' && act && act.requires_machine;
    const op = f.opId ? SX.opsById[f.opId] : null;
    const top = Object.entries(SX.freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
    const sorted = [...SX.acts].sort((a, b) => (top.includes(b.id) ? 1 : 0) - (top.includes(a.id) ? 1 : 0));
    let n = 0; const N = () => ++n;
    const barCls = obj && rest < -0.01 ? 'over' : obj && Math.abs(rest) < 0.01 ? 'full' : '';

    root.innerHTML = `
    <div class="sx-daybar">
      <div><h2 class="sx-title">${esc(cap(dayLabel(t)))}</h2>
        <p class="sx-sub">${esc(SX.metierLabel)} · format ${esc(SX.format.label)} · ${obj ? 'objectif du jour ' + hm(obj) : 'pas d\'objectif aujourd\'hui'}</p></div>
      <div class="sx-prog" aria-live="polite">
        <div class="sx-row sx-between"><span class="sx-big">${hm(tot)}${obj ? ` <small>/ ${hm(obj)}</small>` : ''}</span>
          ${obj ? `<span class="${rest < -0.01 ? 'sx-bad' : Math.abs(rest) < 0.01 ? 'sx-ok' : 'sx-mid'}">${rest < -0.01 ? hm(-rest) + ' de trop' : Math.abs(rest) < 0.01 ? 'Journée complète ✓' : 'Reste à déclarer ' + hm(rest)}</span>` : ''}</div>
        ${obj ? `<div class="sx-bar"><span class="${barCls}" style="width:${Math.min(100, tot / obj * 100)}%"></span></div>` : ''}
      </div>
    </div>

    ${endOfDayHTML(obj, rest)}
    ${weekCheckHTML()}
    ${opsCard()}
    ${chronoStrip()}

    <div class="sx-grid">
      <div class="sx-card" id="sxFormCard">
        <div class="sx-row sx-between sx-mb">
          <h2 class="sx-h2">${op ? 'Reprendre l\'étape' : f.editId ? 'Modifier la déclaration' : f.workDate ? 'Déclaration d\'un jour passé' : 'Nouvelle déclaration'}</h2>
          ${SX.lastSaved && !f.editId && !op ? '<button type="button" class="sx-btn sx-sm" data-a="repeat">↻ Refaire la même</button>' : ''}
          ${f.editId || op ? '<button type="button" class="sx-btn sx-sm" data-a="cancelForm">Annuler</button>' : ''}
        </div>
        ${f.workDate ? `<div class="sx-past"><span>📅 Pour le <b>${esc(dayLabel(f.workDate))}</b> · déjà ${hm(dayTotal(SX.viewDate === f.workDate ? SX.viewDecls : []))}${objectiveFor(f.workDate) ? ' sur ' + hm(objectiveFor(f.workDate)) : ''}</span><button type="button" class="sx-link" data-a="pastCancel">Revenir à aujourd'hui</button></div>` : ''}
        ${op ? `<div class="sx-opsum"><b>${esc((actById(op.activite_id) || {}).name || '')}</b>
            <span class="sx-mono">${esc(op.serial || 'sans matricule')} · ${esc(modelLabel(op.model_id) || 'modèle ?')}</span>
            <span class="sx-small">Commencée le ${esc(shortLabel(op.started_on))} · déjà ${h2(op.total_hours)} h · attendu ${h2(op.std_value)} h</span></div>` : `
        <div class="sx-step"><span class="sx-num">${N()}</span><div>
          <h3>Activité</h3>
          <div class="sx-seg" role="group" aria-label="Type d'activité">
            <button type="button" data-kind="prod" aria-pressed="${f.kind === 'prod'}">Production</button>
            <button type="button" data-kind="hp" aria-pressed="${f.kind === 'hp'}">Hors production</button>
          </div>
          <div class="sx-chips">${f.kind === 'prod'
            ? sorted.map(a => `<button type="button" class="sx-chip" data-act="${a.id}" aria-pressed="${f.act === a.id}">${top.includes(a.id) ? '<span class="sx-star" aria-label="fréquent">★</span>' : ''}${esc(a.name)}${a.requires_machine ? ' <small>matricule</small>' : ''}</button>`).join('')
            : SX.hp.map(h => `<button type="button" class="sx-chip" data-hp="${h.id}" aria-pressed="${f.hp === h.id}">${esc(h.label)}</button>`).join('')}</div>
        </div></div>
        ${act && f.kind === 'prod' ? `<p class="sx-attendu" id="sxAttendu">${attenduText(act)}</p>` : ''}
        ${f.kind === 'prod' && act && !isM && act.uses_quantity !== false ? `<div class="sx-step"><span class="sx-num">${N()}</span><div><h3>Quantité</h3>
          <div class="sx-stepper"><button type="button" data-a="qm" aria-label="Moins">−</button><input type="text" id="sxQte" inputmode="numeric" value="${esc(f.qte)}" aria-label="Quantité"><button type="button" data-a="qp" aria-label="Plus">+</button></div></div></div>` : ''}
        ${isM ? `<div class="sx-step"><span class="sx-num">${N()}</span><div><h3>Matériel <small>· 1 matricule = 1 quantité, comptée à la finalisation</small></h3>
          <div class="sx-mgrid">
            <div><label class="field-label" for="sxSerial">N° de série</label><input type="text" id="sxSerial" class="sx-mono" value="${esc(f.serial)}" placeholder="7019606410YBX" autocomplete="off" autocapitalize="characters"></div>
            <div><label class="field-label" for="sxModelQ">Modèle</label><div id="sxModelBox">${modelBox()}</div></div>
          </div>
          <div id="sxLookup"></div>
          <label class="sx-check"><input type="checkbox" id="sxUnreadable" ${f.unreadable ? 'checked' : ''}> Étiquette illisible, compléter plus tard (le responsable verra une alerte)</label>
        </div></div>` : ''}`}
        <div class="sx-step"><span class="sx-num">${N()}</span><div><h3>${isM ? 'Temps consacré aujourd\'hui' : 'Temps consacré'}</h3>
          <div class="sx-quick">${[0.25, 0.5, 1, 1.5, 2, 3].map(v => `<button type="button" data-tq="${v}" aria-pressed="false">${h2(v)}</button>`).join('')}</div>
          <div class="sx-row sx-mt"><input type="text" id="sxTime" class="sx-mono sx-time" value="${esc(f.tRaw)}" placeholder="ex : 1h30, 45 min" aria-label="Temps consacré" inputmode="decimal"><span id="sxConv" class="sx-small"></span></div>
          ${chronoInline()}
        </div></div>
        ${isM ? `<div class="sx-step"><span class="sx-num">${N()}</span><div><h3>Statut de l'étape</h3>
          <div class="sx-stchoice">
            <button type="button" class="fin" data-st="final" aria-pressed="${f.st === 'final'}">✓ Finaliser l'étape<small>La machine est terminée : 1 unité comptée.</small></button>
            <button type="button" class="pau" data-st="pause" aria-pressed="${f.st === 'pause'}">⏸ Mettre en attente / À poursuivre<small>Le temps compte aujourd'hui, la machine pas encore.</small></button>
          </div><p id="sxStPrev" class="sx-small sx-mt"></p>${f.st === 'final' && act.checklist ? checklistHTML(act) : ''}</div></div>` : ''}
        ${act && f.kind === 'prod' && !isM && act.checklist && !op ? `<div class="sx-step"><span class="sx-num">${N()}</span><div><h3>Checklist</h3>${checklistHTML(act)}</div></div>` : ''}
        <div class="sx-step"><span class="sx-num">${N()}</span><div><h3>Commentaire <small>(facultatif)</small></h3>
          <input type="text" id="sxNote" value="${esc(f.note)}" placeholder="Ex : attente pièce, machine très sale…" aria-label="Commentaire"></div></div>
        ${f.err ? `<div class="sx-error" role="alert">${f.err}</div>` : ''}
        <button type="button" class="btn-primary sx-save" data-a="save" ${SX.busy ? 'disabled' : ''}>${SX.busy ? 'Enregistrement…' : f.editId ? 'Mettre à jour' : 'Valider'}</button>
      </div>

      <div class="sx-side">
        ${chronoSide()}
        ${chronoPausedSide()}
        ${alertsCard()}
        ${dayCard()}
      </div>
    </div>`;
    updConv(); lookupSerial(true);
  }

  // Rappel de fin de journée (à partir de 16 h 30, heure de l'atelier)
  const parisMinutes = () => { const p = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const g = t => +(p.find(x => x.type === t) || {}).value || 0; return g('hour') * 60 + g('minute'); };
  function endOfDayHTML(obj, rest){
    if(!obj || rest < 0.01 || parisMinutes() < 16 * 60 + 30 || SX.eodHidden === SX.today) return '';
    return `<div class="sx-eod" role="status"><span>⏰ <b>Il manque ${hm(rest)}</b> pour compléter votre journée.</span>
      <span class="sx-row"><button type="button" class="sx-btn sx-sm sx-primary" data-a="eodGo">Déclarer maintenant</button><button type="button" class="sx-link" data-a="eodHide">Plus tard</button></span></div>`;
  }

  // Bilan de la semaine : le vendredi (et le week-end), « tout est bon ? » avant de signer
  function weekCheckHTML(){
    const wd = weekdayIdx(SX.today);
    if(wd < 4 || SX.weekHidden === SX.today || !SX.format) return '';
    const monday = addDays(SX.today, -wd), v = SX.weekVal;
    if(v && v.validated_at) return '';
    const days = [0, 1, 2, 3, 4].map(i => { const d = addDays(monday, i), obj = objectiveFor(d), tot = r2(SX.weekDecls.filter(x => x.work_date === d).reduce((a, x) => a + Number(x.hours), 0));
      return { d, obj, tot, ok: !obj || Math.abs(tot - obj) < 0.01, over: obj && tot > obj + 0.01 }; });
    const bad = days.filter(x => !x.ok && x.d <= SX.today);
    const editable = d => d >= correctionFloor();
    const chips = days.map(x => `<button type="button" class="sx-wkday ${x.ok ? 'ok' : x.over ? 'over' : 'miss'}" data-goday="${x.d}" ${editable(x.d) ? '' : 'disabled'} title="${esc(dayLabel(x.d))}">
        <b>${esc(dayLabel(x.d, { weekday: 'short' }))}</b><span>${x.ok ? '✓' : x.over ? '+' + hm(x.tot - x.obj) : '−' + hm(x.obj - x.tot)}</span></button>`).join('');
    const signed = v && v.signed_at;
    return `<div class="sx-card sx-wkcheck" role="status">
      <div class="sx-row sx-between"><h2 class="sx-h2">📋 C'est vendredi : votre semaine est-elle juste ?</h2><button type="button" class="sx-link" data-a="weekHide">Plus tard</button></div>
      <p class="sx-small">${bad.length ? `${bad.length} jour${bad.length > 1 ? 's' : ''} à revoir : touchez un jour pour le corriger ou ajouter ce qui manque.` : 'Tous les jours sont complets. Vérifiez puis signez votre semaine.'}</p>
      <div class="sx-wkdays">${chips}</div>
      <div class="sx-row">${SX.weekVal !== undefined ? `<button type="button" class="sx-btn sx-sm ${bad.length ? '' : 'sx-primary'}" data-a="weekSign">${signed ? '✍ Signée · signer à nouveau' : '✍ Signer ma semaine'}</button>` : ''}
        <button type="button" class="sx-btn sx-sm" data-a="weekOpen">Voir ma fiche de la semaine</button></div>
    </div>`;
  }

  function opsCard(){
    const ops = SX.openOps;
    return `<div class="sx-card sx-ops">
      <h2 class="sx-h2">Mes étapes en cours (${ops.length})</h2>
      ${ops.length ? `<div class="sx-tscroll"><table class="sx-table"><thead><tr><th>Matricule</th><th>Modèle</th><th>Étape</th><th>Début</th><th class="n">Temps consacré</th><th class="n">Attendu</th><th>Statut</th><th></th></tr></thead><tbody>
        ${ops.map(o => `<tr><td class="sx-mono">${o.serial ? esc(o.serial) : '<span class="sx-bad">à compléter</span>'}</td><td>${esc(modelLabel(o.model_id) || '—')}</td>
          <td>${esc((actById(o.activite_id) || {}).name || '')}</td><td>${esc(shortLabel(o.started_on))}</td><td class="n">${h2(o.total_hours)} h</td><td class="n">${h2(o.std_value)} h</td>
          <td>${pill(SX.form.opId === o.id ? 'encours' : o.status)}</td>
          <td><button type="button" class="sx-btn sx-sm sx-primary" data-resume="${o.id}" ${SX.form.opId === o.id ? 'disabled' : ''}>${SX.form.opId === o.id ? 'Reprise ci-dessous' : 'Reprendre l\'étape'}</button></td></tr>`).join('')}
      </tbody></table></div>`
      : '<p class="sx-small">Aucune étape en cours. Si une machine n\'est pas terminée, choisissez « Mettre en attente » en validant : le temps compte dans la journée et vous la retrouverez ici.</p>'}
    </div>`;
  }
  const pill = s => `<span class="sx-pill sx-${STATUS[s][0]}">${STATUS[s][1]}</span>`;

  function alertsCard(){
    const out = [], obj = objectiveFor(SX.today), tot = dayTotal(SX.todayDecls);
    if(obj && tot > obj + 0.01) out.push(['bad', 'Temps supérieur à l\'objectif', `${h2(tot)} h déclarées pour ${h2(obj)} h`]);
    if(!obj && tot > 0) out.push(['mid', 'Jour sans objectif', `${h2(tot)} h déclarées un jour non travaillé dans votre format`]);
    SX.openOps.filter(o => !o.serial || !o.model_id).forEach(o => out.push(['bad', !o.serial ? 'Matricule à compléter' : 'Modèle à compléter', (actById(o.activite_id) || {}).name || '']));
    if(!out.length) return '';
    return `<div class="sx-card"><h2 class="sx-h2">À vérifier</h2>${out.map(([k, t, m]) => `<div class="sx-alert sx-alert-${k}"><b>${esc(t)}</b><span>${esc(m)}</span></div>`).join('')}</div>`;
  }

  function dayCard(){
    const d = SX.viewDate, isToday = d === SX.today, list = SX.viewDecls, live = list.filter(x => !x.cancelled);
    const minDate = addDays(SX.today, -60);
    return `<details class="sx-card sx-daydetails" id="sxDayDetails" ${SX.dayOpen ? 'open' : ''}>
      <summary><span class="sx-h2">${isToday ? 'Aujourd\'hui' : esc(cap(shortLabel(d)))} · ${live.length} déclaration${live.length > 1 ? 's' : ''} · ${hm(dayTotal(list))}</span><span class="sx-small sx-summ">${SX.dayOpen ? 'Masquer' : 'Afficher'}</span></summary>
      <div class="sx-row sx-between sx-mb sx-mt"><span class="sx-small">Jour affiché</span>
        <span class="week-nav sx-daynav"><button type="button" data-day="-1" aria-label="Jour précédent" ${d <= minDate ? 'disabled' : ''}>‹</button><button type="button" data-day="1" aria-label="Jour suivant" ${isToday ? 'disabled' : ''}>›</button></span></div>
      ${isToday ? '' : `<p class="sx-small sx-mb">${hm(dayTotal(list))} déclarées${objectiveFor(d) ? ' sur ' + hm(objectiveFor(d)) : ''} · <button type="button" class="sx-btn sx-sm" data-day="0">Revenir à aujourd'hui</button></p>
        ${d >= correctionFloor() ? `<button type="button" class="sx-btn sx-sm sx-primary sx-mb" data-a="addPast">＋ Ajouter une déclaration ce jour-là</button>` : '<p class="sx-small sx-mb">🔒 Ce jour n\'est plus modifiable : demandez au responsable.</p>'}`}
      <ul class="sx-entries">${list.slice().reverse().map(entryHTML).join('') || '<li class="sx-small">Rien de déclaré ce jour-là.</li>'}</ul>
      <p class="sx-small sx-mt">Modifiable ${corrLabel()}. Une déclaration annulée reste visible (barrée) pour garder l'historique.</p>
    </details>`;
  }

  function entryHTML(d){
    const a = d.activite_id ? actById(d.activite_id) : null, h = d.hors_production_id ? hpById(d.hors_production_id) : null;
    const op = d.operation_id ? SX.opsById[d.operation_id] : null;
    const theo = a && !op && d.std_value !== null ? d.quantity * d.std_value : null;
    const ed = canEdit(d);
    const name = a ? a.name : h ? h.label : 'Activité';
    return `<li class="sx-entry${d.cancelled ? ' sx-cancel' : ''}">
      <div class="sx-row sx-between"><span><b>${esc(name)}</b>${a && !op ? ` <small>× ${d.quantity}</small>` : ''}${h ? ' <span class="sx-pill sx-dim">hors production</span>' : ''}</span><span class="sx-time-v">${hm(Number(d.hours))}</span></div>
      ${op ? `<span class="sx-meta sx-mono">${op.serial ? esc(op.serial) : '<span class="sx-bad">Matricule à compléter</span>'} · ${esc(modelLabel(op.model_id) || 'modèle ?')}</span>
        <span class="sx-meta">${pill(op.status)} Cumul ${h2(op.total_hours)} h · attendu ${h2(op.std_value)} h${op.status === 'final' && op.std_value !== null ? ` · écart <b class="${op.total_hours - op.std_value > 0.005 ? 'sx-mid' : 'sx-ok'}">${sgn(op.total_hours - op.std_value)} h</b>` : ''}</span>` : ''}
      ${theo !== null ? `<span class="sx-meta">Théorique ${h2(theo)} h · déclaré ${h2(d.hours)} h · écart <b class="${d.hours - theo > 0.005 ? 'sx-mid' : 'sx-ok'}">${sgn(d.hours - theo)} h</b> (standard ${h2(d.std_value)})</span>` : ''}
      ${Array.isArray(d.checklist) && d.checklist.length ? `<span class="sx-meta">✓ Checklist : ${d.checklist.length} point${d.checklist.length > 1 ? 's' : ''} coché${d.checklist.length > 1 ? 's' : ''}</span>` : ''}
      ${d.note ? `<span class="sx-meta">« ${esc(d.note)} »</span>` : ''}
      ${d.cancelled ? `<span class="sx-meta">Annulée le ${esc(new Date(d.cancelled_at).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }))}</span>` : ''}
      ${ed ? `<div class="sx-row">${op ? '' : `<button type="button" class="sx-btn sx-sm" data-edit="${d.id}">Modifier</button>`}<button type="button" class="sx-btn sx-sm sx-danger" data-cancel="${d.id}">${SX.confirmCancel === d.id ? 'Confirmer l\'annulation' : 'Annuler cette déclaration'}</button></div>`
        : d.cancelled ? '' : '<span class="sx-small">🔒 Verrouillé</span>'}
    </li>`;
  }

  /* ---------- checklists officielles (reprises de l'ancien Suivi) ---------- */
  const CHECKLISTS = {
    reconditionnement: { title: 'Auto-contrôle avant envoi (checklist officielle)', items: [
      'Propreté intérieur et extérieur', 'Propreté CCD + sous la vitre scanner', 'Remontage de tous les carters',
      'Propreté unités internes (Tambour/BD/CTI/Four, grille ventilateur)', 'Changement bac de récup + bac récup d\'avance',
      'Câble d\'alimentation + câble fax ajoutés', 'Carters non rayés (cache charnière, poignet, baguette laser)',
      'N° de série et modèle vérifiés (fiche REP ↔ machine)', 'PATIN K7 + PATIN ADF changés', 'Panel dépoussiéré et non rayé',
      'Étiquette QR code bien placée', 'Vis fixation socle 2/3 K7 vérifiées'] },
    installation: { title: 'Checklist installation / mise en route', items: [
      'Déballage et vérification (dommages transport, accessoires complets)', 'Emplacement vérifié (prise électrique dédiée + accès réseau)',
      'Mise sous tension + premier démarrage sans erreur', 'Connexion réseau configurée (Ethernet/Wi-Fi)', 'Pilotes installés sur le(s) poste(s) client',
      'Licence / logiciel activé et enregistré', 'Test d\'impression + scan réalisé avec succès', 'Consommables de démarrage vérifiés (toner, papier)',
      'Explication rapide au client (utilisation de base)'] }
  };
  const stdOf = a => a && Object.prototype.hasOwnProperty.call(SX.std || {}, a.id) ? SX.std[a.id] : null;
  function checklistHTML(a){
    const c = CHECKLISTS[a.checklist]; if(!c) return '';
    const done = SX.form.checks.length;
    return `<div class="sx-checklist"><div class="sx-row sx-between"><b>${esc(c.title)}</b><span class="sx-small" id="sxCheckCount">${done} / ${c.items.length}</span></div>
      ${c.items.map((it, i) => `<label class="sx-check"><input type="checkbox" data-chk="${i}" ${SX.form.checks.includes(it) ? 'checked' : ''}> ${esc(it)}</label>`).join('')}</div>`;
  }

  /* ---------- chronos facultatifs (si le responsable les active) ----------
     Comme l'ancien Suivi : un chrono par tâche, plusieurs à la fois. Lancer ou
     reprendre l'un met les autres en pause. Une machine « à poursuivre » garde
     son chrono : en la reprenant, il repart de là où il s'était arrêté (cumul
     déjà déclaré + nouvelle séance). Le chrono ne fait que proposer le temps de
     la séance : rien n'est enregistré tant que le collaborateur ne valide pas.
     Enregistrés sur le serveur (table chronos_user) : un chrono commencé sur le
     PC de l'atelier continue sur le téléphone. Copie locale dans le navigateur
     pour l'affichage instantané et si le serveur n'est pas joignable. */
  const chronoKey = () => 'rb-chronos-' + SX.userId;
  // chrono : { id, key, label, act, hp, kind, opId, serial, model, start (ms|null), acc (ms de la séance), prior (h déjà déclarées) }
  function chronosGet(){
    try{
      let list = JSON.parse(localStorage.getItem(chronoKey()) || 'null');
      if(!Array.isArray(list)){
        list = [];
        const old = JSON.parse(localStorage.getItem('rb-chrono-' + SX.userId) || 'null'); // ancien chrono unique
        if(old && typeof old === 'object') list.push({ id: 'c' + Date.now(), key: 'free', label: 'Chrono', start: old.start, acc: old.acc || 0, prior: 0 });
        localStorage.removeItem('rb-chrono-' + SX.userId);
      }
      return list.filter(c => c && c.id);
    }catch(e){ return []; }
  }
  const chronoTsKey = () => chronoKey() + '-ts';
  const localTs = () => { try{ return +localStorage.getItem(chronoTsKey()) || 0; }catch(e){ return 0; } };
  let pushTimer = null;
  function chronosSet(list, fromServerTs){
    try{
      localStorage.setItem(chronoKey(), JSON.stringify(list));
      localStorage.setItem(chronoTsKey(), String(fromServerTs || Date.now()));
    }catch(e){ toast('Chrono indisponible sur ce navigateur.'); }
    if(!fromServerTs){ clearTimeout(pushTimer); pushTimer = setTimeout(pushChronos, 500); }
  }
  // Envoie la liste au serveur (le dernier appareil qui modifie a raison)
  async function pushChronos(){
    if(SX.chronoServer === false || !SX.userId) return;
    const { error } = await sb.from('chronos_user').upsert({ user_id: SX.userId, data: chronosGet(), updated_at: new Date(localTs() || Date.now()).toISOString() });
    if(error){ console.warn('Chronos non synchronisés :', error.message); if(/chronos_user|PGRST205|does not exist/i.test(error.message)) SX.chronoServer = false; }
  }
  // Récupère la version du serveur si elle est plus récente ; renvoie true si elle a changé
  async function pullChronos(){
    if(SX.chronoServer === false || !SX.userId) return false;
    const { data, error } = await sb.from('chronos_user').select('data, updated_at').eq('user_id', SX.userId).maybeSingle();
    if(error){ if(/chronos_user|PGRST205|does not exist/i.test(error.message || '')) SX.chronoServer = false; return false; }
    SX.chronoServer = true;
    const ts = data ? Date.parse(data.updated_at) : 0;
    if(data && ts > localTs()){
      const before = JSON.stringify(chronosGet());
      chronosSet(Array.isArray(data.data) ? data.data : [], ts);
      return before !== JSON.stringify(chronosGet());
    }
    if(!data || ts < localTs()) await pushChronos();
    return false;
  }
  const chronoMs = c => c ? (c.acc || 0) + (c.start ? Date.now() - c.start : 0) : 0;
  const hms = ms => { const t = Math.floor(ms / 1000); return [t / 3600 | 0, (t % 3600) / 60 | 0, t % 60].map(n => String(n).padStart(2, '0')).join(':'); };
  // Clé de la tâche affichée dans le formulaire
  function formKey(f){
    if(f.workDate) return null; // déclaration d'un jour passé : pas de chrono
    if(f.opId) return 'op:' + f.opId;
    if(f.kind === 'hp') return f.hp ? 'hp:' + f.hp : null;
    return f.act ? 'act:' + f.act : null; // nouvelle machine : le matricule peut être tapé après le lancement du chrono
  }
  function formLabel(f){
    if(f.kind === 'hp') return (hpById(f.hp) || {}).label || 'Hors production';
    const a = actById(f.act); if(!a) return 'Chrono';
    const op = f.opId ? SX.opsById[f.opId] : null, serial = op ? op.serial : f.serial.trim().toUpperCase();
    return a.name + (a.requires_machine ? ' · ' + (serial || 'sans matricule') : '');
  }
  const chronoOfForm = () => { const k = formKey(SX.form); return k ? chronosGet().find(c => c.key === k) : null; };
  function runOnly(list, id){ // un seul chrono tourne : les autres passent en pause
    list.forEach(c => { if(c.id !== id && c.start){ c.acc = chronoMs(c); c.start = null; } });
  }
  const chronoOn = () => SX.rules.chrono === true;
  const sessH = c => r2(chronoMs(c) / 3600000);
  // Le formulaire change de tâche : l'ancienne se met en pause (ou disparaît si
  // elle n'a duré que quelques secondes : simple clic de passage), la nouvelle démarre.
  function syncChrono(prevKey){
    if(!chronoOn()) return;
    const f = SX.form, k = f.editId ? null : formKey(f), list = chronosGet();
    if(prevKey && prevKey !== k){
      const p = list.find(c => c.key === prevKey);
      if(p){ if(!p.opId && !p.prior && chronoMs(p) < 60000) list.splice(list.indexOf(p), 1); else if(p.start){ p.acc = chronoMs(p); p.start = null; } }
    }
    if(k){
      let c = list.find(x => x.key === k);
      const op = f.opId ? SX.opsById[f.opId] : null;
      if(!c){ c = { id: 'c' + Date.now(), key: k, label: formLabel(f), kind: f.kind, act: f.act, hp: f.hp, opId: f.opId, serial: f.serial, model: f.model, start: Date.now(), acc: 0, prior: op ? Number(op.total_hours) || 0 : 0 }; list.push(c); }
      else { if(op) c.prior = Number(op.total_hours) || 0; if(!c.start) c.start = Date.now(); }
      runOnly(list, c.id);
    }
    chronosSet(list);
  }
  // Lignes du haut : les autres tâches commencées (un toque pour y revenir)
  function chronoStrip(){
    if(!chronoOn()) return '';
    const k = formKey(SX.form), others = chronosGet().filter(c => c.key !== k);
    if(!others.length) return '';
    return `<div class="sx-chstrip" aria-label="Tâches commencées"><span class="sx-small">En attente :</span>${others.map(c => `
      <span class="sx-chchip"><button type="button" data-chr="open" data-cid="${c.id}" title="Revenir à cette tâche"><b>${esc(c.label)}</b> <span class="sx-mono" data-chrono-t="${c.id}">${hms((c.prior || 0) * 3600000 + chronoMs(c))}</span> ▶</button><button type="button" class="sx-chx" data-chr="del" data-cid="${c.id}" aria-label="Oublier ce chrono">✕</button></span>`).join('')}</div>`;
  }
  // Colonne de droite (ordinateur) : les tâches en pause, un clic pour y revenir
  function chronoPausedSide(){
    if(!chronoOn()) return '';
    const k = formKey(SX.form), others = chronosGet().filter(c => c.key !== k);
    if(!others.length) return '';
    const mini = chronoMini();
    return `<div class="sx-card sx-chpaused"><h2 class="sx-h2">Tâches en pause (${others.length})</h2>
      ${mini ? '' : '<p class="sx-small">Cliquez sur une tâche pour la reprendre : son chrono repart, celle en cours se met en pause.</p>'}
      ${others.map(c => `<div class="sx-chp">
        <button type="button" class="sx-chp-open" data-chr="open" data-cid="${c.id}" title="Reprendre cette tâche">
          <span class="sx-chp-l">${esc(c.label)}</span>
          <span class="sx-mono sx-chp-t" data-chrono-t="${c.id}">${hms((c.prior || 0) * 3600000 + chronoMs(c))}</span>
          <span class="sx-chp-go">▶ Reprendre</span></button>
        <button type="button" class="sx-chx" data-chr="del" data-cid="${c.id}" aria-label="Oublier ce chrono" title="Oublier ce chrono">✕</button></div>`).join('')}
    </div>`;
  }
  // Dans l'étape « Temps » : le chrono de la tâche affichée
  // Le chrono de la tâche affichée : dans l'étape « Temps » sur téléphone,
  // dans la colonne de droite sur ordinateur (même contenu, un seul visible)
  function chronoBody(c){
    const long = c.start && chronoMs(c) > 4 * 3600000;
    return `<div class="sx-row sx-between"><b class="sx-chrono-l">⏱ ${esc(c.label)}</b><span class="sx-row"><span class="sx-pill sx-${c.start ? 'ok' : 'dim'}">${c.start ? 'En marche' : 'En pause'}</span><button type="button" class="sx-link" data-a="chronoMini">Masquer</button></span></div>
      <span class="sx-chrono-t" data-chrono-t="${c.id}">${hms((c.prior || 0) * 3600000 + chronoMs(c))}</span>
      ${c.prior ? `<span class="sx-small">Déjà déclaré ${hm(c.prior)} · séance <span data-chrono-s="${c.id}">${hms(chronoMs(c))}</span></span>` : ''}
      <div class="sx-row"><button type="button" class="sx-btn sx-sm sx-primary" data-chr="use" data-cid="${c.id}">Utiliser ce temps</button>
        <button type="button" class="sx-btn sx-sm" data-chr="${c.start ? 'pause' : 'run'}" data-cid="${c.id}">${c.start ? '⏸ Pause' : '▶ Reprendre'}</button></div>
      <span class="sx-small">${SX.form.tManual ? 'Vous avez tapé un temps : « Utiliser ce temps » le remplace par celui du chrono.' : 'Le temps se remplit tout seul. « Utiliser ce temps » le fige au besoin.'}</span>
      ${long ? '<span class="sx-small sx-bad">Plus de 4 h sans pause : pensez à mettre en pause (repas, fin de journée).</span>' : ''}`;
  }
  // Chrono discret par défaut : une ligne avec le temps ; « Afficher » ouvre le panneau complet
  const miniKey = () => 'rb-chrono-mini-' + SX.userId;
  const chronoMini = () => { try{ return localStorage.getItem(miniKey()) !== '0'; }catch(e){ return true; } };
  function chronoMiniBar(c){
    return `<div class="sx-chmini ${c.start ? 'run' : 'paused'}"><span class="sx-chmini-dot" aria-hidden="true"></span>
      <span class="sx-mono" data-chrono-t="${c.id}">${hms((c.prior || 0) * 3600000 + chronoMs(c))}</span>
      <span class="sx-small sx-chmini-l">${c.start ? '' : 'en pause · '}${esc(c.label)}</span>
      <button type="button" class="sx-link" data-a="chronoFull">Afficher le chrono</button></div>`;
  }
  function chronoInline(){
    if(!chronoOn() || SX.form.editId) return '';
    const c = chronoOfForm(); if(!c) return '';
    return chronoMini() ? `<div class="sx-chinline-mini">${chronoMiniBar(c)}</div>` : `<div class="sx-chinline ${c.start ? 'run' : 'paused'}">${chronoBody(c)}</div>`;
  }
  function chronoSide(){
    if(!chronoOn() || SX.form.editId) return '';
    const c = chronoOfForm(); if(!c) return '';
    return chronoMini() ? `<div class="sx-card sx-chside sx-chside-mini">${chronoMiniBar(c)}</div>` : `<div class="sx-card sx-chside ${c.start ? 'run' : 'paused'}">${chronoBody(c)}</div>`;
  }
  function fillTimeFromChrono(){
    const f = SX.form; if(!chronoOn() || f.tManual || f.editId) return;
    const c = chronoOfForm(); if(!c) return;
    const h = sessH(c); if(h < 0.01) return; f.tRaw = h2(h);
    const i = document.getElementById('sxTime'); if(i && document.activeElement !== i) i.value = f.tRaw;
  }
  function chronoAction(a, cid){
    const list = chronosGet(), c = list.find(x => x.id === cid);
    if(!c) return;
    if(a === 'pause' && c.start){ c.acc = chronoMs(c); c.start = null; }
    else if(a === 'run' && !c.start){ c.start = Date.now(); runOnly(list, c.id); }
    else if(a === 'del'){ list.splice(list.indexOf(c), 1); }
    else if(a === 'open'){ chronosSet(list); openChrono(c); return; }
    else if(a === 'use'){
      SX.form.tManual = false; const h = sessH(c); SX.form.tRaw = h2(Math.max(0.01, h));
      chronosSet(list); render(); toast(`Temps du chrono repris : ${hm(Math.max(0.01, h))}.`); return;
    }
    chronosSet(list); fillTimeFromChrono(); render();
  }
  function pauseAllChronos(){ const list = chronosGet(); list.forEach(c => { if(c.start){ c.acc = chronoMs(c); c.start = null; } }); chronosSet(list); }
  // Ouvre la tâche d'un chrono dans le formulaire (la reprend si c'est une machine en cours)
  function openChrono(c){
    const prevKey = formKey(SX.form);
    if(c.opId && !SX.openOps.some(o => o.id === c.opId)){ toast('Cette étape n\'est plus en cours.'); return; }
    SX.form = Object.assign(blankForm(), c.kind === 'hp' ? { kind: 'hp', hp: c.hp } : { kind: 'prod', act: c.act, opId: c.opId || null, serial: c.opId ? '' : (c.serial || ''), model: c.opId ? null : (c.model || null) });
    SX.lookup = { serial: '', rows: [] };
    syncChrono(prevKey); fillTimeFromChrono();
    render(); const card = document.getElementById('sxFormCard'); if(card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  // Après « Valider » : la machine à poursuivre garde son chrono (en pause, cumul à jour) ; sinon le chrono est terminé
  function chronoAfterSave(oldKey, isM, st, opId){
    if(!oldKey) return;
    const list = chronosGet(), c = list.find(x => x.key === oldKey); if(!c) return;
    const op = opId ? SX.opsById[opId] : null;
    if(isM && st === 'pause' && op){
      Object.assign(c, { key: 'op:' + op.id, opId: op.id, start: null, acc: 0, prior: Number(op.total_hours) || 0, label: formLabel({ kind: 'prod', act: op.activite_id, opId: op.id, serial: '' }) });
    } else list.splice(list.indexOf(c), 1);
    chronosSet(list);
  }
  setInterval(() => {
    const els = root.querySelectorAll('[data-chrono-t]'); if(!els.length) return;
    const list = chronosGet();
    els.forEach(el => { const c = list.find(x => x.id === el.dataset.chronoT); if(c && c.start){ el.textContent = hms((c.prior || 0) * 3600000 + chronoMs(c)); const s = root.querySelector(`[data-chrono-s="${c.id}"]`); if(s) s.textContent = hms(chronoMs(c)); } });
    const before = SX.form.tRaw; fillTimeFromChrono(); if(SX.form.tRaw !== before) updConv();
  }, 1000);

  /* ---------- modèle : recherche avec loupe ---------- */
  function searchModels(q, limit = 8){
    const terms = String(q || '').trim().split(/\s+/).filter(Boolean).map(norm);
    if(!terms.length) return [];
    return SX.models.filter(m => { const hay = norm(`${m.model} ${m.famille || ''} ${m.brand}`); return terms.every(t => hay.includes(t)); }).slice(0, limit);
  }
  function modelBox(){
    const m = SX.form.model ? modelById(SX.form.model) : null;
    if(m) return `<div class="sx-msel"><span><b class="sx-mono">${esc(m.model)}</b><br><small>${esc(m.brand)}${m.famille ? ' · ' + esc(m.famille) : ''}</small></span><button type="button" class="sx-btn sx-sm" data-a="mChange">Changer</button></div>`;
    return `<div class="sx-msearch"><span class="sx-loupe" aria-hidden="true">🔍</span><input type="text" id="sxModelQ" class="sx-mono" placeholder="Tapez : 3525, IRAC, KONICA…" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="sxModelList" aria-autocomplete="list"></div><ul id="sxModelList" class="sx-mlist" role="listbox" hidden></ul>`;
  }
  function renderModelList(){
    const q = document.getElementById('sxModelQ'), ul = document.getElementById('sxModelList');
    if(!q || !ul) return;
    const res = searchModels(q.value);
    if(!q.value.trim()){ ul.hidden = true; q.setAttribute('aria-expanded', 'false'); return; }
    SX.mSel = Math.min(SX.mSel, Math.max(0, res.length - 1));
    ul.innerHTML = res.length
      ? res.map((m, i) => `<li role="option" id="sxmopt-${i}" aria-selected="${i === SX.mSel}" data-pick="${m.id}"><b class="sx-mono">${esc(m.model)}</b><small>${esc(m.brand)}${m.famille ? ' · ' + esc(m.famille) : ''}</small></li>`).join('')
      : '<li class="sx-small sx-noclick">Aucun modèle trouvé. Demandez au responsable de l\'ajouter.</li>';
    ul.hidden = false; q.setAttribute('aria-expanded', 'true');
    if(res.length) q.setAttribute('aria-activedescendant', 'sxmopt-' + SX.mSel);
  }
  function pickModel(id){
    SX.form.model = id;
    const box = document.getElementById('sxModelBox'); if(box) box.innerHTML = modelBox();
  }

  /* ---------- N° de série : ce que l'atelier sait déjà ---------- */
  let lookupTimer = null;
  function lookupSerial(immediate){
    const box = document.getElementById('sxLookup'); if(!box) return;
    const s = SX.form.serial.trim().toUpperCase();
    if(!s){ box.innerHTML = ''; SX.lookup = { serial: '', rows: [] }; return; }
    if(SX.lookup.serial === s){ showLookup(); return; }
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(async () => {
      const { data, error } = await sb.rpc('lookup_serial', { p_serial: s });
      if(error){ console.error('Erreur lookup_serial:', error); return; }
      SX.lookup = { serial: s, rows: data || [] };
      showLookup();
    }, immediate ? 0 : 300);
  }
  function showLookup(){
    const box = document.getElementById('sxLookup'); if(!box) return;
    const f = SX.form, rows = SX.lookup.rows, same = rows.filter(r => r.activite_id === f.act);
    const open = same.find(r => r.status === 'encours' || r.status === 'pause');
    const fin = same.find(r => r.status === 'final');
    if(open){
      const mine = open.is_mine && SX.openOps.find(o => o.serial === SX.lookup.serial && o.activite_id === f.act);
      box.innerHTML = mine
        ? `<div class="sx-info sx-info-ok sx-row sx-between"><span>Cette étape est déjà commencée sur cette machine (depuis le ${esc(shortLabel(open.started_on))}).</span><button type="button" class="sx-btn sx-sm sx-primary" data-resume="${mine.id}">Reprendre l'étape</button></div>`
        : `<div class="sx-info sx-info-bad">Cette étape est en cours chez ${esc(open.collaborateur || 'un collègue')} depuis le ${esc(shortLabel(open.started_on))}.</div>`;
      return;
    }
    if(fin){ box.innerHTML = `<div class="sx-info sx-info-bad">Ce N° de série a déjà été finalisé pour cette étape (${esc(fin.collaborateur || '')}). Un N° de série ne peut pas être enregistré deux fois pour la même étape.</div>`; return; }
    const known = rows.find(r => r.model_id);
    if(known){
      if(!f.model){ pickModel(known.model_id); }
      const done = [...new Set(rows.map(r => r.activite))].join(', ');
      box.innerHTML = `<div class="sx-info sx-info-ok">Machine connue : ${esc(modelLabel(known.model_id))}. Modèle rempli automatiquement. Déjà enregistrée pour : ${esc(done)}.</div>`;
    } else box.innerHTML = '<div class="sx-info">Nouvelle machine : choisissez le modèle.</div>';
  }

  function attenduText(a){
    const std = stdOf(a), f = SX.form;
    if(std === null) return a.uses_quantity === false ? 'Temps seulement (pas de quantité, pas de temps attendu).' : 'Pas de temps attendu pour cette activité.';
    if(a.requires_machine){
      const op = f.opId ? SX.opsById[f.opId] : null, s2 = op && op.std_value !== null ? Number(op.std_value) : std;
      return `Temps attendu : <b>${h2(s2)} h</b> par machine (${hm(s2)}).`;
    }
    if(a.uses_quantity === false) return `Temps attendu : <b>${h2(std)} h</b>.`;
    const q = parseInt(f.qte, 10) || 0;
    return `Temps attendu : <b>${h2(std)} h</b> par unité${q > 0 ? ` · pour ${q} : <b>${h2(q * std)} h</b> (${hm(q * std)})` : ''}.`;
  }
  function updConv(){
    const el = document.getElementById('sxConv'); if(!el) return;
    const v = parseTime(SX.form.tRaw);
    el.innerHTML = v === null ? '' : Number.isNaN(v) ? '<span class="sx-bad">Format non reconnu</span>' : `= ${h2(v)} h · ${hm(v)}`;
    root.querySelectorAll('[data-tq]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.tq === v)));
    const at = document.getElementById('sxAttendu'), a0 = actById(SX.form.act); if(at && a0) at.innerHTML = attenduText(a0);
    const p = document.getElementById('sxStPrev');
    if(p){
      const op = SX.form.opId ? SX.opsById[SX.form.opId] : null, before = op ? Number(op.total_hours) : 0;
      const t = (v === null || Number.isNaN(v)) ? 0 : v;
      const std = op ? op.std_value : stdOf(actById(SX.form.act));
      p.innerHTML = `Cumul après validation : <b>${h2(before + t)} h</b>${std !== null && std !== undefined ? ` pour ${h2(std)} h attendues${SX.form.st === 'final' ? ` · écart <b class="${before + t - std > 0.005 ? 'sx-mid' : 'sx-ok'}">${sgn(before + t - std)} h</b>` : ''}` : ''}.`;
    }
  }

  /* ---------- enregistrement ---------- */
  async function save(){
    const f = SX.form, isP = f.kind === 'prod', a = isP && f.act ? actById(f.act) : null, isM = a && a.requires_machine;
    const t = parseTime(f.tRaw), errs = [];
    if(isP && !a) errs.push('Choisissez une activité.');
    if(!isP && !f.hp) errs.push('Choisissez un motif hors production.');
    const noQty = a && a.uses_quantity === false;
    const q = isP && !isM && !noQty ? Number(String(f.qte).replace(',', '.')) : 0;
    if(isP && !isM && !noQty && (!Number.isInteger(q) || q < 1)) errs.push('La quantité doit être un nombre entier (1 ou plus).');
    if(t === null) errs.push('Indiquez le temps consacré.');
    else if(Number.isNaN(t) || t <= 0) errs.push('Temps non reconnu. Exemples : 1,5 · 1h30 · 45 min.');
    else if(t > 12) errs.push('Plus de 12 h sur une seule déclaration : vérifiez.');
    if(isM && !f.st) errs.push('Choisissez : finaliser l\'étape ou la mettre en attente.');
    if(isM && f.workDate) errs.push('Les étapes avec matricule se déclarent le jour même. Pour un jour passé, choisissez une autre activité ou demandez au responsable.');
    if(isM && !f.opId){
      const s = f.serial.trim().toUpperCase();
      if(!f.unreadable && !s) errs.push('N° de série obligatoire pour cette étape.');
      if(!f.unreadable && !f.model) errs.push('Modèle obligatoire pour cette étape.');
      if(s && SX.lookup.serial === s){
        const same = SX.lookup.rows.filter(r => r.activite_id === a.id);
        if(same.some(r => r.status === 'final')) errs.push('Ce N° de série a déjà été finalisé pour cette étape.');
        else if(same.some(r => r.status === 'encours' || r.status === 'pause')) errs.push('Cette étape est déjà en cours sur ce N° de série : utilisez « Reprendre l\'étape ».');
      }
    }
    if(errs.length){ f.err = errs.map(esc).join('<br>'); render(); return; }

    SX.busy = true; f.err = ''; render();
    const note = f.note.trim() || null;
    let error = null, msg = '', newId = null;
    const chronosBefore = chronosGet(), formBefore = Object.assign({}, f, { tManual: true, err: '', st: f.st });
    try{
      if(isM){
        const r = await sb.rpc('declare_machine_step', {
          p_activite: a.id, p_operation: f.opId, p_serial: f.opId ? null : (f.serial.trim() || null),
          p_model: f.opId ? null : f.model, p_hours: t, p_note: note, p_finalize: f.st === 'final' });
        error = r.error; newId = r.data;
        if(!error && f.st === 'final' && f.checks.length) await sb.from('declarations').update({ checklist: f.checks }).eq('id', r.data);
        msg = f.st === 'final' ? `Étape finalisée · ${esc(a.name)}` : `Temps enregistré (${hm(t)}). L'étape est dans « Mes étapes en cours ».`;
      }else{
        const row = isP ? { activite_id: a.id, hors_production_id: null, quantity: q, hours: t, note, checklist: a.checklist && f.checks.length ? f.checks : null }
                        : { activite_id: null, hors_production_id: f.hp, quantity: 0, hours: t, note };
        const r = f.editId
          ? await sb.from('declarations').update(row).eq('id', f.editId).select().single()
          : await sb.from('declarations').insert(Object.assign({ user_id: SX.userId }, row, f.workDate ? { work_date: f.workDate } : {})).select().single();
        error = r.error;
        if(!error){
          if(!f.editId) newId = r.data.id;
          const d = r.data, theo = d.activite_id && d.std_value !== null ? d.quantity * d.std_value : null;
          msg = f.editId ? 'Déclaration mise à jour.'
            : `Enregistré · ${esc(isP ? a.name : hpById(f.hp).label)} · ${hm(t)}${theo !== null ? ` · théorique ${h2(theo)} h · écart ${sgn(t - theo)} h` : ''}`;
        }
      }
    }catch(e){ error = { message: e.message }; }
    SX.busy = false;
    if(error){ f.err = esc(dbError(error)); render(); return; }
    if(!f.opId && !f.editId) SX.lastSaved = { kind: f.kind, act: f.act, hp: f.hp, qte: f.qte, model: f.model };
    const kind = f.kind, oldKey = f.editId ? null : formKey(f); SX.form = blankForm(); SX.form.kind = kind; SX.lookup = { serial: '', rows: [] };
    if(f.workDate){ SX.viewDate = f.workDate; SX.dayOpen = true; }
    await loadDay();
    if(oldKey){
      let opId = f.opId;
      if(isM && !opId){ const s0 = f.serial.trim().toUpperCase() || null; const o = SX.openOps.filter(x => x.activite_id === a.id && (x.serial || null) === s0).pop(); opId = o && o.id; }
      chronoAfterSave(oldKey, isM, f.st, opId);
    }
    render();
    if(isM && f.st === 'final'){
      const op = Object.values(SX.opsById).find(o => o.status === 'final' && o.activite_id === a.id && (f.opId ? o.id === f.opId : o.serial === (f.serial.trim().toUpperCase() || null)));
      if(op && op.std_value !== null) msg += ` · total ${h2(op.total_hours)} h pour ${h2(op.std_value)} h attendues (écart ${sgn(op.total_hours - op.std_value)} h)`;
    }
    if(newId) toastUndo(msg, async () => {
      const { error: e2 } = await sb.from('declarations').update({ cancelled: true }).eq('id', newId);
      if(e2){ toast(esc(dbError(e2))); return; }
      if(chronoOn()) chronosSet(chronosBefore);          // le chrono revient comme avant
      SX.form = Object.assign(blankForm(), formBefore);  // et le formulaire aussi, pour corriger
      if(SX.form.opId && !SX.openOps.some(o => o.id === SX.form.opId)) SX.form.opId = formBefore.opId;
      SX.lookup = { serial: '', rows: [] };
      await loadDay(); render();
      toast('Déclaration annulée : corrigez puis validez à nouveau.');
    });
    else toast(msg);
  }

  async function cancelDeclaration(id){
    const { error } = await sb.from('declarations').update({ cancelled: true }).eq('id', id);
    if(error){ toast(esc(dbError(error))); return; }
    SX.confirmCancel = null;
    await loadDay(); render();
    toast('Déclaration annulée. Elle reste visible dans l\'historique.');
  }

  function startEdit(id){
    const d = [...SX.viewDecls, ...SX.todayDecls].find(x => x.id === id); if(!d) return;
    SX.dayOpen = true;
    SX.form = Object.assign(blankForm(), { kind: d.activite_id ? 'prod' : 'hp', act: d.activite_id, hp: d.hors_production_id,
      qte: d.quantity || 1, tRaw: h2(d.hours), tManual: true, note: d.note || '', editId: d.id, checks: Array.isArray(d.checklist) ? d.checklist : [] });
    render(); document.getElementById('sxFormCard').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function resume(id){
    const op = SX.openOps.find(o => o.id === id); if(!op) return;
    const prevKey = formKey(SX.form);
    SX.form = Object.assign(blankForm(), { kind: 'prod', act: op.activite_id, opId: op.id });
    syncChrono(prevKey); // son chrono repart là où il s'était arrêté
    render(); document.getElementById('sxFormCard').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* ---------- événements (une seule fois, sur le conteneur) ---------- */
  root.addEventListener('click', async e => {
    const li = e.target.closest('[data-pick]');
    if(li){ pickModel(li.dataset.pick); return; }
    const b = e.target.closest('button'); if(!b || b.disabled) return;
    const d = b.dataset, f = SX.form;
    if(d.kind){ const pk = formKey(f); f.kind = d.kind; f.act = null; f.hp = null; f.err = ''; syncChrono(pk); render(); }
    else if(d.act){ const pk = formKey(f); f.act = d.act; f.st = null; f.err = ''; SX.lookup = { serial: '', rows: [] }; if(pk !== formKey(f)) f.tManual = false; syncChrono(pk); render(); }
    else if(d.hp){ const pk = formKey(f); f.hp = d.hp; f.err = ''; if(pk !== formKey(f)) f.tManual = false; syncChrono(pk); render(); }
    else if(d.tq){ f.tManual = true; f.tRaw = h2(+d.tq); const i = document.getElementById('sxTime'); if(i) i.value = f.tRaw; updConv(); }
    else if(d.st){ f.st = d.st; render(); }
    else if(d.resume) resume(d.resume);
    else if(d.a === 'qm'){ f.qte = Math.max(1, (parseInt(f.qte, 10) || 1) - 1); document.getElementById('sxQte').value = f.qte; updConv(); }
    else if(d.a === 'qp'){ f.qte = (parseInt(f.qte, 10) || 0) + 1; document.getElementById('sxQte').value = f.qte; updConv(); }
    else if(d.a === 'save') save();
    else if(d.a === 'chronoFull' || d.a === 'chronoMini'){ try{ localStorage.setItem(miniKey(), d.a === 'chronoMini' ? '1' : '0'); }catch(e){} render(); }
    else if(d.a === 'addPast'){ const pk = formKey(f); SX.form = Object.assign(blankForm(), { workDate: SX.viewDate, tManual: true }); syncChrono(pk); render(); document.getElementById('sxFormCard').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else if(d.a === 'pastCancel'){ SX.form = blankForm(); SX.viewDate = SX.today; await loadDay(); render(); }
    else if(d.a === 'eodGo'){ const c = document.getElementById('sxFormCard'); if(c) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else if(d.a === 'eodHide'){ SX.eodHidden = SX.today; render(); }
    else if(d.a === 'weekHide'){ SX.weekHidden = SX.today; render(); }
    else if(d.goday){ SX.viewDate = d.goday; SX.dayOpen = true; await loadDay(); render(); const c = document.getElementById('sxDayDetails'); if(c) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else if(d.a === 'weekSign'){
      const { error } = await sb.rpc('sign_week', { p_monday: addDays(SX.today, -weekdayIdx(SX.today)) });
      if(error){ toast('Signature impossible : ' + esc(dbError(error))); return; }
      await loadDay(); render(); toast('Semaine signée. Le responsable va la valider.');
    }
    else if(d.a === 'weekOpen'){ const t = document.querySelector('.tab[data-view="semaine"]'); if(t) t.click(); }
    else if(d.chr) chronoAction(d.chr, d.cid);
    else if(d.a === 'repeat'){ const pk = formKey(f); SX.form = Object.assign(blankForm(), SX.lastSaved); syncChrono(pk); render(); toast('Activité et modèle repris : indiquez le matricule et le temps.'); }
    else if(d.a === 'cancelForm'){
      const k = formKey(f), list = chronosGet(), c = k && list.find(x => x.key === k);
      if(c && !f.opId){ list.splice(list.indexOf(c), 1); chronosSet(list); }  // tâche abandonnée : son chrono aussi
      else if(c && c.start){ c.acc = chronoMs(c); c.start = null; chronosSet(list); } // machine en cours : on garde son chrono, en pause
      SX.form = blankForm(); render(); }
    else if(d.a === 'mChange'){ f.model = null; const box = document.getElementById('sxModelBox'); box.innerHTML = modelBox(); document.getElementById('sxModelQ').focus(); }
    else if(d.edit) startEdit(d.edit);
    else if(d.cancel){ if(SX.confirmCancel === d.cancel) await cancelDeclaration(d.cancel); else { SX.confirmCancel = d.cancel; render(); } }
    else if(d.day !== undefined){
      const step = +d.day;
      SX.dayOpen = true;
      SX.viewDate = step === 0 ? SX.today : addDays(SX.viewDate, step);
      if(SX.viewDate > SX.today) SX.viewDate = SX.today;
      await loadDay(); render();
    }
  });
  root.addEventListener('toggle', e => {
    if(e.target.id !== 'sxDayDetails') return;
    SX.dayOpen = e.target.open;
    const sm = e.target.querySelector('.sx-summ'); if(sm) sm.textContent = SX.dayOpen ? 'Masquer' : 'Afficher';
  }, true);
  root.addEventListener('input', e => {
    const t = e.target, f = SX.form;
    if(t.id === 'sxTime'){ f.tRaw = t.value; f.tManual = t.value.trim() !== ''; updConv(); }
    else if(t.id === 'sxQte'){ f.qte = t.value; updConv(); }
    else if(t.id === 'sxSerial'){ f.serial = t.value; lookupSerial(false); }
    else if(t.id === 'sxNote') f.note = t.value;
    else if(t.id === 'sxModelQ'){ SX.mSel = 0; renderModelList(); }
  });
  root.addEventListener('change', e => {
    if(e.target.id === 'sxUnreadable') SX.form.unreadable = e.target.checked;
    else if(e.target.dataset.chk !== undefined){
      const a = actById(SX.form.act), c = a && CHECKLISTS[a.checklist]; if(!c) return;
      const it = c.items[+e.target.dataset.chk];
      SX.form.checks = e.target.checked ? [...new Set([...SX.form.checks, it])] : SX.form.checks.filter(x => x !== it);
      const n = document.getElementById('sxCheckCount'); if(n) n.textContent = `${SX.form.checks.length} / ${c.items.length}`;
    }
  });
  root.addEventListener('keydown', e => {
    if(e.target.id !== 'sxModelQ') return;
    const res = searchModels(e.target.value);
    if(e.key === 'ArrowDown'){ SX.mSel = Math.min(res.length - 1, SX.mSel + 1); renderModelList(); e.preventDefault(); }
    else if(e.key === 'ArrowUp'){ SX.mSel = Math.max(0, SX.mSel - 1); renderModelList(); e.preventDefault(); }
    else if(e.key === 'Enter' && res[SX.mSel]){ pickModel(res[SX.mSel].id); e.preventDefault(); }
    else if(e.key === 'Escape'){ const ul = document.getElementById('sxModelList'); if(ul) ul.hidden = true; }
  });

  /* ---------- connexion / changement de compte ---------- */
  sb.auth.onAuthStateChange((_event, session) => {
    if(!session){ if(SX.userId) pauseAllChronos(); Object.assign(SX, { userId: null, ready: false }); root.innerHTML = ''; return; }
    setTimeout(() => {
      const view = document.getElementById('view-saisie');
      if(view && view.classList.contains('active')) initSaisie(session.user.id !== SX.userId);
    }, 0);
  });
  // Le rappel de 16 h 30 apparaît même si la page reste ouverte
  let eodShown = false;
  setInterval(() => { const on = parisMinutes() >= 16 * 60 + 30; if(on !== eodShown){ eodShown = on; const v = document.getElementById('view-saisie'); if(SX.ready && v && v.classList.contains('active') && !document.activeElement.matches('input, textarea')) render(); } }, 60000);
  // Revenir sur l'onglet après minuit : on recharge la bonne journée
  document.addEventListener('visibilitychange', () => {
    const view = document.getElementById('view-saisie');
    if(document.visibilityState === 'visible' && SX.ready && view && view.classList.contains('active') && SX.today !== todayStr()) initSaisie(true);
    else if(document.visibilityState === 'visible' && SX.ready && SX.rules.chrono === true) pullChronos().then(changed => { if(changed && view && view.classList.contains('active')) render(); });
  });
  // Déconnexion : les chronos sont mis en pause avant la sortie (pour l'autre appareil aussi)
  const logoutBtn = document.getElementById('btnLogout');
  if(logoutBtn) logoutBtn.addEventListener('click', () => { if(SX.userId && SX.rules.chrono === true){ pauseAllChronos(); clearTimeout(pushTimer); pushChronos(); } }, true);
})();
