// Define o que se pode editar no painel. É usado no browser (para desenhar os formulários)
// e no Worker (para validar o que é guardado), por isso as regras só existem aqui.

const PHOTO_PATH = /^assets\/(?!.*\.\.)(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:jpe?g|png|webp)$/i;

const photoFields = [
  { key: 'image', type: 'photo', label: 'Foto', required: true },
  { key: 'alt', type: 'text', label: 'Descrição da foto', required: true, max: 160, hint: 'O que se vê na foto. Ajuda quem usa leitores de ecrã e o Google.' },
];

export const FILES = {
  services: {
    path: 'src/_data/services.json',
    label: 'Serviços',
    fields: [
      {
        key: 'categories', type: 'list', label: 'Categorias', singular: 'categoria', fixedBy: 'id', titleKey: 'label', min: 1,
        fields: [
          { key: 'id', type: 'hidden' },
          { key: 'label', type: 'text', label: 'Nome da categoria', required: true, max: 60 },
          {
            key: 'services', type: 'list', label: 'Serviços', singular: 'serviço', titleKey: 'name', metaTemplate: '€{price} · {duration}', min: 1,
            fields: [
              { key: 'name', type: 'text', label: 'Nome', required: true, max: 80 },
              { key: 'duration', type: 'text', label: 'Duração', required: true, max: 20, hint: 'Por exemplo: 30 min, 1h, 1h30' },
              { key: 'price', type: 'int', label: 'Preço em euros', required: true, min: 0, max: 9999 },
              { key: 'offerItemId', type: 'text', label: 'Código do serviço na Fresha', max: 30, pattern: '^s:\\d+$', patternMessage: 'Tem de ter este formato: s:21295258', hint: 'O valor depois de offerItemId= no link do serviço, por exemplo s:21295258. Se ficar vazio, o botão abre a página geral de marcações.' },
            ],
          },
        ],
      },
    ],
  },
  gallery: {
    path: 'src/_data/gallery.json',
    label: 'Galeria',
    fields: [
      { key: 'photos', type: 'list', label: 'Fotos', singular: 'foto', titleKey: 'alt', thumbKey: 'image', min: 1, fields: photoFields },
    ],
  },
  reviews: {
    path: 'src/_data/reviews.json',
    label: 'Avaliações',
    fields: [
      {
        key: 'reviews', type: 'list', label: 'Avaliações', singular: 'avaliação', titleKey: 'author', min: 1,
        fields: [
          { key: 'text', type: 'textarea', label: 'Texto', required: true, max: 1000 },
          { key: 'author', type: 'text', label: 'Autor', required: true, max: 80 },
          { key: 'stars', type: 'int', label: 'Estrelas', required: true, min: 1, max: 5, default: 5 },
        ],
      },
    ],
  },
  mestre: {
    path: 'src/_data/mestre.json',
    label: 'O Mestre',
    fields: [
      { key: 'name', type: 'text', label: 'Nome', required: true, max: 60 },
      { key: 'role', type: 'text', label: 'Função', required: true, max: 80 },
      {
        key: 'paragraphs', type: 'list', label: 'Texto', singular: 'parágrafo', titleKey: 'text', min: 1,
        fields: [{ key: 'text', type: 'textarea', label: 'Parágrafo', required: true, max: 1000 }],
      },
      { key: 'mainPhoto', type: 'group', label: 'Foto principal', fields: photoFields },
      { key: 'secondPhoto', type: 'group', label: 'Foto secundária', fields: photoFields },
    ],
  },
  contact: {
    path: 'src/_data/contact.json',
    label: 'Contactos',
    fields: [
      { key: 'phone', type: 'text', label: 'Telefone', required: true, max: 30, pattern: '^\\+\\d[\\d ]{6,}$', patternMessage: 'Escreve com o indicativo, por exemplo +351 960 116 858', hint: 'Com o indicativo. Também é usado nos botões de ligar e de WhatsApp.' },
      { key: 'street', type: 'text', label: 'Rua', required: true, max: 100 },
      { key: 'postalCity', type: 'text', label: 'Código postal e cidade', required: true, max: 80 },
      { key: 'country', type: 'text', label: 'País', required: true, max: 60 },
      {
        key: 'hours', type: 'list', label: 'Horário', singular: 'linha', titleKey: 'days', metaTemplate: '{value}', min: 1,
        fields: [
          { key: 'days', type: 'text', label: 'Dias', required: true, max: 40 },
          { key: 'value', type: 'text', label: 'Horas', required: true, max: 40, hint: 'Por exemplo: 10:00 — 20:00. Para dias fechados, escreve Encerrado.' },
        ],
      },
      { key: 'bookingUrl', type: 'text', label: 'Link de marcações na Fresha', required: true, max: 200, pattern: '^https://www\\.fresha\\.com/[^\\s"<>]+$', patternMessage: 'Tem de ser um link https://www.fresha.com/…', hint: 'Só muda se a página da Fresha mudar de endereço.' },
    ],
  },
};

