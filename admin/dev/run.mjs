// Experimentar o painel no computador, sem Cloudflare nem GitHub:
//   - um "GitHub" falso guarda tudo em memória, a partir de uma cópia de src/, por isso nada do repositório muda;
//   - um proxy faz de Cloudflare Access e entra com o e-mail de teste.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const adminDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(adminDir, '..');
const WORKER_PORT = Number(process.env.WORKER_PORT || 8787);
const FAKE_PORT = Number(process.env.FAKE_PORT || 8799);
const PANEL_PORT = Number(process.env.PORT || 8788);
const TOKEN = 'dev-token';
const AUD = 'dev-aud';
const EMAIL = process.env.DEV_EMAIL || 'barbearia@exemplo.pt';
const team = `http://localhost:${FAKE_PORT}`;

/* ---------- Estado do repositório falso ---------- */
const blobs = new Map(); // sha → Buffer
const trees = new Map(); // sha → Map(caminho → sha do blob)
const commits = new Map(); // sha → { tree, parents, message }
const blobSha = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const putBlob = (buf) => { const sha = blobSha(buf); blobs.set(sha, buf); return sha; };
const newSha = () => randomBytes(20).toString('hex');

const start = new Map();
const addDir = (rel) => {
  for (const name of fs.readdirSync(path.join(repoDir, rel))) {
    const child = path.join(rel, name);
    if (fs.statSync(path.join(repoDir, child)).isDirectory()) addDir(child);
    else start.set(child.split(path.sep).join('/'), putBlob(fs.readFileSync(path.join(repoDir, child))));
  }
};
addDir('src/_data');
addDir('src/assets/galeria');
const firstTree = newSha();
trees.set(firstTree, start);
let head = newSha();
commits.set(head, { tree: firstTree, parents: [], message: 'inicial' });

const readJson = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}));
});
const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'dev', alg: 'RS256', use: 'sig' };
const signToken = () => new SignJWT({ email: EMAIL })
  .setProtectedHeader({ alg: 'RS256', kid: 'dev' })
  .setIssuer(team).setAudience(AUD).setIssuedAt().setExpirationTime('1h').sign(privateKey);

/* ---------- GitHub falso + chaves do Access ---------- */
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, team);
  const route = url.pathname;
  if (route === '/cdn-cgi/access/certs') return send(res, 200, { keys: [jwk] });

  // Só para testes: ver e alterar o estado.
  if (route === '/__state') {
    const tree = trees.get(commits.get(head).tree);
    const wanted = url.searchParams.get('path');
    if (wanted) {
      const sha = tree.get(wanted);
      if (!sha) return send(res, 404, {});
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(blobs.get(sha));
    }
    return send(res, 200, { head, message: commits.get(head).message, commitCount: commits.size, paths: [...tree.keys()] });
  }
  if (route === '/__edit' && req.method === 'POST') {
    const { path: p, text } = await readJson(req);
    const tree = new Map(trees.get(commits.get(head).tree));
    tree.set(p, putBlob(Buffer.from(text)));
    const t = newSha(); trees.set(t, tree);
    const c = newSha(); commits.set(c, { tree: t, parents: [head], message: 'edição externa' });
    head = c;
    return send(res, 200, {});
  }

  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { message: 'Bad credentials' });
  const m = route.match(/^\/repos\/[^/]+\/[^/]+(\/.*)$/);
  if (!m) return send(res, 404, {});
  const p = m[1];

  if (req.method === 'GET' && p.startsWith('/git/ref/heads/')) return send(res, 200, { object: { sha: head } });
  if (req.method === 'GET' && p.startsWith('/git/commits/')) {
    const c = commits.get(p.split('/').pop());
    return c ? send(res, 200, { tree: { sha: c.tree } }) : send(res, 404, {});
  }
  if (req.method === 'GET' && p.startsWith('/contents/')) {
    const file = decodeURIComponent(p.slice('/contents/'.length));
    const sha = trees.get(commits.get(head).tree).get(file);
    if (!sha) return send(res, 404, {});
    if ((req.headers.accept || '').includes('raw')) { res.writeHead(200); return res.end(blobs.get(sha)); }
    return send(res, 200, { sha, encoding: 'base64', content: blobs.get(sha).toString('base64') });
  }
  if (req.method === 'POST' && p === '/git/blobs') {
    const { content, encoding } = await readJson(req);
    return send(res, 201, { sha: putBlob(Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf8')) });
  }
  if (req.method === 'POST' && p === '/git/trees') {
    const { base_tree: base, tree } = await readJson(req);
    const next = new Map(trees.get(base));
    for (const entry of tree) next.set(entry.path, entry.sha);
    const sha = newSha(); trees.set(sha, next);
    return send(res, 201, { sha });
  }
  if (req.method === 'POST' && p === '/git/commits') {
    const { tree, parents, message } = await readJson(req);
    const sha = newSha(); commits.set(sha, { tree, parents, message });
    return send(res, 201, { sha });
  }
  if (req.method === 'PATCH' && p.startsWith('/git/refs/heads/')) {
    const { sha } = await readJson(req);
    if (commits.get(sha)?.parents[0] !== head) return send(res, 422, { message: 'Update is not a fast forward' });
    head = sha;
    return send(res, 200, { object: { sha } });
  }
  return send(res, 404, {});
});
fake.listen(FAKE_PORT);

/* ---------- Worker ---------- */
const vars = {
  GITHUB_TOKEN: TOKEN,
  GITHUB_API_URL: team,
  GITHUB_REPO: 'teste/teste',
  GITHUB_BRANCH: 'teste',
  ACCESS_TEAM_DOMAIN: team,
  ACCESS_AUD: AUD,
};
const wrangler = spawn('npx', ['wrangler', 'dev', '--port', String(WORKER_PORT), '--inspector-port', '0', ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], {
  cwd: adminDir,
  stdio: ['ignore', process.env.DEV_QUIET ? 'ignore' : 'inherit', 'inherit'],
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});

/* ---------- "Cloudflare Access": entra sempre com o e-mail de teste ---------- */
const proxy = http.createServer(async (req, res) => {
  const token = await signToken();
  const upstream = http.request({
    host: 'localhost', port: WORKER_PORT, path: req.url, method: req.method,
    headers: { ...req.headers, host: `localhost:${WORKER_PORT}`, 'cf-access-jwt-assertion': token },
  }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  upstream.on('error', () => { res.writeHead(503); res.end('O Worker ainda está a arrancar. Recarrega dentro de momentos.'); });
  req.pipe(upstream);
});
proxy.listen(PANEL_PORT, () => {
  console.log(`\nPainel de teste: http://localhost:${PANEL_PORT}/admin/`);
  console.log('As alterações ficam só em memória e desaparecem ao fechar.\n');
});

const stop = () => { wrangler.kill(); fake.close(); proxy.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
wrangler.on('exit', (code) => { console.log(`wrangler terminou (${code})`); process.exit(code ?? 0); });
