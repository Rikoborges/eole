/* =========================================================================
   ReproBench — onglet « Semaine » : Ma fiche + Mes résultats
   (cahier des charges de l'atelier, partie 3)

   • Ma fiche : la fiche Excel de la semaine, remplie toute seule à partir des
     déclarations (activité × jour, temps et quantités, objectif, reste à
     déclarer), semaines précédentes avec ‹ ›.
   • Mes résultats : attendu / déclaré / hors production / théorique / écart /
     efficience, points de maîtrise par activité (au moins 5 opérations,
     tendance), efficience des 8 dernières semaines.

   Règles de calcul (cahier des charges § 9 et § 13) :
     théorique = quantité × standard recopié au moment de la déclaration ;
     étapes avec matricule : seules les opérations FINALISÉES comptent, avec
     leur temps cumulé sur tous les jours, dans la semaine de finalisation ;
     efficience = théorique ÷ temps réalisé (activités qui ont un standard).
   Dépend de script.js (sb, escapeHtml, getMyUserId).
   ========================================================================= */
(function(){
  'use strict';

  const root = document.getElementById('semaine-root');
  if(!root) return;

  const TZ = 'Europe/Paris';
  const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const weekdayIdx = s => (new Date(s + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const mondayOf = s => addDays(s, -weekdayIdx(s));
  const fmtDate = (s, o) => new Date(s + 'T12:00:00Z').toLocaleDateString('fr-FR', Object.assign({ timeZone: 'UTC' }, o));
  function isoWeek(s){
    const d = new Date(s + 'T12:00:00Z'); const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }
  const weekLabel = m => `S${isoWeek(m)} · ${fmtDate(m, { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(m, 4), { day: 'numeric', month: 'short' })}`;

  const r2 = v => Math.round(v * 100) / 100;
  const h2 = v => (v === null || v === undefined || isNaN(v)) ? '—' : r2(Number(v)).toFixed(2).replace('.', ',');
  const hm = v => { const m = Math.round(Math.abs(v) * 60); return `${v < 0 ? '−' : ''}${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  const sgn = v => (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + h2(Math.abs(v));
  const pct = v => (v === null || v === undefined || isNaN(v)) ? '—' : Math.round(v * 100) + ' %';
  const effCls = v => v === null || v === undefined ? 'dim' : v >= 0.97 ? 'ok' : v >= 0.9 ? 'mid' : 'bad';
  const esc = s => escapeHtml(s);
  const DAYS = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.'];

  const S = {
    userId: null, ready: false, loading: false, error: null,
    profile: null, format: null, metierLabel: '', acts: [], hp: [], rules: {}, isResp: false,
    tab: 'fiche', week: null, period: 'w', today: null,
    decls: [], ops: [], openOps: [], loadedFrom: null
  };
  const actById = id => S.acts.find(a => a.id === id);
  const objDay = (dateStr) => { const i = weekdayIdx(dateStr); return i < 5 && S.format ? Number(S.format.day_hours[i]) : 0; };

  function dbError(error){
    const msg = (error && (error.message || error.details)) || 'erreur inconnue';
    if(/relation .* does not exist|Could not find the table|PGRST205/i.test(msg)) return 'La base n\'est pas encore installée (supabase/atelier-schema.sql).';
    return msg;
  }

  /* ---------- chargement ---------- */
  async function loadRefs(){
    const uid = S.userId;
    const [prof, acts, hp, rules, formats, metiers, resp] = await Promise.all([
      sb.from('collaborateurs').select('*').eq('user_id', uid).maybeSingle(),
      sb.from('activites').select('id, metier_id, name, requires_machine, sort, active').order('sort'),
      sb.from('hors_production').select('id, label, sort').order('sort'),
      sb.from('regles_saisie').select('key, value'),
      sb.from('formats_horaires').select('*'),
      sb.from('metiers').select('*'),
      sb.rpc('is_responsable')
    ]);
    const bad = [prof, acts, hp, rules, formats, metiers].find(r => r.error);
    if(bad){ S.error = dbError(bad.error); return false; }
    S.error = null;
    S.profile = prof.data;
    S.hp = hp.data || [];
    S.rules = Object.fromEntries((rules.data || []).map(r => [r.key, r.value]));
    S.isResp = !resp.error && !!resp.data;
    if(S.profile){
      S.acts = (acts.data || []).filter(a => a.metier_id === S.profile.metier_id);
      S.format = (formats.data || []).find(f => f.id === S.profile.format_id) || null;
      const m = (metiers.data || []).find(x => x.id === S.profile.metier_id);
      S.metierLabel = m ? m.label : '';
    }
    return true;
  }

  // On charge toujours 8 semaines (pour les tendances) jusqu'à la semaine affichée.
  async function loadData(){
    const uid = S.userId;
    const lastMon = S.week, from = addDays(lastMon, -7 * 7), to = addDays(lastMon, 6);
    const [decls, ops, open] = await Promise.all([
      sb.from('declarations').select('id, work_date, activite_id, hors_production_id, operation_id, quantity, hours, std_value')
        .eq('user_id', uid).eq('cancelled', false).gte('work_date', from).lte('work_date', to).order('work_date').limit(5000),
      sb.from('operations_avec_temps').select('id, activite_id, serial, status, started_on, finished_on, std_value, total_hours, last_work_date')
        .eq('user_id', uid).eq('status', 'final').gte('finished_on', from).lte('finished_on', to).limit(2000),
      sb.from('operations_avec_temps').select('id, activite_id, serial, status, started_on, std_value, total_hours')
        .eq('user_id', uid).in('status', ['encours', 'pause'])
    ]);
    const bad = [decls, ops, open].find(r => r.error);
    if(bad){ S.error = dbError(bad.error); return; }
    S.decls = decls.data || []; S.ops = ops.data || []; S.openOps = open.data || []; S.loadedFrom = from;
  }

  async function initSemaine(force){
    const uid = await getMyUserId();
    if(!uid) return;
    if(uid !== S.userId) Object.assign(S, { userId: uid, ready: false, week: null, tab: 'fiche' });
    if(S.loading) return;
    S.today = todayStr();
    if(!S.week) S.week = mondayOf(S.today);
    if(S.ready && !force){ render(); return; }
    S.loading = true;
    if(!S.ready) root.innerHTML = '<p class="loading">Chargement…</p>';
    try{
      const ok = await loadRefs();
      if(ok && S.profile && S.profile.metier_id && S.format) await loadData();
      S.ready = true;
    }catch(e){ console.error('Erreur Semaine:', e); S.error = 'Erreur inattendue : ' + e.message; }
    finally{ S.loading = false; }
    render();
  }
  window.initSemaine = initSemaine;

  /* ---------- calculs ---------- */
  const inWeeks = (d, mondays) => mondays.includes(mondayOf(d));
  function stats(mondays, actFilter){
    const P = actFilter || (() => true);
    let decl = 0, hp = 0, theo = 0, real = 0, qte = 0, ops = 0;
    S.decls.forEach(d => {
      if(!inWeeks(d.work_date, mondays)) return;
      if(d.hors_production_id){ if(!actFilter) hp += Number(d.hours); return; }
      if(!P(d.activite_id)) return;
      decl += Number(d.hours);
      if(d.operation_id) return;                       // compté via l'opération finalisée
      qte += d.quantity; ops++;
      if(d.std_value !== null){ theo += d.quantity * Number(d.std_value); real += Number(d.hours); }
    });
    S.ops.forEach(o => {
      if(!o.finished_on || !inWeeks(o.finished_on, mondays) || !P(o.activite_id)) return;
      qte += 1; ops++;
      if(o.std_value !== null){ theo += Number(o.std_value); real += Number(o.total_hours); }
    });
    return { decl: r2(decl), hp: r2(hp), theo: r2(theo), real: r2(real), qte, ops, eff: real ? theo / real : null, ecart: r2(real - theo) };
  }
  function expected(mondays){
    let s = 0;
    mondays.forEach(m => { for(let i = 0; i < 5; i++){ const d = addDays(m, i); if(d <= S.today) s += objDay(d); } });
    return s;
  }
  const periodMondays = () => {
    const n = S.period === 'w' ? 1 : S.period === '4w' ? 4 : 8;
    return Array.from({ length: n }, (_, i) => addDays(S.week, -7 * (n - 1 - i)));
  };

  /* ---------- rendu ---------- */
  function render(){
    if(S.error){ root.innerHTML = `<div class="sx-card sx-notice"><h2 class="sx-h2">Indisponible</h2><p>${esc(S.error)}</p></div>`; return; }
    if(!S.profile || !S.profile.metier_id || !S.format){
      root.innerHTML = `<div class="sx-card sx-notice"><h2 class="sx-h2">Votre fiche n'est pas encore complète</h2><p>Le responsable des ateliers doit indiquer votre métier et votre format horaire.</p></div>`;
      return;
    }
    const showRes = S.rules.resultats_visibles !== false || S.isResp;
    if(!showRes) S.tab = 'fiche';
    root.innerHTML = `
      <div class="sx-row sx-between">
        <div class="sx-seg" role="group" aria-label="Affichage">
          <button type="button" data-tab="fiche" aria-pressed="${S.tab === 'fiche'}">Ma fiche</button>
          ${showRes ? `<button type="button" data-tab="res" aria-pressed="${S.tab === 'res'}">Mes résultats</button>` : ''}
        </div>
        ${S.tab === 'res' ? `<div class="sx-seg" role="group" aria-label="Période">
          ${[['w', 'Semaine'], ['4w', '4 sem.'], ['8w', '8 sem.']].map(([k, l]) => `<button type="button" data-period="${k}" aria-pressed="${S.period === k}">${l}</button>`).join('')}</div>` : ''}
      </div>
      <div class="week-nav sw-nav">
        <button type="button" data-week="-1" aria-label="Semaine précédente">‹</button>
        <span class="week-nav-label">${S.tab === 'res' && S.period !== 'w' ? `S${isoWeek(periodMondays()[0])} → ${weekLabel(S.week)}` : weekLabel(S.week)}</span>
        <button type="button" data-week="1" aria-label="Semaine suivante" ${S.week >= mondayOf(S.today) ? 'disabled' : ''}>›</button>
      </div>
      ${S.week !== mondayOf(S.today) ? '<p class="sx-small"><button type="button" class="sx-btn sx-sm" data-week="0">Revenir à cette semaine</button></p>' : ''}
      ${S.tab === 'fiche' ? ficheHTML() : resultsHTML()}`;
  }

  function ficheHTML(){
    const m = S.week, days = Array.from({ length: 5 }, (_, i) => addDays(m, i));
    const W = [m], s = stats(W), exp = expected(W);
    const decls = S.decls.filter(d => mondayOf(d.work_date) === m);
    const cell = (pred, day) => {
      if(day > S.today) return '';
      const x = decls.filter(d => d.work_date === day && pred(d)); if(!x.length) return '';
      const t = x.reduce((a, d) => a + Number(d.hours), 0), q = x.reduce((a, d) => a + (d.operation_id ? 0 : d.quantity), 0);
      const pending = x.some(d => d.operation_id && S.openOps.some(o => o.id === d.operation_id));
      return `${h2(t)}${q ? ` <span class="sw-q">(${q})</span>` : ''}${pending ? ' <span class="sx-mid" title="Étape à poursuivre">⏸</span>' : ''}`;
    };
    const rowsA = S.acts.filter(a => a.active || decls.some(d => d.activite_id === a.id)).map(a => {
      const st = stats(W, id => id === a.id);
      const open = S.openOps.filter(o => o.activite_id === a.id && decls.some(d => d.operation_id === o.id)).length;
      return `<tr><td>${esc(a.name)}</td>${days.map(d => `<td class="n">${cell(x => x.activite_id === a.id, d)}</td>`).join('')}
        <td class="n">${st.qte || ''}${open ? ` <span class="sx-mid">+${open} ⏸</span>` : ''}</td><td class="n">${st.decl ? h2(st.decl) : ''}</td>
        <td class="n">${st.real ? h2(st.theo) : ''}</td><td class="n">${st.real ? `<span class="sx-pill sx-${effCls(st.eff)}">${sgn(st.ecart)}</span>` : ''}</td></tr>`;
    }).join('');
    const hpUsed = S.hp.filter(h => decls.some(d => d.hors_production_id === h.id));
    const rowsH = hpUsed.map(h => `<tr class="sw-hp"><td>${esc(h.label)}</td>${days.map(d => `<td class="n">${cell(x => x.hors_production_id === h.id, d)}</td>`).join('')}
      <td></td><td class="n">${h2(decls.filter(d => d.hors_production_id === h.id).reduce((a, d) => a + Number(d.hours), 0))}</td><td></td><td></td></tr>`).join('');
    const tot = days.map(d => r2(decls.filter(x => x.work_date === d).reduce((a, x) => a + Number(x.hours), 0)));
    return `
      <div class="sw-kpis">
        ${kpi('Déclaré', hm(s.decl + s.hp), '', `sur ${hm(exp)} attendues${m === mondayOf(S.today) ? ' à ce jour' : ''}`)}
        ${kpi('Théorique produit', h2(s.theo) + ' h', '', 'unités finalisées × standard')}
        ${kpi('Efficience', pct(s.eff), effCls(s.eff), 'théorique ÷ réalisé')}
        ${kpi('Hors production', hm(s.hp), '', hpUsed.map(h => h.label).join(', ') || '—')}
      </div>
      <div class="sx-card sx-tscroll"><table class="sx-table sw-table">
        <thead><tr><th>Activité</th>${days.map((d, i) => `<th class="n">${DAYS[i]} ${fmtDate(d, { day: 'numeric' })}</th>`).join('')}<th class="n">Qté</th><th class="n">Déclaré</th><th class="n">Théorique</th><th class="n">Écart</th></tr></thead>
        <tbody>${rowsA}${rowsH}</tbody>
        <tfoot>
          <tr><td>Objectif</td>${days.map(d => `<td class="n">${h2(objDay(d))}</td>`).join('')}<td colspan="4"></td></tr>
          <tr><td>Reste à déclarer</td>${days.map((d, i) => {
            const o = objDay(d), r = r2(o - tot[i]);
            if(d > S.today) return `<td class="n sx-small">${o ? h2(o) : ''}</td>`;
            if(!o && !tot[i]) return '<td></td>';
            const cls = Math.abs(r) < 0.01 ? 'sx-ok' : r < 0 ? 'sx-bad' : d === S.today ? 'sx-mid' : 'sx-bad';
            return `<td class="n ${cls}">${Math.abs(r) < 0.01 ? '✓' : r < 0 ? '+' + h2(-r) : h2(r)}</td>`;
          }).join('')}<td colspan="4"></td></tr>
        </tfoot></table></div>
      <p class="sx-small">Heures (quantité). ⏸ = étape à poursuivre : le temps compte le jour où il est fait, la machine est comptée le jour où elle est finalisée.</p>`;
  }

  const kpi = (l, v, k, h) => `<div class="sw-kpi"><span class="sw-lbl">${l}</span><span class="sw-val ${k ? 'sx-' + k : ''}">${v}</span><span class="sx-small">${esc(h)}</span></div>`;

  function resultsHTML(){
    const W = periodMondays(), s = stats(W), exp = expected(W);
    const all8 = Array.from({ length: 8 }, (_, i) => addDays(S.week, -7 * (7 - i)));
    const mW = S.period === 'w' ? all8 : W;
    const half = Math.ceil(mW.length / 2), early = mW.slice(0, half), late = mW.slice(half);
    const rows = S.acts.map(a => {
      const P = id => id === a.id, x = stats(mW, P), e1 = stats(early, P), e2 = stats(late, P);
      let trend = '→';
      if(mW.length > 1 && e1.ops >= 3 && e2.ops >= 3 && e1.eff && e2.eff){ const d = e2.eff - e1.eff; trend = d > 0.03 ? '↗' : d < -0.03 ? '↘' : '→'; }
      const hasStd = x.real > 0 || x.theo > 0;
      const status = !hasStd && x.ops ? ['dim', 'Sans standard'] : x.ops < 5 ? ['dim', 'Données insuffisantes']
                   : x.eff >= 0.97 ? ['ok', 'Maîtrisé'] : x.eff < 0.9 ? ['bad', 'À accompagner'] : ['mid', 'Correct'];
      const open = S.openOps.filter(o => o.activite_id === a.id).length;
      return { a, x, trend, status, open };
    }).filter(r => r.x.ops > 0 || r.open);
    const pts = all8.map(m => stats([m]).eff);
    return `
      <div class="sw-kpis">
        ${kpi('Productif attendu', hm(exp), '', `${S.format.label} · ${W.length > 1 ? W.length + ' semaines' : 'S' + isoWeek(W[0])}`)}
        ${kpi('Productif déclaré', hm(s.decl), '', `${pct(exp ? s.decl / exp : null)} de l'attendu`)}
        ${kpi('Hors production', hm(s.hp), '', 'jamais compté comme contre-performance')}
        ${kpi('Théorique', h2(s.theo) + ' h', '', `${s.qte} unités finalisées`)}
        ${kpi('Écart', sgn(s.ecart) + ' h', s.ecart > 0.004 ? 'mid' : 'ok', 'réalisé − théorique')}
        ${kpi('Efficience', pct(s.eff), effCls(s.eff), 'théorique ÷ réalisé')}
      </div>
      <div class="sw-grid">
        <div class="sx-card sx-tscroll"><h2 class="sx-h2 sx-mb">Points de maîtrise et axes de progression</h2>
          ${rows.length ? `<table class="sx-table"><thead><tr><th>Activité</th><th class="n">Opér.</th><th class="n">Qté</th><th class="n">Théorique</th><th class="n">Réalisé</th><th class="n">Efficience</th><th class="n">Tendance</th><th>Statut</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${esc(r.a.name)}${r.open ? ` <span class="sx-pill sx-mid">${r.open} en cours</span>` : ''}</td><td class="n">${r.x.ops}</td><td class="n">${r.x.qte}</td>
            <td class="n">${r.x.real ? h2(r.x.theo) : '—'}</td><td class="n">${h2(r.x.real || r.x.decl)}</td><td class="n sx-${effCls(r.x.eff)}">${pct(r.x.eff)}</td>
            <td class="n sw-trend">${r.trend}</td><td><span class="sx-pill sx-${r.status[0]}">${r.status[1]}</span></td></tr>`).join('')}</tbody></table>`
          : '<p class="sx-small">Pas encore de déclaration sur la période.</p>'}
          <p class="sx-small sx-mt">Calculé sur ${S.period === 'w' ? 'les 8 dernières semaines' : 'la période'}. Il faut au moins 5 opérations pour classer une activité : une opération atypique ne suffit pas. Tendance = 2ᵉ moitié de la période comparée à la 1ʳᵉ.</p>
        </div>
        <div class="sx-card"><h2 class="sx-h2 sx-mb">Efficience par semaine</h2>${trendSVG(pts, all8)}</div>
      </div>`;
  }

  function trendSVG(pts, mondays){
    const W = 380, H = 170, L = 40, B = 26, T = 16, lo = 0.75, hi = 1.15, n = pts.length;
    const X = i => L + i * (W - L - 14) / (n - 1), Y = v => T + (hi - Math.max(lo, Math.min(hi, v))) / (hi - lo) * (H - T - B);
    const P = pts.map((v, i) => v === null ? null : [X(i), Y(v), v]).filter(Boolean);
    let s = `<svg class="sw-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Efficience des 8 dernières semaines">`;
    [0.8, 0.9, 1, 1.1].forEach(v => { s += `<line class="${v === 1 ? 'tg' : 'gl'}" x1="${L}" x2="${W - 14}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v * 100)}%</text>`; });
    if(P.length){
      const path = P.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      if(P.length > 1) s += `<path class="ar" d="${path} L ${P[P.length - 1][0]} ${H - B} L ${P[0][0]} ${H - B} Z"/><path class="ln" d="${path}"/>`;
      const l = P[P.length - 1];
      s += `<circle class="pt" cx="${l[0]}" cy="${l[1]}" r="4.5"/><text class="lbl" x="${l[0] - 8}" y="${l[1] - 9}" text-anchor="end">${pct(l[2])}</text>`;
    } else s += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">Pas encore de données</text>`;
    mondays.forEach((m, i) => { if(i % 2 === 1 || i === n - 1) s += `<text x="${X(i)}" y="${H - 7}" text-anchor="middle">S${isoWeek(m)}</text>`; });
    return s + '</svg>';
  }

  /* ---------- événements ---------- */
  root.addEventListener('click', async e => {
    const b = e.target.closest('button'); if(!b || b.disabled) return;
    const d = b.dataset;
    if(d.tab){ S.tab = d.tab; render(); }
    else if(d.period){ S.period = d.period; render(); }
    else if(d.week !== undefined){
      const step = +d.week, cur = mondayOf(S.today);
      S.week = step === 0 ? cur : addDays(S.week, 7 * step);
      if(S.week > cur) S.week = cur;
      root.querySelector('.sw-nav .week-nav-label').textContent = 'Chargement…';
      await loadData(); render();
    }
  });

  sb.auth.onAuthStateChange((_event, session) => {
    if(!session){ Object.assign(S, { userId: null, ready: false }); root.innerHTML = ''; }
  });
})();
