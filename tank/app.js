// Forever BiS page. Reads the local server's API; no build step. The published copy (STATIC) reads the same API
// answers as JSON files written by the site export, and has no buttons that start work.
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const GROUPS = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'finger', 'trinket', 'main_hand', 'off_hand', 'ranged'];
const GROUP_LABEL = { head: 'Head', neck: 'Neck', shoulder: 'Shoulders', back: 'Back', chest: 'Chest', wrist: 'Wrists', hands: 'Hands', waist: 'Waist', legs: 'Legs', feet: 'Feet', finger: 'Rings', trinket: 'Trinkets', main_hand: 'Main hand', off_hand: 'Off hand', ranged: 'Ranged / relic' };
const ENCHANT_SLOTS_OF = { head: ['head'], shoulder: ['shoulder'], back: ['back'], chest: ['chest'], wrist: ['wrist'], hands: ['hands'], legs: ['legs'], feet: ['feet'], finger: ['finger1', 'finger2'], main_hand: ['main_hand'], off_hand: ['off_hand'], ranged: ['ranged'] };
const METRIC = { tps: 'TPS', dps: 'DPS', tmi: 'TMI', dtps: 'DTPS', score: 'Score', cod: 'Death %' };
const SHOW = 8;

const state = { config: null, server: null, popularity: null, spec: null, build: null, tab: null, results: {}, poll: null };

const STATIC = document.documentElement.dataset.static === '1';

