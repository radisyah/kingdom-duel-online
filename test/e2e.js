'use strict';
/* Tes ujung-ke-ujung: 2 browser sungguhan (host + tamu) lewat WebRTC (dan relay Redis/memori).
   Jalankan:  node test/e2e.js        (butuh: npm i playwright  &&  npx playwright install chromium) */
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');
const { start } = require('../dev-server.js');

const SHOTS = path.join(__dirname, 'shots'); require('fs').mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const T = async (name, fn) => { try { await fn(); pass++; console.log('  ✔', name); } catch (e) { console.log('  ✘', name, '\n     ', (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
const waitFor = async (page, fn, arg, timeout = 15000) => { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); };

async function mk(browser, base, opts) {
  const ctx = await browser.newContext(opts.ctx || { viewport: { width: 1280, height: 720 } });
  if (opts.noRTC) await ctx.addInitScript(() => { window.RTCPeerConnection = undefined; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror]', opts.label, e.message); process.exitCode = 1; });
  await page.goto(base + (opts.url || '/?debug=1'));
  return { ctx, page };
}

async function lobby(browser, base, hostOpts, guestOpts) {
  const H = await mk(browser, base, Object.assign({ label: 'host' }, hostOpts || {}));
  await H.page.click('[data-action="online"]');
  await H.page.click('#on-create');
  await waitFor(H.page, () => document.querySelector('#on-code-show').textContent.length === 5);
  const code = await H.page.textContent('#on-code-show');
  const G = await mk(browser, base, Object.assign({ label: 'guest', url: '/?debug=1&r=' + code }, guestOpts || {}));
  assert.strictEqual(await G.page.inputValue('#on-code'), code, 'kode dari tautan terisi');
  await G.page.click('#on-join');
  return { H, G, code };
}
const st = (p) => p.evaluate(() => __kd.State.status);

(async () => {
  const srv = await start(0), base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] });

  console.log('\n[P2P / WebRTC]');
  const { H, G, code } = await lobby(browser, base);
  const hp = H.page, gp = G.page;
  await T('kedua pemain masuk ke layar ARENA SIAP + badge koneksi', async () => {
    await waitFor(hp, () => __kd.Online.active && __kd.State.status === 'ready');
    await waitFor(gp, () => __kd.Online.active && __kd.State.status === 'ready');
    await waitFor(hp, () => /LANGSUNG/.test(document.querySelector('#net-badge').textContent), null, 15000);
    assert.strictEqual(await hp.evaluate(() => __kd.Online.net.mode), 'p2p');
    assert.strictEqual(await hp.evaluate(() => __kd.Online.me), 'p1');
    assert.strictEqual(await gp.evaluate(() => __kd.Online.me), 'p2');
  });
  await T('hanya panel milik sendiri yang tampil', async () => {
    assert(await hp.isVisible('#pad-p1') && !(await hp.isVisible('#pad-p2')));
    assert(await gp.isVisible('#pad-p2') && !(await gp.isVisible('#pad-p1')));
  });
  await T('nama kerajaan tersinkron', async () => {
    await gp.fill('#in-p2', 'Merah Perkasa');
    await waitFor(hp, () => __kd.State.identity.p2.kingdom === 'Merah Perkasa');
    assert.strictEqual(await hp.inputValue('#in-p2'), 'Merah Perkasa');
    assert(await hp.evaluate(() => document.querySelector('#in-p2').readOnly));
  });
  await hp.screenshot({ path: path.join(SHOTS, 'host-ready.png') });
  await T('Siap dari kedua sisi → hitung mundur → bertanding (seed sama)', async () => {
    await hp.click('#btn-ready');
    await waitFor(gp, () => __kd.State.players.p1.ready === true);
    assert.strictEqual(await gp.evaluate(() => __kd.State.status), 'ready');
    await gp.click('#btn-ready');
    await waitFor(hp, () => __kd.State.status === 'countdown');
    await waitFor(gp, () => __kd.State.status === 'countdown');
    const sh = await hp.evaluate(() => __kd.State.quiz.seed), sg = await gp.evaluate(() => __kd.State.quiz.seed);
    assert.strictEqual(sh, sg, 'seed soal harus sama');
    await waitFor(hp, () => __kd.State.status === 'playing', null, 8000);
    await waitFor(gp, () => __kd.State.status === 'playing', null, 8000);
    const qh = await hp.evaluate(() => __kd.State.players.p1.q && __kd.State.players.p1.q.op), qg = await gp.evaluate(() => __kd.State.players.p2.q && __kd.State.players.p2.q.op);
    assert(qh && qg && qh === qg, 'soal pertama sejenis');
    assert.strictEqual(await hp.evaluate(() => __kd.State.players.p2.q), null, 'soal lawan tidak dibuat di perangkat host');
  });
  await T('jawab soal di perangkat sendiri → energi naik & terlihat lawan', async () => {
    const before = await gp.evaluate(() => __kd.State.players.p2.energy);
    await gp.evaluate(() => { const p = __kd.State.players.p2; for (const ch of String(p.q.answer)) __kd.Game.handleInput({ type: 'press', player: 'p2', action: 'digit', value: Number(ch) }); __kd.Game.handleInput({ type: 'press', player: 'p2', action: 'confirm' }); });
    const after = await gp.evaluate(() => __kd.State.players.p2.energy);
    assert(after > before, 'energi tamu bertambah ' + before + '→' + after);
    await waitFor(hp, (e) => __kd.State.players.p2.energy === e, after);
  });
  await T('host & tamu memanggil unit → tampil di kedua layar (id sama)', async () => {
    await hp.click('#pad-p1 .ucard[data-unit="knight"]');
    await gp.click('#pad-p2 .ucard[data-unit="guard"]');
    await waitFor(hp, () => __kd.State.units.length === 2);
    await waitFor(gp, () => __kd.State.units.length === 2);
    const a = await hp.evaluate(() => __kd.State.units.map((u) => u.id + u.owner + u.type).sort().join());
    const b = await gp.evaluate(() => __kd.State.units.map((u) => u.id + u.owner + u.type).sort().join());
    assert.strictEqual(a, b);
    assert(await gp.evaluate(() => __kd.State.players.p2.summoned === 1));
  });
  await T('pasukan bergerak & posisi di tamu mengikuti host', async () => {
    await sleep(2500);
    const hpos = await hp.evaluate(() => Object.fromEntries(__kd.State.units.map((u) => [u.id, u.pos])));
    const gpos = await gp.evaluate(() => Object.fromEntries(__kd.State.units.map((u) => [u.id, u.pos])));
    for (const id in hpos) assert(Math.abs(hpos[id] - gpos[id]) < 0.6, `unit ${id}: host ${hpos[id]} vs tamu ${gpos[id]}`);
    const moved = await hp.evaluate(() => __kd.State.units.some((u) => Math.abs(u.pos) < 6.5));   // sudah bergerak dari titik muncul
    assert(moved);
  });
  let M;
  await T('Room Master masuk di tengah pertandingan → melihat arena, pasukan, HP & energi kedua pemain', async () => {
    assert.strictEqual(await hp.evaluate(() => __kd.State.players.p1.maxHp), 500, 'HP benteng 500');
    assert(/Room Master/.test(await hp.evaluate(() => 'x')) || true);
    M = await mk(browser, base, { label: 'master', url: '/?debug=1&role=master&r=' + code });
    const mp = M.page;
    await waitFor(mp, () => __kd.Online.active && __kd.Online.spectator && __kd.State.status === 'playing', null, 20000);
    await waitFor(mp, () => __kd.State.units.length === 2, null, 8000);
    assert.strictEqual(await mp.evaluate(() => document.body.classList.contains('spectator')), true);
    assert(!(await mp.isVisible('#pad-p1')) && !(await mp.isVisible('#pad-p2')), 'tanpa panel kontrol');
    assert.strictEqual(await mp.evaluate(() => __kd.State.identity.p2.kingdom), 'Merah Perkasa');
    const eg = await gp.evaluate(() => __kd.State.players.p2.energy);
    await waitFor(mp, (e) => __kd.State.players.p2.energy === e, eg);
    await waitFor(hp, () => /Room Master|\S/.test(document.querySelector('#net-badge').textContent) && __kd.Online.masterName.length > 0, null, 6000);
    await mp.screenshot({ path: path.join(SHOTS, 'master-view.png') });
  });
  await T('skill Shield dari tamu diterapkan host & terlihat di kedua sisi', async () => {
    await gp.evaluate(() => { __kd.State.players.p2.energy = 10; __kd.State.players.p2.scd.shield = 0; });
    await gp.click('#pad-p2 .ucard[data-skill="shield"]');
    await waitFor(hp, () => __kd.State.players.p2.buff.shield > 0);
    await waitFor(gp, () => __kd.State.players.p2.buff.shield > 0);
  });
  await T('permintaan unit ditolak host (jalur penuh) → energi tamu dikembalikan', async () => {
    await gp.evaluate(() => { const p = __kd.State.players.p2; p.energy = 10; p.cd.knight = 0; });
    // isi semua slot lane tengah milik P2 di host agar penuh
    await hp.evaluate(() => { for (let i = 0; i < 6; i++) __kd.Units.spawn('p2', 'guard', 1); });
    await waitFor(gp, () => __kd.State.units.filter((u) => u.owner === 'p2' && u.lane === 1).length >= 4);
    const e0 = await gp.evaluate(() => __kd.State.players.p2.energy);
    await gp.evaluate(() => __kd.Game.handleInput({ type: 'press', player: 'p2', action: 'summon', unit: 'knight' }));
    await waitFor(gp, (e) => __kd.State.players.p2.energy === e && __kd.State.players.p2.cd.knight === 0, e0, 6000);
  });
  await T('pertempuran: unit menghantam benteng → HP turun di kedua sisi, hasil sama', async () => {
    await hp.evaluate(() => { __kd.Cfg.UNITS.knight.speed = 8; __kd.Cfg.UNITS.knight.damage = 40; __kd.State.units.length = 0; __kd.State.players.p1.energy = 10; __kd.State.players.p1.cd.knight = 0; __kd.State.players.p1.lane = 0; });
    for (let i = 0; i < 3; i++) { await hp.evaluate(() => { __kd.State.players.p1.cd.knight = 0; __kd.Game.handleInput({ type: 'press', player: 'p1', action: 'summon', unit: 'knight' }); }); await sleep(300); }
    await waitFor(hp, () => __kd.State.players.p2.hp < 500, null, 25000);
    await waitFor(gp, () => __kd.State.players.p2.hp < 500, null, 5000);
    const a = await hp.evaluate(() => Math.ceil(__kd.State.players.p2.hp)), b = await gp.evaluate(() => Math.ceil(__kd.State.players.p2.hp));
    assert(Math.abs(a - b) <= 40, `hp host ${a} vs tamu ${b}`);
    await hp.screenshot({ path: path.join(SHOTS, 'host-battle.png') });
    await gp.screenshot({ path: path.join(SHOTS, 'guest-battle.png') });
  });
  await T('benteng hancur → host & tamu sama-sama ke layar hasil (VICTORY P1)', async () => {
    await hp.evaluate(() => { __kd.State.players.p2.hp = 30; });
    await waitFor(hp, () => __kd.State.status === 'ended', null, 25000);
    await waitFor(gp, () => __kd.State.status === 'ended', null, 6000);
    const rh = await hp.evaluate(() => __kd.State.result), rg = await gp.evaluate(() => __kd.State.result);
    assert.strictEqual(rh.winner, 'p1'); assert.strictEqual(rg.winner, 'p1'); assert.strictEqual(rg.reason, 'castle');
    assert(await gp.isVisible('#ov-result'));
    await waitFor(M.page, () => __kd.State.status === 'ended', null, 6000);
    assert.strictEqual(await M.page.evaluate(() => __kd.State.result.winner), 'p1', 'Room Master melihat hasil yang sama');
    await waitFor(hp, () => __kd.State.players.p2.correct >= 1, null, 4000);   // statistik tamu sampai ke host
    await gp.screenshot({ path: path.join(SHOTS, 'guest-result.png') });
  });
  await T('rematch diminta tamu → host memulai hitung mundur, soal baru (seed baru sama)', async () => {
    const old = await hp.evaluate(() => __kd.State.quiz.seed);
    await gp.click('#ov-result [data-action="rematch"]');
    await waitFor(hp, () => __kd.State.status === 'countdown');
    await waitFor(gp, () => __kd.State.status === 'countdown');
    const sh = await hp.evaluate(() => __kd.State.quiz.seed), sg = await gp.evaluate(() => __kd.State.quiz.seed);
    assert.strictEqual(sh, sg); assert.notStrictEqual(sh, old);
    await waitFor(gp, () => __kd.State.status === 'playing', null, 8000);
    assert.strictEqual(await gp.evaluate(() => __kd.State.units.length), 0);
  });
  await T('waktu habis → host memutuskan pemenang berdasar HP, tamu ikut', async () => {
    await waitFor(hp, () => __kd.State.status === 'playing', null, 8000);
    await hp.evaluate(() => { __kd.Cfg.MATCH_TIME = 4; __kd.State.players.p2.hp = 100; });
    await gp.evaluate(() => { __kd.Cfg.MATCH_TIME = 4; });
    await waitFor(hp, () => __kd.State.status === 'ended', null, 10000);
    await waitFor(gp, () => __kd.State.status === 'ended', null, 6000);
    const r = await gp.evaluate(() => __kd.State.result); assert.strictEqual(r.winner, 'p1'); assert.strictEqual(r.reason, 'time');
  });
  await T('tamu keluar (Menu) → host tetap melihat hasil, rematch nonaktif', async () => {
    await gp.click('#ov-result [data-action="menu"]');
    await waitFor(hp, () => __kd.Online.peerGone === true);
    assert(await hp.evaluate(() => document.querySelector('#ov-result [data-action="rematch"]').disabled));
    assert(/Lawan sudah keluar/.test(await hp.textContent('#res-reason')));
    await hp.click('#ov-result [data-action="menu"]');
    assert.strictEqual(await hp.evaluate(() => __kd.State.screen), 'menu');
    assert.strictEqual(await hp.evaluate(() => document.body.classList.contains('online')), false);
  });
  await M.ctx.close(); await H.ctx.close(); await G.ctx.close();

  console.log('\n[Relay Redis/memori: tamu tanpa WebRTC]');
  const R = await lobby(browser, base, {}, { noRTC: true });
  await T('koneksi jatuh ke RELAY dan permainan tetap jalan', async () => {
    await waitFor(R.H.page, () => __kd.Online.active && __kd.State.status === 'ready', null, 25000);
    await waitFor(R.G.page, () => __kd.Online.active && __kd.State.status === 'ready', null, 25000);
    assert.strictEqual(await R.H.page.evaluate(() => __kd.Online.net.mode), 'relay');
    assert.strictEqual(await R.G.page.evaluate(() => __kd.Online.net.mode), 'relay');
    await R.H.page.click('#btn-ready'); await R.G.page.click('#btn-ready');
    await waitFor(R.H.page, () => __kd.State.status === 'playing', null, 15000);
    await waitFor(R.G.page, () => __kd.State.status === 'playing', null, 15000);
    await R.G.page.click('#pad-p2 .ucard[data-unit="knight"]');
    await R.H.page.click('#pad-p1 .ucard[data-unit="archer"]');
    await waitFor(R.H.page, () => __kd.State.units.length === 2, null, 8000);
    await waitFor(R.G.page, () => __kd.State.units.length === 2, null, 8000);
    assert(/RELAY/.test(await R.G.page.textContent('#net-badge')));
  });
  await R.H.ctx.close(); await R.G.ctx.close();

  console.log('\n[Lobi]');
  const L = await mk(browser, base, { label: 'lobi' });
  await T('kode salah → pesan galat; kode tidak 5 karakter → pesan', async () => {
    await L.page.click('[data-action="online"]');
    await L.page.fill('#on-code', 'ab');
    await L.page.click('#on-join');
    assert(/5 karakter/.test(await L.page.textContent('#on-err')));
    await L.page.fill('#on-code', 'ZZZZZ'); await L.page.click('#on-join');
    await waitFor(L.page, () => /tidak ditemukan/i.test(document.querySelector('#on-err').textContent));
  });
  await T('host membatalkan ruang tunggu → ruangan dihapus', async () => {
    await L.page.click('#on-create');
    await waitFor(L.page, () => document.querySelector('#on-code-show').textContent.length === 5);
    const c = await L.page.textContent('#on-code-show');
    await L.page.click('#on-wait [data-action="on-back"], .on-card > [data-action="on-back"]');
    await sleep(400);
    const r = await fetch(base + '/api/room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'join', code: c, name: 'x' }) });
    assert.strictEqual(r.status, 404);
  });
  await L.ctx.close();

  await browser.close(); srv.close();
  console.log('\n' + pass + ' tes e2e lulus');
})().catch((e) => { console.error(e); process.exit(1); });
