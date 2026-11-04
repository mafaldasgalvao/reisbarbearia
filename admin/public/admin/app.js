import { FILES, emptyValue, cleanFile } from './schema.js';

const MAX_PHOTO_SIDE = 1600;
const $ = (id) => document.getElementById(id);

let files = {}; // nome → { sha, data, saved }
let active = 'services';
let errors = []; // { file, path, message }
let saving = false;
const pendingPhotos = new Map(); // caminho → { blob, url }
const shownPhotos = new Map(); // caminho → url local, para fotos acabadas de carregar
const openItems = new WeakSet();

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

const isDirty = (name) => JSON.stringify(files[name].data) !== files[name].saved;
const dirtyNames = () => Object.keys(files).filter(isDirty);
const errorAt = (path) => errors.find((e) => e.file === active && e.path === path);
const hasErrorInside = (path) => errors.some((e) => e.file === active && (e.path === path || e.path.startsWith(`${path}.`)));
const photoUrl = (path) => shownPhotos.get(path) || `api/image?path=${encodeURIComponent(path)}`;

/* ---------- Campos ---------- */
function fieldShell(field, path, control, labelFor) {
  const error = errorAt(path);
  const label = field.required
    ? el('label', { htmlFor: labelFor }, field.label, ' ', el('span', { class: 'required', text: '*', 'aria-hidden': 'true' }))
    : el('label', { htmlFor: labelFor, text: `${field.label} (opcional)` });
  return el('div', { class: `field${error ? ' has-error' : ''}`, 'data-path': path },
    label,
    control,
    field.hint ? el('p', { class: 'hint', text: field.hint }) : null,
    error ? el('p', { class: 'error', text: error.message }) : null);
}

// Corre quando se sai do campo, muitas vezes a meio de um clique noutro botão:
// redesenhar a página aqui faria esse clique perder-se, por isso só se limpa o erro deste campo.
function afterEdit(path) {
  errors = errors.filter((e) => !(e.file === active && e.path === path));
  const field = document.querySelector(`[data-path="${path}"]`);
  if (field) {
    field.classList.remove('has-error');
    field.querySelector(':scope > .error')?.remove();
    for (let item = field.closest('.item'); item; item = item.parentElement.closest('.item')) {
      if (!item.querySelector('.field.has-error, .list.has-error')) item.classList.remove('has-error');
    }
  }
  refreshBar();
  renderTabs();
}

function renderTextField(field, holder, path) {
  const id = `f-${path}`;
  const input = field.type === 'textarea'
    ? el('textarea', { id, value: holder[field.key] ?? '' })
    : el('input', { id, type: 'text', value: holder[field.key] ?? '', autocomplete: 'off' });
  if (field.required) input.required = true;
  input.addEventListener('input', () => { holder[field.key] = input.value; refreshBar(); renderTabs(); refreshSummary(input); });
  input.addEventListener('change', () => afterEdit(path));
  return fieldShell(field, path, input, id);
}

function renderIntField(field, holder, path) {
  const id = `f-${path}`;
  const input = el('input', { id, type: 'number', inputMode: 'numeric', step: '1', value: holder[field.key] ?? '' });
  if (field.min !== undefined) input.min = field.min;
  if (field.max !== undefined) input.max = field.max;
  input.addEventListener('input', () => {
    holder[field.key] = input.value === '' ? null : Number(input.value);
    refreshBar(); renderTabs(); refreshSummary(input);
  });
  input.addEventListener('change', () => afterEdit(path));
  return fieldShell(field, path, input, id);
}

function slugify(name) {
  const base = name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return base || 'foto';
}