async function api(path, opts) {
	if (STATIC) {
		if (opts?.method && opts.method !== 'GET') throw new Error('Read-only copy');
		path = path.replace(/^\/api\//, 'api/') + '.json';
	}
	const res = await fetch(path, opts);
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
	return body;
}

function fmtDate(iso) {
	if (!iso) return '—';
	const d = new Date(iso);
	return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const short = (h) => (h ? h.slice(0, 8) : '—');

// ---------- status bar and jobs ----------

function renderStatus() {
	const s = state.server;
	if (!s) return;
	const e = s.engine;
	const behind = e.behind == null ? '<span class="muted">not checked</span>' : e.behind === 0 ? '<span class="ok">up to date</span>' : `<span class="warn">${e.behind} commit${e.behind > 1 ? 's' : ''} behind</span>`;
	const busy = s.job?.status === 'running';
	const cur = s.results.filter((r) => r.spec === state.spec && r.build === state.build)[0];
	const stale = cur && cur.engineCommit !== e.pinned;
	const pop = s.popularity;
	if (STATIC) {
		$('#status').innerHTML = `
			<div class="chip"><b>Engine</b> <a href="https://github.com/wowsims/forever/commit/${e.pinned}" target="_blank" rel="noopener">${short(e.pinned)}</a></div>
			<div class="chip"><b>Sims</b> ${cur ? fmtDate(cur.generatedAt) : 'not run'}</div>
			<div class="chip"><b>Popularity</b> ${pop ? `${fmtDate(pop.generatedAt)} · ${Object.values(pop.counts).reduce((a, b) => a + b, 0)} ${state.config.site?.players ?? 'players'}` : '—'}</div>`;
		return;
	}
	$('#status').innerHTML = `
		<div class="chip" title="${esc(e.pinnedSubject)}"><b>Engine</b> ${short(e.pinned)} · ${fmtDate(e.pinnedDate)} · ${behind}
			<button id="btnCheck" ${busy ? 'disabled' : ''}>Check</button>
			${e.behind > 0 ? `<button id="btnUpdate" class="primary" ${busy ? 'disabled' : ''}>Update engine</button>` : ''}</div>
		<div class="chip"><b>Sims</b> ${cur ? fmtDate(cur.generatedAt) : 'never run'}${cur?.quick ? ' <span class="warn">(quick)</span>' : ''}${stale ? ' <span class="warn">older engine</span>' : ''}
			<button id="btnSims" class="primary" ${busy ? 'disabled' : ''}>Run sims</button></div>
		<div class="chip" title="Benchmarks items no earlier run considered against the saved BiS sets, without a rerun"><b>New items</b> ${newItemsText(s.newItems)}
			<button id="btnItems" ${busy || !s.results.length ? 'disabled' : ''}>Check</button></div>
		<div class="chip"><b>Popularity</b> ${pop ? `${fmtDate(pop.generatedAt)} · ${Object.values(pop.counts).reduce((a, b) => a + b, 0)} ${state.config.site?.players ?? 'players'}` : 'never scanned'}
			<button id="btnPop" ${busy || !s.blizzardConfigured ? 'disabled' : ''} title="${s.blizzardConfigured ? '' : 'Set Blizzard API credentials in .env'}">Refresh</button></div>`;
	$('#btnCheck').onclick = () => act(() => api('/api/engine/check', { method: 'POST' }));
	if ($('#btnUpdate')) $('#btnUpdate').onclick = () => confirm(`Update the engine to ${short(e.latest)} (${e.latestSubject})? This rebuilds and commits the new pin. Re-run the sims afterwards.`) && act(() => api('/api/engine/update', { method: 'POST' }));
	$('#btnSims').onclick = openSimsDialog;
	$('#btnItems').onclick = () => {
		const ids = prompt('Check the wowsims database for items no run has seen.\nOptionally add item ids from other sites (comma separated):', '');
		if (ids === null) return;
		act(() => api('/api/items/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }));
	};
	$('#btnPop').onclick = () => act(() => api('/api/popularity/refresh', { method: 'POST' }));
	renderJob();
}

function newItemsText(n) {
	if (!n) return 'never checked';
	const found = n.specs.reduce((a, s) => a + s.found.length, 0);
	const stale = n.specs.reduce((a, s) => a + (s.stale?.length ?? 0), 0);
	return `${fmtDate(n.checkedAt)} · ${found} new${stale ? ` · <span class="warn">${stale} BiS change${stale > 1 ? 's' : ''}</span>` : ''}`;
}

function openSimsDialog() {
	const spec = state.config.specs.find((x) => x.key === state.spec);
	const choice = prompt(
		`Run sims for:\n  1 = ${spec.label} (all builds, all tabs)\n  2 = this tab only (${state.tab})\n  3 = all three specs (slow)\n  q = quick pipeline check (this spec, low iterations)\n\nType 1, 2, 3 or q:`,
		'1',
	);
	if (!choice) return;
	const args = { 1: { spec: state.spec }, 2: { spec: state.spec, build: state.build, tab: state.tab }, 3: {}, q: { spec: state.spec, quick: true } }[choice.trim()];
	if (!args) return;
	act(() => api('/api/sims/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }));
}

async function act(fn) {
	try {
		await fn();
	} catch (e) {
		alert(e.message);
	}
	await refreshState();
}

function renderJob() {
	const j = state.server?.job;
	const el = $('#job');
	if (!j) return el.classList.add('hidden');
	el.classList.remove('hidden');
	const pr = j.progress;
	const pct = pr && pr.total ? Math.min(100, (100 * pr.done) / pr.total) : 0;
	const where = pr ? [pr.spec, pr.build, pr.tab].filter(Boolean).join(' / ') : '';
	el.innerHTML = `<b>${esc(j.kind)}</b> — ${esc(j.status)} ${j.status === 'running' ? '<button id="btnCancel">Cancel</button>' : '<button id="btnDismiss">Hide</button>'}
		<div class="muted">${esc(where)} ${pr ? `· ${esc(pr.phase)} ${pr.done}/${pr.total}` : ''} · started ${fmtDate(j.startedAt)}</div>
		<div class="bar"><div style="width:${pct}%"></div></div>
		<pre>${esc(j.log.slice(-40).join('\n'))}</pre>`;
	if ($('#btnCancel')) $('#btnCancel').onclick = () => act(() => api('/api/jobs/cancel', { method: 'POST' }));
	if ($('#btnDismiss')) $('#btnDismiss').onclick = () => el.classList.add('hidden');
	const pre = el.querySelector('pre');
	pre.scrollTop = pre.scrollHeight;
}

async function refreshState() {
	const prevStatus = state.server?.job?.status;
	state.server = await api('/api/state');
	renderStatus();
	const running = state.server.job?.status === 'running';
	if (running && !state.poll) state.poll = setInterval(refreshState, 1500);
	if (!running && state.poll) {
		clearInterval(state.poll);
		state.poll = null;
	}
	if (prevStatus === 'running' && !running) {
		state.results = {};
		await loadPopularity();
		await renderAll();
	}
}

async function loadPopularity() {
	try {
		state.popularity = await api('/api/popularity');
	} catch {
		state.popularity = null;
	}
}

// ---------- spec / build / tab navigation ----------

function renderSpecTabs() {
	$('#specTabs').innerHTML = state.config.specs.map((s) => `<button data-spec="${s.key}" class="${s.key === state.spec ? 'active' : ''}">${esc(s.label)}</button>`).join('');
	for (const b of document.querySelectorAll('#specTabs button')) b.onclick = () => selectSpec(b.dataset.spec);
}

function selectSpec(key) {
	state.spec = key;
	const spec = state.config.specs.find((s) => s.key === key);
	state.build = spec.talentBuilds[0].key;
	location.hash = `${state.spec}/${state.build}/${state.tab ?? ''}`;
	renderAll();
}

async function getResult(spec, build) {
	const k = `${spec}/${build}`;
	if (!(k in state.results)) {
		try {
			state.results[k] = await api(`/api/results/${spec}/${build}`);
		} catch {
			state.results[k] = null;
		}
	}
	return state.results[k];
}

async function renderAll() {
	renderSpecTabs();
	renderStatus();
	const spec = state.config.specs.find((s) => s.key === state.spec);
	const build = spec.talentBuilds.find((b) => b.key === state.build) ?? spec.talentBuilds[0];
	const res = await getResult(spec.key, build.key);
	const talentURL = `https://www.wowhead.com/forever/talent-calc/${spec.class}/${build.talents}`;
	$('#toolbar').innerHTML = `
		<label>Talents <select id="buildSel">${spec.talentBuilds.map((b) => `<option value="${b.key}" ${b.key === build.key ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
		<a href="${talentURL}" target="_blank" rel="noopener">${esc(build.talents)}</a>
		<span title="${esc(build.source)}">· ${esc(build.source)}</span>
		<span>· ${esc(spec.race.replace('Race', '').replace(/([a-z])([A-Z])/g, '$1 $2'))} · ${spec.professions.map(esc).join(' + ')}</span>`;
	$('#buildSel').onchange = (e) => {
		state.build = e.target.value;
		renderAll();
	};
	const tabs = state.config.scenarios.tabs;
	if (!tabs.some((t) => t.key === state.tab)) state.tab = tabs[0].key;
	$('#scenarioTabs').innerHTML = tabs.map((t) => `<button data-tab="${t.key}" class="${t.key === state.tab ? 'active' : ''}">${esc(t.label)}</button>`).join('');
	for (const b of document.querySelectorAll('#scenarioTabs button'))
		b.onclick = () => {
			state.tab = b.dataset.tab;
			location.hash = `${state.spec}/${state.build}/${state.tab}`;
			renderAll();
		};
	renderMain(spec, build, res);
}

// ---------- results ----------

function iconImg(icon) {
	return icon ? `<img class="icon" loading="lazy" src="https://wow.zamimg.com/images/wow/icons/medium/${esc(icon)}.jpg" alt="">` : '';
}

function itemLink(res, id, suffix) {
	const it = res.items[id];
	const name = (it?.name ?? `Item ${id}`) + (suffix ? ` ${res.suffixes[suffix] ?? ''}` : '');
	const q = it ? `q${it.quality}` : '';
	const rand = suffix ? `&rand=${suffix}` : '';
	return `<a class="${q}" href="https://www.wowhead.com/forever/item=${id}${rand ? '?' + rand.slice(1) : ''}" target="_blank" rel="noopener" data-wowhead="item=${id}${rand}&domain=forever">${esc(name)}</a>`;
}

const ITEM_TYPE_OF_SLOT = { head: 1, neck: 2, shoulder: 3, back: 4, chest: 5, wrist: 6, hands: 7, waist: 8, legs: 9, feet: 10, finger1: 11, finger2: 11, main_hand: 13, off_hand: 13, ranged: 14 };

// The enchant row of effect eid that fits slot: one effect can be several enchants (+15 Agility is both
// "Enchant Gloves - Superior Agility" and "Enchant Weapon - Agility").
function enchantRow(eid, slot, itemId, res) {
	const rows = state.enchantRows?.[eid];
	if (!rows?.length) return null;
	const type = ITEM_TYPE_OF_SLOT[slot];
	let fits = rows.filter((r) => r.type === type || r.extraTypes.includes(type));
	if (type === 13 && fits.length > 1) {
		const it = res?.items[itemId];
		const want = slot === 'off_hand' ? 2 : it?.hand === 4 ? 1 : 0; // shield, two-hander, other weapon
		const exact = fits.filter((r) => r.enchantType === want);
		if (exact.length) fits = exact;
	}
	return fits[0] ?? rows[0];
}

function enchantLabel(res, eid, slot, itemId) {
	if (!eid) return '<span class="muted">No enchant</span>';
	const e = res.enchants[eid];
	const row = slot ? enchantRow(eid, slot, itemId, res) : null;
	const name = row?.name ?? e?.name ?? `Enchant ${eid}`;
	const spell = row?.spellId || e?.spellId;
	return spell ? `<a href="https://www.wowhead.com/forever/spell=${spell}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name);
}

function availTag(avail) {
	switch (avail) {
		case 'world_drop': return '<span class="tag world" title="The database records no source for this item. It is used because it has a random enchantment (an original-game world drop) or because scanned level 60 players wear it.">no source data</span>';
		case 'unverified': return '<span class="tag unverified" title="Forever item with no recorded source. It may be raid loot, so it is never put in BiS. Add it to config/item-overrides.json include list once confirmed.">unverified</span>';
		case 'raid': return '<span class="tag raid" title="Raid source: shown for reference, never in pre-raid BiS">raid</span>';
		default: return '';
	}
}

function popularity(group, id) {
	const p = state.popularity?.specs?.[state.spec];
	if (!p || !p.count) return '';
	const n = p.items[id] ?? 0;
	return `<span title="${n} of ${p.count} scanned ${state.spec.replace(/_/g, ' ')}s wear it">${Math.round((100 * n) / p.count)}%</span>`;
}

function enchantPopularity(slots, eid) {
	const p = state.popularity?.specs?.[state.spec];
	if (!p || !p.count || !eid) return '';
	let n = 0;
	for (const s of slots) n += p.enchants?.[s]?.[eid] ?? 0;
	const denom = p.count * slots.length;
	return `<span title="${n} of ${denom} scanned slots">${Math.round((100 * n) / denom)}%</span>`;
}

function fmtDelta(tab, row) {
	if (row.isBis) return '<span class="muted">BiS</span>';
	const sign = tab.lowerBetter ? -1 : 1;
	const better = row.delta * sign;
	const isScore = tab.primary === 'score';
	const v = isScore ? `${(100 * row.delta).toFixed(2)}%` : `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(tab.primary === 'tmi' ? 2 : 1)}`;
	const ci = isScore ? `${(196 * row.deltaSe).toFixed(2)}%` : (1.96 * row.deltaSe).toFixed(tab.primary === 'tmi' ? 2 : 1);
	const cls = Math.abs(row.delta) <= 1.96 * row.deltaSe ? 'muted' : better > 0 ? 'good' : 'bad';
	return `<span class="${cls}" title="95% interval ±${ci}">${v}</span>`;
}

// Tank pages show every metric; a DPS page (config/site.json metrics: ["dps"]) shows only the ones it lists.
const tankPage = () => !state.config.site?.metrics || state.config.site.metrics.includes("tmi");

function rowTitle(tab, r) {
	const m = r.metrics;
	if (!tankPage()) return `DPS ${m.dps.toFixed(1)} · ${m.iters} iterations`;
	return `TPS ${m.tps.toFixed(1)} · DPS ${m.dps.toFixed(1)} · TMI ${m.tmi.toFixed(2)} · DTPS ${m.dtps.toFixed(1)} · death ${(100 * m.cod).toFixed(2)}% · crit reduction ${m.critReduction.toFixed(2)}% · ${m.iters} iterations`;
}

// The BiS set against the wowsims preset gear the search started from (which may hold raid items): a BiS set that
// loses to it on its own metric would mean something is wrong, so say so.
function presetLine(tab) {
	const s = tab.start;
	if (!s) return '';
	const b = tab.bisMetrics;
	const parts = (tankPage() ? ['tps', 'dps', 'tmi'] : ['dps']).map((k) => {
		const d = b[k] - s[k];
		const good = k === 'tmi' ? d < 0 : d > 0;
		return `${METRIC[k]} ${s[k].toFixed(k === 'tmi' ? 2 : 1)} → ${b[k].toFixed(k === 'tmi' ? 2 : 1)} <span class="${good ? 'good' : 'bad'}">(${d > 0 ? '+' : ''}${d.toFixed(k === 'tmi' ? 2 : 1)})</span>`;
	});
	const key = tab.primary === 'score' ? null : tab.primary;
	const worse = key && (tab.lowerBetter ? b[key] > s[key] : b[key] < s[key]);
	return `<p class="muted" style="font-size:12px;margin:10px 0 0">Against the wowsims preset gear (the starting set, raid items included): ${parts.join(' · ')}${worse ? ' <span class="bad">— BiS is behind the preset on this tab\'s metric; check the preset for raid or Horde items.</span>' : ''}</p>`;
}

function renderMain(spec, build, res) {
	const main = $('#main');
	if (!res) {
		main.innerHTML = `<p class="empty">No results for ${esc(spec.label)} (${esc(build.name)}) yet. Press <b>Run sims</b>.</p>`;
		return;
	}
	const tab = res.tabs.find((t) => t.key === state.tab);
	if (!tab) {
		main.innerHTML = `<p class="empty">This tab has not been simmed for ${esc(spec.label)} yet. Press <b>Run sims</b>.</p>`;
		return;
	}
	const notices = [];
	if (res.meta.quick) notices.push('These are <b>quick</b> results (a tenth of the iterations) for checking the pipeline. Do not gear from them.');
	if (res.meta.engineCommit !== state.server.engine.pinned) notices.push(`Simmed on engine ${short(res.meta.engineCommit)}; the engine is now ${short(state.server.engine.pinned)}. Re-run the sims.`);
	if (tab.constraint === 'uncrittable' && !tab.feasible) notices.push('No pre-raid set in the pool reaches crit immunity with these items; this is the closest set.');
	if (tab.stale?.length) notices.push(`New items beat this tab's BiS set: ${tab.stale.map(esc).join('; ')}. The other rows were measured against the old set.${STATIC ? '' : ' <button data-rerun="1">Re-run this tab</button>'}`);
	if (tab.polish?.length) notices.push(`The final check moved BiS after the search: ${tab.polish.map(esc).join('; ')}.`);

	const bisRows = tab.bis.map((b) => {
		if (!b.id) return '';
		const it = res.items[b.id];
		return `<div class="bis-row"><span class="slot">${esc(b.slot.replace('_', ' '))}</span>${iconImg(it?.icon)}<span class="nm">${itemLink(res, b.id, b.suffix)}${availTag(it?.avail)}${b.enchant ? ` <span class="ench">${enchantLabel(res, b.enchant, b.slot, b.id)}</span>` : ''}</span></div>`;
	}).join('');
	const m = tab.bisMetrics;
	const metricBox = (k, v, digits) => `<div class="metric ${tab.primary === k ? 'primary' : ''}">${METRIC[k] ?? k}<b>${v.toFixed(digits)}</b></div>`;
	const sh = tab.sheet ?? {};
	// The site lists the sheet rows its players care about (config/site.json sheet: "melee" or "caster"); tanks get the defensive ones.
	const sheetKind = state.config.site?.sheet ?? 'tank';
	const sheetRows = {
		tank: [
			['Health', sh.health, 0], ['Armor', sh.armor, 0], ['Defense rating', sh.defenseRating, 0], ['Crit reduction', sh.critReduction, 2, '%'],
			['Hit', sh.hitPercent, 2, '%'], ['Expertise', sh.expertisePercent, 2, '%'], ['Dodge', sh.dodgePercent, 2, '%'], ['Parry', sh.parryPercent, 2, '%'], ['Block', sh.blockPercent, 2, '%'], ['Block value', sh.blockValue, 0],
		],
		melee: [
			['Attack power', sh.attackPower, 0], ['Ranged AP', sh.rangedAttackPower, 0], ['Strength', sh.strength, 0], ['Agility', sh.agility, 0], ['Spell power', sh.spellDamage, 0],
			['Melee hit', sh.hitPercent, 2, '%'], ['Melee crit', sh.critPercent, 2, '%'], ['Ranged hit', sh.rangedHitPercent, 2, '%'], ['Ranged crit', sh.rangedCritPercent, 2, '%'], ['Expertise', sh.expertisePercent, 2, '%'], ['Haste', sh.meleeHastePercent, 2, '%'],
		],
		caster: [
			['Spell damage', sh.spellDamage, 0], ['Healing', sh.healingPower, 0], ['Intellect', sh.intellect, 0], ['Spirit', sh.spirit, 0], ['Mana', sh.mana, 0],
			['Spell hit', sh.spellHitPercent, 2, '%'], ['Spell crit', sh.spellCritPercent, 2, '%'], ['Spell haste', sh.spellHastePercent, 2, '%'],
		],
	};
	const sheetBits = sheetRows[sheetKind].filter((x) => x[1] != null).map(([l, v, d, u]) => `<div class="metric">${l}<b>${v.toFixed(d)}${u ?? ''}</b></div>`).join('');

	const cards = GROUPS.map((g) => {
		const rows = tab.groups[g] ?? [];
		if (!rows.length) return '';
		const usable = rows.filter((r) => r.avail !== 'unverified').slice(0, SHOW);
		const unv = rows.filter((r) => r.avail === 'unverified').slice(0, 3);
		const tr = (r, i) => {
			const it = res.items[r.id];
			return `<tr class="${r.isBis ? 'bisrow' : ''} ${r.avail === 'unverified' ? 'unv' : ''}" title="${esc(rowTitle(tab, r))}">
				<td class="n">${i == null ? '' : i + 1}</td><td class="ic">${iconImg(it?.icon)}</td>
				<td class="it">${itemLink(res, r.id, r.suffix)}${availTag(r.avail)}${it?.fromBlizzard ? `<span class="tag" title="The engine's database lacks this item; its stats come from Blizzard's API (a scanned player's worn copy).${it.unread?.length ? ' Not modelled: ' + esc(it.unread.join('; ')) : ''}">Blizzard stats${it.unread?.length ? '*' : ''}</span>` : ''}${r.tied && !r.isBis ? '<span class="tag tie" title="Within the 95% interval of the best: statistically tied">tie</span>' : ''}${r.new ? `<span class="tag new" title="Added by a new-item check${r.approx ? ' on a newer engine: its delta against BiS is exact, its place among the other rows approximate' : ''}">new${r.approx ? '*' : ''}</span>` : ''}${!r.feasible && tab.constraint ? '<span class="tag crit">crittable</span>' : ''}
				<span class="src" title="${esc((it?.sources ?? []).join(' · '))}">${esc((it?.sources ?? []).slice(0, 2).join(' · '))}${it?.ilvl ? ` · ilvl ${it.ilvl}` : ''}</span></td>
				<td class="d">${fmtDelta(tab, r)}</td><td class="p">${popularity(g, r.id)}</td></tr>`;
		};
		const enchSlots = ENCHANT_SLOTS_OF[g] ?? [];
		const enchRows = enchSlots.length ? tab.enchants[enchSlots[0]] ?? [] : [];
		const ench = enchRows.length
			? `<details class="ench-list"><summary>Top enchants (${enchRows.length} fit)</summary><table class="rank">${enchRows.slice(0, SHOW).map((r, i) => `<tr class="${r.isBis ? 'bisrow' : ''}" title="${esc(rowTitle(tab, r))}"><td class="n">${i + 1}</td><td class="it">${enchantLabel(res, r.enchant, r.slot, r.id)}${availTag(r.avail)}${r.tied && !r.isBis ? '<span class="tag tie">tie</span>' : ''}</td><td class="d">${fmtDelta(tab, r)}</td><td class="p">${enchantPopularity(enchSlots, r.enchant)}</td></tr>`).join('')}</table></details>`
			: '';
		return `<div class="card"><h3>${GROUP_LABEL[g]} <span class="count">${res.poolCounts[g] ?? 0} candidates · Δ ${METRIC[tab.primary] ?? tab.primary} · worn</span></h3>
			<table class="rank">${usable.map((r, i) => tr(r, i)).join('')}${unv.length ? `<tr><td colspan="5" class="muted" style="font-size:10px;padding-top:6px">Unverified source (not used for BiS)</td></tr>${unv.map((r) => tr(r, null)).join('')}` : ''}</table>${ench}</div>`;
	}).join('');

	const setup = res.meta.setup ?? {};
	const listOn = (o) => Object.entries(o ?? {}).filter(([, v]) => v && v !== 0).map(([k, v]) => (v === true ? k : `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`)).join(', ') || '—';
	const enc = res.meta.encounters[tab.encounter];
	const it = res.meta.iterations;

	main.innerHTML = `
		${notices.map((n) => `<div class="notice">${n}</div>`).join('')}
		<section class="bis">
			<h2>Best in slot — ${esc(tab.label)} ${tab.constraint === 'uncrittable' ? (tab.feasible ? '<span class="tag">uncrittable</span>' : '<span class="tag crit">not uncrittable</span>') : ''}</h2>
			<div class="bis-grid">${bisRows}</div>
			<div class="metrics">${tankPage() ? `${metricBox('tps', m.tps, 1)}${metricBox('dps', m.dps, 1)}${metricBox('tmi', m.tmi, 2)}${metricBox('dtps', m.dtps, 1)}<div class="metric">Death<b>${(100 * m.cod).toFixed(2)}%</b></div>` : metricBox('dps', m.dps, 1)}</div>
			<div class="metrics">${sheetBits}</div>
			${presetLine(tab)}
		</section>
		<div class="grid">${cards}</div>
		<details class="panel"><summary>Sim settings for this result</summary><div class="kv">
			<div>Engine</div><div><a href="https://github.com/wowsims/forever/commit/${res.meta.engineCommit}" target="_blank" rel="noopener">${short(res.meta.engineCommit)}</a> · simmed ${fmtDate(res.meta.generatedAt)} · ${res.meta.sims} sims in ${Math.round(res.meta.seconds / 60)} min</div>
			<div>Encounter</div><div>${esc(enc.label)}: ${enc.duration}s ±${enc.durationVariation}s, ${enc.targets.map((t) => `${t.count}× ${esc(t.name)} (level ${t.level}, ${t.minBaseDamage} base damage, ${t.swingSpeed}s swing)`).join(', ')}</div>
			<div>Ranked by</div><div>${Object.entries(tab.objective).map(([k, w]) => `${METRIC[k] ?? k} × ${w}`).join(' + ')}${tab.constraint ? ` · constraint: ${tab.constraint}` : ''}</div>
			<div>Iterations</div><div>screen ${it.Screen}, search ${it.Search}, final ${it.Final} · seed ${res.meta.seed} (the same for every gear set)</div>
			<div>Race / professions</div><div>${esc(setup.race)} · ${esc(setup.profession1)} + ${esc(setup.profession2)}</div>
			<div>Talents</div><div><a href="https://www.wowhead.com/forever/talent-calc/${spec.class}/${esc(setup.talents)}" target="_blank" rel="noopener">${esc(setup.talents)}</a></div>
			<div>Rotation</div><div>${setup.aplRows} APL rows from ${esc(setup.setupFile)}</div>
			<div>Individual buffs</div><div>${esc(listOn(setup.buffs))}</div>
			<div>Raid buffs</div><div>${esc(listOn(setup.raidBuffs))}</div>
			<div>Party buffs</div><div>${esc(listOn(setup.partyBuffs))}</div>
			<div>Debuffs</div><div>${esc(listOn(setup.debuffs))}</div>
			<div>Consumables</div><div>${esc(listOn(setup.consumables))}</div>
			<div>Healing model</div><div>${esc(listOn(setup.healingModel))}</div>
		</div></details>
		<details class="panel"><summary>How these rankings are made (and their limits)</summary>
			<ul>
				<li>Every Alliance-usable item of item level ${45}+ that ${esc(spec.label)} can wear is screened once against the spec's starting gear. Raid drops, Horde-only items and items on the exclusion list are left out; Forever items with no recorded source are screened but never put in BiS.</li>
				<li>The best ${state.config.scenarios.shortlistPerSlot} per slot for this tab (plus anything statistically tied with the last) go to a slot-by-slot search, which also tries every enchant and each item set's pieces together, until a full pass changes nothing.</li>
				<li>The list in each slot is that slot's candidates swapped into the BiS set at ${it.Final} iterations, so each number is "what this item is worth in this set". Every sim uses the same random seed, so two items see identical fights.</li>
				<li>The 95% interval (hover a number) treats the two sims as independent, which overstates the noise: grey numbers and <span class="tag tie">tie</span> mean the difference is not proven. Prefer the more available item among ties.</li>
				<li>Rings and trinkets: an item is tried in either slot. Two copies of one item are never paired.</li>
				<li>Popularity is the share of scanned level 60 players of this spec (both factions) wearing the item, from the guilds in config/popularity.json.</li>
				<li>The rotation is the wowsims APL; trinkets and on-use effects are valued only as far as the APL uses them.</li>
			</ul>
		</details>`;
	const rr = main.querySelector('[data-rerun]');
	if (rr) rr.onclick = () => act(() => api('/api/sims/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec: state.spec, build: state.build, tab: state.tab }) }));
	window.$WowheadPower?.refreshLinks?.();
}

// ---------- start ----------

async function start() {
	state.config = await api('/api/config');
	if (state.config.site) {
		document.title = state.config.site.title;
		$('.brand h1').textContent = state.config.site.title;
		$('.brand .sub').textContent = state.config.site.subtitle;
	}
	const [spec, build, tab] = location.hash.slice(1).split('/');
	state.spec = state.config.specs.some((s) => s.key === spec) ? spec : state.config.specs[0].key;
	const specCfg = state.config.specs.find((s) => s.key === state.spec);
	state.build = specCfg.talentBuilds.some((b) => b.key === build) ? build : specCfg.talentBuilds[0].key;
	state.tab = tab || state.config.scenarios.tabs[0].key;
	await loadPopularity();
	try {
		state.enchantRows = await api('/api/enchant-rows');
	} catch {
		state.enchantRows = null; // names fall back to the results file's
	}
	await refreshState();
	await renderAll();
}
start().catch((e) => ($('#main').innerHTML = `<p class="empty">Could not ${STATIC ? 'load the results' : 'reach the local server'}: ${esc(e.message)}</p>`));
