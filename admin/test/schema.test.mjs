import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { FILES, cleanFile } from '../public/admin/schema.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`../../${FILES[name].path}`, import.meta.url)));
const copy = (value) => JSON.parse(JSON.stringify(value));
const paths = (result) => result.errors.map((e) => e.path);

test('the current content of every file is valid and unchanged, including key order', () => {
  for (const name of Object.keys(FILES)) {
    const data = load(name);
    const { value, errors } = cleanFile(name, data, data);
    assert.deepEqual(errors, [], name);
    assert.equal(JSON.stringify(value), JSON.stringify(data), name);
  }
});

test('unknown files are refused, including inherited object keys', () => {
  assert.equal(cleanFile('nope', {}, {}).errors.length, 1);
  assert.equal(cleanFile('__proto__', {}, {}).errors.length, 1);
  assert.equal(cleanFile('constructor', {}, {}).errors.length, 1);
});

test('fields that are not in the schema are dropped', () => {
  const data = load('reviews');
  const input = copy(data);
  input.extra = 'x';
  input.reviews[0].evil = 'y';
  const { value, errors } = cleanFile('reviews', input, data);
  assert.deepEqual(errors, []);
  assert.equal(value.extra, undefined);
  assert.equal(value.reviews[0].evil, undefined);
});

test('prices must be whole numbers in range', () => {
  const data = load('services');
  for (const bad of ['12', 12.5, -1, null]) {
    const input = copy(data);
    input.categories[0].services[0].price = bad;
    assert.deepEqual(paths(cleanFile('services', input, data)), ['categories.0.services.0.price'], String(bad));
  }
});

test('categories cannot be added, removed or have their id changed', () => {
  const data = load('services');
  const removed = copy(data); removed.categories.pop();
  assert.deepEqual(paths(cleanFile('services', removed, data)), ['categories']);
  const added = copy(data); added.categories.push({ ...added.categories[0], id: 'nova' });
  assert.deepEqual(paths(cleanFile('services', added, data)), ['categories']);
  const renamed = copy(data); renamed.categories[0].id = 'outra';
  assert.deepEqual(paths(cleanFile('services', renamed, data)), ['categories']);
});

test('categories can be reordered and renamed', () => {
  const data = load('services');
  const input = copy(data);
  input.categories.reverse();
  input.categories[0].label = 'Novo nome';
  assert.deepEqual(cleanFile('services', input, data).errors, []);
});

test('photo paths cannot leave the assets folder or be another file type', () => {
  const data = load('gallery');
  for (const bad of ['../secret.jpg', 'assets/../../x.jpg', 'assets/a..b.jpg', '/assets/x.jpg', 'https://evil.test/x.jpg', 'assets/x.svg', 'assets/x.html']) {
    const input = copy(data);
    input.photos[0].image = bad;
    assert.deepEqual(paths(cleanFile('gallery', input, data)), ['photos.0.image'], bad);
  }
});

test('links and phone numbers are checked', () => {
  const data = load('contact');
  for (const bad of ['javascript:alert(1)', 'http://www.fresha.com/x', 'https://evil.test/', 'https://www.fresha.com/"><script>']) {
    const input = copy(data);
    input.bookingUrl = bad;
    assert.deepEqual(paths(cleanFile('contact', input, data)), ['bookingUrl'], bad);
  }
  const phone = copy(data); phone.phone = '960116858';
  assert.deepEqual(paths(cleanFile('contact', phone, data)), ['phone']);
});

test('required lists cannot be emptied', () => {
  const data = load('gallery');
  assert.deepEqual(paths(cleanFile('gallery', { photos: [] }, data)), ['photos']);
});

test('the Fresha code is optional but must match when present', () => {
  const data = load('services');
  const empty = copy(data); empty.categories[0].services[0].offerItemId = '';
  assert.deepEqual(cleanFile('services', empty, data).errors, []);
  const bad = copy(data); bad.categories[0].services[0].offerItemId = 'abc';
  assert.deepEqual(paths(cleanFile('services', bad, data)), ['categories.0.services.0.offerItemId']);
});
