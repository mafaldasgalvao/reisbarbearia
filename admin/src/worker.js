// Painel da Reis Barbearia: serve o painel e guarda as alterações no GitHub.
// Quem entra é decidido pelo Cloudflare Access; aqui confirma-se o token em todos os pedidos.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { FILES, cleanFile } from '../public/admin/schema.js';

const MAX_BODY_BYTES = 30 * 1024 * 1024;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MAX_PHOTOS = 20;
const NEW_PHOTO_PATH = /^assets\/galeria\/[a-z0-9-]+\.(?:webp|jpg)$/;
const IMAGE_PATH = /^assets\/(?!.*\.\.)(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:jpe?g|png|webp)$/i;
const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
  'Cache-Control': 'no-store',
};

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function withHeaders(response) {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

/* ---------- Autenticação ---------- */
const keySets = new Map();
function keySetFor(teamDomain) {
  if (!keySets.has(teamDomain)) keySets.set(teamDomain, createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`)));
  return keySets.get(teamDomain);
}

// Sem configuração ou sem token válido, ninguém entra.
async function authenticate(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new HttpError(401, 'Sessão inválida.');
  try {
    const { payload } = await jwtVerify(token, keySetFor(env.ACCESS_TEAM_DOMAIN), {
      issuer: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256'],
    });
    if (typeof payload.email !== 'string' || !payload.email) throw new Error('no email');
    return { email: payload.email };
  } catch {
    throw new HttpError(401, 'Sessão inválida.');
  }
}

/* ---------- GitHub ---------- */
function github(env) {
  const base = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPO}`;
  const call = async (path, { method = 'GET', body, accept = 'application/vnd.github+json', okStatuses = [] } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: accept,
        'User-Agent': 'reis-barbearia-painel',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok && !okStatuses.includes(response.status)) {
      console.error('GitHub', method, path, response.status);
      throw new HttpError(502, 'Não foi possível falar com o GitHub. Tenta outra vez dentro de momentos.');
    }
    return response;
  };
  return { call, api: async (path, options) => (await call(path, options)).json() };
}

const contentsPath = (env, path) => `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`;

function decodeBase64(text) {
  const binary = atob(text.replace(/\s/g, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
const toFileText = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function readFile(gh, env, name) {
  const file = await gh.api(contentsPath(env, FILES[name].path));
  const text = new TextDecoder().decode(decodeBase64(file.content));
  return { sha: file.sha, text, data: JSON.parse(text) };
}

/* ---------- Pedidos ---------- */
async function getContent(env, user) {
  const gh = github(env);
  const names = Object.keys(FILES);
  const loaded = await Promise.all(names.map((name) => readFile(gh, env, name)));
  const files = {};
  names.forEach((name, i) => { files[name] = { sha: loaded[i].sha, data: loaded[i].data }; });
  return json({ email: user.email, files });
}

async function getImage(url, env) {
  const path = url.searchParams.get('path') || '';
  if (!IMAGE_PATH.test(path)) throw new HttpError(400, 'Foto inválida.');
  const gh = github(env);
  const response = await gh.call(contentsPath(env, `src/${path}`), { accept: 'application/vnd.github.raw+json', okStatuses: [404] });
  if (response.status === 404) throw new HttpError(404, 'Foto não encontrada.');
  const type = IMAGE_TYPES[path.split('.').pop().toLowerCase()];
  return new Response(response.body, { headers: { 'Content-Type': type } });
}

function isImageBytes(bytes) {
  const webp = bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return webp || jpeg;
}

function checkPhotos(photos) {
  if (!Array.isArray(photos) || photos.length > MAX_PHOTOS) throw new HttpError(400, `Máximo de ${MAX_PHOTOS} fotos de cada vez.`);
  const seen = new Set();
  for (const photo of photos) {
    if (typeof photo?.path !== 'string' || !NEW_PHOTO_PATH.test(photo.path) || seen.has(photo.path) || typeof photo.base64 !== 'string') throw new HttpError(400, 'Foto inválida.');
    seen.add(photo.path);
    if (photo.base64.length > (MAX_PHOTO_BYTES * 4) / 3 + 4) throw new HttpError(400, 'Foto demasiado grande.');
    let bytes;
    try { bytes = decodeBase64(photo.base64); } catch { throw new HttpError(400, 'Foto inválida.'); }
    if (!isImageBytes(bytes)) throw new HttpError(400, 'O ficheiro não é uma foto válida.');
  }
}

async function save(request, env) {
  // Só pedidos feitos pelo próprio painel.
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') throw new HttpError(403, 'Pedido recusado.');
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) throw new HttpError(415, 'Pedido inválido.');
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) throw new HttpError(413, 'As fotos são demasiado grandes. Guarda menos de cada vez.');

  let body;
  try { body = await request.json(); } catch { throw new HttpError(400, 'Pedido inválido.'); }
  const requested = body?.files;
  const names = requested && typeof requested === 'object' ? Object.keys(requested) : [];
  if (!names.length || names.some((name) => !Object.hasOwn(FILES, name))) throw new HttpError(400, 'Pedido inválido.');
  const photos = body.photos ?? [];
  checkPhotos(photos);

  const gh = github(env);
  const current = await Promise.all(names.map((name) => readFile(gh, env, name)));

  const changes = [];
  const allErrors = [];
  names.forEach((name, i) => {
    if (requested[name]?.sha !== current[i].sha) throw new HttpError(409, 'O conteúdo foi alterado noutro lado entretanto. Recarrega a página para veres a versão mais recente.');
    const { value, errors } = cleanFile(name, requested[name].data, current[i].data);
    errors.forEach((e) => allErrors.push({ file: name, ...e }));
    if (!errors.length && toFileText(value) !== current[i].text) changes.push({ name, text: toFileText(value) });
  });
  if (allErrors.length) throw new HttpError(422, 'Há campos por corrigir.', allErrors);
  if (!changes.length && !photos.length) return json({ changed: false, files: {} });

  // Tudo num único commit: uma gravação, uma publicação do site.
  const headSha = (await gh.api(`/git/ref/heads/${encodeURIComponent(env.GITHUB_BRANCH)}`)).object.sha;
  const baseTree = (await gh.api(`/git/commits/${headSha}`)).tree.sha;

  const photoEntries = [];
  for (const photo of photos) {
    const blob = await gh.api('/git/blobs', { method: 'POST', body: { content: photo.base64, encoding: 'base64' } });
    photoEntries.push({ path: `src/${photo.path}`, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const fileEntries = [];
  const newShas = {};
  for (const change of changes) {
    const blob = await gh.api('/git/blobs', { method: 'POST', body: { content: change.text, encoding: 'utf-8' } });
    newShas[change.name] = blob.sha;
    fileEntries.push({ path: FILES[change.name].path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await gh.api('/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: [...fileEntries, ...photoEntries] } });

  const labels = changes.map((change) => FILES[change.name].label);
  if (photos.length) labels.push(photos.length === 1 ? '1 foto' : `${photos.length} fotos`);
  const commit = await gh.api('/git/commits', {
    method: 'POST',
    body: {
      message: `Painel: atualiza ${labels.join(', ')}`,
      tree: tree.sha,
      parents: [headSha],
      author: { name: 'Painel Reis Barbearia', email: 'painel@users.noreply.github.com' },
    },
  });
  const update = await gh.call(`/git/refs/heads/${encodeURIComponent(env.GITHUB_BRANCH)}`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false },
    okStatuses: [409, 422],
  });
  if (!update.ok) throw new HttpError(409, 'O conteúdo foi alterado noutro lado entretanto. Recarrega a página para veres a versão mais recente.');

  const files = {};
  for (const name of names) files[name] = { sha: newShas[name] || current[names.indexOf(name)].sha };
  return json({ changed: true, files });
}

async function route(request, env, url) {
  const user = await authenticate(request, env);
  const { pathname } = url;
  if (pathname === '/' || pathname === '/admin') return Response.redirect(`${url.origin}/admin/`, 302);
  if (pathname === '/admin/api/content' && request.method === 'GET') return getContent(env, user);
  if (pathname === '/admin/api/image' && request.method === 'GET') return getImage(url, env);
  if (pathname === '/admin/api/save' && request.method === 'POST') return save(request, env);
  if (pathname.startsWith('/admin/api/')) throw new HttpError(404, 'Não encontrado.');
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Pedido inválido.');
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      return withHeaders(await route(request, env, url));
    } catch (error) {
      if (error instanceof HttpError) return withHeaders(json({ error: error.message, details: error.details }, error.status));
      console.error('Erro inesperado', error?.message);
      return withHeaders(json({ error: 'Ocorreu um erro. Tenta outra vez.' }, 500));
    }
  },
};
