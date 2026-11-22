/* =========================================================================
   ReproBench — fiche hebdomadaire (remplace la fiche Excel 37H / 39H / AIDE)

   Fiche.load(userId, lundi)  → les données de la semaine d'une personne
   Fiche.xlsx(fiche)          → vrai fichier Excel (.xlsx) mis en forme
   Fiche.print(lundi, userId) → version imprimable / « Enregistrer en PDF »
   Fiche.statusHTML(v)        → pastille Non signée / Signée / Validée

   Utilisée par « Ma semaine » (le collaborateur) et par le mode Admin.
   Dépend de script.js : sb, escapeHtml, downloadBlob.
   ========================================================================= */
(function(){
  'use strict';
  const TZ = 'Europe/Paris';
  const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmt = (s, o) => new Date(s + 'T12:00:00Z').toLocaleDateString('fr-FR', Object.assign({ timeZone: 'UTC' }, o));
  const dt = v => new Date(v).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
  const r2 = v => Math.round(v * 100) / 100;
  const h2 = v => (v === null || v === undefined || isNaN(v)) ? '' : r2(Number(v)).toFixed(2).replace('.', ',');
  function isoWeek(s){
    const d = new Date(s + 'T12:00:00Z'); const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3); const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }
  const esc = s => escapeHtml(s);

  async function load(userId, monday){
    const sunday = addDays(monday, 6);
    const [prof, acts, hp, formats, metiers, decls, ops, val] = await Promise.all([
      sb.from('collaborateurs').select('*').eq('user_id', userId).maybeSingle(),
      sb.from('activites').select('id, metier_id, name, requires_machine, sort, active').order('sort'),
      sb.from('hors_production').select('id, label, sort').order('sort'),
      sb.from('formats_horaires').select('*'),
      sb.from('metiers').select('*'),
      sb.from('declarations').select('work_date, activite_id, hors_production_id, operation_id, quantity, hours, std_value')
        .eq('user_id', userId).eq('cancelled', false).gte('work_date', monday).lte('work_date', sunday).order('work_date').limit(2000),
      sb.from('operations_avec_temps').select('id, activite_id, std_value, total_hours, finished_on')
        .eq('user_id', userId).eq('status', 'final').gte('finished_on', monday).lte('finished_on', sunday).limit(1000),
      sb.from('validations_semaine').select('*').eq('user_id', userId).eq('week_monday', monday).maybeSingle()
    ]);
    const bad = [prof, acts, hp, formats, metiers, decls, ops].find(r => r.error);
    if(bad) throw new Error(bad.error.message);
    const p = prof.data || {}, format = (formats.data || []).find(f => f.id === p.format_id) || null;
    const metier = (metiers.data || []).find(m => m.id === p.metier_id);
    const v = val.error ? null : val.data;
    let validator = '';
    if(v && v.validated_by){
      const r = await sb.from('collaborateurs').select('display_name').eq('user_id', v.validated_by).maybeSingle();
      validator = (r.data && r.data.display_name) || 'le responsable';
    }
    const D = decls.data || [], O = ops.data || [];
    const weekend = [5, 6].filter(i => D.some(d => d.work_date === addDays(monday, i)));
    const dayIdx = [0, 1, 2, 3, 4, ...weekend];
    const days = dayIdx.map(i => ({ date: addDays(monday, i), label: DAYS[i], obj: i < 5 && format ? Number(format.day_hours[i]) || 0 : 0 }));

    const allActs = acts.data || [];
    const used = new Set(D.map(d => d.activite_id).filter(Boolean));
    const rows = allActs.filter(a => (a.metier_id === p.metier_id && a.active) || used.has(a.id)).map(a => {
      const mine = D.filter(d => d.activite_id === a.id);
      const perDay = days.map(dy => { const x = mine.filter(d => d.work_date === dy.date); return { h: r2(x.reduce((s, d) => s + Number(d.hours), 0)), q: x.reduce((s, d) => s + (d.operation_id ? 0 : d.quantity), 0) }; });
      const fin = O.filter(o => o.activite_id === a.id);
      const plain = mine.filter(d => !d.operation_id);
      const qte = plain.reduce((s, d) => s + d.quantity, 0) + fin.length;
      const theo = plain.filter(d => d.std_value !== null).reduce((s, d) => s + d.quantity * Number(d.std_value), 0) + fin.filter(o => o.std_value !== null).reduce((s, o) => s + Number(o.std_value), 0);
      const real = plain.filter(d => d.std_value !== null).reduce((s, d) => s + Number(d.hours), 0) + fin.filter(o => o.std_value !== null).reduce((s, o) => s + Number(o.total_hours), 0);
      return { name: a.name, perDay, hours: r2(mine.reduce((s, d) => s + Number(d.hours), 0)), qte, theo: r2(theo), real: r2(real) };
    });
    const hpRows = (hp.data || []).filter(h => D.some(d => d.hors_production_id === h.id)).map(h => {
      const mine = D.filter(d => d.hors_production_id === h.id);
      return { name: h.label, perDay: days.map(dy => ({ h: r2(mine.filter(d => d.work_date === dy.date).reduce((s, d) => s + Number(d.hours), 0)), q: 0 })), hours: r2(mine.reduce((s, d) => s + Number(d.hours), 0)) };
    });
    const dayTot = days.map(dy => r2(D.filter(d => d.work_date === dy.date).reduce((s, d) => s + Number(d.hours), 0)));
    const theo = r2(rows.reduce((s, r) => s + r.theo, 0)), real = r2(rows.reduce((s, r) => s + r.real, 0));
    return {
      userId, monday, sunday, week: isoWeek(monday), name: p.display_name || 'Sans nom', metier: metier ? metier.label : '',
      format: format ? format.label : '', interim: !!p.interim, days, rows, hpRows, dayTot,
      total: r2(dayTot.reduce((s, x) => s + x, 0)), objective: r2(days.reduce((s, d) => s + d.obj, 0)),
      prod: r2(rows.reduce((s, r) => s + r.hours, 0)), hp: r2(hpRows.reduce((s, r) => s + r.hours, 0)),
      theo, eff: real ? theo / real : null, validation: v, validator
    };
  }

  function statusText(v, validator){
    if(v && v.validated_at) return `Validée le ${dt(v.validated_at)}${validator ? ' par ' + validator : ''}`;
    if(v && v.signed_at) return `Signée par le collaborateur le ${dt(v.signed_at)} · à valider`;
    return 'Non signée';
  }
  function statusHTML(v){
    if(v && v.validated_at) return '<span class="sx-pill sx-ok">' + ico('lock', 14) + ' Validée</span>';
    if(v && v.signed_at) return '<span class="sx-pill sx-mid">' + ico('pen', 14) + ' Signée · à valider</span>';
    return '<span class="sx-pill sx-dim">Non signée</span>';
  }

  /* ---------- Excel (.xlsx) : ExcelJS chargé seulement au premier export ---------- */
  let excelLoading = null;
  function loadExcel(){
    if(window.ExcelJS) return Promise.resolve();
    if(excelLoading) return excelLoading;
    excelLoading = new Promise((ok, ko) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s.integrity = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';
      s.crossOrigin = 'anonymous';
      s.onload = () => ok(); s.onerror = () => { excelLoading = null; ko(new Error('Module Excel indisponible (réseau ?)')); };
      document.head.appendChild(s);
    });
    return excelLoading;
  }

  async function xlsx(f){
    await loadExcel();
    const wb = new window.ExcelJS.Workbook();
    wb.creator = 'ReproBench';
    const ws = wb.addWorksheet('S' + f.week, { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    const nD = f.days.length, lastCol = 1 + nD + 4;
    const DARK = 'FF161E27', GOLD = 'FFD4A017', GREY = 'FFEEF1F5', LINE = 'FFB8C0CC';
    const border = { top: { style: 'thin', color: { argb: LINE } }, left: { style: 'thin', color: { argb: LINE } }, bottom: { style: 'thin', color: { argb: LINE } }, right: { style: 'thin', color: { argb: LINE } } };
    ws.columns = [{ width: 42 }, ...f.days.map(() => ({ width: 12 })), { width: 8 }, { width: 11 }, { width: 11 }, { width: 10 }];

    ws.mergeCells(1, 1, 1, lastCol);
    Object.assign(ws.getCell(1, 1), { value: `FICHE D'ACTIVITÉ — SEMAINE ${f.week}` });
    ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
    ws.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    ws.getCell(1, 1).alignment = { vertical: 'middle' }; ws.getRow(1).height = 26;
    const info = [['Collaborateur', f.name + (f.interim ? ' (intérim)' : '')], ['Métier', f.metier], ['Format horaire', f.format],
                  ['Période', `du ${fmt(f.monday, { day: 'numeric', month: 'long', year: 'numeric' })} au ${fmt(f.sunday, { day: 'numeric', month: 'long', year: 'numeric' })}`]];
    info.forEach(([k, v], i) => { const r = ws.getRow(2 + i); r.getCell(1).value = k; r.getCell(1).font = { bold: true }; r.getCell(2).value = v; ws.mergeCells(2 + i, 2, 2 + i, lastCol); });

    const H = 7;
    const head = ['Activité', ...f.days.map(d => `${d.label} ${fmt(d.date, { day: 'numeric' })}`), 'Qté', 'Déclaré (h)', 'Théorique (h)', 'Écart (h)'];
    const hr = ws.getRow(H); hr.values = head; hr.height = 20;
    hr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.border = border; });
    hr.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

    let r = H + 1;
    const put = (vals, opts = {}) => {
      const row = ws.getRow(r++); row.values = vals;
      row.eachCell({ includeEmpty: true }, (c, col) => {
        if(col > lastCol) return;
        c.border = border;
        if(col > 1 && typeof c.value === 'number') c.numFmt = '0.00';
        if(opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
        if(opts.bold) c.font = { bold: true };
        if(col > 1) c.alignment = { horizontal: 'right' };
      });
      return row;
    };
    const cellVal = x => x.h ? x.h : null;
    f.rows.forEach(a => {
      const ecart = a.real ? r2(a.real - a.theo) : null;
      const row = put([a.name, ...a.perDay.map(cellVal), a.qte || null, a.hours || null, a.real ? a.theo : null, ecart]);
      a.perDay.forEach((x, i) => { if(x.q) row.getCell(2 + i).note = `Quantité : ${x.q}`; });
      const qCell = row.getCell(2 + nD); qCell.numFmt = '0';
      if(ecart !== null){ const c = row.getCell(lastCol); c.font = { bold: true, color: { argb: ecart > 0.004 ? 'FFC2410C' : 'FF15803D' } }; }
    });
    if(f.hpRows.length){
      put(['Hors production', ...f.days.map(() => null), null, null, null, null], { fill: GREY, bold: true });
      f.hpRows.forEach(h => put([h.name, ...h.perDay.map(cellVal), null, h.hours || null, null, null]));
    }
    put(['TOTAL DÉCLARÉ', ...f.dayTot, null, f.total, f.theo || null, null], { fill: GREY, bold: true });
    put(['Objectif du jour', ...f.days.map(d => d.obj), null, f.objective, null, null]);
    const er = put(['Écart / objectif', ...f.days.map((d, i) => d.date > today() ? null : r2(f.dayTot[i] - d.obj)), null, r2(f.total - f.objective), null, null], { bold: true });
    er.eachCell((c, col) => { if(col > 1 && typeof c.value === 'number' && Math.abs(c.value) > 0.004) c.font = { bold: true, color: { argb: c.value < 0 ? 'FFC2410C' : 'FF15803D' } }; });

    r++;
    const sum = [['Production déclarée (h)', f.prod], ['Hors production (h)', f.hp], ['Théorique produit (h)', f.theo],
                 ['Efficience (théorique ÷ réalisé)', f.eff === null ? '—' : Math.round(f.eff * 100) + ' %']];
    sum.forEach(([k, v]) => { const row = ws.getRow(r++); row.getCell(1).value = k; row.getCell(1).font = { bold: true }; row.getCell(2).value = v; if(typeof v === 'number') row.getCell(2).numFmt = '0.00'; });

    r++;
    const v = f.validation;
    const sig = [['Signature du collaborateur', v && v.signed_at ? `Signée dans ReproBench le ${dt(v.signed_at)}` : ''],
                 ['Visa du responsable', v && v.validated_at ? `Validée le ${dt(v.validated_at)}${f.validator ? ' par ' + f.validator : ''}` : '']];
    sig.forEach(([k, val]) => {
      const row = ws.getRow(r); row.getCell(1).value = k; row.getCell(1).font = { bold: true };
      ws.mergeCells(r, 2, r + 1, Math.min(lastCol, 2 + nD)); const c = row.getCell(2); c.value = val; c.border = border; c.alignment = { vertical: 'middle' };
      ws.getRow(r).height = 22; ws.getRow(r + 1).height = 22; r += 3;
    });
    ws.getCell(r, 1).value = 'Heures en décimal (1,50 = 1 h 30). Les quantités sont en commentaire de chaque case. Une machine est comptée le jour où elle est finalisée.';
    ws.getCell(r, 1).font = { italic: true, size: 9, color: { argb: 'FF5B6672' } };
    ws.getRow(H).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    ws.views = [{ state: 'frozen', ySplit: H, xSplit: 1 }];
    ws.getCell(1, 1).border = { bottom: { style: 'medium', color: { argb: GOLD } } };

    const buf = await wb.xlsx.writeBuffer();
    const safe = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `fiche-S${f.week}-${safe || 'collaborateur'}.xlsx`);
  }
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

  /* ---------- version imprimable (PDF via « Imprimer » du navigateur) ---------- */
  function printHTML(f){
    const v = f.validation, nD = f.days.length;
    const td = x => `<td class="n">${x.h ? h2(x.h) + (x.q ? `<small> (${x.q})</small>` : '') : ''}</td>`;
    const rows = f.rows.map(a => { const e = a.real ? r2(a.real - a.theo) : null;
      return `<tr><td>${esc(a.name)}</td>${a.perDay.map(td).join('')}<td class="n">${a.qte || ''}</td><td class="n">${h2(a.hours || null)}</td><td class="n">${a.real ? h2(a.theo) : ''}</td><td class="n ${e > 0.004 ? 'bad' : e !== null ? 'ok' : ''}">${e === null ? '' : (e > 0 ? '+' : '') + h2(e)}</td></tr>`; }).join('');
    const hpRows = f.hpRows.length ? `<tr class="sec"><td colspan="${nD + 5}">Hors production</td></tr>` + f.hpRows.map(h => `<tr><td>${esc(h.name)}</td>${h.perDay.map(td).join('')}<td></td><td class="n">${h2(h.hours)}</td><td></td><td></td></tr>`).join('') : '';
    const t = today();
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Fiche S${f.week} — ${esc(f.name)}</title><style>
      @page{ size: A4 landscape; margin: 12mm; }
      body{ font: 12px/1.4 Arial, Helvetica, sans-serif; color: #111827; margin: 0; }
      h1{ font-size: 18px; margin: 0 0 4px; } .sub{ color: #4B5563; margin: 0 0 12px; }
      .bar{ height: 4px; background: #D4A017; margin: 0 0 10px; }
      .info{ display: grid; grid-template-columns: repeat(4, auto); gap: 4px 24px; margin-bottom: 12px; } .info b{ display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #4B5563; }
      table{ width: 100%; border-collapse: collapse; } th, td{ border: 1px solid #B8C0CC; padding: 5px 6px; }
      th{ background: #161E27; color: #fff; font-weight: 600; text-align: center; } th:first-child{ text-align: left; }
      td.n{ text-align: right; font-variant-numeric: tabular-nums; } small{ color: #4B5563; }
      tr.sec td{ background: #EEF1F5; font-weight: 700; } tfoot td{ font-weight: 700; background: #EEF1F5; }
      .bad{ color: #C2410C; font-weight: 700; } .ok{ color: #15803D; }
      .sum{ display: flex; gap: 28px; margin: 12px 0; } .sum b{ display: block; font-size: 16px; }
      .sig{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 18px; } .sig div{ border: 1px solid #B8C0CC; min-height: 64px; padding: 8px; }
      .note{ color: #4B5563; font-size: 10px; margin-top: 10px; }
      .actions{ margin: 0 0 16px; padding: 12px 14px; background: #F3F4F6; border: 1px solid #D9DEE5; border-radius: 8px; } .actions .fix{ margin: 8px 0 0; color: #374151; font-size: 12.5px; } @media print{ .actions{ display: none; } } @media screen{ body{ padding: 20px 24px; max-width: 1200px; margin: 0 auto; } }
      button{ font: inherit; padding: 8px 14px; border: 1px solid #111827; background: #fff; border-radius: 6px; cursor: pointer; margin-right: 8px; }
    </style></head><body>
      <div class="actions"><div><button type="button" data-p="print">${ico('printer')} Imprimer / Enregistrer en PDF</button><button type="button" data-p="refresh">↻ Actualiser</button><button type="button" data-p="close">Fermer</button></div>
        <p class="fix">${v && v.validated_at
          ? 'Semaine validée et verrouillée : pour corriger, le responsable doit d\'abord la rouvrir (Admin › Collaborateurs › Fiches de la semaine › Rouvrir).'
          : 'Une erreur ? Laissez cette fenêtre ouverte, corrigez dans ReproBench (Saisir › liste du jour › Modifier, ou Annuler puis déclarer à nouveau), puis cliquez sur « Actualiser ».'}</p></div>
      <h1>Fiche d'activité — semaine ${f.week}</h1><div class="bar"></div>
      <div class="info"><div><b>Collaborateur</b>${esc(f.name)}${f.interim ? ' (intérim)' : ''}</div><div><b>Métier</b>${esc(f.metier)}</div><div><b>Format</b>${esc(f.format)}</div>
        <div><b>Période</b>du ${fmt(f.monday, { day: 'numeric', month: 'long' })} au ${fmt(f.sunday, { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
      <table><thead><tr><th>Activité</th>${f.days.map(d => `<th>${d.label.slice(0, 3)}. ${fmt(d.date, { day: 'numeric' })}</th>`).join('')}<th>Qté</th><th>Déclaré</th><th>Théorique</th><th>Écart</th></tr></thead>
      <tbody>${rows}${hpRows}</tbody>
      <tfoot><tr><td>Total déclaré</td>${f.dayTot.map(x => `<td class="n">${h2(x) || '0,00'}</td>`).join('')}<td></td><td class="n">${h2(f.total)}</td><td class="n">${h2(f.theo || null)}</td><td></td></tr>
        <tr><td>Objectif</td>${f.days.map(d => `<td class="n">${h2(d.obj)}</td>`).join('')}<td></td><td class="n">${h2(f.objective)}</td><td></td><td></td></tr>
        <tr><td>Écart / objectif</td>${f.days.map((d, i) => { if(d.date > t) return '<td></td>'; const e = r2(f.dayTot[i] - d.obj); return `<td class="n ${Math.abs(e) < 0.005 ? 'ok' : e < 0 ? 'bad' : ''}">${Math.abs(e) < 0.005 ? ico('check', 14) : (e > 0 ? '+' : '') + h2(e)}</td>`; }).join('')}<td></td><td class="n">${h2(r2(f.total - f.objective))}</td><td></td><td></td></tr></tfoot></table>
      <div class="sum"><div>Production<b>${h2(f.prod)} h</b></div><div>Hors production<b>${h2(f.hp)} h</b></div><div>Théorique produit<b>${h2(f.theo)} h</b></div><div>Efficience<b>${f.eff === null ? '—' : Math.round(f.eff * 100) + ' %'}</b></div></div>
      <div class="sig"><div><b>Signature du collaborateur</b><br>${v && v.signed_at ? 'Signée dans ReproBench le ' + dt(v.signed_at) : ''}</div>
        <div><b>Visa du responsable</b><br>${v && v.validated_at ? `Validée le ${dt(v.validated_at)}${f.validator ? ' par ' + esc(f.validator) : ''}` : ''}</div></div>
      <p class="note">Heures en décimal (1,50 = 1 h 30) ; quantité entre parenthèses. Une machine est comptée le jour où elle est finalisée. Document généré par ReproBench le ${dt(new Date().toISOString())}.</p>
    </body></html>`;
  }
  // Aperçu de la fiche (pas d'impression automatique : on vérifie d'abord).
  // La fenêtre est ouverte tout de suite (au clic) pour ne pas être bloquée, puis remplie.
  async function print(monday, userId){
    const w = window.open('', '_blank');
    if(!w){ alert('Autorisez l\'ouverture de fenêtres pour voir la fiche.'); return; }
    w.document.write('<p style="font:14px Arial;padding:20px">Préparation de la fiche…</p>');
    async function fill(){
      try{
        const f = await load(userId, monday);
        w.document.open(); w.document.write(printHTML(f)); w.document.close();
        // pas de script dans la fenêtre (sécurité du site) : les boutons sont branchés d'ici
        const on = (k, fn) => { const el = w.document.querySelector(`[data-p="${k}"]`); if(el) el.addEventListener('click', fn); };
        on('print', () => w.print());
        on('close', () => w.close());
        on('refresh', () => { w.document.body.style.opacity = '.5'; fill(); });
      }catch(e){ w.document.body.innerHTML = '<p style="font:14px Arial;padding:20px">Fiche indisponible : ' + esc(e.message) + '</p>'; }
    }
    await fill();
  }

  window.Fiche = { load, xlsx, print, statusHTML, statusText, isoWeek };
})();