// Reduz a foto no browser: as fotos do telemóvel são grandes demais para o site.
async function preparePhoto(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível abrir esta foto. Experimenta uma foto em JPG ou PNG.');
  }
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = el('canvas', { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  let blob = await encode('image/webp');
  let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') { blob = await encode('image/jpeg'); ext = 'jpg'; }
  if (!blob) throw new Error('Não foi possível preparar esta foto.');
  const random = crypto.getRandomValues(new Uint8Array(3));
  const suffix = [...random].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { blob, path: `assets/galeria/${slugify(file.name)}-${suffix}.${ext}` };
}

function renderPhotoField(field, holder, path) {
  const id = `f-${path}`;
  const value = holder[field.key];
  const input = el('input', { id, type: 'file', accept: 'image/*' });
  const button = el('button', { type: 'button', class: 'btn', text: value ? 'Trocar foto' : 'Escolher foto', onclick: () => input.click() });
  input.addEventListener('change', async () => {
    const [file] = input.files;
    if (!file) return;
    button.disabled = true;
    button.textContent = 'A preparar…';
    try {
      const { blob, path: newPath } = await preparePhoto(file);
      const url = URL.createObjectURL(blob);
      pendingPhotos.set(newPath, { blob, url });
      shownPhotos.set(newPath, url);
      holder[field.key] = newPath;
      errors = errors.filter((e) => !(e.file === active && e.path === path));
      renderContent();
      refreshBar();
      renderTabs();
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = false;
      button.textContent = value ? 'Trocar foto' : 'Escolher foto';
    }
  });
  const preview = value
    ? el('img', { src: photoUrl(value), alt: '', loading: 'lazy' })
    : el('span', { class: 'photo-empty', text: 'Sem foto' });
  return fieldShell(field, path, el('div', { class: 'photo' }, preview, button, input), id);
}

function renderGroup(field, holder, path) {
  return el('div', { class: 'group' }, el('h3', { text: field.label }), ...renderFields(field.fields, holder[field.key], path));
}

function fillTemplate(template, item) {
  return template.replace(/\{(\w+)\}/g, (_, key) => item[key] ?? '');
}

function summaryParts(field, item, index) {
  const title = (item[field.titleKey] || '').toString().trim();
  return {
    title: title.length > 70 ? `${title.slice(0, 70)}…` : title || 'Por preencher',
    meta: field.metaTemplate ? fillTemplate(field.metaTemplate, item) : '',
    index,
  };
}

// Atualiza o título do item enquanto se escreve, sem redesenhar a página.
function refreshSummary(input) {
  const details = input.closest('.item');
  if (details?._refresh) details._refresh();
}

function moveItem(list, from, to) {
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  renderContent();
  refreshBar();
  renderTabs();
}

function renderList(field, holder, path) {
  const list = holder[field.key];
  const listError = errorAt(path);
  const wrap = el('div', { class: `list${listError ? ' has-error' : ''}`, 'data-path': path },
    el('p', { class: 'list-title' }, field.label, ' ', el('span', { class: 'count', text: `(${list.length})` })));

  list.forEach((item, i) => {
    const itemPath = `${path}.${i}`;
    const details = el('details', { class: `item${hasErrorInside(itemPath) ? ' has-error' : ''}`, open: openItems.has(item) || hasErrorInside(itemPath) });
    details.addEventListener('toggle', () => { if (details.open) openItems.add(item); else openItems.delete(item); });
    const title = el('span', { class: 'item-title' });
    const meta = el('span', { class: 'item-meta' });
    const thumb = field.thumbKey && item[field.thumbKey] ? el('img', { class: 'item-thumb', src: photoUrl(item[field.thumbKey]), alt: '', loading: 'lazy' }) : null;
    details._refresh = () => {
      const parts = summaryParts(field, item, i);
      title.textContent = parts.title;
      meta.textContent = parts.meta;
    };
    details._refresh();
    details.append(el('summary', {}, thumb, el('span', { class: 'item-text' }, title, meta)));

    const actions = el('div', { class: 'item-actions' },
      el('button', { type: 'button', class: 'btn', text: '↑ Subir', disabled: i === 0, onclick: () => moveItem(list, i, i - 1) }),
      el('button', { type: 'button', class: 'btn', text: '↓ Descer', disabled: i === list.length - 1, onclick: () => moveItem(list, i, i + 1) }),
      field.fixedBy ? null : el('button', {
        type: 'button', class: 'btn btn-danger', text: 'Remover', disabled: Boolean(field.min && list.length <= field.min),
        onclick: () => { list.splice(i, 1); errors = errors.filter((e) => !(e.file === active && (e.path === path || e.path.startsWith(`${path}.`)))); renderContent(); refreshBar(); renderTabs(); },
      }));
    details.append(el('div', { class: 'item-body' }, ...renderFields(field.fields, item, itemPath), actions));
    wrap.append(details);
  });

  if (listError) wrap.append(el('p', { class: 'error', text: listError.message }));
  if (!field.fixedBy) {
    wrap.append(el('button', {
      type: 'button', class: 'btn btn-add', text: `+ Adicionar ${field.singular}`,
      onclick: () => {
        const item = emptyValue(field.fields);
        list.push(item);
        openItems.add(item);
        errors = errors.filter((e) => !(e.file === active && e.path === path));
        renderContent();
        refreshBar();
        renderTabs();
        const added = document.querySelector(`[data-path="${path}"] > .item:last-of-type`);
        added?.scrollIntoView({ block: 'center' });
        added?.querySelector('.item-body input, .item-body textarea, .item-body button')?.focus({ preventScroll: true });
      },
    }));
  }
  return wrap;
}

function renderFields(fields, holder, parentPath) {
  return fields.filter((f) => f.type !== 'hidden').map((field) => {
    const path = parentPath ? `${parentPath}.${field.key}` : field.key;
    if (field.type === 'list') return renderList(field, holder, path);
    if (field.type === 'group') return renderGroup(field, holder, path);
    if (field.type === 'int') return renderIntField(field, holder, path);
    if (field.type === 'photo') return renderPhotoField(field, holder, path);
    return renderTextField(field, holder, path);
  });
}

/* ---------- Página ---------- */
// Os botões só são criados uma vez, para um clique nunca cair num botão acabado de substituir.
function renderTabs() {
  const tabs = $('tabs');
  if (!tabs.children.length) {
    for (const [name, def] of Object.entries(FILES)) {
      tabs.append(el('button', {
        type: 'button', class: 'tab', 'data-file': name,
        onclick: () => { active = name; renderTabs(); renderContent(); window.scrollTo(0, 0); },
      }, def.label, el('span', { class: 'dot', title: 'Alterações por guardar' })));
    }
  }
  for (const button of tabs.children) {
    const name = button.dataset.file;
    button.setAttribute('aria-current', name === active ? 'page' : 'false');
    button.querySelector('.dot').hidden = !isDirty(name);
  }
}

function renderContent() {
  $('content').replaceChildren(...renderFields(FILES[active].fields, files[active].data, ''));
}

function setStatus(message, kind = '') {
  const status = $('status');
  status.textContent = message;
  status.className = `status${kind ? ` is-${kind}` : ''}`;
}

function refreshBar() {
  const dirty = dirtyNames().length > 0 || pendingPhotosInUse().length > 0;
  $('save').disabled = !dirty || saving;
  $('discard').disabled = !dirty || saving;
  $('save').textContent = saving ? 'A guardar…' : 'Guardar';
  if (dirty && !saving && !$('status').classList.contains('is-error')) setStatus('Tens alterações por guardar.');
  if (dirty && $('status').classList.contains('is-ok')) setStatus('Tens alterações por guardar.');
}

function pendingPhotosInUse() {
  const text = dirtyNames().map((name) => JSON.stringify(files[name].data)).join('');
  return [...pendingPhotos.keys()].filter((path) => text.includes(JSON.stringify(path)));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Não foi possível ler a foto.'));
    reader.readAsDataURL(blob);
  });
}

