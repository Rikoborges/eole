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
    view: 'atelier', period: 'w', week: null, today: null,
    filt: { metier: '', format: '', marque: '' }, opsF: 'open', selUser: null, mq: '',
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

  async function loadAll(){
    const from = addDays(mondayOf(P.today), -7 * 7);
    await loadRefs();
    const [decls, opsRecent, opsOpen] = await Promise.all([
      fetchAll(() => sb.from('declarations').select('id, user_id, work_date, activite_id, hors_production_id, operation_id, quantity, hours, std_value, note, cancelled, created_at')
        .gte('work_date', from).order('work_date')),
      fetchAll(() => sb.from('operations_avec_temps').select('*').gte('started_on', addDays(from, -60)).order('started_on')),
      fetchAll(() => sb.from('operations_avec_temps').select('*').in('status', OPEN))
    ]);
    P.decls = decls;
    P.firstDecl = {};
    decls.forEach(d => { if(!d.cancelled && (!P.firstDecl[d.user_id] || d.work_date < P.firstDecl[d.user_id])) P.firstDecl[d.user_id] = d.work_date; });
    const ops = new Map(); [...opsRecent, ...opsOpen].forEach(o => ops.set(o.id, o)); P.ops = [...ops.values()];
    const pr = await sb.from('presence').select('user_id, day, first_seen, last_seen').eq('day', P.today);
    P.presence = pr.error ? [] : pr.data;
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
  window.setPilotageView = v => { P.view = v; P.closing = null; };

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
  const periodMondays = () => {
    const n = P.period === 'w' ? 1 : P.period === '4w' ? 4 : 8;
    const last = P.period === 'w' ? P.week : mondayOf(P.today);
    return Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i)));
  };
  const last8 = () => Array.from({ length: 8 }, (_, i) => addDays(mondayOf(P.today), -7 * (7 - i)));
  const inW = (d, W) => d && W.includes(mondayOf(d));
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
    let s = 0; W.forEach(m => { for(let i = 0; i < 5; i++){ const d = addDays(m, i); if(d <= P.today && d >= first) s += objDay(u, d); } }); return s;
  }
  function alertsFor(u, W){
    const out = [], mine = P.decls.filter(d => d.user_id === u.user_id && live(d));
    const first = mine.length ? mine.reduce((a, d) => d.work_date < a ? d.work_date : a, mine[0].work_date) : null;
    if(!first) out.push({ k: 'mid', t: 'Aucune déclaration', m: 'depuis 8 semaines', d: null, u });
    W.forEach(m => { for(let i = 0; i < 5; i++){
      const d = addDays(m, i); if(d > P.today || !first || d < first) continue;
      const tot = r2(mine.filter(x => x.work_date === d).reduce((a, x) => a + Number(x.hours), 0)), obj = objDay(u, d);
      if(d < P.today && tot < obj - 0.01) out.push({ k: 'mid', t: 'Temps incomplet', m: `${h2(tot)} h déclarées sur ${h2(obj)} h`, d, u });
      if(tot > obj + 0.01) out.push({ k: 'bad', t: 'Temps supérieur à l\'objectif', m: `${h2(tot)} h pour ${h2(obj)} h`, d, u });
    }});
    P.ops.filter(o => o.user_id === u.user_id && o.status !== 'annulee' && !o.imported && inW(o.started_on, W) && (!o.serial || !o.model_id))
      .forEach(o => out.push({ k: 'bad', t: !o.serial ? 'Matricule non renseigné' : 'Modèle non renseigné', m: aname(o.activite_id), d: o.started_on, u }));
    if(W.includes(mondayOf(P.today))) P.ops.filter(o => o.user_id === u.user_id && OPEN.includes(o.status)).forEach(o => {
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
      <div class="sx-seg" role="group" aria-label="Période">${[['w', 'Semaine'], ['4w', '4 sem.'], ['8w', '8 sem.']].map(([k, l]) => `<button type="button" data-period="${k}" aria-pressed="${P.period === k}">${l}</button>`).join('')}</div>
      ${P.period === 'w' ? `<span class="week-nav sx-daynav"><button type="button" data-week="-1" aria-label="Semaine précédente" ${P.week <= last8()[0] ? 'disabled' : ''}>‹</button><span class="week-nav-label">${weekLabel(P.week)}</span><button type="button" data-week="1" aria-label="Semaine suivante" ${P.week >= mondayOf(P.today) ? 'disabled' : ''}>›</button></span>`
        : `<span class="sx-small sx-mono">S${isoWeek(W[0])} → S${isoWeek(W[W.length - 1])}</span>`}</div>`;
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
    root.innerHTML = `${({ atelier: vAtelier, operations: vOperations, collab: vCollab, activites: vActivites, machines: vMachines, params: vParams })[P.view]()}`;
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
          <td class="n sx-${effCls(x.eff)}">${pct(x.eff)}</td><td class="n">${no || ''}</td><td class="n">${na ? `<span class="sx-pill sx-mid">${na}</span>` : '<span class="sx-ok">✓</span>'}</td></tr>`; }).join('')}</tbody></table>
        <p class="sx-small sx-mt">Touchez une ligne pour le détail du collaborateur.</p>` : '<p class="sx-small">Aucun collaborateur avec métier et format renseignés.</p>'}
      </div>
      <div class="pl-grid">
        <div class="sx-card"><h2 class="sx-h2 sx-mb">Où passe le temps</h2>
          ${list.length ? `<div class="pl-bars">${list.map(([k, v]) => `<div class="pl-bar"><span>${esc(k)}</span><span class="sx-mono sx-small">${h2(v)} h · ${pct(v / tot)}</span><div class="pl-track"><span class="${k === 'Hors production' ? 'hp' : ''}" style="width:${v / list[0][1] * 100}%"></span></div></div>`).join('')}</div>` : '<p class="sx-small">Aucune déclaration sur la période.</p>'}
        </div>
        <div class="pl-side">
          <div class="sx-card"><h2 class="sx-h2">Alertes (${al.length})</h2><div class="pl-scroll">${al.length ? al.map(x => `<div class="sx-alert sx-alert-${x.k}"><b>${esc(x.t)}</b><span>${esc(x.u.display_name || '')}${x.d ? ' · ' + esc(shortDate(x.d)) : ''} · ${esc(x.m)}</span></div>`).join('') : '<p class="sx-small sx-mt">Aucune anomalie sur la période.</p>'}</div></div>
          <div class="sx-card"><h2 class="sx-h2">Activité en direct</h2>${P.feed.length ? `<ul class="pl-feed">${P.feed.map(f => `<li><time>${f.t}</time><span>${f.h}</span></li>`).join('')}</ul>` : '<p class="sx-small sx-mt">Les nouvelles déclarations apparaissent ici dès qu\'elles sont faites.</p>'}</div>
          <div class="sx-card"><h2 class="sx-h2 sx-mb">Exports Excel</h2><div class="sx-row">
            ${[['detail', 'Détail des saisies'], ['collab', 'Par collaborateur'], ['activite', 'Par activité'], ['operations', 'Opérations']].map(([k, l]) => `<button type="button" class="sx-btn sx-sm" data-export="${k}">⬇ ${l}</button>`).join('')}</div>
            <p class="sx-small sx-mt">Période et filtres affichés ci-dessus.</p></div>
        </div>
      </div>`;
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
        const row = `<tr class="${o.status === 'annulee' ? 'pl-struck' : ''}"><td class="sx-mono">${o.serial ? esc(o.serial) : o.imported ? '<span class="sx-small">ancien Suivi</span>' : '<span class="sx-bad">à compléter</span>'}</td><td class="sx-small">${esc((modelById(o.model_id) || {}).model || '—')}</td>
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

  function vCollab(){
    const team = P.users.filter(u => u.metier_id && u.format_id);
    if(!team.length) return '<div class="sx-card"><p class="sx-small">Aucun collaborateur avec métier et format renseignés.</p></div>';
    if(!P.selUser || !team.some(u => u.user_id === P.selUser)) P.selUser = team[0].user_id;
    const u = userById(P.selUser), W = periodMondays(), s = stats([u.user_id], W), exp = expected(u, W);
    const all8 = last8(), mW = P.period === 'w' ? all8 : W, half = Math.ceil(mW.length / 2), early = mW.slice(0, half), late = mW.slice(half);
    const rows = P.acts.filter(a => a.metier_id === u.metier_id).map(a => {
      const A = id => id === a.id, x = stats([u.user_id], mW, A), e1 = stats([u.user_id], early, A), e2 = stats([u.user_id], late, A);
      let trend = '→'; if(mW.length > 1 && e1.ops >= 3 && e2.ops >= 3 && e1.eff && e2.eff){ const d = e2.eff - e1.eff; trend = d > 0.03 ? '↗' : d < -0.03 ? '↘' : '→'; }
      const status = !(x.real || x.theo) && x.ops ? ['dim', 'Sans standard'] : x.ops < 5 ? ['dim', 'Données insuffisantes'] : x.eff >= 0.97 ? ['ok', 'Maîtrisé'] : x.eff < 0.9 ? ['bad', 'À accompagner'] : ['mid', 'Correct'];
      const open = P.ops.filter(o => o.user_id === u.user_id && o.activite_id === a.id && OPEN.includes(o.status)).length;
      return { a, x, trend, status, open };
    }).filter(r => r.x.ops || r.open);
    const open = P.ops.filter(o => o.user_id === u.user_id && OPEN.includes(o.status));
    const recent = P.decls.filter(d => d.user_id === u.user_id && inW(d.work_date, W)).slice(-15).reverse();
    const pres = P.presence.find(p => p.user_id === u.user_id);
    const t = v => new Date(v).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    return `<div class="sx-row sx-between"><label class="pl-filters">Collaborateur <select id="plUser">${team.map(x => `<option value="${x.user_id}" ${x.user_id === u.user_id ? 'selected' : ''}>${esc(x.display_name || 'Sans nom')} · ${esc(metierLabel(x.metier_id))} · ${esc((formatOf(x) || {}).label || '')}</option>`).join('')}</select></label>${periodCtl()}</div>
      <div class="sw-kpis">
        ${kpi('Productif attendu', hm(exp), '', esc((formatOf(u) || {}).label || ''))}
        ${kpi('Productif déclaré', hm(s.decl), '', pct(exp ? s.decl / exp : null) + ' de l\'attendu')}
        ${kpi('Hors production', hm(s.hp), '', 'non compté en contre-performance')}
        ${kpi('Théorique', h2(s.theo) + ' h', '', `${s.qte} unités finalisées`)}
        ${kpi('Écart', sgn(s.ecart) + ' h', s.ecart > 0.004 ? 'mid' : 'ok', 'réalisé − théorique')}
        ${kpi('Efficience', pct(s.eff), effCls(s.eff), 'théorique ÷ réalisé')}
      </div>
      <div class="sx-card sx-tscroll"><h2 class="sx-h2 sx-mb">Points de maîtrise et axes de progression</h2>
        ${rows.length ? `<table class="sx-table"><thead><tr><th>Activité</th><th class="n">Opér.</th><th class="n">Qté</th><th class="n">Théorique</th><th class="n">Réalisé</th><th class="n">Efficience</th><th class="n">Tendance</th><th>Statut</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.a.name)}${r.open ? ` <span class="sx-pill sx-mid">${r.open} en cours</span>` : ''}</td><td class="n">${r.x.ops}</td><td class="n">${r.x.qte}</td><td class="n">${r.x.real ? h2(r.x.theo) : '—'}</td><td class="n">${h2(r.x.real || r.x.decl)}</td><td class="n sx-${effCls(r.x.eff)}">${pct(r.x.eff)}</td><td class="n sw-trend">${r.trend}</td><td><span class="sx-pill sx-${r.status[0]}">${r.status[1]}</span></td></tr>`).join('')}</tbody></table>` : '<p class="sx-small">Pas encore de déclaration.</p>'}
        <p class="sx-small sx-mt">Au moins 5 opérations pour classer une activité. Calculé sur ${P.period === 'w' ? 'les 8 dernières semaines' : 'la période'}.</p></div>
      <div class="pl-grid">
        <div class="sx-card"><h2 class="sx-h2 sx-mb">Efficience par semaine</h2>${trendSVG(all8.map(m => stats([u.user_id], [m]).eff), all8)}</div>
        <div class="pl-side">
          <div class="sx-card"><h2 class="sx-h2 sx-mb">Étapes en cours (${open.length})</h2>${open.map(o => `<div class="sx-opsum"><b>${esc(aname(o.activite_id))}</b><span class="sx-mono sx-small">${esc(o.serial || 'sans matricule')} · ${esc((modelById(o.model_id) || {}).model || '')}</span><span class="sx-small">${pill(o.status)} depuis le ${esc(shortDate(o.started_on))} · ${h2(o.total_hours)} h / ${h2(o.std_value)} h</span></div>`).join('') || '<p class="sx-small">Aucune.</p>'}</div>
          <div class="sx-card"><h2 class="sx-h2">Alertes</h2>${alertsFor(u, W).map(x => `<div class="sx-alert sx-alert-${x.k}"><b>${esc(x.t)}</b><span>${x.d ? esc(shortDate(x.d)) + ' · ' : ''}${esc(x.m)}</span></div>`).join('') || '<p class="sx-small sx-mt">Aucune.</p>'}</div>
          <details class="guide"><summary>Heures de connexion (masqué) <span class="chev">›</span></summary><p class="sx-small">Visible uniquement par le responsable, jamais par le collaborateur.</p>
            <p class="sx-mono">${pres ? `Aujourd'hui : première activité ${t(pres.first_seen)} · dernière ${t(pres.last_seen)}` : 'Pas de connexion enregistrée aujourd\'hui.'}</p></details>
        </div>
      </div>
      <div class="sx-card"><h2 class="sx-h2 sx-mb">Dernières déclarations de la période</h2><ul class="sx-entries">${recent.map(d => {
        const o = d.operation_id && P.ops.find(x => x.id === d.operation_id);
        const name = d.activite_id ? aname(d.activite_id) : ((P.hp.find(h => h.id === d.hors_production_id) || {}).label || '');
        return `<li class="sx-entry${d.cancelled ? ' sx-cancel' : ''}"><span class="sx-small">${esc(shortDate(d.work_date))}</span><div class="sx-row sx-between"><span><b>${esc(name)}</b>${d.quantity ? ` <small>× ${d.quantity}</small>` : ''}</span><span class="sx-time-v">${hm(Number(d.hours))}</span></div>${o ? `<span class="sx-meta sx-mono">${esc(o.serial || 'sans matricule')} · ${pill(o.status)}</span>` : ''}${d.note ? `<span class="sx-meta">« ${esc(d.note)} »</span>` : ''}</li>`; }).join('') || '<li class="sx-small">Aucune.</li>'}</ul></div>`;
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
    const q = P.mq.trim().toUpperCase();
    const hits = q.length >= 3 ? P.ops.filter(o => o.serial && o.serial.includes(q)) : [];
    const groups = {}; hits.forEach(o => (groups[o.serial] = groups[o.serial] || []).push(o));
    const recent = recentMachines();
    return `<p class="sx-small">Traçabilité : tapez un N° de série (3 caractères minimum). Historique chargé : 8 dernières semaines et toutes les étapes en cours.</p>
      <div class="sx-msearch pl-msearch"><span class="sx-loupe" aria-hidden="true">🔍</span><input type="text" id="plMq" class="sx-mono" value="${esc(P.mq)}" placeholder="7019606410YBX" aria-label="Rechercher un N° de série" autocomplete="off"></div>
      <div id="plMachines">${machinesResults(q, groups, recent)}</div>`;
  }
  function recentMachines(){
    return [...new Map(P.ops.filter(o => o.serial).sort((a, b) => String(b.last_work_date || b.started_on).localeCompare(String(a.last_work_date || a.started_on))).map(o => [o.serial, o])).values()].slice(0, 10);
  }
  function machinesResults(q, groups, recent){
    if(q.length < 3) return `<div class="sx-card"><h2 class="sx-h2 sx-mb">Dernières machines traitées</h2><div class="sx-chips">${recent.map(o => `<button type="button" class="sx-chip sx-mono" data-mq="${esc(o.serial)}">${esc(o.serial)} <small>${esc((modelById(o.model_id) || {}).model || '')}</small></button>`).join('') || '<span class="sx-small">Aucune machine pour l\'instant.</span>'}</div></div>`;
    const entries = Object.entries(groups);
    if(!entries.length) return '<p class="sx-small">Aucune machine trouvée.</p>';
    return entries.slice(0, 8).map(([serial, ops]) => `<div class="sx-card"><div class="sx-row sx-between"><h2 class="sx-h2">${esc(serial)}</h2><span class="sx-pill sx-dim">${esc((modelById(ops[0].model_id) || {}).model || 'modèle ?')}</span></div>
      ${ops.sort((a, b) => a.started_on.localeCompare(b.started_on)).map(o => {
        const segs = P.decls.filter(d => d.operation_id === o.id);
        return `<div class="pl-machine-op"><div class="sx-row sx-between"><b>${esc(aname(o.activite_id))}</b>${pill(o.status)}</div>
          <div class="sx-tscroll"><table class="sx-table"><thead><tr><th>Date</th><th>Collaborateur</th><th class="n">Temps</th><th>Note</th></tr></thead><tbody>${segs.map(d => `<tr class="${d.cancelled ? 'pl-struck' : ''}"><td>${esc(shortDate(d.work_date))}</td><td>${esc(uname(d.user_id))}</td><td class="n">${h2(d.hours)} h</td><td class="sx-small">${esc(d.note || '')}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="2"><b>Total étape</b></td><td class="n"><b>${h2(o.total_hours)} h</b></td><td class="sx-small">attendu ${h2(o.std_value)} h${o.status === 'final' && o.std_value !== null ? ` · écart ${sgn(o.total_hours - o.std_value)} h` : ''}</td></tr></tfoot></table></div></div>`; }).join('')}</div>`).join('');
  }

  function trendSVG(pts, mondays){
    const W = 380, H = 170, L = 40, B = 26, T = 16, lo = 0.75, hi = 1.15, n = pts.length;
    const X = i => L + i * (W - L - 14) / (n - 1), Y = v => T + (hi - Math.max(lo, Math.min(hi, v))) / (hi - lo) * (H - T - B);
    const Pp = pts.map((v, i) => v === null ? null : [X(i), Y(v), v]).filter(Boolean);
    let s = `<svg class="sw-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Efficience des 8 dernières semaines">`;
    [0.8, 0.9, 1, 1.1].forEach(v => { s += `<line class="${v === 1 ? 'tg' : 'gl'}" x1="${L}" x2="${W - 14}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v * 100)}%</text>`; });
    if(Pp.length){
      const path = Pp.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      if(Pp.length > 1) s += `<path class="ar" d="${path} L ${Pp[Pp.length - 1][0]} ${H - B} L ${Pp[0][0]} ${H - B} Z"/><path class="ln" d="${path}"/>`;
      const l = Pp[Pp.length - 1]; s += `<circle class="pt" cx="${l[0]}" cy="${l[1]}" r="4.5"/><text class="lbl" x="${l[0] - 8}" y="${l[1] - 9}" text-anchor="end">${pct(l[2])}</text>`;
    } else s += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">Pas encore de données</text>`;
    mondays.forEach((m, i) => { if(i % 2 === 1 || i === n - 1) s += `<text x="${X(i)}" y="${H - 7}" text-anchor="middle">S${isoWeek(m)}</text>`; });
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
  function pCollab(){
    return `<div class="sx-tscroll"><table class="sx-table pl-ptable"><thead><tr><th>Nom affiché</th><th>Métier</th><th>Format</th><th>Intérim</th><th>Droits</th><th>Actif</th></tr></thead><tbody>
      ${P.users.map(u => `<tr><td><input type="text" data-cu="${u.user_id}" data-cf="display_name" value="${esc(u.display_name || '')}" aria-label="Nom affiché"></td>
        <td><select data-cu="${u.user_id}" data-cf="metier_id" aria-label="Métier de ${esc(u.display_name || '')}"><option value="">— à choisir —</option>${P.metiers.filter(m => m.active || m.id === u.metier_id).map(m => `<option value="${m.id}" ${u.metier_id === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></td>
        <td><select data-cu="${u.user_id}" data-cf="format_id" aria-label="Format de ${esc(u.display_name || '')}"><option value="">— à choisir —</option>${P.formats.map(f => `<option value="${f.id}" ${u.format_id === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></td>
        <td>${cb(`data-cu="${u.user_id}" data-cf="interim"`, u.interim, 'Intérim')}</td>
        <td><select data-cu="${u.user_id}" data-cf="role" aria-label="Droits"><option value="collaborateur" ${u.role === 'collaborateur' ? 'selected' : ''}>Collaborateur</option><option value="responsable" ${u.role === 'responsable' ? 'selected' : ''}>Admin</option></select></td>
        <td>${cb(`data-cu="${u.user_id}" data-cf="active"`, u.active, 'Actif')}</td></tr>`).join('')}</tbody></table></div>
      <p class="sx-small sx-mt">Un intérimaire reçoit en général le métier Aide technique ; vous pouvez le changer. « Admin » donne accès au mode Admin (Atelier, Opérations… Paramètres).</p>
      <h3 class="pl-h3">Créer un compte</h3>
      <div class="sx-row pl-addrow"><input type="text" id="ncName" placeholder="Nom (ex : Paul D.)" aria-label="Nom" autocomplete="off">
        <input type="text" id="ncEmail" placeholder="Identifiant (ex : paul.durand) ou e-mail" aria-label="Identifiant ou e-mail" autocomplete="off" autocapitalize="none">
        <input type="text" id="ncPass" placeholder="Mot de passe provisoire (8 caractères min.)" aria-label="Mot de passe provisoire" autocomplete="off">
        <button type="button" class="sx-btn sx-primary" data-a="addAccount">+ Créer le compte</button></div>
      <p class="sx-small sx-mt">Pas d'e-mail EOLE (intérim…) ? Laissez l'identifiant vide : il est créé à partir du nom (ex. « paul.durand »), et la personne se connecte avec cet identifiant, sans e-mail personnel. Communiquez-lui l'identifiant et le mot de passe. Sa fiche apparaît aussitôt : choisissez ensuite son métier et son format.</p>`;
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
    return `<div class="sx-row"><div class="sx-msearch pl-grow"><span class="sx-loupe" aria-hidden="true">🔍</span><input type="text" id="plPmq" class="sx-mono" value="${esc(P.pmq)}" placeholder="Rechercher parmi ${P.models.length} modèles" aria-label="Rechercher un modèle"></div>
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
    return `<label class="pl-filters">Correction par le collaborateur <select data-rule="correction">${[['day', 'Jusqu\'à la fin de la journée'], ['h24', 'Pendant 24 h'], ['week', 'Jusqu\'à la fin de la semaine'], ['none', 'Responsable uniquement']].map(([k, l]) => `<option value="${k}" ${corr === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
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
      const email = login.includes('@') ? login : login + '@eole-atelier.local';
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
        toastPl(email.endsWith('@eole-atelier.local') ? `Compte créé. Identifiant de connexion : ${email.replace('@eole-atelier.local', '')}` : `Compte créé pour ${body.email || email}. Choisissez maintenant son métier et son format.`);
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
    const tag = P.period === 'w' ? 'S' + isoWeek(P.week) : `S${isoWeek(W[0])}-S${isoWeek(W[W.length - 1])}`;
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
    const row = e.target.closest('[data-open]');
    if(row){ P.selUser = row.dataset.open; P.view = 'collab'; render(); return; }
    const b = e.target.closest('button'); if(!b || b.disabled) return;
    const d = b.dataset;
    if(d.view){ P.view = d.view; P.closing = null; render(); }
    else if(d.period){ P.period = d.period; render(); }
    else if(d.week !== undefined){ P.week = addDays(P.week, 7 * +d.week); if(P.week > mondayOf(P.today)) P.week = mondayOf(P.today); render(); }
    else if(d.opsf){ P.opsF = d.opsf; P.closing = null; render(); }
    else if(d.close){ P.closing = { id: d.close, mode: d.mode, motif: d.mode === 'annulee' ? ((P.motifs.find(m => /erreur/i.test(m.label)) || {}).id || '') : '', comment: '', err: '', busy: false }; render(); }
    else if(d.a === 'closeCancel'){ P.closing = null; render(); }
    else if(d.a === 'closeOk') confirmClose();
    else if(d.export) exportCsv(d.export);
    else if(d.mq){ P.mq = d.mq; render(); }
    else await onParamClick(d);
  });
  root.addEventListener('keydown', e => {
    const row = e.target.closest && e.target.closest('[data-open]');
    if(row && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); P.selUser = row.dataset.open; P.view = 'collab'; render(); }
  });
  root.addEventListener('input', e => {
    const t = e.target;
    if(t.id === 'plComment' && P.closing) P.closing.comment = t.value;
    else if(t.id === 'plPmq'){ P.pmq = t.value; const q = t.value.trim().toUpperCase().replace(/[\s.\-]/g, ''); document.getElementById('plModels').innerHTML = modelsTable(q ? P.models.filter(m => (m.model + (m.famille || '') + m.brand).toUpperCase().replace(/[\s.\-]/g, '').includes(q)) : P.models); }
    else if(t.id === 'plMq'){
      P.mq = t.value; const q = P.mq.trim().toUpperCase();
      const groups = {}; if(q.length >= 3) P.ops.filter(o => o.serial && o.serial.includes(q)).forEach(o => (groups[o.serial] = groups[o.serial] || []).push(o));
      document.getElementById('plMachines').innerHTML = machinesResults(q, groups, recentMachines());
    }
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if(t.dataset.filt !== undefined){ P.filt[t.dataset.filt] = t.value; render(); }
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