// Valor inicial de um item novo numa lista.
export function emptyValue(fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'list') out[f.key] = [];
    else if (f.type === 'group') out[f.key] = emptyValue(f.fields);
    else if (f.type === 'int') out[f.key] = f.default ?? null;
    else out[f.key] = '';
  }
  return out;
}

function cleanField(f, input, previous, path, errors) {
  const fail = (message) => { errors.push({ path, message }); return input; };
  switch (f.type) {
    case 'hidden':
      return typeof input === 'string' ? input : fail('Valor inválido.');
    case 'text':
    case 'textarea': {
      if (typeof input !== 'string') return fail('Valor inválido.');
      const value = input.trim();
      if (!value) return f.required ? fail('Este campo é obrigatório.') : '';
      if (f.max && value.length > f.max) return fail(`Máximo de ${f.max} caracteres.`);
      if (f.pattern && !new RegExp(f.pattern).test(value)) return fail(f.patternMessage || 'Formato inválido.');
      return value;
    }
    case 'int':
      if (input === null || input === undefined || input === '') return f.required ? fail('Este campo é obrigatório.') : null;
      if (!Number.isInteger(input)) return fail('Tem de ser um número inteiro.');
      if (f.min !== undefined && input < f.min) return fail(`O mínimo é ${f.min}.`);
      if (f.max !== undefined && input > f.max) return fail(`O máximo é ${f.max}.`);
      return input;
    case 'photo':
      if (input === '' || input === null || input === undefined) return f.required ? fail('Escolhe uma foto.') : '';
      if (typeof input !== 'string' || !PHOTO_PATH.test(input)) return fail('Foto inválida.');
      return input;
    case 'group':
      if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Valor inválido.');
      return cleanFields(f.fields, input, previous, path, errors);
    case 'list': {
      if (!Array.isArray(input)) return fail('Valor inválido.');
      if (f.min && input.length < f.min) return fail(`Tem de ficar pelo menos ${f.min === 1 ? `1 ${f.singular}` : f.min}.`);
      if (f.fixedBy && Array.isArray(previous)) {
        const ids = (list) => list.map((item) => item?.[f.fixedBy]).sort().join('|');
        if (ids(input) !== ids(previous)) return fail(`Não é possível adicionar nem remover: ${f.label.toLowerCase()}.`);
      }
      return input.map((item, i) => {
        const itemPath = `${path}.${i}`;
        if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push({ path: itemPath, message: 'Valor inválido.' }); return item; }
        const before = f.fixedBy && Array.isArray(previous) ? previous.find((p) => p?.[f.fixedBy] === item[f.fixedBy]) : undefined;
        return cleanFields(f.fields, item, before, itemPath, errors);
      });
    }
    default:
      return fail('Campo desconhecido.');
  }
}

// Só guarda os campos previstos, pela ordem prevista.
function cleanFields(fields, input, previous, path, errors) {
  const out = {};
  for (const f of fields) {
    const childPath = path ? `${path}.${f.key}` : f.key;
    out[f.key] = cleanField(f, input[f.key], previous?.[f.key], childPath, errors);
  }
  return out;
}

export function cleanFile(name, input, previous) {
  if (!Object.hasOwn(FILES, name)) return { value: null, errors: [{ path: '', message: 'Ficheiro desconhecido.' }] };
  const def = FILES[name];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: null, errors: [{ path: '', message: 'Valor inválido.' }] };
  const errors = [];
  const value = cleanFields(def.fields, input, previous, '', errors);
  return { value, errors };
}