function showFirstError() {
  const first = errors[0];
  if (!first) return;
  if (active !== first.file) { active = first.file; renderTabs(); }
  renderContent();
  const target = document.querySelector('.field.has-error, .list.has-error');
  target?.scrollIntoView({ block: 'center' });
  target?.querySelector('input, textarea, button')?.focus({ preventScroll: true });
}

async function save() {
  const names = dirtyNames();
  if (!names.length || saving) return;

  errors = names.flatMap((name) => cleanFile(name, files[name].data, JSON.parse(files[name].saved)).errors.map((e) => ({ file: name, ...e })));
  if (errors.length) {
    setStatus(errors.length === 1 ? 'Há 1 campo por corrigir.' : `Há ${errors.length} campos por corrigir.`, 'error');
    showFirstError();
    return;
  }

  saving = true;
  setStatus('A guardar…');
  refreshBar();
  try {
    const paths = pendingPhotosInUse();
    const photos = await Promise.all(paths.map(async (path) => ({ path, base64: await blobToBase64(pendingPhotos.get(path).blob) })));
    const body = { files: {}, photos };
    const sent = {};
    for (const name of names) {
      const { value } = cleanFile(name, files[name].data, JSON.parse(files[name].saved));
      sent[name] = value;
      body.files[name] = { sha: files[name].sha, data: value };
    }
    const response = await fetch('api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));

    if (response.status === 401) { showFatal('A tua sessão terminou. Recarrega a página para entrares de novo. As alterações por guardar perdem-se.'); return; }
    if (response.status === 422 && Array.isArray(result.details)) {
      errors = result.details;
      setStatus(result.error, 'error');
      showFirstError();
      return;
    }
    if (!response.ok) { setStatus(result.error || 'Não foi possível guardar. Tenta outra vez.', 'error'); return; }

    for (const name of names) {
      files[name].data = sent[name];
      files[name].saved = JSON.stringify(sent[name]);
      files[name].sha = result.files[name]?.sha || files[name].sha;
    }
    paths.forEach((path) => pendingPhotos.delete(path));
    errors = [];
    setStatus(result.changed ? 'Guardado. O site atualiza dentro de 1 a 2 minutos.' : 'Não havia nada para guardar.', 'ok');
    renderContent();
  } catch {
    setStatus('Sem ligação. As alterações não foram guardadas. Tenta outra vez.', 'error');
  } finally {
    saving = false;
    refreshBar();
    renderTabs();
  }
}

function discard() {
  if (!window.confirm('Anular todas as alterações por guardar?')) return;
  for (const name of dirtyNames()) files[name].data = JSON.parse(files[name].saved);
  pendingPhotos.clear();
  errors = [];
  setStatus('');
  renderContent();
  renderTabs();
  refreshBar();
}

function showFatal(message) {
  $('bar').hidden = true;
  $('tabs').replaceChildren();
  window.removeEventListener('beforeunload', warnBeforeLeaving);
  $('content').replaceChildren(el('div', { class: 'notice' },
    el('p', { text: message }),
    el('button', { type: 'button', class: 'btn btn-primary', text: 'Recarregar', onclick: () => location.reload() })));
}

function warnBeforeLeaving(event) {
  if (dirtyNames().length) event.preventDefault();
}

async function start() {
  try {
    const response = await fetch('api/content');
    if (response.status === 401) { showFatal('A tua sessão terminou. Recarrega a página para entrares de novo.'); return; }
    const result = await response.json();
    if (!response.ok) { showFatal(result.error || 'Não foi possível carregar o conteúdo.'); return; }
    $('email').textContent = result.email;
    for (const [name, file] of Object.entries(result.files)) {
      files[name] = { sha: file.sha, data: file.data, saved: JSON.stringify(file.data) };
    }
  } catch {
    showFatal('Sem ligação. Verifica a internet e tenta outra vez.');
    return;
  }
  $('bar').hidden = false;
  $('save').addEventListener('click', save);
  $('discard').addEventListener('click', discard);
  window.addEventListener('beforeunload', warnBeforeLeaving);
  renderTabs();
  renderContent();
  refreshBar();
}

start();
