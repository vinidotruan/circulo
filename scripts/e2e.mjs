// Teste ponta a ponta no Chrome headless via DevTools Protocol (sem dependências).
// Uso: node scripts/e2e.mjs http://localhost:8765/ <pasta-de-saida>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333;
const profile = mkdtempSync(path.join(outDir, 'profile-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=390,844', 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* aguardando */ }
  if (!target) await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const problems = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    problems.push(`exceção: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    problems.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(outDir, name), Buffer.from(r.data, 'base64'));
};
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const isActive = (id) => js(`document.getElementById('${id}').classList.contains('is-active')`);
const text = (id) => js(`document.getElementById('${id}').textContent`);
const typeName = (v) => js(`(() => { const n = document.getElementById('name-input'); n.value = ${JSON.stringify(v)}; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url });
  await sleep(1500);

  check('abre vazio, com convite pra criar', await js(`document.getElementById('scr-home').classList.contains('is-empty') && !document.getElementById('empty-add').hidden`));
  await shot('01-vazio.png');

  await js(`document.getElementById('btn-log').click()`); await sleep(400);
  check('botão principal leva pra novo hábito quando vazio', await isActive('scr-new'));
  await js(`document.querySelector('.emoji-opt').click()`);
  await typeName('Leitura');
  check('criar habilita com emoji + nome', await js(`!document.getElementById('btn-create').disabled`));
  await js(`document.getElementById('btn-create').click()`); await sleep(600);
  check('primeiro hábito criado', await js(`document.querySelectorAll('.habit-chip').length === 1`));

  await js(`document.getElementById('btn-new').click()`); await sleep(400);
  await js(`document.querySelectorAll('.emoji-opt')[2].click(); document.getElementById('kind-reps').checked = true;`);
  await typeName('Água');
  await shot('02-novo.png');
  await js(`document.getElementById('btn-create').click()`); await sleep(800);
  check('segundo hábito criado e centralizado', (await text('habit-name')) === 'Água');
  await shot('03-home.png');

  await js(`document.getElementById('btn-log').click()`); await sleep(400);
  check('abre o anel', await isActive('scr-log'));
  await js(`(() => { const d = document.getElementById('dial'); const r = d.getBoundingClientRect();
    const x = r.left + r.width * 0.94, y = r.top + r.height / 2;
    d.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
    d.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, bubbles: true })); })()`);
  const v = await text('dial-value');
  check('toque no anel às 3h marca 10 de 40', v === '10', `valor=${v}`);
  await shot('04-anel.png');
  await js(`document.getElementById('btn-save').click()`); await sleep(900);
  const t1 = await text('habit-today');
  check('home mostra o total de hoje', t1.startsWith('Hoje: 10 vezes'), t1);
  check('bolinha de hoje acesa', await js(`document.querySelector('.week li.today').classList.contains('done')`));
  await shot('05-salvo.png');

  await js(`document.getElementById('toast-action').click()`); await sleep(300);
  const t2 = await text('habit-today');
  check('desfazer remove o registro', t2.startsWith('Nada hoje'), t2);

  await js(`document.getElementById('btn-log').click()`); await sleep(400);
  await js(`document.getElementById('inc').click()`);
  await js(`document.getElementById('btn-save').click()`); await sleep(900);
  await sleep(500);
  await send('Page.reload'); await sleep(1800);
  const t3 = await js(`document.getElementById('habit-today').textContent + ' | ' + document.querySelectorAll('.habit-chip').length`);
  check('dados e hábito selecionado persistem ao recarregar', t3.startsWith('Hoje: 11 vezes') && t3.endsWith('| 2'), t3);

  check('service worker ativo', await js(`navigator.serviceWorker.getRegistration().then((r) => !!(r && (r.active || r.waiting || r.installing)))`));
  const cached = await js(`caches.keys().then(async (ks) => ks.length ? (await (await caches.open(ks[0])).keys()).length : 0)`);
  check('arquivos guardados pra offline', cached >= 11, `itens=${cached}`);

  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Page.reload'); await sleep(1800);
  check('abre offline com os dados', (await text('habit-today')).startsWith('Hoje: 11 vezes'));
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // segurar o emoji do centro abre a edição
  await js(`(() => { const c = document.querySelectorAll('.habit-chip')[1]; const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 2, bubbles: true })); })()`);
  await sleep(800);
  check('segurar o emoji abre a edição', (await isActive('scr-new')) && (await text('form-title')) === 'Editar hábito');
  check('tipo travado depois de registrar', await js(`document.getElementById('kind-reps').disabled && !document.getElementById('kind-note').hidden`));
  await js(`document.getElementById('btn-delete').click()`);
  check('apagar pede segundo toque', (await text('btn-delete')).startsWith('Toque de novo'));
  await js(`document.getElementById('btn-delete').click()`); await sleep(600);
  check('hábito apagado', await js(`document.querySelectorAll('.habit-chip').length === 1`) && (await text('habit-name')) === 'Leitura');

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(300);
  await shot('06-escuro.png');
} catch (err) {
  failures++;
  console.log('FAIL  erro no teste:', err.message);
} finally {
  const relevant = problems.filter((p) => !/favicon/i.test(p));
  console.log(relevant.length ? `Console:\n  ${relevant.join('\n  ')}` : 'Console: sem erros');
  console.log(failures ? `\n${failures} falha(s)` : '\nTudo passou');
  ws.close();
  chrome.kill();
  process.exit(failures ? 1 : 0);
}
