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
  const blankForm = () => ({ kind: 'prod', act: null, hp: null, qte: 1, serial: '', model: null, unreadable: false,
                             tRaw: '', note: '', editId: null, opId: null, st: null, err: '' });
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
    if(rule === 'none') return addDays(t, 1);
    return t;
  }
  const canEdit = d => !d.cancelled && d.work_date >= correctionFloor();
  const corrLabel = () => ({ day: "jusqu'à la fin de la journée", h24: 'pendant 24 h',
                             week: "jusqu'à la fin de la semaine", none: 'uniquement par le responsable' })[SX.rules.correction || 'day'];

  /* ---------- message temporaire ---------- */
  let toastEl = null, toastTimer = null;
  function toast(html){
    if(!toastEl){ toastEl = document.createElement('div'); toastEl.className = 'sx-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.innerHTML = html; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4500);
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
    const [prof, acts, hp, models, rules, formats, metiers] = await Promise.all([
      sb.from('collaborateurs').select('*').eq('user_id', uid).maybeSingle(),
      sb.from('activites').select('id, metier_id, name, requires_machine, sort').eq('active', true).order('sort'),
      sb.from('hors_production').select('id, label, sort').eq('active', true).order('sort'),
      sb.from('printer_models').select('id, brand, model, famille').order('model'),
      sb.from('regles_saisie').select('key, value'),
      sb.from('formats_horaires').select('*'),
      sb.from('metiers').select('*')
    ]);
    const firstErr = [prof, acts, hp, models, rules, formats, metiers].find(r => r.error);
    if(firstErr){ SX.setupError = dbError(firstErr.error); return false; }
    SX.setupError = null;
    SX.profile = prof.data;
    SX.rules = Object.fromEntries((rules.data || []).map(r => [r.key, r.value]));
    SX.models = models.data || [];
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
    const res = await Promise.all(qs);
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
      if(ok && SX.profile && SX.profile.metier_id && SX.format) await loadDay();
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

    ${opsCard()}

    <div class="sx-grid">
      <div class="sx-card" id="sxFormCard">
        <div class="sx-row sx-between sx-mb">
          <h2 class="sx-h2">${op ? 'Reprendre l\'étape' : f.editId ? 'Modifier la déclaration' : 'Nouvelle déclaration'}</h2>
          ${SX.lastSaved && !f.editId && !op ? '<button type="button" class="sx-btn sx-sm" data-a="repeat">↻ Refaire la même</button>' : ''}
          ${f.editId || op ? '<button type="button" class="sx-btn sx-sm" data-a="cancelForm">Annuler</button>' : ''}
        </div>
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
        ${f.kind === 'prod' && act && !isM ? `<div class="sx-step"><span class="sx-num">${N()}</span><div><h3>Quantité</h3>
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
          ${SX.rules.chrono === true ? chronoHTML() : ''}
        </div></div>
        ${isM ? `<div class="sx-step"><span class="sx-num">${N()}</span><div><h3>Statut de l'étape</h3>
          <div class="sx-stchoice">
            <button type="button" class="fin" data-st="final" aria-pressed="${f.st === 'final'}">✓ Finaliser l'étape<small>La machine est terminée : 1 unité comptée.</small></button>
            <button type="button" class="pau" data-st="pause" aria-pressed="${f.st === 'pause'}">⏸ Mettre en attente / À poursuivre<small>Le temps compte aujourd'hui, la machine pas encore.</small></button>
          </div><p id="sxStPrev" class="sx-small sx-mt"></p></div></div>` : ''}
        <div class="sx-step"><span class="sx-num">${N()}</span><div><h3>Commentaire <small>(facultatif)</small></h3>
          <input type="text" id="sxNote" value="${esc(f.note)}" placeholder="Ex : attente pièce, machine très sale…" aria-label="Commentaire"></div></div>
        ${f.err ? `<div class="sx-error" role="alert">${f.err}</div>` : ''}
        <button type="button" class="btn-primary sx-save" data-a="save" ${SX.busy ? 'disabled' : ''}>${SX.busy ? 'Enregistrement…' : f.editId ? 'Mettre à jour' : 'Valider'}</button>
      </div>

      <div class="sx-side">
        ${alertsCard()}
        ${dayCard()}
      </div>
    </div>`;
    updConv(); lookupSerial(true);
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
    return `<div class="sx-card">
      <div class="sx-row sx-between sx-mb"><h2 class="sx-h2">${isToday ? 'Aujourd\'hui' : esc(cap(shortLabel(d)))} · ${live.length} déclaration${live.length > 1 ? 's' : ''}</h2>
        <span class="week-nav sx-daynav"><button type="button" data-day="-1" aria-label="Jour précédent" ${d <= minDate ? 'disabled' : ''}>‹</button><button type="button" data-day="1" aria-label="Jour suivant" ${isToday ? 'disabled' : ''}>›</button></span></div>
      ${isToday ? '' : `<p class="sx-small sx-mb">${hm(dayTotal(list))} déclarées${objectiveFor(d) ? ' sur ' + hm(objectiveFor(d)) : ''} · <button type="button" class="sx-btn sx-sm" data-day="0">Revenir à aujourd'hui</button></p>`}
      <ul class="sx-entries">${list.slice().reverse().map(entryHTML).join('') || '<li class="sx-small">Rien de déclaré ce jour-là.</li>'}</ul>
      <p class="sx-small sx-mt">Modifiable ${corrLabel()}. Une déclaration annulée reste visible (barrée) pour garder l'historique.</p>
    </div>`;
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
      ${d.note ? `<span class="sx-meta">« ${esc(d.note)} »</span>` : ''}
      ${d.cancelled ? `<span class="sx-meta">Annulée le ${esc(new Date(d.cancelled_at).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }))}</span>` : ''}
      ${ed ? `<div class="sx-row">${op ? '' : `<button type="button" class="sx-btn sx-sm" data-edit="${d.id}">Modifier</button>`}<button type="button" class="sx-btn sx-sm sx-danger" data-cancel="${d.id}">${SX.confirmCancel === d.id ? 'Confirmer l\'annulation' : 'Annuler cette déclaration'}</button></div>`
        : d.cancelled ? '' : '<span class="sx-small">🔒 Verrouillé</span>'}
    </li>`;
  }

  /* ---------- chrono facultatif (si le responsable l'active) ----------
     Il ne fait que proposer un temps : le collaborateur le voit dans le champ
     et valide lui-même. Rien n'est enregistré en base tant qu'il ne valide pas. */
  const chronoKey = () => 'rb-chrono-' + SX.userId;
  const chronoStart = () => { try{ const v = localStorage.getItem(chronoKey()); return v ? Number(v) : null; }catch(e){ return null; } };
  let chronoTick = null;
  function chronoHTML(){
    const st = chronoStart();
    return `<div class="sx-row sx-mt sx-chrono"><button type="button" class="sx-btn" data-a="chrono">${st ? '⏹ Arrêter et utiliser ce temps' : '⏱ Chrono (facultatif)'}</button><span id="sxChronoT" class="sx-mono sx-small">${st ? hm((Date.now() - st) / 3600000) : ''}</span></div>`;
  }
  function chronoToggle(){
    const st = chronoStart();
    try{
      if(st){
        localStorage.removeItem(chronoKey());
        SX.form.tRaw = h2(Math.max(0.01, r2((Date.now() - st) / 3600000)));
      } else localStorage.setItem(chronoKey(), String(Date.now()));
    }catch(e){ toast('Chrono indisponible sur ce navigateur.'); }
    render();
  }
  setInterval(() => { const el = document.getElementById('sxChronoT'), st = chronoStart(); if(el && st) el.textContent = hm((Date.now() - st) / 3600000); }, 15000);

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

  function updConv(){
    const el = document.getElementById('sxConv'); if(!el) return;
    const v = parseTime(SX.form.tRaw);
    el.innerHTML = v === null ? '' : Number.isNaN(v) ? '<span class="sx-bad">Format non reconnu</span>' : `= ${h2(v)} h · ${hm(v)}`;
    root.querySelectorAll('[data-tq]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.tq === v)));
    const p = document.getElementById('sxStPrev');
    if(p){
      const op = SX.form.opId ? SX.opsById[SX.form.opId] : null, before = op ? Number(op.total_hours) : 0;
      const t = (v === null || Number.isNaN(v)) ? 0 : v;
      const std = op ? op.std_value : null;
      p.innerHTML = `Cumul après validation : <b>${h2(before + t)} h</b>${std !== null && std !== undefined ? ` pour ${h2(std)} h attendues${SX.form.st === 'final' ? ` · écart <b class="${before + t - std > 0.005 ? 'sx-mid' : 'sx-ok'}">${sgn(before + t - std)} h</b>` : ''}` : ''}.`;
    }
  }

  /* ---------- enregistrement ---------- */
  async function save(){
    const f = SX.form, isP = f.kind === 'prod', a = isP && f.act ? actById(f.act) : null, isM = a && a.requires_machine;
    const t = parseTime(f.tRaw), errs = [];
    if(isP && !a) errs.push('Choisissez une activité.');
    if(!isP && !f.hp) errs.push('Choisissez un motif hors production.');
    const q = isP && !isM ? Number(String(f.qte).replace(',', '.')) : 0;
    if(isP && !isM && (!Number.isInteger(q) || q < 1)) errs.push('La quantité doit être un nombre entier (1 ou plus).');
    if(t === null) errs.push('Indiquez le temps consacré.');
    else if(Number.isNaN(t) || t <= 0) errs.push('Temps non reconnu. Exemples : 1,5 · 1h30 · 45 min.');
    else if(t > 12) errs.push('Plus de 12 h sur une seule déclaration : vérifiez.');
    if(isM && !f.st) errs.push('Choisissez : finaliser l\'étape ou la mettre en attente.');
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
    let error = null, msg = '';
    try{
      if(isM){
        const r = await sb.rpc('declare_machine_step', {
          p_activite: a.id, p_operation: f.opId, p_serial: f.opId ? null : (f.serial.trim() || null),
          p_model: f.opId ? null : f.model, p_hours: t, p_note: note, p_finalize: f.st === 'final' });
        error = r.error;
        msg = f.st === 'final' ? `Étape finalisée · ${esc(a.name)}` : `Temps enregistré (${hm(t)}). L'étape est dans « Mes étapes en cours ».`;
      }else{
        const row = isP ? { activite_id: a.id, hors_production_id: null, quantity: q, hours: t, note }
                        : { activite_id: null, hors_production_id: f.hp, quantity: 0, hours: t, note };
        const r = f.editId
          ? await sb.from('declarations').update(row).eq('id', f.editId).select().single()
          : await sb.from('declarations').insert(Object.assign({ user_id: SX.userId }, row)).select().single();
        error = r.error;
        if(!error){
          const d = r.data, theo = d.activite_id && d.std_value !== null ? d.quantity * d.std_value : null;
          msg = f.editId ? 'Déclaration mise à jour.'
            : `Enregistré · ${esc(isP ? a.name : hpById(f.hp).label)} · ${hm(t)}${theo !== null ? ` · théorique ${h2(theo)} h · écart ${sgn(t - theo)} h` : ''}`;
        }
      }
    }catch(e){ error = { message: e.message }; }
    SX.busy = false;
    if(error){ f.err = esc(dbError(error)); render(); return; }
    if(!f.opId && !f.editId) SX.lastSaved = { kind: f.kind, act: f.act, hp: f.hp, qte: f.qte, model: f.model };
    const kind = f.kind; SX.form = blankForm(); SX.form.kind = kind; SX.lookup = { serial: '', rows: [] };
    await loadDay();
    render();
    if(isM && f.st === 'final'){
      const op = Object.values(SX.opsById).find(o => o.status === 'final' && o.activite_id === a.id && (f.opId ? o.id === f.opId : o.serial === (f.serial.trim().toUpperCase() || null)));
      if(op && op.std_value !== null) msg += ` · total ${h2(op.total_hours)} h pour ${h2(op.std_value)} h attendues (écart ${sgn(op.total_hours - op.std_value)} h)`;
    }
    toast(msg);
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
    SX.form = Object.assign(blankForm(), { kind: d.activite_id ? 'prod' : 'hp', act: d.activite_id, hp: d.hors_production_id,
      qte: d.quantity || 1, tRaw: h2(d.hours), note: d.note || '', editId: d.id });
    render(); document.getElementById('sxFormCard').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function resume(id){
    const op = SX.openOps.find(o => o.id === id); if(!op) return;
    SX.form = Object.assign(blankForm(), { kind: 'prod', act: op.activite_id, opId: op.id });
    render(); document.getElementById('sxFormCard').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* ---------- événements (une seule fois, sur le conteneur) ---------- */
  root.addEventListener('click', async e => {
    const li = e.target.closest('[data-pick]');
    if(li){ pickModel(li.dataset.pick); return; }
    const b = e.target.closest('button'); if(!b || b.disabled) return;
    const d = b.dataset, f = SX.form;
    if(d.kind){ f.kind = d.kind; f.act = null; f.hp = null; f.err = ''; render(); }
    else if(d.act){ f.act = d.act; f.st = null; f.err = ''; SX.lookup = { serial: '', rows: [] }; render(); }
    else if(d.hp){ f.hp = d.hp; f.err = ''; render(); }
    else if(d.tq){ f.tRaw = h2(+d.tq); const i = document.getElementById('sxTime'); if(i) i.value = f.tRaw; updConv(); }
    else if(d.st){ f.st = d.st; root.querySelectorAll('[data-st]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.st === d.st))); updConv(); }
    else if(d.resume) resume(d.resume);
    else if(d.a === 'qm'){ f.qte = Math.max(1, (parseInt(f.qte, 10) || 1) - 1); document.getElementById('sxQte').value = f.qte; }
    else if(d.a === 'qp'){ f.qte = (parseInt(f.qte, 10) || 0) + 1; document.getElementById('sxQte').value = f.qte; }
    else if(d.a === 'save') save();
    else if(d.a === 'chrono') chronoToggle();
    else if(d.a === 'repeat'){ SX.form = Object.assign(blankForm(), SX.lastSaved); render(); toast('Activité et modèle repris : indiquez le matricule et le temps.'); }
    else if(d.a === 'cancelForm'){ SX.form = blankForm(); render(); }
    else if(d.a === 'mChange'){ f.model = null; const box = document.getElementById('sxModelBox'); box.innerHTML = modelBox(); document.getElementById('sxModelQ').focus(); }
    else if(d.edit) startEdit(d.edit);
    else if(d.cancel){ if(SX.confirmCancel === d.cancel) await cancelDeclaration(d.cancel); else { SX.confirmCancel = d.cancel; render(); } }
    else if(d.day !== undefined){
      const step = +d.day;
      SX.viewDate = step === 0 ? SX.today : addDays(SX.viewDate, step);
      if(SX.viewDate > SX.today) SX.viewDate = SX.today;
      await loadDay(); render();
    }
  });
  root.addEventListener('input', e => {
    const t = e.target, f = SX.form;
    if(t.id === 'sxTime'){ f.tRaw = t.value; updConv(); }
    else if(t.id === 'sxQte') f.qte = t.value;
    else if(t.id === 'sxSerial'){ f.serial = t.value; lookupSerial(false); }
    else if(t.id === 'sxNote') f.note = t.value;
    else if(t.id === 'sxModelQ'){ SX.mSel = 0; renderModelList(); }
  });
  root.addEventListener('change', e => {
    if(e.target.id === 'sxUnreadable') SX.form.unreadable = e.target.checked;
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
    if(!session){ Object.assign(SX, { userId: null, ready: false }); root.innerHTML = ''; return; }
    setTimeout(() => {
      const view = document.getElementById('view-saisie');
      if(view && view.classList.contains('active')) initSaisie(session.user.id !== SX.userId);
    }, 0);
  });
  // Revenir sur l'onglet après minuit : on recharge la bonne journée
  document.addEventListener('visibilitychange', () => {
    const view = document.getElementById('view-saisie');
    if(document.visibilityState === 'visible' && SX.ready && view && view.classList.contains('active') && SX.today !== todayStr()) initSaisie(true);
  });
})();
