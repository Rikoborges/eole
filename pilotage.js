/* =========================================================================
   ReproBench — onglet « Pilotage » réservé au Responsable des Ateliers
   (cahier des charges de l'atelier, partie 4)

   Cinq vues :
     • Atelier        synthèse, collaborateurs, où passe le temps, alertes,
                      activité en direct, exports Excel
     • Opérations     étapes avec matricule ; clôture « abandonnée » ou
                      suppression (= annulation archivée), avec motif
     • Collaborateurs résultats d'une personne, points de maîtrise, tendance
     • Activités      meilleurs résultats et plus gros écarts par étape
     • Machines       traçabilité par N° de série

   Calculs identiques à semaine.js (théorique = quantité × standard recopié ;
   étapes avec matricule comptées à la finalisation avec leur temps cumulé).
   Visible seulement si is_responsable() ; la base refuse de toute façon les
   lectures et écritures non autorisées (RLS).
   Dépend de script.js (sb, escapeHtml, getMyUserId, csvCell, downloadBlob).
   ========================================================================= */
(function(){
  'use strict';

  const root = document.getElementById('pilotage-root');
  if(!root) return;

  /* ---------- utilitaires ---------- */
  const TZ = 'Europe/Paris';
  const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const weekdayIdx = s => (new Date(s + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const mondayOf = s => addDays(s, -weekdayIdx(s));
  const fmtDate = (s, o) => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('fr-FR', Object.assign({ timeZone: 'UTC' }, o)) : '—';
  const shortDate = s => fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short' });
  function isoWeek(s){
    const d = new Date(s + 'T12:00:00Z'); const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }
  const weekLabel = m => `S${isoWeek(m)} · ${fmtDate(m, { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(m, 4), { day: 'numeric', month: 'short' })}`;
  const workdaysBetween = (a, b) => { let n = 0, d = a; while(d < b){ d = addDays(d, 1); if(weekdayIdx(d) < 5) n++; } return n; };

  const r2 = v => Math.round(v * 100) / 100;
  const h2 = v => (v === null || v === undefined || isNaN(v)) ? '—' : r2(Number(v)).toFixed(2).replace('.', ',');
  const hm = v => { const m = Math.round(Math.abs(v) * 60); return `${v < 0 ? '−' : ''}${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  const sgn = v => (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + h2(Math.abs(v));
  const pct = v => (v === null || v === undefined || isNaN(v)) ? '—' : Math.round(v * 100) + ' %';
  const effCls = v => v === null || v === undefined ? 'dim' : v >= 0.97 ? 'ok' : v >= 0.9 ? 'mid' : 'bad';
  const esc = s => escapeHtml(s);
  const STATUS = { encours: ['blue', 'En cours'], pause: ['mid', 'À poursuivre'], final: ['ok', 'Finalisée'],
                   abandon: ['bad', 'Abandonnée / Non réalisable'], annulee: ['dim', 'Annulée (archivée)'] };
  const pill = s => `<span class="sx-pill sx-${STATUS[s][0]}">${STATUS[s][1]}</span>`;
  const OPEN = ['encours', 'pause'];

  /* ---------- état ---------- */
  const P = {
    allowed: null, ready: false, loading: false, error: null, me: null,
    view: 'inbox', period: 'w', week: null, day: null, today: null,
    filt: { metier: '', format: '', marque: '' }, opsF: 'open', selUser: null, mq: '', acc: {},
    users: [], acts: [], hp: [], formats: [], metiers: [], models: [], motifs: [],
    decls: [], ops: [], presence: [], firstDecl: {}, standards: [], rules: {}, pTab: 'collab', pmq: '', confirmDel: null, feed: [], closing: null, channel: null, reloadTimer: null
  };
  const userById = id => P.users.find(u => u.user_id === id);
  const uname = id => { const u = userById(id); return u ? (u.display_name || 'Sans nom') : '—'; };
  const actById = id => P.acts.find(a => a.id === id);
  const aname = id => (actById(id) || {}).name || '—';
  const modelById = id => P.models.find(m => m.id === id);
  const formatOf = u => P.formats.find(f => f.id === (u && u.format_id));
  const metierLabel = id => (P.metiers.find(m => m.id === id) || {}).label || '—';
  const objDay = (u, d) => { const f = formatOf(u), i = weekdayIdx(d); return f && i < 5 ? Number(f.day_hours[i]) : 0; };

  function dbError(error){
    const msg = (error && (error.message || error.details)) || 'erreur inconnue';
    if(/relation .* does not exist|Could not find the table|PGRST205/i.test(msg)) return 'La base n\'est pas encore installée (supabase/atelier-schema.sql).';
    return msg;
  }

  // PostgREST renvoie au plus 1000 lignes par requête : on pagine.
  async function fetchAll(makeQuery){
    const out = [];
    for(let from = 0; ; from += 1000){
      const { data, error } = await makeQuery().range(from, from + 999);
      if(error) throw error;
      out.push(...data);
      if(data.length < 1000) return out;
    }
  }

  /* ---------- accès ---------- */
  async function checkAccess(){
    const { data, error } = await sb.rpc('is_responsable');
    P.allowed = !error && !!data;
    if(window.setResponsable) window.setResponsable(P.allowed);
    return P.allowed;
  }

  /* ---------- chargement ---------- */
  async function loadRefs(){
    const [users, acts, hp, formats, metiers, models, motifs, standards, rules] = await Promise.all([
      sb.from('collaborateurs').select('*').order('display_name'),
      sb.from('activites').select('*').order('metier_id').order('sort'),
      sb.from('hors_production').select('*').order('sort'),
      sb.from('formats_horaires').select('*'),
      sb.from('metiers').select('*').order('sort'),
      sb.from('printer_models').select('id, brand, model, famille'),
      sb.from('motifs_abandon').select('*').order('sort'),
      sb.from('standards').select('*').order('valid_from'),
      sb.from('regles_saisie').select('key, value')
    ]);
    const bad = [users, acts, hp, formats, metiers, models, motifs, standards, rules].find(r => r.error);
    if(bad) throw bad.error;
    Object.assign(P, { users: users.data, acts: acts.data, hp: hp.data, formats: formats.data, metiers: metiers.data,
                       models: models.data, motifs: motifs.data, standards: standards.data,
                       rules: Object.fromEntries(rules.data.map(r => [r.key, r.value])) });
  }

  async function loadGuards(){
    const { data, error } = await sb.rpc('login_guard_status');
    P.guards = error ? [] : (data || []);
  }

  async function loadAll(){
    const from = [addDays(mondayOf(P.today), -7 * 7), P.today ? periodStart() : null].filter(Boolean).sort()[0];
    P.loadedFrom = from;
    await loadRefs();
    await loadGuards();
    const [decls, opsRecent, opsOpen] = await Promise.all([
      fetchAll(() => sb.from('declarations').select('id, user_id, work_date, activite_id, hors_production_id, operation_id, quantity, hours, std_value, note, checklist, cancelled, created_at')
        .gte('work_date', from).order('work_date')),
      fetchAll(() => sb.from('operations_avec_temps').select('*').gte('started_on', addDays(from, -60)).order('started_on')),
      fetchAll(() => sb.from('operations_avec_temps').select('*').in('status', OPEN))
    ]);
    P.decls = decls;
    P.firstDecl = {};
    decls.forEach(d => { if(!d.cancelled && (!P.firstDecl[d.user_id] || d.work_date < P.firstDecl[d.user_id])) P.firstDecl[d.user_id] = d.work_date; });
    const ops = new Map(); [...opsRecent, ...opsOpen].forEach(o => ops.set(o.id, o)); P.ops = [...ops.values()];
    await loadSeen();
    const jr = await sb.from('journal').select('*').gte('at', from + 'T00:00:00Z').order('at', { ascending: false }).limit(3000);
    P.journal = jr.error ? [] : (jr.data || []); P.journalOk = !jr.error;
    const vs = await sb.from('validations_semaine').select('*').gte('week_monday', mondayOf(from));
    P.vals = vs.error ? [] : (vs.data || []); P.valOk = !vs.error; // table pas encore installée : section masquée
    const pr = await sb.from('presence').select('user_id, day, first_seen, last_seen').eq('day', P.today);
    P.presence = pr.error ? [] : pr.data;
  }

  // Période plus ancienne que les données chargées (1 an, Du… au…) : on recharge.
  async function setPeriod(fn){
    fn(); render();
    if(periodStart() < P.loadedFrom){
      P.rangeLoading = true; render();
      try{ await loadAll(); }catch(e){ console.error(e); toastPl('Chargement impossible : ' + dbError(e)); }
      P.rangeLoading = false; render();
    }
  }

  async function initPilotage(force){
    const uid = await getMyUserId(); if(!uid) return;
    if(uid !== P.me){ Object.assign(P, { me: uid, ready: false, allowed: null, selUser: null }); }
    if(P.allowed === null && !(await checkAccess())) return;
    if(!P.allowed){ root.innerHTML = ''; return; }
    if(P.loading) return;
    P.today = todayStr();
    if(!P.week) P.week = mondayOf(P.today);
    if(P.ready && !force){ render(); return; }
    P.loading = true;
    if(!P.ready) root.innerHTML = '<p class="loading">Chargement…</p>';
    try{ await loadAll(); P.error = null; P.ready = true; subscribe(); }
    catch(e){ console.error('Erreur Pilotage:', e); P.error = dbError(e); }
    finally{ P.loading = false; }
    render();
  }
  window.initPilotage = initPilotage;
  window.setPilotageView = v => { if(v === 'collab' && P.view !== 'collab') P.selUser = null; P.view = v; P.closing = null; };

  /* ---------- temps réel : chaque déclaration met le tableau à jour ---------- */
  function subscribe(){
    if(P.channel) return;
    P.channel = sb.channel('pilotage-atelier')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'declarations' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operations' }, onChange)
      .subscribe();
  }
  function onChange(payload){
    const row = payload.new || {};
    if(payload.table === 'declarations' && payload.eventType === 'INSERT'){
      const what = row.activite_id ? aname(row.activite_id) : ((P.hp.find(h => h.id === row.hors_production_id) || {}).label || 'Hors production');
      P.feed.unshift({ t: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), h: `<b>${esc(uname(row.user_id))}</b> · ${esc(what)}${row.quantity ? ' ×' + row.quantity : ''} · ${h2(row.hours)} h` });
      P.feed = P.feed.slice(0, 15);
    }
    clearTimeout(P.reloadTimer);
    P.reloadTimer = setTimeout(async () => {
      const view = document.getElementById('view-pilotage');
      if(!view || !view.classList.contains('active')) { P.ready = false; return; }
      const ae = document.activeElement;
      if(ae && root.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return; // ne pas couper une saisie
      try{ await loadAll(); render(); }catch(e){ console.error(e); }
    }, 1200);
  }

  /* ---------- calculs ---------- */
  // Période choisie : W = liste des lundis concernés ; en mode « Jour », W.day
  // restreint tous les calculs à ce seul jour.
  const periodMondays = () => {
    let from, to;
    if(P.period === 'd'){ from = to = P.day; }
    else if(P.period === 'custom'){ from = P.from; to = P.to; }
    else {
      const n = P.period === 'w' ? 1 : P.period === '4w' ? 4 : P.period === 'y' ? 52 : 8;
      const last = P.period === 'w' ? P.week : mondayOf(P.today);
      from = addDays(last, -7 * (n - 1)); to = addDays(last, 6);
    }
    const W = []; for(let m = mondayOf(from); m <= to; m = addDays(m, 7)) W.push(m);
    W.from = from; W.to = to; if(from === to) W.day = from;
    return W;
  };
  const periodStart = () => periodMondays().from;
  const last8 = () => Array.from({ length: 8 }, (_, i) => addDays(mondayOf(P.today), -7 * (7 - i)));
  const inW = (d, W) => !!d && d >= (W.from || W[0]) && d <= (W.to || addDays(W[W.length - 1], 6));
  const live = d => !d.cancelled;
  function teamUsers(){
    return P.users.filter(u => u.active && u.metier_id && u.format_id &&
      (!P.filt.metier || u.metier_id === P.filt.metier) && (!P.filt.format || u.format_id === P.filt.format));
  }
  function stats(uids, W, actP, marque){
    const A = actP || (() => true);
    let decl = 0, hp = 0, theo = 0, real = 0, qte = 0, ops = 0;
    P.decls.forEach(d => {
      if(!live(d) || !uids.includes(d.user_id) || !inW(d.work_date, W)) return;
      if(d.hors_production_id){ if(!actP && !marque) hp += Number(d.hours); return; }
      if(!A(d.activite_id)) return;
      if(marque){ const o = d.operation_id && P.ops.find(x => x.id === d.operation_id); if(!o || (modelById(o.model_id) || {}).brand !== marque) return; }
      decl += Number(d.hours);
      if(d.operation_id) return;
      qte += d.quantity; ops++;
      if(d.std_value !== null){ theo += d.quantity * Number(d.std_value); real += Number(d.hours); }
    });
    P.ops.forEach(o => {
      if(o.status !== 'final' || !uids.includes(o.user_id) || !inW(o.finished_on, W) || !A(o.activite_id)) return;
      if(marque && (modelById(o.model_id) || {}).brand !== marque) return;
      qte += 1; ops++;
      if(o.std_value !== null){ theo += Number(o.std_value); real += Number(o.total_hours); }
    });
    return { decl: r2(decl), hp: r2(hp), theo: r2(theo), real: r2(real), qte, ops, eff: real ? theo / real : null, ecart: r2(real - theo) };
  }
  // L'attendu commence au premier jour où la personne a déclaré (démarrage de l'outil,
  // arrivée d'un intérimaire) : sinon les semaines d'avant compteraient comme « manquantes ».
  function expected(u, W){
    const first = P.firstDecl[u.user_id]; if(!first) return 0;
    let s = 0; W.forEach(m => { for(let i = 0; i < 5; i++){ const d = addDays(m, i); if(d <= P.today && d >= first && inW(d, W)) s += objDay(u, d); } }); return s;
  }
  function alertsFor(u, W){
    const out = [], mine = P.decls.filter(d => d.user_id === u.user_id && live(d));
    const first = mine.length ? mine.reduce((a, d) => d.work_date < a ? d.work_date : a, mine[0].work_date) : null;
    if(!first) out.push({ k: 'mid', t: 'Aucune déclaration', m: 'depuis 8 semaines', d: null, u });
    W.forEach(m => { for(let i = 0; i < 5; i++){
      const d = addDays(m, i); if(d > P.today || !first || d < first || !inW(d, W)) continue;
      const tot = r2(mine.filter(x => x.work_date === d).reduce((a, x) => a + Number(x.hours), 0)), obj = objDay(u, d);
      if(d < P.today && tot < obj - 0.01) out.push({ k: 'mid', t: 'Temps incomplet', m: `${h2(tot)} h déclarées sur ${h2(obj)} h`, d, u });
      if(tot > obj + 0.01) out.push({ k: 'bad', t: 'Temps supérieur à l\'objectif', m: `${h2(tot)} h pour ${h2(obj)} h`, d, u });
    }});
    P.ops.filter(o => o.user_id === u.user_id && o.status !== 'annulee' && !o.imported && inW(o.started_on, W) && (!o.serial || !o.model_id))
      .forEach(o => out.push({ k: 'bad', t: !o.serial ? 'Matricule non renseigné' : 'Modèle non renseigné', m: aname(o.activite_id), d: o.started_on, u }));
    if(inW(P.today, W)) P.ops.filter(o => o.user_id === u.user_id && OPEN.includes(o.status)).forEach(o => {
      const last = o.last_work_date || o.started_on, n = workdaysBetween(last, P.today);
      if(n >= 2) out.push({ k: 'mid', t: `À poursuivre depuis ${n} jours`, m: `${aname(o.activite_id)} · ${o.serial || 'sans matricule'}`, d: last, u });
    });
    return out;
  }

  /* ---------- rendu ---------- */
  const kpi = (l, v, k, h) => `<div class="sw-kpi"><span class="sw-lbl">${l}</span><span class="sw-val ${k ? 'sx-' + k : ''}">${v}</span><span class="sx-small">${h}</span></div>`;
  function periodCtl(){
    const W = periodMondays();
    return `<div class="sx-row">
      <div class="sx-seg" role="group" aria-label="Période">${[['d', 'Jour'], ['w', 'Semaine'], ['4w', '4 sem.'], ['8w', '8 sem.'], ['y', '1 an'], ['custom', 'Du… au…']].map(([k, l]) => `<button type="button" data-period="${k}" aria-pressed="${P.period === k}">${l}</button>`).join('')}</div>
      ${P.period === 'd' ? `<span class="week-nav sx-daynav pl-daypick"><button type="button" data-dayp="-1" aria-label="Jour précédent" >‹</button>
          <input type="date" id="plDay" value="${P.day}" max="${P.today}" aria-label="Choisir un jour">
          <button type="button" data-dayp="1" aria-label="Jour suivant" ${P.day >= P.today ? 'disabled' : ''}>›</button></span>
          <span class="sx-small">${esc(fmtDate(P.day, { weekday: 'long', day: 'numeric', month: 'long' }))}</span>${P.day !== P.today ? ' <button type="button" class="sx-btn sx-sm" data-dayp="0">Aujourd\'hui</button>' : ''}`
      : P.period === 'w' ? `<span class="week-nav sx-daynav"><button type="button" data-week="-1" aria-label="Semaine précédente">‹</button><span class="week-nav-label">${weekLabel(P.week)}</span><button type="button" data-week="1" aria-label="Semaine suivante" ${P.week >= mondayOf(P.today) ? 'disabled' : ''}>›</button></span>`
        : P.period === 'custom' ? `<span class="sx-row pl-range"><label>Du <input type="date" id="plFrom" value="${P.from}" max="${P.today}"></label><label>au <input type="date" id="plTo" value="${P.to}" max="${P.today}"></label></span>
          <span class="sx-small">${esc(fmtDate(P.from, { day: 'numeric', month: 'short', year: 'numeric' }))} → ${esc(fmtDate(P.to, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>`
        : `<span class="sx-small sx-mono">S${isoWeek(W[0])} → S${isoWeek(W[W.length - 1])}${P.period === 'y' ? ` · ${esc(fmtDate(W.from, { month: 'short', year: 'numeric' }))} → ${esc(fmtDate(P.today, { month: 'short', year: 'numeric' }))}` : ''}</span>`}
      ${P.rangeLoading ? '<span class="sx-small">Chargement de la période…</span>' : ''}</div>`;
  }
  function filtersHTML(withMarque){
    const brands = [...new Set(P.models.map(m => m.brand))].sort();
    return `<div class="sx-row pl-filters">
      <label>Métier <select data-filt="metier"><option value="">Tous</option>${P.metiers.map(m => `<option value="${m.id}" ${P.filt.metier === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      <label>Format <select data-filt="format"><option value="">37 h et 39 h</option>${P.formats.map(f => `<option value="${f.id}" ${P.filt.format === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
      ${withMarque ? `<label>Marque <select data-filt="marque"><option value="">Toutes</option>${brands.map(b => `<option ${P.filt.marque === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>` : ''}</div>`;
  }

  function render(){
    if(P.error){ root.innerHTML = `<div class="sx-card sx-notice"><h2 class="sx-h2">Pilotage indisponible</h2><p>${esc(P.error)}</p></div>`; return; }
    const nOpen = P.ops.filter(o => OPEN.includes(o.status)).length;
    if(window.markPilotageTab) window.markPilotageTab(P.view);
    const opTab = document.querySelector('.tab[data-pview="operations"]');
    if(opTab) opTab.innerHTML = 'Opérations' + (nOpen ? ` <span class="pl-count">${nOpen}</span>` : '');
    const inTab = document.querySelector('.tab[data-pview="inbox"]');
    if(inTab){ const n = inboxItems().reduce((a, g) => a + g.items.length, 0); inTab.innerHTML = 'À traiter' + (n ? ` <span class="pl-count">${n}</span>` : ''); }
    root.innerHTML = `${({ inbox: vInbox, atelier: vAtelier, operations: vOperations, collab: vCollab, activites: vActivites, machines: vMachines, params: vParams })[P.view]()}`;
  }

  /* ---------- À traiter : tout ce qui attend une action du responsable ---------- */
  function inboxItems(){
    const team = P.users.filter(u => u.active && u.metier_id && u.format_id), cur = mondayOf(P.today);
    const last8w = last8(), last2 = [addDays(cur, -7), cur];
    const groups = [];
    if(P.valOk) groups.push({ key: 'fiches', title: 'Fiches de la semaine à valider', items: team.flatMap(u => toValidate(u, last8w).map(m => {
      const v = valOf(u.user_id, m), s = stats([u.user_id], [m]);
      return { key: `fiche:${u.user_id}:${m}`, k: v && v.signed_at ? 'mid' : 'dim', t: `${esc(uname(u.user_id))} · S${isoWeek(m)}`, m: `${hm(s.decl + s.hp)} / ${hm(expected(u, [m]))} · ${v && v.signed_at ? 'signée par le collaborateur' : 'pas encore signée'}`,
               actions: `<button type="button" class="sx-btn sx-sm" data-val="${m}" data-uid="${u.user_id}">Valider</button><button type="button" class="sx-btn sx-sm" data-fp="${m}" data-uid="${u.user_id}">Voir la fiche</button>` }; })) });
    groups.push({ key: 'jours', title: 'Journées incomplètes (2 dernières semaines)', items: team.map(u => {
      const al = alertsFor(u, last2).filter(a => a.t === 'Temps incomplet' || a.t === 'Temps supérieur à l\'objectif');
      if(!al.length) return null;
      const miss = al.filter(a => a.t === 'Temps incomplet').length, over = al.length - miss;
      return { key: `jours:${u.user_id}:${al.map(a => a.d).join(',')}`, k: 'mid', t: `${esc(uname(u.user_id))} · ${al.length} jour${al.length > 1 ? 's' : ''}`,
               m: `${miss ? `incomplet${miss > 1 ? 's' : ''} : ` : ''}${al.slice(0, 8).map(a => esc(shortDate(a.d))).join(', ')}${al.length > 8 ? '…' : ''}${over ? ` · dont ${over} au-dessus de l'objectif` : ''}`,
               actions: `<button type="button" class="sx-btn sx-sm" data-open="${u.user_id}">Voir le collaborateur</button>` };
    }).filter(Boolean) });
    groups.push({ key: 'machines', title: 'Machines en attente depuis 3 jours ou plus', items: P.ops.filter(o => OPEN.includes(o.status) && workdaysBetween(o.last_work_date || o.started_on, P.today) >= 3).map(o => ({
      key: `machine:${o.id}:${o.last_work_date || o.started_on}`, k: 'mid', t: `${esc(o.serial || 'sans matricule')} · ${esc(aname(o.activite_id))}`, m: `chez ${esc(uname(o.user_id))} · dernier travail ${esc(shortDate(o.last_work_date || o.started_on))} (${workdaysBetween(o.last_work_date || o.started_on, P.today)} j)`,
      actions: o.serial ? `<button type="button" class="sx-btn sx-sm" data-mq="${esc(o.serial)}">Fiche machine</button>` : `<button type="button" class="sx-btn sx-sm" data-view="operations">Opérations</button>` })) });
    groups.push({ key: 'matricules', title: 'Matricule ou modèle à compléter', items: P.ops.filter(o => o.status !== 'annulee' && !o.imported && (!o.serial || !o.model_id)).map(o => ({
      key: `mat:${o.id}:${o.serial ? 'm' : 's'}`, k: 'bad', t: `${esc(aname(o.activite_id))} · ${esc(uname(o.user_id))}`, m: `${!o.serial ? 'N° de série manquant' : 'modèle manquant'} · commencée le ${esc(shortDate(o.started_on))}`, actions: '<button type="button" class="sx-btn sx-sm" data-view="operations">Opérations</button>' })) });
    groups.push({ key: 'comptes', title: 'Comptes bloqués', items: (P.guards || []).filter(g => g.locked_until && new Date(g.locked_until) > new Date()).map(g => ({
      key: `lock:${g.user_id}:${g.locked_until}`, k: 'bad', t: esc(uname(g.user_id)), m: `bloqué jusqu'à ${esc(new Date(g.locked_until).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }))} (mots de passe faux)`, actions: `<button type="button" class="sx-btn sx-sm sx-primary" data-unlock="${g.user_id}">Débloquer</button>` })) });
    groups.push({ key: 'fiches-inc', title: 'Fiches collaborateur incomplètes', items: P.users.filter(u => u.active && (!u.metier_id || !u.format_id)).map(u => ({
      key: `inc:${u.user_id}`, k: 'mid', t: esc(u.display_name || 'Sans nom'), m: 'métier ou format horaire à renseigner : la personne ne peut pas encore déclarer', actions: '<button type="button" class="sx-btn sx-sm" data-view="params">Paramètres</button>' })) });
    const seen = P.seen || {};
    groups.forEach(g => { g.done = g.items.filter(i => seen[i.key]); g.items = g.items.filter(i => !seen[i.key]); });
    return groups;
  }
  // « OK » : l'élément sort de la liste et est rangé dans « Traités » (serveur, sinon ce navigateur)
  async function loadSeen(){
    const r = await sb.from('inbox_vus').select('item_key, label, seen_at');
    if(!r.error){ P.seenServer = true; P.seen = Object.fromEntries((r.data || []).map(x => [x.item_key, x])); return; }
    P.seenServer = false;
    try{ P.seen = JSON.parse(localStorage.getItem('rb-inbox-vus-' + P.me) || '{}'); }catch(e){ P.seen = {}; }
  }
  async function markSeen(key, label, on){
    P.seen = P.seen || {};
    if(on) P.seen[key] = { item_key: key, label, seen_at: new Date().toISOString() }; else delete P.seen[key];
    if(P.seenServer){
      const r = on ? await sb.from('inbox_vus').upsert({ item_key: key, label }) : await sb.from('inbox_vus').delete().eq('item_key', key);
      if(r.error) toastPl('Non enregistré : ' + dbError(r.error));
    } else { try{ localStorage.setItem('rb-inbox-vus-' + P.me, JSON.stringify(P.seen)); }catch(e){} }
  }
  function vInbox(){
    const groups = inboxItems(), total = groups.reduce((a, g) => a + g.items.length, 0);
    const done = groups.flatMap(g => g.done.map(i => Object.assign({ group: g.title }, i, { seen: (P.seen || {})[i.key] })));
    const doneHTML = done.length ? `<details class="pl-acc pl-done" data-acc="inboxDone" ${P.acc.inboxDone ? 'open' : ''}><summary><span>Traités</span><span class="pl-acc-n">${done.length}</span><span class="chev" aria-hidden="true">›</span></summary>
      <div class="pl-acc-body"><ul class="pl-donelist">${done.sort((a, b) => String(b.seen.seen_at).localeCompare(String(a.seen.seen_at))).map(i => `<li><div><b>${i.t}</b><span class="sx-small">${esc(i.group)} · vu le ${esc(new Date(i.seen.seen_at).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }))}</span></div>
        <button type="button" class="sx-btn sx-sm" data-ibundo="${esc(i.key)}">Remettre</button></li>`).join('')}</ul>
        <p class="sx-small sx-mt">Un élément rangé revient tout seul s'il change (nouveau jour incomplet, machine de nouveau bloquée…).</p></div></details>` : '';
    if(!total) return `<div class="sx-card pl-inbox-empty"><h2 class="sx-h2">${ico('check', 18)} Tout est à jour</h2><p class="sx-small">Aucune fiche à valider, aucune journée incomplète, aucune machine bloquée.</p></div>${doneHTML}`;
    return `<p class="sx-small">${total} point${total > 1 ? 's' : ''} à traiter. Faites l'action, ou « OK » quand c'est vu : la ligne est rangée dans « Traités ».</p>
      ${groups.filter(g => g.items.length).map(g => `<div class="sx-card pl-inbox"><h2 class="sx-h2 sx-mb">${g.title} <span class="pl-acc-n">${g.items.length}</span></h2>
        <ul>${g.items.slice(0, 30).map(i => `<li class="pl-ib-${i.k}"><div><b><span class="pl-dot" aria-hidden="true"></span>${i.t}</b><span class="sx-small">${i.m}</span></div><div class="sx-row">${i.actions}<button type="button" class="sx-btn sx-sm pl-ok" data-ibok="${esc(i.key)}" data-iblabel="${esc(i.t.replace(/<[^>]+>/g, ''))}" title="Vu : ranger dans « Traités »">${ico('check', 14)} OK</button></div></li>`).join('')}</ul>
        ${g.items.length > 30 ? `<p class="sx-small sx-mt">… et ${g.items.length - 30} de plus.</p>` : ''}</div>`).join('')}${doneHTML}`;
  }

  function vAtelier(){
    const W = periodMondays(), team = teamUsers(), ids = team.map(u => u.user_id);
    const s = stats(ids, W), exp = team.reduce((a, u) => a + expected(u, W), 0);
    const al = team.flatMap(u => alertsFor(u, W));
    const open = P.ops.filter(o => ids.includes(o.user_id) && OPEN.includes(o.status));
    const byAct = {}; P.decls.filter(d => live(d) && ids.includes(d.user_id) && inW(d.work_date, W)).forEach(d => {
      const k = d.activite_id ? aname(d.activite_id) : 'Hors production'; byAct[k] = (byAct[k] || 0) + Number(d.hours); });
    const tot = Object.values(byAct).reduce((a, b) => a + b, 0), list = Object.entries(byAct).sort((a, b) => b[1] - a[1]);
    const incomplete = P.users.filter(u => u.active && (!u.metier_id || !u.format_id));
    return `${periodCtl()}${filtersHTML(false)}
      ${incomplete.length ? `<div class="sx-alert sx-alert-mid"><b>${incomplete.length} fiche${incomplete.length > 1 ? 's' : ''} incomplète${incomplete.length > 1 ? 's' : ''}</b><span>${incomplete.map(u => esc(u.display_name || 'sans nom')).join(', ')} : métier ou format à renseigner (ces personnes ne peuvent pas encore déclarer).</span></div>` : ''}
      <div class="sw-kpis">
        ${kpi('Productif attendu', hm(exp), '', `${team.length} collaborateur${team.length > 1 ? 's' : ''}`)}
        ${kpi('Déclaré productif', hm(s.decl), '', pct(exp ? s.decl / exp : null) + ' de l\'attendu')}
        ${kpi('Hors production', hm(s.hp), '', 'réunions, formation, congés…')}
        ${kpi('Théorique produit', h2(s.theo) + ' h', '', `${s.qte} unités finalisées`)}
        ${kpi('Taux de réalisation', pct(s.eff), effCls(s.eff), `écart ${sgn(s.ecart)} h`)}
        ${kpi('Étapes en cours', open.length, '', `${h2(open.reduce((a, o) => a + Number(o.total_hours), 0))} h déjà engagées`)}
      </div>
      <div class="sx-card sx-tscroll"><h2 class="sx-h2 sx-mb">Collaborateurs</h2>
        ${team.length ? `<table class="sx-table"><thead><tr><th>Collaborateur</th><th>Métier · format</th><th class="n">Attendu</th><th class="n">Déclaré</th><th class="n">Hors prod.</th><th class="n">Théorique</th><th class="n">Écart</th><th class="n">Efficience</th><th class="n">En cours</th><th class="n">Alertes</th></tr></thead>
        <tbody>${team.map(u => { const x = stats([u.user_id], W), na = al.filter(a => a.u === u).length, no = open.filter(o => o.user_id === u.user_id).length;
          return `<tr class="pl-click" data-open="${u.user_id}" tabindex="0"><td><b>${esc(u.display_name || 'Sans nom')}</b>${u.interim ? ' <span class="sx-pill sx-blue">intérim</span>' : ''}</td><td class="sx-small">${esc(metierLabel(u.metier_id))} · ${esc((formatOf(u) || {}).label || '')}</td>
          <td class="n">${h2(expected(u, W))}</td><td class="n">${h2(x.decl)}</td><td class="n">${h2(x.hp)}</td><td class="n">${h2(x.theo)}</td><td class="n">${sgn(x.ecart)}</td>
          <td class="n sx-${effCls(x.eff)}">${pct(x.eff)}</td><td class="n">${no || ''}</td><td class="n">${na ? `<span class="sx-pill sx-mid">${na}</span>` : '<span class="sx-ok" aria-label="aucune">' + ico('check', 14) + '</span>'}</td></tr>`; }).join('')}</tbody></table>
        <p class="sx-small sx-mt">Touchez une ligne pour le détail du collaborateur.</p>` : '<p class="sx-small">Aucun collaborateur avec métier et format renseignés.</p>'}
      </div>
      ${W.day ? dayDetailCard(team, W.day) : ''}
      <div class="pl-grid">
        <div class="sx-card"><h2 class="sx-h2 sx-mb">Où passe le temps</h2>
          ${list.length ? `<div class="pl-bars">${list.map(([k, v]) => `<div class="pl-bar"><span>${esc(k)}</span><span class="sx-mono sx-small">${h2(v)} h · ${pct(v / tot)}</span><div class="pl-track"><span class="${k === 'Hors production' ? 'hp' : ''}" style="width:${v / list[0][1] * 100}%"></span></div></div>`).join('')}</div>` : '<p class="sx-small">Aucune déclaration sur la période.</p>'}
        </div>
        <div class="pl-side">
          <div class="sx-card"><h2 class="sx-h2">Alertes (${al.length})</h2><div class="pl-scroll">${al.length ? al.map(x => `<div class="sx-alert sx-alert-${x.k}"><b>${esc(x.t)}</b><span>${esc(x.u.display_name || '')}${x.d ? ' · ' + esc(shortDate(x.d)) : ''} · ${esc(x.m)}</span></div>`).join('') : '<p class="sx-small sx-mt">Aucune anomalie sur la période.</p>'}</div></div>
          <div class="sx-card"><h2 class="sx-h2">Activité en direct</h2>${P.feed.length ? `<ul class="pl-feed">${P.feed.map(f => `<li><time>${f.t}</time><span>${f.h}</span></li>`).join('')}</ul>` : '<p class="sx-small sx-mt">Les nouvelles déclarations apparaissent ici dès qu\'elles sont faites.</p>'}</div>
          <div class="sx-card"><h2 class="sx-h2 sx-mb">Exports Excel</h2><div class="sx-row">
            ${[['detail', 'Détail des saisies'], ['collab', 'Par collaborateur'], ['activite', 'Par activité'], ['operations', 'Opérations']].map(([k, l]) => `<button type="button" class="sx-btn sx-sm" data-export="${k}">${ico('download', 14)} ${l}</button>`).join('')}</div>
            <p class="sx-small sx-mt">Période et filtres affichés ci-dessus.</p></div>
        </div>
      </div>`;
  }

  function dayDetailCard(team, day){
    const blocks = team.map(u => {
      const list = P.decls.filter(d => d.user_id === u.user_id && d.work_date === day).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const tot = r2(list.filter(live).reduce((a, d) => a + Number(d.hours), 0)), obj = objDay(u, day);
      const cls = !obj && !tot ? 'dim' : Math.abs(tot - obj) < 0.01 ? 'ok' : tot > obj ? 'bad' : 'mid';
      return `<div class="pl-dayblock"><div class="sx-row sx-between"><b>${esc(u.display_name || 'Sans nom')}</b><span class="sx-${cls}">${hm(tot)}${obj ? ' / ' + hm(obj) : ''}</span></div>
        ${list.length ? `<ul class="pl-daylist">${list.map(d => {
          const o = d.operation_id && P.ops.find(x => x.id === d.operation_id);
          const name = d.activite_id ? aname(d.activite_id) : ((P.hp.find(h => h.id === d.hors_production_id) || {}).label || '');
          return `<li class="${d.cancelled ? 'pl-struck' : ''}"><span class="sx-mono">${hm(Number(d.hours))}</span><span>${esc(name)}${d.quantity ? ` <small>× ${d.quantity}</small>` : ''}${o ? ` <small class="sx-mono">${esc(o.serial || '')}</small> ${pill(o.status)}` : ''}${Array.isArray(d.checklist) && d.checklist.length ? ` <small>${ico('check', 14)} ${d.checklist.length}</small>` : ''}${d.note ? ` <small>« ${esc(d.note)} »</small>` : ''}${d.cancelled ? ' <small>(annulée)</small>' : ''}</span></li>`; }).join('')}</ul>`
          : `<p class="sx-small">${obj ? 'Aucune déclaration.' : 'Jour non travaillé dans son format.'}</p>`}</div>`;
    }).join('');
    return `<div class="sx-card"><h2 class="sx-h2 sx-mb">Déclarations du ${esc(fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2><div class="pl-daygrid">${blocks}</div></div>`;
  }

  function vOperations(){
    const sets = { open: o => OPEN.includes(o.status), final: o => o.status === 'final', closed: o => o.status === 'abandon' || o.status === 'annulee' };
    const list = P.ops.filter(sets[P.opsF]).sort((a, b) => String(b.last_work_date || b.started_on).localeCompare(String(a.last_work_date || a.started_on))).slice(0, 200);
    const cnt = k => P.ops.filter(sets[k]).length;
    return `<p class="sx-small">Étapes avec matricule. Une opération n'est jamais supprimée : elle est abandonnée ou annulée, avec motif, date et auteur.</p>
      <div class="sx-seg" role="group" aria-label="Statut">${[['open', 'En cours / à poursuivre'], ['final', 'Finalisées'], ['closed', 'Abandonnées et annulées']].map(([k, l]) => `<button type="button" data-opsf="${k}" aria-pressed="${P.opsF === k}">${l} (${cnt(k)})</button>`).join('')}</div>
      <div class="sx-card sx-tscroll"><table class="sx-table"><thead><tr><th>Matricule</th><th>Modèle</th><th>Étape</th><th>Collaborateur</th><th>Début</th><th>Dernier travail</th><th class="n">Temps cumulé</th><th class="n">Attendu</th><th>Statut</th><th></th></tr></thead><tbody>
      ${list.map(o => {
        const last = o.last_work_date || o.started_on, n = OPEN.includes(o.status) ? workdaysBetween(last, P.today) : 0;
        const motif = (P.motifs.find(m => m.id === o.motif_id) || {}).label;
        const row = `<tr class="${o.status === 'annulee' ? 'pl-struck' : ''}"><td class="sx-mono">${o.serial ? `<button type="button" class="pl-link mat" data-mq="${esc(o.serial)}" title="Voir la fiche de la machine">${esc(o.serial)}</button>` : o.imported ? '<span class="sx-small">ancien Suivi</span>' : '<span class="sx-bad">à compléter</span>'}</td><td class="sx-small">${esc((modelById(o.model_id) || {}).model || '—')}</td>
          <td>${esc(aname(o.activite_id))}</td><td>${esc(uname(o.user_id))}</td><td>${esc(shortDate(o.started_on))}</td><td>${esc(shortDate(last))}${n >= 2 ? ` <span class="sx-pill sx-mid">${n} j</span>` : ''}</td>
          <td class="n">${h2(o.total_hours)} h</td><td class="n">${h2(o.std_value)} h</td>
          <td>${pill(o.status)}${(motif || o.close_comment) ? `<br><span class="sx-small">${esc(motif || '')}${o.close_comment ? ' · ' + esc(o.close_comment) : ''}${o.closed_at ? ' · ' + esc(new Date(o.closed_at).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' })) : ''}${o.closed_by ? ' · par ' + esc(uname(o.closed_by)) : ''}</span>` : ''}</td>
          <td class="pl-actions">${OPEN.includes(o.status) ? `<button type="button" class="sx-btn sx-sm" data-close="${o.id}" data-mode="abandon">Clôturer : abandonnée</button>` : ''}${OPEN.includes(o.status) || o.status === 'final' ? `<button type="button" class="sx-btn sx-sm sx-danger" data-close="${o.id}" data-mode="annulee">Supprimer</button>` : ''}</td></tr>`;
        const c = P.closing;
        const form = c && c.id === o.id ? `<tr class="pl-closing"><td colspan="10">
          <div class="sx-row pl-closeform"><b>${c.mode === 'abandon' ? 'Clôturer comme « Abandonnée / Non réalisable »' : 'Supprimer = annuler et archiver'}</b>
            <label>Motif <select id="plMotif"><option value="">Choisir…</option>${P.motifs.filter(m => m.active).map(m => `<option value="${m.id}" ${c.motif === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
            <label class="pl-grow">Commentaire${(P.motifs.find(m => m.id === c.motif) || {}).requires_comment ? ' (obligatoire)' : ''} <input type="text" id="plComment" value="${esc(c.comment)}"></label>
            <button type="button" class="sx-btn sx-primary" data-a="closeOk" ${c.busy ? 'disabled' : ''}>Confirmer</button><button type="button" class="sx-btn" data-a="closeCancel">Annuler</button></div>
          <p class="sx-small sx-mt">${c.mode === 'abandon' ? `Les ${h2(o.total_hours)} h restent dans le temps productif du collaborateur. La machine n'est pas comptée en quantité et l'opération ne fausse pas l'efficience.` : 'L\'opération et ses temps restent dans l\'historique (barrés) mais sortent des totaux. À utiliser pour une erreur de saisie.'}</p>
          ${c.err ? `<div class="sx-error">${esc(c.err)}</div>` : ''}</td></tr>` : '';
        return row + form; }).join('') || '<tr><td colspan="10" class="sx-small">Aucune opération.</td></tr>'}
      </tbody></table></div>`;
  }


  /* ---------- graphiques du détail collaborateur ---------- */
  const PALETTE = ['var(--copper)', '#4F9DDE', '#22C55E', '#A78BFA', '#F97316', '#2DD4BF', '#F472B6', '#94A3B8'];

  // Machines finalisées par marque (clic sur une marque → ses modèles)
  function brandChart(u, W){
    const done = P.ops.filter(o => o.user_id === u.user_id && o.status === 'final' && inW(o.finished_on, W));
    if(!done.length) return '<p class="sx-small">Aucune machine finalisée sur la période.</p>';
    const by = {}; done.forEach(o => { const m = modelById(o.model_id); const b = m ? m.brand : 'Modèle non renseigné'; (by[b] = by[b] || []).push(m ? m.model : '—'); });
    const list = Object.entries(by).sort((a, b) => b[1].length - a[1].length), max = list[0][1].length;
    const sel = P.brandSel && by[P.brandSel] ? P.brandSel : null;
    const bars = list.map(([b, arr]) => `<button type="button" class="pl-hbar${sel === b ? ' on' : ''}" data-brand="${esc(b)}" aria-pressed="${sel === b}">
        <span class="pl-hbar-l">${esc(b)}</span><span class="pl-hbar-t"><span style="width:${arr.length / max * 100}%"></span></span><b class="sx-mono">${arr.length}</b></button>`).join('');
    let models = '';
    if(sel){
      const c = {}; by[sel].forEach(m => { c[m] = (c[m] || 0) + 1; });
      const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10);
      models = `<div class="pl-models"><p class="sx-small"><b>${esc(sel)}</b> · modèles les plus traités</p>${top.map(([m, n]) => `<div class="pl-mrow"><span>${esc(m)}</span><b class="sx-mono">${n}</b></div>`).join('')}</div>`;
    }
    return `<p class="sx-small">${done.length} machine${done.length > 1 ? 's' : ''} finalisée${done.length > 1 ? 's' : ''} · touchez une marque pour voir ses modèles</p><div class="pl-hbars">${bars}</div>${models}`;
  }

  // Heures par jour (ou par semaine sur une longue période) : production + hors production, repère de l'attendu
  function hoursChart(u, W){
    const from = W.from, to = W.to < P.today ? W.to : P.today;
    const days = []; for(let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const byWeek = days.length > 31;
    const buckets = [];
    if(byWeek){ W.forEach(m => buckets.push({ k: m, label: 'S' + isoWeek(m), days: days.filter(d => mondayOf(d) === m) })); }
    const first = P.firstDecl[u.user_id];
    if(!byWeek) days.filter(d => (first && d >= first && objDay(u, d) > 0) || P.decls.some(x => x.user_id === u.user_id && x.work_date === d && live(x))).forEach(d => buckets.push({ k: d, label: fmtDate(d, { weekday: 'short', day: 'numeric' }), days: [d] }));
    buckets.forEach(b => {
      b.prod = 0; b.hp = 0; b.obj = 0;
      P.decls.forEach(x => { if(x.user_id === u.user_id && live(x) && b.days.includes(x.work_date)){ if(x.hors_production_id) b.hp += Number(x.hours); else b.prod += Number(x.hours); } });
      b.days.forEach(d => { if(first && d >= first) b.obj += objDay(u, d); });
    });
    const shown = buckets.filter(b => b.days.length);
    if(!shown.length || !shown.some(b => b.prod + b.hp + b.obj)) return '<p class="sx-small">Aucune donnée sur la période.</p>';
    const Wd = 760, H = 210, L = 38, R = 8, T = 12, B = 30, n = shown.length;
    const max = Math.max(...shown.map(b => Math.max(b.prod + b.hp, b.obj)), 1) * 1.1;
    const slot = (Wd - L - R) / n, bw = Math.max(4, Math.min(34, slot * 0.62));
    const Y = v => T + (1 - v / max) * (H - T - B);
    const step = Math.max(1, Math.ceil(n / 14));
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => { const v = max / 1.1 * f; return `<line class="gl" x1="${L}" x2="${Wd - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }).join('');
    const bars = shown.map((b, i) => {
      const x = L + i * slot + (slot - bw) / 2, tot = b.prod + b.hp, miss = b.obj && tot < b.obj - 0.01;
      const tip = `${b.label} : ${h2(b.prod)} h production + ${h2(b.hp)} h hors production${b.obj ? ' · attendu ' + h2(b.obj) + ' h' : ''}`;
      return `<g><title>${esc(tip)}</title>
        <rect class="bp" x="${x}" y="${Y(b.prod)}" width="${bw}" height="${Y(0) - Y(b.prod)}" rx="2"/>
        <rect class="bh" x="${x}" y="${Y(tot)}" width="${bw}" height="${Y(b.prod) - Y(tot)}" rx="2"/>
        ${b.obj ? `<line class="${miss ? 'ob miss' : 'ob'}" x1="${x - 3}" x2="${x + bw + 3}" y1="${Y(b.obj)}" y2="${Y(b.obj)}"/>` : ''}
        ${(n - 1 - i) % step === 0 ? `<text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle">${esc(b.label)}</text>` : ''}</g>`;
    }).join('');
    const missing = shown.filter(b => b.obj && b.prod + b.hp < b.obj - 0.01).length;
    return `<div class="pl-legend"><span><i class="bp"></i>Production</span><span><i class="bh"></i>Hors production</span><span><i class="ob"></i>Attendu</span>${missing ? `<span class="sx-mid">${missing} ${byWeek ? 'semaine' : 'jour'}${missing > 1 ? 's' : ''} incomplet${missing > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="sx-tscroll"><svg class="pl-svg" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Heures déclarées par ${byWeek ? 'semaine' : 'jour'}">${grid}${bars}</svg></div>`;
  }

  // Répartition du temps par activité (rosca)
  function activityDonut(u, W){
    const by = {};
    P.decls.forEach(d => { if(d.user_id !== u.user_id || !live(d) || !inW(d.work_date, W)) return; const k = d.activite_id ? aname(d.activite_id) : 'Hors production'; by[k] = (by[k] || 0) + Number(d.hours); });
    let list = Object.entries(by).sort((a, b) => b[1] - a[1]);
    if(!list.length) return '<p class="sx-small">Aucune déclaration sur la période.</p>';
    if(list.length > 7){ const rest = list.slice(6).reduce((a, x) => a + x[1], 0); list = [...list.slice(0, 6), ['Autres', rest]]; }
    const tot = list.reduce((a, x) => a + x[1], 0), R = 70, C = 2 * Math.PI * R;
    let off = 0;
    const segs = list.map(([k, v], i) => { const len = v / tot * C, col = k === 'Hors production' ? '#94A3B8' : PALETTE[i % PALETTE.length];
      const s = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${col}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"><title>${esc(k)} : ${h2(v)} h</title></circle>`; off += len; return [s, col]; });
    return `<div class="pl-donut"><svg viewBox="0 0 180 180" role="img" aria-label="Temps par activité"><g transform="rotate(-90 90 90)">${segs.map(x => x[0]).join('')}</g>
        <text x="90" y="86" text-anchor="middle" class="pl-dn">${hm(tot)}</text><text x="90" y="106" text-anchor="middle" class="pl-dl">au total</text></svg>
      <ul>${list.map(([k, v], i) => `<li><i style="background:${segs[i][1]}"></i><span>${esc(k)}</span><b class="sx-mono">${h2(v)} h</b><small>${pct(v / tot)}</small></li>`).join('')}</ul></div>`;
  }

  // Sanfona : l'état ouvert/fermé survit aux rafraîchissements en temps réel
  const acc = (key, title, count, body, openDefault) => {
    const open = P.acc[key] !== undefined ? P.acc[key] : !!openDefault;
    return `<details class="pl-acc" data-acc="${key}" ${open ? 'open' : ''}><summary><span>${title}</span>${count !== null && count !== undefined ? `<span class="pl-acc-n">${count}</span>` : ''}<span class="chev" aria-hidden="true">›</span></summary><div class="pl-acc-body">${body}</div></details>`;
  };

  // Même type d'alerte répété (ex. « Temps incomplet » sur 18 jours) : une seule ligne
  function groupAlerts(al){
    const groups = new Map();
    al.forEach(x => { const g = groups.get(x.t) || { k: x.k, t: x.t, items: [] }; g.items.push(x); groups.set(x.t, g); });
    return [...groups.values()].map(g => g.items.length === 1
      ? `<div class="sx-alert sx-alert-${g.k}"><b>${esc(g.t)}</b><span>${g.items[0].d ? esc(shortDate(g.items[0].d)) + ' · ' : ''}${esc(g.items[0].m)}</span></div>`
      : `<div class="sx-alert sx-alert-${g.k}"><b>${esc(g.t)} · ${g.items.length} fois</b><span>${g.items.slice(-6).reverse().map(x => (x.d ? esc(shortDate(x.d)) + ' : ' : '') + esc(x.m)).join(' · ')}${g.items.length > 6 ? ` · et ${g.items.length - 6} de plus` : ''}</span></div>`).join('');
  }

  function vCollab(){
    const team = P.users.filter(u => u.metier_id && u.format_id);
    if(!team.length) return '<div class="sx-card"><p class="sx-small">Aucun collaborateur avec métier et format renseignés.</p></div>';
    if(P.selUser && !team.some(u => u.user_id === P.selUser)) P.selUser = null;
    return P.selUser ? collabDetail(team) : collabOverview(team);
  }

  /* ---------- journal des modifications : phrases lisibles ---------- */
  const STATUS_TXT = { encours: 'En cours', pause: 'À poursuivre', final: 'Finalisée', abandon: 'Abandonnée', annulee: 'Annulée' };
  function journalText(j){
    const b = j.before || {}, a = j.after || {};
    const what = x => x.activite_id ? aname(x.activite_id) : x.hors_production_id ? ((P.hp.find(h => h.id === x.hors_production_id) || {}).label || 'Hors production') : '';
    if(j.table_name === 'declarations'){
      const head = `${esc(what(b) || what(a))}${b.work_date ? ' du ' + esc(shortDate(b.work_date)) : ''}`;
      if(j.action === 'suppression') return `${head} : supprimée`;
      if(j.action === 'annulation') return `${head} : <b>annulée</b> (${h2(b.hours)} h)`;
      const ch = [];
      if(b.hours !== a.hours) ch.push(`temps ${h2(b.hours)} → <b>${h2(a.hours)} h</b>`);
      if(b.quantity !== a.quantity) ch.push(`quantité ${b.quantity} → <b>${a.quantity}</b>`);
      if(b.activite_id !== a.activite_id || b.hors_production_id !== a.hors_production_id) ch.push(`activité → <b>${esc(what(a))}</b>`);
      if(b.work_date !== a.work_date) ch.push(`jour → <b>${esc(shortDate(a.work_date))}</b>`);
      if((b.note || '') !== (a.note || '')) ch.push(`commentaire « ${esc(a.note || '')} »`);
      if(JSON.stringify(b.checklist) !== JSON.stringify(a.checklist)) ch.push('checklist modifiée');
      if(b.cancelled && !a.cancelled) ch.push('<b>rétablie</b>');
      return `${head} : ${ch.join(' · ') || 'modifiée'}`;
    }
    const ch = [];
    if(b.serial !== a.serial) ch.push(`matricule ${esc(b.serial || '—')} → <b>${esc(a.serial || '—')}</b>`);
    if(b.model_id !== a.model_id) ch.push(`modèle → <b>${esc((modelById(a.model_id) || {}).model || '—')}</b>`);
    if(b.status !== a.status){ const m = (P.motifs.find(x => x.id === a.motif_id) || {}).label; ch.push(`${STATUS_TXT[b.status] || b.status} → <b>${STATUS_TXT[a.status] || a.status}</b>${m ? ' (' + esc(m) + ')' : ''}${a.close_comment ? ' « ' + esc(a.close_comment) + ' »' : ''}`); }
    return `Étape ${esc(aname(a.activite_id || b.activite_id))}${a.serial || b.serial ? ' · ' + esc(a.serial || b.serial) : ''} : ${ch.join(' · ') || 'modifiée'}`;
  }
  function journalList(list, emptyTxt){
    if(!list.length) return `<p class="sx-small">${emptyTxt}</p>`;
    return `<ul class="pl-journal">${list.map(j => `<li><time>${esc(new Date(j.at).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }))}</time>
      <span>${journalText(j)}<small> · par ${esc(j.actor === j.user_id ? 'le collaborateur' : uname(j.actor))}</small></span></li>`).join('')}</ul>`;
  }

  /* ---------- fiches hebdomadaires : signature, validation, Excel / PDF ---------- */
  const valOf = (uid, m) => (P.vals || []).find(v => v.user_id === uid && v.week_monday === m);
  // semaines passées avec des déclarations mais pas encore validées
  const toValidate = (u, W) => W.filter(m => m < mondayOf(P.today) && !(valOf(u.user_id, m) || {}).validated_at && P.decls.some(d => d.user_id === u.user_id && !d.cancelled && mondayOf(d.work_date) === m));
  function weeksCard(u, W){
    if(!P.valOk) return '';
    const weeks = W.filter(m => m <= P.today).slice().reverse().slice(0, 12);
    const rows = weeks.map(m => {
      const v = valOf(u.user_id, m), WW = [m], s = stats([u.user_id], WW), exp = expected(u, WW), tot = r2(s.decl + s.hp);
      const has = P.decls.some(d => d.user_id === u.user_id && !d.cancelled && mondayOf(d.work_date) === m);
      return `<tr><td><b>S${isoWeek(m)}</b> <span class="sx-small">${esc(fmtDate(m, { day: 'numeric', month: 'short' }))} – ${esc(fmtDate(addDays(m, 4), { day: 'numeric', month: 'short' }))}</span></td>
        <td class="n">${hm(tot)} <small>/ ${hm(exp)}</small></td><td>${Fiche.statusHTML(v)}</td>
        <td class="pl-actions">${v && v.validated_at
          ? `<button type="button" class="sx-btn sx-sm" data-unval="${m}" data-uid="${u.user_id}">${P.confirmUnval === m ? 'Confirmer la réouverture' : 'Rouvrir'}</button>`
          : `<button type="button" class="sx-btn sx-sm" data-val="${m}" data-uid="${u.user_id}" ${has || (v && v.signed_at) ? '' : 'disabled'}>Valider</button>`}
          <button type="button" class="sx-btn sx-sm" data-fx="${m}" data-uid="${u.user_id}">${ico('download', 14)} Excel</button><button type="button" class="sx-btn sx-sm" data-fp="${m}" data-uid="${u.user_id}">${ico('eye', 14)} Voir</button></td></tr>`;
    }).join('');
    return `<div class="sx-card sx-tscroll"><h2 class="sx-h2 sx-mb">Fiches de la semaine</h2>
      <table class="sx-table"><thead><tr><th>Semaine</th><th class="n">Déclaré / attendu</th><th>État</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="sx-small">Aucune semaine sur la période.</td></tr>'}</tbody></table>
      <p class="sx-small sx-mt">Valider verrouille la semaine : le collaborateur ne peut plus la modifier. « Rouvrir » la déverrouille.</p></div>`;
  }

  // 1) Vue d'ensemble : une carte par personne, l'essentiel d'un coup d'œil
  function collabOverview(team){
    const W = periodMondays();
    const list = team.filter(u => u.active).map(u => {
      const s = stats([u.user_id], W), exp = expected(u, W), al = alertsFor(u, W), open = P.ops.filter(o => o.user_id === u.user_id && OPEN.includes(o.status)).length;
      return { u, s, exp, al, open, fill: exp ? (s.decl + s.hp) / exp : null, tv: P.valOk ? toValidate(u, W).length : 0 };
    });
    const inactive = team.filter(u => !u.active);
    return `${periodCtl()}
      <div class="pl-cgrid">${list.map(({ u, s, exp, al, open, fill, tv }) => `
        <button type="button" class="pl-ccard" data-open="${u.user_id}">
          <span class="pl-ccard-h"><b>${esc(u.display_name || 'Sans nom')}</b>${u.interim ? '<span class="sx-pill sx-blue">intérim</span>' : ''}${al.length ? `<span class="sx-pill sx-mid">${al.length} alerte${al.length > 1 ? 's' : ''}</span>` : '<span class="sx-pill sx-ok">OK</span>'}${tv ? `<span class="sx-pill sx-blue">${tv} fiche${tv > 1 ? 's' : ''} à valider</span>` : ''}</span>
          <span class="sx-small">${esc(metierLabel(u.metier_id))} · ${esc((formatOf(u) || {}).label || '')}</span>
          <span class="pl-ccard-row"><span>Déclaré</span><b class="sx-mono">${hm(s.decl + s.hp)} <small>/ ${hm(exp)}</small></b></span>
          <span class="pl-track"><span style="width:${Math.min(100, (fill || 0) * 100)}%"></span></span>
          <span class="pl-ccard-row"><span>Efficience</span><b class="sx-${effCls(s.eff)}">${pct(s.eff)}</b></span>
          <span class="pl-ccard-row"><span>Unités finalisées</span><b class="sx-mono">${s.qte}</b></span>
          <span class="pl-ccard-row"><span>Étapes en cours</span><b class="sx-mono">${open || '—'}</b></span>
          <span class="pl-ccard-go">Voir le détail ›</span>
        </button>`).join('')}</div>
      ${inactive.length ? `<p class="sx-small sx-mt">Désactivés (non affichés) : ${inactive.map(u => esc(u.display_name || 'sans nom')).join(', ')}.</p>` : ''}`;
  }

  // 2) Détail : le résumé direct en haut, le reste en sanfona
  function collabDetail(team){
    const u = userById(P.selUser), W = periodMondays(), s = stats([u.user_id], W), exp = expected(u, W);
    const long = W.length > 8, all8 = last8(), mW = (P.period === 'w' || P.period === 'd') ? all8 : W, half = Math.ceil(mW.length / 2), early = mW.slice(0, half), late = mW.slice(half);
    const rows = P.acts.filter(a => a.metier_id === u.metier_id).map(a => {
      const A = id => id === a.id, x = stats([u.user_id], mW, A), e1 = stats([u.user_id], early, A), e2 = stats([u.user_id], late, A);
      let trend = '→'; if(mW.length > 1 && e1.ops >= 3 && e2.ops >= 3 && e1.eff && e2.eff){ const d = e2.eff - e1.eff; trend = d > 0.03 ? '↗' : d < -0.03 ? '↘' : '→'; }
      const status = !(x.real || x.theo) && x.ops ? ['dim', 'Sans standard'] : x.ops < 5 ? ['dim', 'Données insuffisantes'] : x.eff >= 0.97 ? ['ok', 'Maîtrisé'] : x.eff < 0.9 ? ['bad', 'À accompagner'] : ['mid', 'Correct'];
      const open = P.ops.filter(o => o.user_id === u.user_id && o.activite_id === a.id && OPEN.includes(o.status)).length;
      return { a, x, trend, status, open };
    }).filter(r => r.x.ops || r.open);
    const open = P.ops.filter(o => o.user_id === u.user_id && OPEN.includes(o.status));
    const al = alertsFor(u, W);
    const decls = P.decls.filter(d => d.user_id === u.user_id && inW(d.work_date, W));
    const recent = decls.slice(-30).reverse();
    const pres = P.presence.find(p => p.user_id === u.user_id);
    const t = v => new Date(v).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    const fill = exp ? (s.decl + s.hp) / exp : null;
    const best = rows.filter(r => r.status[0] === 'ok').map(r => r.a.name), weak = rows.filter(r => r.status[0] === 'bad').map(r => r.a.name);
    const lastDay = decls.length ? decls[decls.length - 1].work_date : null;
    const trendW = long ? W : all8;
    const bullets = [
      `A déclaré <b>${hm(s.decl + s.hp)}</b> sur <b>${hm(exp)}</b> attendues${fill !== null ? ` (${pct(fill)})` : ''}.`,
      s.eff !== null ? `Efficience <b class="sx-${effCls(s.eff)}">${pct(s.eff)}</b> sur ${s.qte} unité${s.qte > 1 ? 's' : ''} finalisée${s.qte > 1 ? 's' : ''}.` : 'Pas encore assez de travail mesuré pour l\'efficience.',
      best.length ? `Maîtrise : ${esc(best.slice(0, 3).join(', '))}.` : '',
      weak.length ? `À accompagner : <b class="sx-bad">${esc(weak.slice(0, 3).join(', '))}</b>.` : '',
      open.length ? `${open.length} étape${open.length > 1 ? 's' : ''} en cours.` : '',
      lastDay ? `Dernière déclaration : ${esc(shortDate(lastDay).replace(/\.$/, ''))}.` : 'Aucune déclaration sur la période.'
    ].filter(Boolean);
    return `<div class="sx-row sx-between pl-dhead">
        <button type="button" class="sx-btn sx-sm" data-a="collabBack">‹ Tous les collaborateurs</button>
        <label class="pl-filters">Collaborateur <select id="plUser">${team.map(x => `<option value="${x.user_id}" ${x.user_id === u.user_id ? 'selected' : ''}>${esc(x.display_name || 'Sans nom')}</option>`).join('')}</select></label>
      </div>
      ${periodCtl()}
      <div class="sx-card pl-who">
        <div class="sx-row sx-between"><h2 class="pl-name">${esc(u.display_name || 'Sans nom')}${u.interim ? ' <span class="sx-pill sx-blue">intérim</span>' : ''}</h2>
          ${al.length ? `<span class="sx-pill sx-mid">${al.length} alerte${al.length > 1 ? 's' : ''}</span>` : '<span class="sx-pill sx-ok">Aucune alerte</span>'}</div>
        <p class="sx-small">${esc(metierLabel(u.metier_id))} · ${esc((formatOf(u) || {}).label || '')}</p>
        <ul class="pl-bullets">${bullets.map(b => `<li>${b}</li>`).join('')}</ul>
      </div>
      <div class="sw-kpis pl-kpis4">
        ${kpi('Déclaré / attendu', hm(s.decl + s.hp), '', `sur ${hm(exp)} · ${pct(fill)}`)}
        ${kpi('Efficience', pct(s.eff), effCls(s.eff), `écart ${sgn(s.ecart)} h`)}
        ${kpi('Unités finalisées', s.qte, '', `${h2(s.theo)} h théoriques`)}
        ${kpi('Hors production', hm(s.hp), '', 'réunions, formation, congés…')}
      </div>
      ${weeksCard(u, W)}
      <div class="pl-charts">
        <div class="sx-card pl-chart-wide"><h2 class="sx-h2 sx-mb">Heures par ${W.from === W.to || (W.to < P.today ? W.to : P.today) <= addDays(W.from, 30) ? 'jour' : 'semaine'}</h2>${hoursChart(u, W)}</div>
        <div class="sx-card"><h2 class="sx-h2 sx-mb">Machines par marque</h2>${brandChart(u, W)}</div>
        <div class="sx-card"><h2 class="sx-h2 sx-mb">Temps par activité</h2>${activityDonut(u, W)}</div>
      </div>
      <div class="pl-accs">
        ${acc('alerts', 'Alertes', al.length, groupAlerts(al) || '<p class="sx-small">Aucune.</p>', al.length > 0)}
        ${acc('open', 'Étapes en cours', open.length, open.map(o => `<div class="sx-opsum"><b>${esc(aname(o.activite_id))}</b><span class="sx-mono sx-small">${esc(o.serial || 'sans matricule')} · ${esc((modelById(o.model_id) || {}).model || '')}</span><span class="sx-small">${pill(o.status)} depuis le ${esc(shortDate(o.started_on))} · ${h2(o.total_hours)} h / ${h2(o.std_value)} h</span></div>`).join('') || '<p class="sx-small">Aucune.</p>')}
        ${acc('mastery', 'Points de maîtrise et axes de progression', rows.length, `<div class="sx-tscroll">${rows.length ? `<table class="sx-table"><thead><tr><th>Activité</th><th class="n">Opér.</th><th class="n">Qté</th><th class="n">Théorique</th><th class="n">Réalisé</th><th class="n">Efficience</th><th class="n">Tendance</th><th>Statut</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${esc(r.a.name)}${r.open ? ` <span class="sx-pill sx-mid">${r.open} en cours</span>` : ''}</td><td class="n">${r.x.ops}</td><td class="n">${r.x.qte}</td><td class="n">${r.x.real ? h2(r.x.theo) : '—'}</td><td class="n">${h2(r.x.real || r.x.decl)}</td><td class="n sx-${effCls(r.x.eff)}">${pct(r.x.eff)}</td><td class="n sw-trend">${r.trend}</td><td><span class="sx-pill sx-${r.status[0]}">${r.status[1]}</span></td></tr>`).join('')}</tbody></table>` : '<p class="sx-small">Pas encore de déclaration.</p>'}</div>
          <p class="sx-small sx-mt">Au moins 5 opérations pour classer une activité. Calculé sur ${(P.period === 'w' || P.period === 'd') ? 'les 8 dernières semaines' : 'la période'}.</p>`)}
        ${acc('trend', 'Efficience par semaine', null, trendSVG(trendW.map(m => stats([u.user_id], [m]).eff), trendW))}
        ${acc('decls', 'Déclarations de la période', decls.length, `<ul class="sx-entries">${recent.map(d => {
          const o = d.operation_id && P.ops.find(x => x.id === d.operation_id);
          const name = d.activite_id ? aname(d.activite_id) : ((P.hp.find(h => h.id === d.hors_production_id) || {}).label || '');
          return `<li class="sx-entry${d.cancelled ? ' sx-cancel' : ''}"><span class="sx-small">${esc(shortDate(d.work_date))}</span><div class="sx-row sx-between"><span><b>${esc(name)}</b>${d.quantity ? ` <small>× ${d.quantity}</small>` : ''}</span><span class="sx-time-v">${hm(Number(d.hours))}</span></div>${o ? `<span class="sx-meta sx-mono">${esc(o.serial || 'sans matricule')} · ${pill(o.status)}</span>` : ''}${d.note ? `<span class="sx-meta">« ${esc(d.note)} »</span>` : ''}</li>`; }).join('') || '<li class="sx-small">Aucune.</li>'}</ul>${decls.length > 30 ? '<p class="sx-small sx-mt">Les 30 plus récentes. Export complet : Atelier › Exports Excel.</p>' : ''}`)}
        ${P.journalOk ? acc('journal', 'Historique des modifications', (P.journal || []).filter(j => j.user_id === u.user_id).length, journalList((P.journal || []).filter(j => j.user_id === u.user_id).slice(0, 60), 'Aucune correction ni annulation sur la période chargée.')) : ''}
        ${acc('pres', 'Heures de connexion (masqué)', null, `<p class="sx-small">Visible uniquement par le responsable, jamais par le collaborateur.</p><p class="sx-mono">${pres ? `Aujourd'hui : première activité ${t(pres.first_seen)} · dernière ${t(pres.last_seen)}` : 'Pas de connexion enregistrée aujourd\'hui.'}</p>`)}
      </div>`;
  }

  function vActivites(){
    const W = periodMondays(), ids = teamUsers().map(u => u.user_id), all8 = last8(), e = all8.slice(0, 4), l = all8.slice(4);
    const rows = P.acts.filter(a => !P.filt.metier || a.metier_id === P.filt.metier).map(a => {
      const A = id => id === a.id, x = stats(ids, W, A, P.filt.marque), x1 = stats(ids, e, A, P.filt.marque), x2 = stats(ids, l, A, P.filt.marque);
      const tr = x1.eff && x2.eff ? (x2.eff - x1.eff > 0.03 ? '↗' : x2.eff - x1.eff < -0.03 ? '↘' : '→') : '→';
      const open = P.ops.filter(o => o.activite_id === a.id && ids.includes(o.user_id) && OPEN.includes(o.status)).length;
      const ab = P.ops.filter(o => o.activite_id === a.id && ids.includes(o.user_id) && o.status === 'abandon' && inW(o.closed_at && o.closed_at.slice(0, 10), W)).length;
      return { a, x, tr, open, ab };
    }).filter(r => r.x.ops || r.open).sort((p, q) => (p.x.eff ?? 9) - (q.x.eff ?? 9));
    const withEff = rows.filter(r => r.x.eff !== null), worst = withEff.slice(0, 2).map(r => r.a.id), best = withEff.slice(-2).map(r => r.a.id);
    return `${periodCtl()}${filtersHTML(true)}<p class="sx-small">Les écarts les plus importants en haut. Temps moyen = temps réalisé ÷ quantité (activités avec standard).</p>
      <div class="sx-card sx-tscroll"><table class="sx-table"><thead><tr><th>Activité</th><th>Métier</th><th class="n">Opérations</th><th class="n">Qté</th><th class="n">Temps moyen / u.</th><th class="n">Efficience</th><th class="n">Tendance 8 sem.</th><th class="n">En cours</th><th class="n">Abandons</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.a.name)}</td><td class="sx-small">${esc(metierLabel(r.a.metier_id))}</td><td class="n">${r.x.ops}</td><td class="n">${r.x.qte}</td><td class="n">${r.x.qte && r.x.real ? h2(r.x.real / r.x.qte) : '—'}</td><td class="n sx-${effCls(r.x.eff)}">${pct(r.x.eff)}</td><td class="n sw-trend">${r.tr}</td><td class="n">${r.a.requires_machine ? r.open : ''}</td><td class="n">${r.a.requires_machine ? r.ab : ''}</td><td>${worst.includes(r.a.id) ? '<span class="sx-pill sx-bad">Plus gros écart</span>' : best.includes(r.a.id) ? '<span class="sx-pill sx-ok">Meilleur résultat</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="sx-small">Aucune donnée sur la période.</td></tr>'}</tbody></table></div>`;
  }

  function vMachines(){
    if(P.mq.trim().length >= 3 && (!P.mres || P.mres.q !== P.mq.trim().toUpperCase().replace(/\s+/g, ''))) setTimeout(searchMachines, 0);
    return `<p class="sx-small">Fiche machine : tapez un N° de série (3 caractères minimum). Toute l'histoire de la machine : étapes, collaborateurs, temps, checklists, corrections.</p>
      <div class="sx-msearch pl-msearch"><span class="sx-loupe" aria-hidden="true">${ico('search')}</span><input type="text" id="plMq" class="sx-mono" value="${esc(P.mq)}" placeholder="7019606410YBX" aria-label="Rechercher un N° de série" autocomplete="off"></div>
      <div id="plMachines">${machinesResults()}</div>`;
  }
  function recentMachines(){
    return [...new Map(P.ops.filter(o => o.serial).sort((a, b) => String(b.last_work_date || b.started_on).localeCompare(String(a.last_work_date || a.started_on))).map(o => [o.serial, o])).values()].slice(0, 10);
  }
  // Fiche machine : tout l'historique (pas seulement les semaines chargées), recherché sur le serveur
  let mqTimer = null;
  function searchMachines(){
    clearTimeout(mqTimer);
    const q = P.mq.trim().toUpperCase().replace(/\s+/g, '');
    if(q.length < 3){ P.mres = null; const el = document.getElementById('plMachines'); if(el) el.innerHTML = machinesResults(); return; }
    mqTimer = setTimeout(async () => {
      const el0 = document.getElementById('plMachines'); if(el0 && !P.mres) el0.innerHTML = '<p class="sx-small">Recherche…</p>';
      const ops = await sb.from('operations_avec_temps').select('*').ilike('serial', '%' + q + '%').order('started_on').limit(80);
      if(ops.error){ P.mres = { q, error: dbError(ops.error) }; }
      else {
        const list = (ops.data || []).filter(o => o.serial && o.serial.toUpperCase().includes(q)), ids = list.map(o => o.id);
        const decls = ids.length ? await sb.from('declarations').select('id, user_id, work_date, operation_id, hours, note, checklist, cancelled, created_at').in('operation_id', ids).order('work_date') : { data: [] };
        const dIds = (decls.data || []).map(d => d.id);
        const jr = P.journalOk && ids.length ? await sb.from('journal').select('*').in('row_id', [...ids, ...dIds]).order('at', { ascending: false }).limit(200) : { data: [] };
        P.mres = { q, ops: list, decls: decls.data || [], journal: jr.error ? [] : (jr.data || []) };
      }
      if(P.mq.trim().toUpperCase().replace(/\s+/g, '') !== q) return; // une autre recherche a été lancée entre-temps
      const el = document.getElementById('plMachines'); if(el) el.innerHTML = machinesResults();
    }, 300);
  }
  function machinesResults(){
    const r = P.mres;
    if(!r){ const recent = recentMachines(); return `<div class="sx-card"><h2 class="sx-h2 sx-mb">Dernières machines traitées</h2><div class="sx-chips">${recent.map(o => `<button type="button" class="sx-chip sx-mono" data-mq="${esc(o.serial)}">${esc(o.serial)} <small>${esc((modelById(o.model_id) || {}).model || '')}</small></button>`).join('') || '<span class="sx-small">Aucune pour l\'instant.</span>'}</div></div>`; }
    if(r.error) return `<div class="sx-error">${esc(r.error)}</div>`;
    const groups = {}; r.ops.forEach(o => (groups[o.serial] = groups[o.serial] || []).push(o));
    const entries = Object.entries(groups);
    if(!entries.length) return '<p class="sx-small">Aucune machine trouvée pour ce N° de série.</p>';
    return (entries.length > 1 ? `<p class="sx-small">${entries.length} machines correspondent : précisez le N° de série pour n'en voir qu'une.</p>` : '') + entries.slice(0, 6).map(([serial, ops]) => machineCard(serial, ops, r)).join('');
  }
  function machineCard(serial, ops, r){
    ops.sort((a, b) => String(a.started_on).localeCompare(String(b.started_on)));
    const m = modelById((ops.find(o => o.model_id) || {}).model_id) || {};
    const live = r.decls.filter(d => !d.cancelled && ops.some(o => o.id === d.operation_id));
    const total = r2(live.reduce((s, d) => s + Number(d.hours), 0)), fin = ops.filter(o => o.status === 'final').length;
    const dates = live.map(d => d.work_date).sort(), people = [...new Set(live.map(d => d.user_id))].map(uname);
    const opIds = new Set(ops.map(o => o.id)), dIds = new Set(r.decls.filter(d => opIds.has(d.operation_id)).map(d => d.id));
    const jr = r.journal.filter(j => opIds.has(j.row_id) || dIds.has(j.row_id));
    return `<div class="sx-card pl-mcard">
      <div class="sx-row sx-between"><div><h2 class="pl-mserial"><span class="mat mat-lg">${esc(serial)}</span></h2><p class="sx-small">${esc(m.brand || '')} ${esc(m.model || 'modèle non renseigné')}${m.famille ? ' · ' + esc(m.famille) : ''}</p></div>
        ${ops.some(o => OPEN.includes(o.status)) ? pill('pause') : fin ? pill('final') : ''}</div>
      <div class="pl-msum"><span><b>${fin}</b> / ${ops.length} étape${ops.length > 1 ? 's' : ''} finalisée${fin > 1 ? 's' : ''}</span><span><b>${h2(total)} h</b> au total</span>
        ${dates.length ? `<span>du <b>${esc(shortDate(dates[0]))}</b> au <b>${esc(shortDate(dates[dates.length - 1]))}</b></span>` : ''}<span>${esc(people.join(', ') || '—')}</span></div>
      <ol class="pl-timeline">${ops.map(o => {
        const segs = r.decls.filter(d => d.operation_id === o.id);
        const motif = (P.motifs.find(x => x.id === o.motif_id) || {}).label;
        return `<li class="st-${o.status}"><div class="sx-row sx-between"><b>${esc(aname(o.activite_id))}</b>${pill(o.status)}</div>
          <span class="sx-small">${h2(o.total_hours)} h pour ${h2(o.std_value)} h attendues${o.status === 'final' && o.std_value !== null ? ` · écart ${sgn(o.total_hours - o.std_value)} h` : ''}${motif ? ' · ' + esc(motif) : ''}${o.close_comment ? ' « ' + esc(o.close_comment) + ' »' : ''}</span>
          <ul class="pl-segs">${segs.map(d => `<li class="${d.cancelled ? 'pl-struck' : ''}"><span>${esc(shortDate(d.work_date))}</span><span>${esc(uname(d.user_id))}</span><span class="sx-mono">${h2(d.hours)} h</span>
            <span class="sx-small">${Array.isArray(d.checklist) && d.checklist.length ? ico('check', 14) + ' checklist (' + d.checklist.length + ') ' : ''}${d.note ? '« ' + esc(d.note) + ' »' : ''}${d.cancelled ? ' (annulée)' : ''}</span></li>`).join('')}</ul></li>`; }).join('')}</ol>
      ${P.journalOk ? `<details class="pl-acc"><summary><span>Modifications</span><span class="pl-acc-n">${jr.length}</span><span class="chev" aria-hidden="true">›</span></summary><div class="pl-acc-body">${journalList(jr, 'Aucune correction sur cette machine.')}</div></details>` : ''}
    </div>`;
  }


  function trendSVG(pts, mondays){
    const W = 380, H = 170, L = 40, B = 26, T = 16, lo = 0.75, hi = 1.15, n = pts.length;
    const X = i => L + i * (W - L - 14) / Math.max(1, n - 1), Y = v => T + (hi - Math.max(lo, Math.min(hi, v))) / (hi - lo) * (H - T - B);
    const Pp = pts.map((v, i) => v === null ? null : [X(i), Y(v), v]).filter(Boolean);
    let s = `<svg class="sw-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Efficience par semaine">`;
    [0.8, 0.9, 1, 1.1].forEach(v => { s += `<line class="${v === 1 ? 'tg' : 'gl'}" x1="${L}" x2="${W - 14}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v * 100)}%</text>`; });
    if(Pp.length){
      const path = Pp.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      if(Pp.length > 1) s += `<path class="ar" d="${path} L ${Pp[Pp.length - 1][0]} ${H - B} L ${Pp[0][0]} ${H - B} Z"/><path class="ln" d="${path}"/>`;
      const l = Pp[Pp.length - 1]; s += `<circle class="pt" cx="${l[0]}" cy="${l[1]}" r="4.5"/><text class="lbl" x="${l[0] - 8}" y="${l[1] - 9}" text-anchor="end">${pct(l[2])}</text>`;
    } else s += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">Pas encore de données</text>`;
    const step = Math.max(2, Math.ceil(n / 8)); mondays.forEach((m, i) => { if((n - 1 - i) % step === 0) s += `<text x="${X(i)}" y="${H - 7}" text-anchor="middle">S${isoWeek(m)}</text>`; });
    return s + '</svg>';
  }

  /* ---------- PARAMÈTRES : tout se règle ici, sans développeur ---------- */
  const curStd = aid => { const l = P.standards.filter(s => s.activite_id === aid); return l.length ? l[l.length - 1] : null; };
  const cb = (attrs, on, label) => `<input type="checkbox" class="pl-cb" ${attrs} ${on ? 'checked' : ''} aria-label="${esc(label)}">`;
  function vParams(){
    const tabs = [['collab', 'Collaborateurs'], ['acts', 'Activités et standards'], ['metiers', 'Métiers'], ['horaires', 'Formats horaires'],
                  ['hp', 'Hors production'], ['motifs', 'Motifs d\'abandon'], ['models', 'Modèles machines'], ['rules', 'Règles de saisie']];
    return `<p class="sx-small">Tout se règle ici. Les changements s'appliquent immédiatement à toute l'équipe.</p>
      <div class="sx-seg pl-ptabs" role="group" aria-label="Paramètres">${tabs.map(([k, l]) => `<button type="button" data-ptab="${k}" aria-pressed="${P.pTab === k}">${l}</button>`).join('')}</div>
      <div class="sx-card">${({ collab: pCollab, acts: pActs, metiers: pMetiers, horaires: pHoraires, hp: pHp, motifs: pMotifs, models: pModels, rules: pRules })[P.pTab]()}</div>`;
  }
  // Supprimer : deux choix clairs
  function delPanelRow(u){
    const n = P.decls.filter(d => d.user_id === u.user_id && !d.cancelled).length;
    return `<tr class="pl-delrow"><td colspan="7"><div class="pl-delpanel">
      <b>Supprimer ${esc(u.display_name || 'ce compte')} ?</b>
      <div class="pl-delchoices">
        <div><button type="button" class="sx-btn sx-sm" data-delu="${u.user_id}">Supprimer l'accès, garder l'historique</button>
          <span class="sx-small">La personne ne peut plus se connecter et disparaît de la liste. Ses heures restent dans les totaux et les fiches. (Conseillé pour quelqu'un qui part.)</span></div>
        <div>${P.confirmPurge === u.user_id
            ? `<button type="button" class="sx-btn sx-sm sx-danger pl-purge-ok" data-purge="${u.user_id}">Oui, tout effacer définitivement</button>`
            : `<button type="button" class="sx-btn sx-sm sx-danger" data-purgeask="${u.user_id}">Tout effacer</button>`}
          <span class="sx-small">Le compte <b>et tout ce qu'il a fait</b> sont supprimés : déclarations${n ? ` (au moins ${n} ces 8 dernières semaines)` : ''}, étapes machine, ancien Suivi, fiches signées. <b>Irréversible.</b> (Pour un compte de test ou créé par erreur.)</span></div>
      </div>
      <button type="button" class="sx-link" data-a="delCancel">Annuler</button></div></td></tr>`;
  }
  // Comptes désactivés / supprimés : rangés à part
  function inactiveHTML(){
    const off = P.users.filter(u => !u.active);
    if(!off.length) return '';
    return `<details class="pl-acc pl-inactive" data-acc="inactive" ${P.acc.inactive ? 'open' : ''}><summary><span>Comptes désactivés ou supprimés</span><span class="pl-acc-n">${off.length}</span><span class="chev" aria-hidden="true">›</span></summary>
      <div class="pl-acc-body"><ul class="pl-donelist">${off.map(u => `<li><div><b>${esc(u.display_name || 'Sans nom')}</b><span class="sx-small">${esc(metierLabel(u.metier_id) || 'sans métier')} · historique conservé</span></div>
        <div class="sx-row"><button type="button" class="sx-btn sx-sm" data-react="${u.user_id}">Réactiver la fiche</button>
          ${P.confirmPurge === u.user_id ? `<button type="button" class="sx-btn sx-sm sx-danger" data-purge="${u.user_id}">Oui, tout effacer définitivement</button>` : `<button type="button" class="sx-btn sx-sm sx-danger" data-purgeask="${u.user_id}">Tout effacer</button>`}</div></li>`).join('')}</ul>
      <p class="sx-small sx-mt">« Réactiver la fiche » la remet dans la liste ; si l'accès avait été supprimé, créez-lui un nouveau compte. « Tout effacer » supprime aussi tout son historique.</p></div></details>`;
  }
  function pCollab(){
    return `<div class="sx-tscroll"><table class="sx-table pl-ptable pl-collab"><thead><tr><th>Nom affiché</th><th>Métier</th><th>Format</th><th>Intérim</th><th>Droits</th><th>Actif</th><th>Accès</th></tr></thead><tbody>
      ${P.users.filter(u => u.active).map(u => `<tr><td><input type="text" data-cu="${u.user_id}" data-cf="display_name" value="${esc(u.display_name || '')}" aria-label="Nom affiché"></td>
        <td><select data-cu="${u.user_id}" data-cf="metier_id" aria-label="Métier de ${esc(u.display_name || '')}"><option value="">— à choisir —</option>${P.metiers.filter(m => m.active || m.id === u.metier_id).map(m => `<option value="${m.id}" ${u.metier_id === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></td>
        <td><select data-cu="${u.user_id}" data-cf="format_id" aria-label="Format de ${esc(u.display_name || '')}"><option value="">— à choisir —</option>${P.formats.map(f => `<option value="${f.id}" ${u.format_id === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></td>
        <td>${cb(`data-cu="${u.user_id}" data-cf="interim"`, u.interim, 'Intérim')}</td>
        <td><select data-cu="${u.user_id}" data-cf="role" aria-label="Droits"><option value="collaborateur" ${u.role === 'collaborateur' ? 'selected' : ''}>Collaborateur</option><option value="responsable" ${u.role === 'responsable' ? 'selected' : ''}>Admin</option></select></td>
        <td>${cb(`data-cu="${u.user_id}" data-cf="active"`, u.active, 'Actif')}</td>
        <td class="pl-access">${accessCell(u)}</td></tr>${P.delPanel === u.user_id ? delPanelRow(u) : ''}`).join('')}</tbody></table></div>
      ${inactiveHTML()}
      ${P.tempPw ? `<div class="sx-alert sx-alert-mid pl-temppw"><b>Mot de passe provisoire de ${esc(uname(P.tempPw.user))}</b><span class="sx-mono">${esc(P.tempPw.password)}</span><span>Notez-le et donnez-le à la personne : il ne sera plus affiché. Elle devra choisir le sien à la connexion.</span><button type="button" class="sx-btn sx-sm" data-a="hideTempPw">J'ai noté</button></div>` : ''}
      <p class="sx-small sx-mt">Un intérimaire reçoit en général le métier Aide technique ; vous pouvez le changer. « Admin » donne accès au mode Admin (Atelier, Opérations… Paramètres). <b>Supprimer</b> : au choix, retirer l'accès en gardant l'historique, ou tout effacer définitivement.</p>
      <h3 class="pl-h3">Créer un compte</h3>
      <div class="sx-row pl-addrow"><input type="text" id="ncName" placeholder="Nom (ex : Paul D.)" aria-label="Nom" autocomplete="off">
        <input type="text" id="ncEmail" placeholder="Identifiant (ex : paul.durand) ou e-mail" aria-label="Identifiant ou e-mail" autocomplete="off" autocapitalize="none">
        <input type="text" id="ncPass" placeholder="Mot de passe provisoire (8 caractères min.)" aria-label="Mot de passe provisoire" autocomplete="off">
        <button type="button" class="sx-btn sx-primary" data-a="addAccount">+ Créer le compte</button></div>
      <p class="sx-small sx-mt">Pas d'e-mail EOLE (intérim…) ? Laissez l'identifiant vide : il est créé à partir du nom (ex. « paul.durand »), et la personne se connecte avec cet identifiant, sans e-mail personnel. Communiquez-lui l'identifiant et le mot de passe. Sa fiche apparaît aussitôt : choisissez ensuite son métier et son format.</p>`;
  }
  function accessCell(u){
    const g = (P.guards || []).find(x => x.user_id === u.user_id);
    const locked = g && g.locked_until && new Date(g.locked_until) > new Date();
    const status = locked ? `<span class="sx-pill sx-bad">Bloqué jusqu'à ${esc(new Date(g.locked_until).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }))}</span>`
      : u.must_change_password ? '<span class="sx-pill sx-mid">Mot de passe provisoire</span>'
      : g && g.failures ? `<span class="sx-pill sx-mid">${g.failures} essai${g.failures > 1 ? 's' : ''} faux</span>` : '<span class="sx-pill sx-ok">OK</span>';
    return `${status}<div class="sx-row">${locked || (g && g.failures) ? `<button type="button" class="sx-btn sx-sm" data-unlock="${u.user_id}">Débloquer</button>` : ''}<button type="button" class="sx-btn sx-sm" data-resetpw="${u.user_id}" title="Donner un nouveau mot de passe provisoire">${P.confirmReset === u.user_id ? 'Confirmer ?' : 'Réinitialiser'}</button>${u.user_id === P.me ? '' : `<button type="button" class="sx-btn sx-sm sx-danger" data-delopen="${u.user_id}" title="Supprimer ce compte">Supprimer</button>`}</div>`;
  }
  function pActs(){
    return P.metiers.map(m => `<h3 class="pl-h3">${esc(m.label)}${m.active ? '' : ' <span class="sx-pill sx-dim">désactivé</span>'}</h3>
      <div class="sx-tscroll"><table class="sx-table pl-ptable"><thead><tr><th>Activité</th><th class="n">Standard h / qté</th><th>Matricule obligatoire</th><th>Quantité</th><th>Checklist</th><th>Active</th><th>Historique du standard</th></tr></thead><tbody>
      ${P.acts.filter(a => a.metier_id === m.id).map(a => { const st = curStd(a.id), hist = P.standards.filter(s => s.activite_id === a.id);
        return `<tr><td><input type="text" data-af="name" data-aid="${a.id}" value="${esc(a.name)}" aria-label="Nom de l'activité"></td>
          <td class="n"><input type="text" class="pl-num" inputmode="decimal" data-std="${a.id}" value="${st && st.hours_per_unit !== null ? h2(st.hours_per_unit) : ''}" placeholder="—" aria-label="Standard ${esc(a.name)}"></td>
          <td>${cb(`data-af="requires_machine" data-aid="${a.id}"`, a.requires_machine, 'Matricule obligatoire')}</td>
          <td>${a.requires_machine ? '<span class="sx-small">1 / machine</span>' : cb(`data-af="uses_quantity" data-aid="${a.id}"`, a.uses_quantity !== false, 'Demander une quantité')}</td>
          <td><select data-af="checklist" data-aid="${a.id}" aria-label="Checklist"><option value="" ${!a.checklist ? 'selected' : ''}>Aucune</option><option value="reconditionnement" ${a.checklist === 'reconditionnement' ? 'selected' : ''}>Reconditionnement</option><option value="installation" ${a.checklist === 'installation' ? 'selected' : ''}>Installation</option></select></td>
          <td>${cb(`data-af="active" data-aid="${a.id}"`, a.active, 'Active')}</td>
          <td class="sx-small">${hist.map(s => `${s.hours_per_unit === null ? '—' : h2(s.hours_per_unit)} depuis le ${esc(fmtDate(s.valid_from, { day: '2-digit', month: '2-digit', year: 'numeric' }))}`).join('<br>') || '—'}</td></tr>`; }).join('')}</tbody></table></div>`).join('') + `
      <h3 class="pl-h3">Ajouter une activité</h3>
      <div class="sx-row pl-addrow"><input type="text" id="npName" placeholder="Nom de l'activité" aria-label="Nom de l'activité">
        <select id="npMetier" aria-label="Métier">${P.metiers.filter(m => m.active).map(m => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select>
        <input type="text" id="npStd" class="pl-num" inputmode="decimal" placeholder="Standard" aria-label="Standard en heures">
        <label class="sx-check"><input type="checkbox" id="npMachine"> Matricule obligatoire</label>
        <button type="button" class="sx-btn sx-primary" data-a="addAct">+ Ajouter</button></div>
      <p class="sx-small sx-mt">Changer un standard ne modifie pas le passé : chaque déclaration garde la valeur en vigueur le jour où elle a été faite. Le nouveau standard s'applique à partir d'aujourd'hui. Une activité désactivée n'est plus proposée mais reste dans l'historique. « Matricule obligatoire » = 1 matricule = 1 quantité, étape suspendable.</p>`;
  }
  function pMetiers(){
    return `<div class="sx-tscroll"><table class="sx-table pl-ptable"><thead><tr><th>Code</th><th>Nom</th><th>Actif</th><th class="n">Collaborateurs</th></tr></thead><tbody>
      ${P.metiers.map(m => `<tr><td class="sx-mono">${esc(m.id)}</td><td><input type="text" data-mtf="label" data-mtid="${esc(m.id)}" value="${esc(m.label)}" aria-label="Nom du métier"></td><td>${cb(`data-mtf="active" data-mtid="${esc(m.id)}"`, m.active, 'Actif')}</td><td class="n">${P.users.filter(u => u.metier_id === m.id).length}</td></tr>`).join('')}</tbody></table></div>
      <div class="sx-row pl-addrow sx-mt"><input type="text" id="nmt" placeholder="Nouveau métier (ex : Logisticien)" aria-label="Nouveau métier"><button type="button" class="sx-btn sx-primary" data-a="addMetier">+ Ajouter</button></div>
      <p class="sx-small sx-mt">Chaque métier a ses propres activités (onglet Activités et standards). Un collaborateur ne voit que les activités de son métier.</p>`;
  }
  function pHoraires(){
    const D = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
    return `<div class="sx-tscroll"><table class="sx-table pl-ptable"><thead><tr><th>Format</th><th class="n">Contrat (h)</th>${D.map(d => `<th class="n">${d}</th>`).join('')}<th class="n">Productif / semaine</th></tr></thead><tbody>
      ${P.formats.map(f => `<tr><td><b>${esc(f.label)}</b></td><td class="n"><input type="text" class="pl-num" inputmode="decimal" data-fmtc="${esc(f.id)}" value="${h2(f.contract_hours)}" aria-label="Heures de contrat ${esc(f.label)}"></td>
        ${f.day_hours.map((v, i) => `<td class="n"><input type="text" class="pl-num" inputmode="decimal" data-fmt="${esc(f.id)}" data-day="${i}" value="${h2(v)}" aria-label="${esc(f.label)} ${D[i]}"></td>`).join('')}
        <td class="n"><b>${h2(f.day_hours.reduce((a, b) => a + Number(b), 0))} h</b></td></tr>`).join('')}</tbody></table></div>
      <p class="sx-small sx-mt">Temps productif attendu par jour. L'objectif du jour de chaque collaborateur vient de son format (vendredi 4 h ou 6 h).</p>`;
  }
  function listParams(rows, kind, extra){
    return `<div class="sx-tscroll"><table class="sx-table pl-ptable"><thead><tr><th>Libellé</th>${extra ? `<th>${extra.title}</th>` : ''}<th>Actif</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><input type="text" data-lk="${kind}" data-lf="label" data-lid="${r.id}" value="${esc(r.label)}" aria-label="Libellé"></td>${extra ? `<td>${cb(`data-lk="${kind}" data-lf="${extra.field}" data-lid="${r.id}"`, r[extra.field], extra.title)}</td>` : ''}<td>${cb(`data-lk="${kind}" data-lf="active" data-lid="${r.id}"`, r.active, 'Actif')}</td></tr>`).join('')}</tbody></table></div>
      <div class="sx-row pl-addrow sx-mt"><input type="text" id="nl-${kind}" placeholder="Nouveau motif" aria-label="Nouveau motif"><button type="button" class="sx-btn sx-primary" data-addl="${kind}">+ Ajouter</button></div>`;
  }
  const pHp = () => listParams(P.hp, 'hp') + '<p class="sx-small sx-mt">Ces motifs expliquent une journée atypique : ils ne comptent jamais comme contre-performance. Un motif désactivé n\'est plus proposé mais reste dans l\'historique.</p>';
  const pMotifs = () => listParams(P.motifs, 'motif', { title: 'Commentaire obligatoire', field: 'requires_comment' }) + '<p class="sx-small sx-mt">Utilisés pour clôturer une opération (abandon ou suppression).</p>';
  function pModels(){
    const q = P.pmq.trim().toUpperCase().replace(/[\s.\-]/g, '');
    const list = q ? P.models.filter(m => (m.model + (m.famille || '') + m.brand).toUpperCase().replace(/[\s.\-]/g, '').includes(q)) : P.models;
    const brands = [...new Set(P.models.map(m => m.brand))].sort();
    return `<div class="sx-row"><div class="sx-msearch pl-grow"><span class="sx-loupe" aria-hidden="true">${ico('search')}</span><input type="text" id="plPmq" class="sx-mono" value="${esc(P.pmq)}" placeholder="Rechercher parmi ${P.models.length} modèles" aria-label="Rechercher un modèle"></div>
      <span class="sx-small">${brands.map(b => `${esc(b)} ${P.models.filter(m => m.brand === b).length}`).join(' · ')}</span></div>
      <div id="plModels">${modelsTable(list)}</div>
      <div class="sx-row pl-addrow sx-mt"><input type="text" id="nmD" class="sx-mono" placeholder="Désignation (ex : IRAC3530 REC)" aria-label="Désignation"><input type="text" id="nmF" class="sx-mono pl-num" placeholder="Famille (CA0…)" aria-label="Code famille">
        <input type="text" id="nmB" list="plBrands" placeholder="Marque" aria-label="Marque"><datalist id="plBrands">${brands.map(b => `<option value="${esc(b)}">`).join('')}</datalist>
        <button type="button" class="sx-btn sx-primary" data-a="addModel">+ Ajouter</button></div>
      <p class="sx-small sx-mt">Un modèle déjà utilisé sur une machine ne peut pas être supprimé (l'historique en a besoin).</p>`;
  }
  function modelsTable(list){
    return `<div class="sx-tscroll pl-models"><table class="sx-table"><thead><tr><th>Désignation</th><th>Famille</th><th>Marque</th><th></th></tr></thead><tbody>
      ${list.slice(0, 150).map(m => `<tr><td class="sx-mono">${esc(m.model)}</td><td class="sx-mono sx-small">${esc(m.famille || '')}</td><td>${esc(m.brand)}</td><td><button type="button" class="sx-btn sx-sm sx-danger" data-delmodel="${m.id}">${P.confirmDel === m.id ? 'Confirmer' : 'Supprimer'}</button></td></tr>`).join('')}</tbody></table>
      ${list.length > 150 ? `<p class="sx-small">… ${list.length - 150} autres : affinez la recherche.</p>` : ''}</div>`;
  }
  function pRules(){
    const r = P.rules, corr = r.correction || 'day';
    const tog = (k, title, help, def) => `<label class="pl-toggle">${cb(`data-rule="${k}"`, r[k] === undefined ? def : r[k] === true, title)}<span><b>${title}</b><span class="sx-small">${help}</span></span></label>`;
    return `<label class="pl-filters">Correction par le collaborateur <select data-rule="correction">${[['day', 'Jusqu\'à la fin de la journée'], ['h24', 'Pendant 24 h'], ['week', 'Jusqu\'à la fin de la semaine'], ['days7', '7 jours (la semaine écoulée)'], ['none', 'Responsable uniquement']].map(([k, l]) => `<option value="${k}" ${corr === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${tog('resultats_visibles', 'Les collaborateurs voient « Mes résultats »', 'Sinon, seul le responsable voit les résultats individuels.', true)}
      ${tog('chrono', 'Chrono facultatif dans Saisir', 'Désactivé par défaut : l\'outil est une déclaration, pas un pointage. Activé, il ne fait que proposer un temps que le collaborateur valide.', false)}
      ${tog('photos_suivi', 'Photos, checklist et lecture IA du bon (onglet Suivi)', 'Fonctions de l\'onglet Suivi, gardées en option.', true)}`;
  }

  async function saveParam(promise, okMsg){
    const { error } = await promise;
    if(error){ toastPl('Erreur : ' + dbError(error)); }
    else if(okMsg) toastPl(okMsg);
    try{ await loadRefs(); }catch(e){ console.error(e); }
    render();
    return !error;
  }
  const parseNum = v => { const s = String(v).trim().replace(',', '.'); if(s === '') return null; const n = Number(s); return isNaN(n) ? NaN : n; };
  async function onParamChange(t){
    const d = t.dataset, val = t.type === 'checkbox' ? t.checked : t.value;
    if(d.cu){
      const v = (d.cf === 'metier_id' || d.cf === 'format_id') ? (val || null) : d.cf === 'display_name' ? (val.trim() || null) : val;
      return saveParam(sb.from('collaborateurs').update({ [d.cf]: v }).eq('user_id', d.cu), 'Fiche mise à jour.');
    }
    if(d.af){
      if(d.af === 'name' && !val.trim()) return render();
      return saveParam(sb.from('activites').update({ [d.af]: d.af === 'name' ? val.trim() : d.af === 'checklist' ? (val || null) : val }).eq('id', d.aid), 'Activité mise à jour.');
    }
    if(d.std){
      const n = parseNum(val);
      if(Number.isNaN(n) || (n !== null && (n < 0 || n > 99))){ t.classList.add('pl-err'); toastPl('Standard invalide (ex : 0,25).'); return; }
      const cur = curStd(d.std);
      if(cur && (cur.hours_per_unit === null ? null : Number(cur.hours_per_unit)) === n) return;
      return saveParam(sb.from('standards').upsert({ activite_id: d.std, hours_per_unit: n, valid_from: P.today }, { onConflict: 'activite_id,valid_from' }),
        `Nouveau standard ${n === null ? 'vide' : h2(n) + ' h'} à partir d'aujourd'hui. Les déclarations passées gardent l'ancien.`);
    }
    if(d.mtf){
      if(d.mtf === 'label' && !val.trim()) return render();
      return saveParam(sb.from('metiers').update({ [d.mtf]: d.mtf === 'label' ? val.trim() : val }).eq('id', d.mtid), 'Métier mis à jour.');
    }
    if(d.fmt !== undefined || d.fmtc !== undefined){
      const n = parseNum(val);
      if(n === null || Number.isNaN(n) || n < 0 || n > 60){ t.classList.add('pl-err'); toastPl('Nombre d\'heures invalide.'); return; }
      if(d.fmtc !== undefined) return saveParam(sb.from('formats_horaires').update({ contract_hours: n }).eq('id', d.fmtc), 'Format mis à jour.');
      if(n > 12){ t.classList.add('pl-err'); toastPl('Au plus 12 h par jour.'); return; }
      const f = P.formats.find(x => x.id === d.fmt), days = f.day_hours.map(Number); days[+d.day] = n;
      return saveParam(sb.from('formats_horaires').update({ day_hours: days }).eq('id', d.fmt), 'Format mis à jour.');
    }
    if(d.lk){
      const table = d.lk === 'hp' ? 'hors_production' : 'motifs_abandon';
      if(d.lf === 'label' && !val.trim()) return render();
      return saveParam(sb.from(table).update({ [d.lf]: d.lf === 'label' ? val.trim() : val }).eq('id', d.lid), 'Motif mis à jour.');
    }
    if(d.rule){
      return saveParam(sb.from('regles_saisie').upsert({ key: d.rule, value: val, updated_at: new Date().toISOString() }), 'Règle mise à jour.');
    }
  }
  async function onParamClick(d){
    if(d.ptab){ P.pTab = d.ptab; P.confirmDel = null; render(); return true; }
    if(d.a === 'hideTempPw'){ P.tempPw = null; render(); return true; }
    if(d.unlock){
      const { error } = await sb.rpc('unlock_login', { p_user: d.unlock });
      toastPl(error ? 'Erreur : ' + dbError(error) : 'Compte débloqué.');
      await loadGuards(); render(); return true;
    }
    if(d.resetpw){
      if(P.confirmReset !== d.resetpw){ P.confirmReset = d.resetpw; P.confirmDel = null; render(); return true; }
      P.confirmReset = null;
      const { data: { session } } = await sb.auth.getSession();
      try{
        const res = await fetch('/api/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` }, body: JSON.stringify({ userId: d.resetpw }) });
        const body = await res.json().catch(() => ({}));
        if(!res.ok){ toastPl(body.error || 'Erreur lors de la réinitialisation.'); render(); return true; }
        P.tempPw = { user: d.resetpw, password: body.password };
        await loadRefs(); await loadGuards(); render();
      }catch(e){ toastPl('Erreur réseau : réessayez.'); render(); }
      return true;
    }
    if(d.delopen){ P.delPanel = P.delPanel === d.delopen ? null : d.delopen; P.confirmPurge = null; P.confirmReset = null; render(); return true; }
    if(d.a === 'delCancel'){ P.delPanel = null; P.confirmPurge = null; render(); return true; }
    if(d.purgeask){ P.confirmPurge = d.purgeask; render(); return true; }
    if(d.react){ return saveParam(sb.from('collaborateurs').update({ active: true }).eq('user_id', d.react), 'Fiche réactivée.'); }
    if(d.purge){
      const who = uname(d.purge); P.confirmPurge = null; P.delPanel = null;
      const { data: { session } } = await sb.auth.getSession();
      try{
        const res = await fetch('/api/delete-collaborator', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` }, body: JSON.stringify({ userId: d.purge, purge: true }) });
        const body = await res.json().catch(() => ({}));
        if(!res.ok){ toastPl(body.error || 'Suppression impossible.'); render(); return true; }
        const c = body.counts || {};
        toastPl(`${who} : compte et historique effacés (${c.declarations || 0} déclaration${(c.declarations || 0) > 1 ? 's' : ''}, ${c.operations || 0} étape${(c.operations || 0) > 1 ? 's' : ''} machine${c.suivi ? `, ${c.suivi} ancien Suivi` : ''}).`);
        if(P.selUser === d.purge) P.selUser = null;
        await loadAll(); render();
      }catch(e){ toastPl('Erreur réseau : réessayez.'); render(); }
      return true;
    }
    if(d.delu){
      P.delPanel = null;
      const who = uname(d.delu);
      const { data: { session } } = await sb.auth.getSession();
      try{
        const res = await fetch('/api/delete-collaborator', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` }, body: JSON.stringify({ userId: d.delu }) });
        const body = await res.json().catch(() => ({}));
        if(!res.ok){ toastPl(body.error || 'Suppression impossible.'); render(); return true; }
        toastPl(body.archived ? `${who} : accès supprimé. Son historique (${body.records} enregistrement${body.records > 1 ? 's' : ''}) est conservé ; la fiche est rangée dans « Comptes désactivés ».` : `${who} : compte supprimé.`);
        if(P.selUser === d.delu) P.selUser = null;
        await loadRefs(); await loadGuards(); render();
      }catch(e){ toastPl('Erreur réseau : réessayez.'); render(); }
      return true;
    }
    if(d.a === 'addAct'){
      const name = document.getElementById('npName').value.trim(), metier = document.getElementById('npMetier').value;
      const std = parseNum(document.getElementById('npStd').value), machine = document.getElementById('npMachine').checked;
      if(!name){ toastPl('Indiquez le nom de l\'activité.'); return true; }
      if(Number.isNaN(std)){ toastPl('Standard invalide (ex : 0,25).'); return true; }
      const sort = Math.max(0, ...P.acts.filter(a => a.metier_id === metier).map(a => a.sort || 0)) + 1;
      const { data, error } = await sb.from('activites').insert({ metier_id: metier, name, requires_machine: machine, sort }).select().single();
      if(error){ toastPl('Erreur : ' + (error.code === '23505' ? 'cette activité existe déjà pour ce métier.' : dbError(error))); return true; }
      await saveParam(sb.from('standards').insert({ activite_id: data.id, hours_per_unit: std, valid_from: P.today }), `Activité « ${name} » ajoutée.`);
      return true;
    }
    if(d.a === 'addAccount'){
      const name = document.getElementById('ncName').value.trim(), password = document.getElementById('ncPass').value;
      let login = document.getElementById('ncEmail').value.trim().toLowerCase();
      if(!login) login = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
      if(!login){ toastPl('Indiquez un nom ou un identifiant.'); return true; }
      if(!/^[a-z0-9._@-]+$/.test(login)){ toastPl('Identifiant : lettres, chiffres, point ou tiret seulement.'); return true; }
      const email = login.includes('@') ? login : login + '@eole-reco.vercel.app';
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toastPl('E-mail invalide.'); return true; }
      if(password.length < 8){ toastPl('Le mot de passe doit avoir au moins 8 caractères.'); return true; }
      const { data: { session } } = await sb.auth.getSession();
      if(!session){ toastPl('Session expirée : reconnectez-vous.'); return true; }
      try{
        const res = await fetch('/api/create-technician', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ name, email, password }) });
        const body = await res.json().catch(() => ({}));
        if(!res.ok){ toastPl(body.error || 'Erreur lors de la création du compte.'); return true; }
        await loadRefs(); render();
        toastPl(email.endsWith('@eole-reco.vercel.app') ? `Compte créé. Identifiant de connexion : ${email.replace('@eole-reco.vercel.app', '')}` : `Compte créé pour ${body.email || email}. Choisissez maintenant son métier et son format.`);
      }catch(err){ console.error(err); toastPl('Erreur réseau : réessayez.'); }
      return true;
    }
    if(d.a === 'addMetier'){
      const label = document.getElementById('nmt').value.trim(); if(!label) return true;
      const id = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || ('M' + Date.now());
      const sort = Math.max(0, ...P.metiers.map(m => m.sort || 0)) + 1;
      await saveParam(sb.from('metiers').insert({ id, label, sort }), `Métier « ${label} » ajouté. Ajoutez maintenant ses activités.`);
      return true;
    }
    if(d.addl){
      const label = document.getElementById('nl-' + d.addl).value.trim(); if(!label) return true;
      const table = d.addl === 'hp' ? 'hors_production' : 'motifs_abandon', list = d.addl === 'hp' ? P.hp : P.motifs;
      await saveParam(sb.from(table).insert({ label, sort: Math.max(0, ...list.map(x => x.sort || 0)) + 1 }), `« ${label} » ajouté.`);
      return true;
    }
    if(d.a === 'addModel'){
      const model = document.getElementById('nmD').value.trim().toUpperCase(), famille = document.getElementById('nmF').value.trim().toUpperCase() || null;
      const brand = document.getElementById('nmB').value.trim();
      if(!model || !brand){ toastPl('Indiquez au moins la désignation et la marque.'); return true; }
      await saveParam(sb.from('printer_models').insert({ brand, model, famille }), `Modèle « ${model} » ajouté.`);
      return true;
    }
    if(d.delmodel){
      if(P.confirmDel !== d.delmodel){ P.confirmDel = d.delmodel; render(); return true; }
      P.confirmDel = null;
      const { error } = await sb.from('printer_models').delete().eq('id', d.delmodel);
      if(error) toastPl(error.code === '23503' ? 'Ce modèle est déjà utilisé sur une machine : il ne peut pas être supprimé.' : 'Erreur : ' + dbError(error));
      else toastPl('Modèle supprimé.');
      await loadRefs(); render();
      return true;
    }
    return false;
  }

  /* ---------- exports Excel (CSV ; séparateur « ; » et virgule décimale) ---------- */
  const num = v => (v === null || v === undefined || isNaN(v)) ? '' : String(r2(Number(v))).replace('.', ',');
  function exportCsv(kind){
    const W = periodMondays(), team = teamUsers(), ids = team.map(u => u.user_id);
    const tag = P.period === 'd' ? P.day : P.period === 'w' ? 'S' + isoWeek(P.week) : `${W.from}_${W.to}`;
    let rows;
    if(kind === 'detail'){
      rows = [['Date', 'Collaborateur', 'Métier', 'Format', 'Activité / motif', 'Quantité', 'Temps déclaré (h)', 'Standard appliqué (h/qté)', 'Temps théorique (h)', 'N° de série', 'Modèle', 'Statut étape', 'Commentaire', 'Annulée']];
      P.decls.filter(d => ids.includes(d.user_id) && inW(d.work_date, W)).forEach(d => {
        const u = userById(d.user_id), o = d.operation_id && P.ops.find(x => x.id === d.operation_id);
        rows.push([d.work_date, uname(d.user_id), metierLabel(u.metier_id), (formatOf(u) || {}).label || '',
          d.activite_id ? aname(d.activite_id) : (P.hp.find(h => h.id === d.hors_production_id) || {}).label || '',
          d.operation_id ? '' : d.quantity, num(d.hours), num(d.std_value), d.operation_id || d.std_value === null ? '' : num(d.quantity * d.std_value),
          o ? o.serial || '' : '', o ? (modelById(o.model_id) || {}).model || '' : '', o ? STATUS[o.status][1] : '', d.note || '', d.cancelled ? 'oui' : '']);
      });
    } else if(kind === 'collab'){
      rows = [['Collaborateur', 'Métier', 'Format', 'Intérim', 'Productif attendu (h)', 'Déclaré productif (h)', 'Hors production (h)', 'Théorique (h)', 'Réalisé avec standard (h)', 'Écart (h)', 'Efficience (%)', 'Quantité']];
      team.forEach(u => { const x = stats([u.user_id], W); rows.push([uname(u.user_id), metierLabel(u.metier_id), (formatOf(u) || {}).label || '', u.interim ? 'oui' : '', num(expected(u, W)), num(x.decl), num(x.hp), num(x.theo), num(x.real), num(x.ecart), x.eff === null ? '' : Math.round(x.eff * 100), x.qte]); });
    } else if(kind === 'activite'){
      rows = [['Activité', 'Métier', 'Opérations', 'Quantité', 'Théorique (h)', 'Réalisé (h)', 'Écart (h)', 'Efficience (%)']];
      P.acts.forEach(a => { const x = stats(ids, W, id => id === a.id); if(x.ops) rows.push([a.name, metierLabel(a.metier_id), x.ops, x.qte, num(x.theo), num(x.real), num(x.ecart), x.eff === null ? '' : Math.round(x.eff * 100)]); });
    } else {
      rows = [['N° de série', 'Modèle', 'Marque', 'Étape', 'Collaborateur', 'Début', 'Fin', 'Statut', 'Temps cumulé (h)', 'Attendu (h)', 'Motif', 'Commentaire']];
      P.ops.filter(o => ids.includes(o.user_id) && (OPEN.includes(o.status) || inW(o.finished_on, W) || inW(o.started_on, W))).forEach(o => {
        const m = modelById(o.model_id) || {};
        rows.push([o.serial || '', m.model || '', m.brand || '', aname(o.activite_id), uname(o.user_id), o.started_on, o.finished_on || '', STATUS[o.status][1], num(o.total_hours), num(o.std_value), (P.motifs.find(x => x.id === o.motif_id) || {}).label || '', o.close_comment || '']);
      });
    }
    const csv = '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `atelier-${kind}-${tag}.csv`);
  }

  /* ---------- clôture d'une opération ---------- */
  async function confirmClose(){
    const c = P.closing;
    const motif = P.motifs.find(m => m.id === c.motif);
    if(!motif){ c.err = 'Choisissez un motif.'; render(); return; }
    if(motif.requires_comment && !c.comment.trim()){ c.err = `Pour « ${motif.label} », le commentaire est obligatoire.`; render(); return; }
    c.busy = true; render();
    const { error } = await sb.from('operations').update({ status: c.mode, motif_id: c.motif, close_comment: c.comment.trim() || null }).eq('id', c.id);
    if(error){ c.busy = false; c.err = dbError(error); render(); return; }
    P.closing = null;
    await loadAll(); render();
    toastPl(c.mode === 'abandon' ? 'Opération clôturée : abandonnée. Le temps reste compté.' : 'Opération annulée et archivée.');
  }
  let tEl = null, tT = null;
  function toastPl(msg){
    if(!tEl){ tEl = document.createElement('div'); tEl.className = 'sx-toast'; tEl.setAttribute('role', 'status'); document.body.appendChild(tEl); }
    tEl.textContent = msg; tEl.hidden = false; clearTimeout(tT); tT = setTimeout(() => { tEl.hidden = true; }, 4500);
  }

  /* ---------- événements ---------- */
  root.addEventListener('click', async e => {
    const sum = e.target.closest('details[data-acc] > summary'); // retenu dès le clic (le « toggle » arrive un peu après)
    if(sum){ const det = sum.parentElement; P.acc[det.dataset.acc] = !det.open; return; }
    const row = e.target.closest('[data-open]');
    if(row){ P.selUser = row.dataset.open; P.view = 'collab'; render(); return; }
    const b = e.target.closest('button'); if(!b || b.disabled) return;
    const d = b.dataset;
    if(d.a === 'collabBack'){ P.selUser = null; P.brandSel = null; render(); return; }
    if(d.val){ const { error } = await sb.rpc('validate_week', { p_user: d.uid, p_monday: d.val }); if(error){ toastPl('Validation impossible : ' + dbError(error)); return; }
      const vs = await sb.from('validations_semaine').select('*').eq('user_id', d.uid).eq('week_monday', d.val).maybeSingle();
      P.vals = (P.vals || []).filter(v => !(v.user_id === d.uid && v.week_monday === d.val)).concat(vs.data ? [vs.data] : []); toastPl(`Semaine ${isoWeek(d.val)} validée et verrouillée.`); render(); return; }
    if(d.unval){ if(P.confirmUnval !== d.unval){ P.confirmUnval = d.unval; render(); return; } P.confirmUnval = null;
      const { error } = await sb.rpc('unvalidate_week', { p_user: d.uid, p_monday: d.unval }); if(error){ toastPl('Réouverture impossible : ' + dbError(error)); return; }
      P.vals = (P.vals || []).map(v => v.user_id === d.uid && v.week_monday === d.unval ? Object.assign({}, v, { validated_at: null, validated_by: null }) : v); toastPl(`Semaine ${isoWeek(d.unval)} rouverte.`); render(); return; }
    if(d.fx){ b.disabled = true; try{ await Fiche.xlsx(await Fiche.load(d.uid, d.fx)); }catch(err){ toastPl('Fiche impossible : ' + err.message); } b.disabled = false; return; }
    if(d.fp){ Fiche.print(d.fp, d.uid); return; }
    if(d.ibok){ const li = b.closest('li'); if(li){ li.style.transition = 'opacity .2s'; li.style.opacity = '0'; } await markSeen(d.ibok, d.iblabel, true); render(); toastPl('Rangé dans « Traités ».'); return; }
    if(d.ibundo){ await markSeen(d.ibundo, '', false); render(); return; }
    if(d.brand !== undefined){ P.brandSel = P.brandSel === d.brand ? null : d.brand; render(); return; }
    if(d.view){ P.view = d.view; P.closing = null; render(); }
    else if(d.period) setPeriod(() => { P.period = d.period; if(d.period === 'd' && !P.day) P.day = P.today;
      if(d.period === 'custom' && !P.from){ P.to = P.today; P.from = addDays(P.today, -90); } });
    else if(d.dayp !== undefined) setPeriod(() => { const n = +d.dayp; P.day = n === 0 ? P.today : addDays(P.day, n); if(P.day > P.today) P.day = P.today; });
    else if(d.week !== undefined) setPeriod(() => { P.week = addDays(P.week, 7 * +d.week); if(P.week > mondayOf(P.today)) P.week = mondayOf(P.today); });
    else if(d.opsf){ P.opsF = d.opsf; P.closing = null; render(); }
    else if(d.close){ P.closing = { id: d.close, mode: d.mode, motif: d.mode === 'annulee' ? ((P.motifs.find(m => /erreur/i.test(m.label)) || {}).id || '') : '', comment: '', err: '', busy: false }; render(); }
    else if(d.a === 'closeCancel'){ P.closing = null; render(); }
    else if(d.a === 'closeOk') confirmClose();
    else if(d.export) exportCsv(d.export);
    else if(d.mq){ P.mq = d.mq; P.mres = null; P.view = 'machines'; if(window.markPilotageTab) window.markPilotageTab('machines'); render(); }
    else await onParamClick(d);
  });
  root.addEventListener('toggle', e => { const el = e.target; if(el.dataset && el.dataset.acc) P.acc[el.dataset.acc] = el.open; }, true);
  root.addEventListener('keydown', e => {
    const row = e.target.closest && e.target.closest('[data-open]');
    if(row && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); P.selUser = row.dataset.open; P.view = 'collab'; render(); }
  });
  root.addEventListener('input', e => {
    const t = e.target;
    if(t.id === 'plComment' && P.closing) P.closing.comment = t.value;
    else if(t.id === 'plPmq'){ P.pmq = t.value; const q = t.value.trim().toUpperCase().replace(/[\s.\-]/g, ''); document.getElementById('plModels').innerHTML = modelsTable(q ? P.models.filter(m => (m.model + (m.famille || '') + m.brand).toUpperCase().replace(/[\s.\-]/g, '').includes(q)) : P.models); }
    else if(t.id === 'plMq'){ P.mq = t.value; searchMachines(); }
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if(t.dataset.filt !== undefined){ P.filt[t.dataset.filt] = t.value; render(); }
    else if(t.id === 'plDay'){ if(t.value && t.value <= P.today) setPeriod(() => { P.day = t.value; }); }
    else if(t.id === 'plFrom' || t.id === 'plTo'){
      const v = t.value; if(!v || v > P.today) return;
      setPeriod(() => { if(t.id === 'plFrom') P.from = v; else P.to = v; if(P.from > P.to){ const x = P.from; P.from = P.to; P.to = x; } });
    }
    else if(t.id === 'plUser'){ P.selUser = t.value; render(); }
    else if(t.id === 'plMotif' && P.closing){ P.closing.motif = t.value; P.closing.err = ''; render(); }
    else if(t.closest('.pl-ptable') || t.dataset.rule !== undefined) onParamChange(t);
  });

  /* ---------- connexion ---------- */
  sb.auth.onAuthStateChange((_event, session) => {
    if(!session){
      Object.assign(P, { me: null, allowed: null, ready: false }); if(window.setResponsable) window.setResponsable(false); root.innerHTML = '';
      if(P.channel){ sb.removeChannel(P.channel); P.channel = null; }
      return;
    }
    setTimeout(async () => {
      if(session.user.id !== P.me){ Object.assign(P, { me: session.user.id, allowed: null, ready: false }); }
      await checkAccess();
    }, 0);
  });
})();
