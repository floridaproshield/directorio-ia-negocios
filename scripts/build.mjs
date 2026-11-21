// Runs on every Vercel deploy. index.html stays the single source of truth (the
// daily review edits only that file); this script reads its data and writes
// dist/ with the listing in plain HTML and one real page per tool, in Spanish
// and English, so search engines can read and link to each of them.
//
// If the data can't be read, the site is published exactly as index.html is.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const SITE = 'https://ia.sunrisewebs.com'
const SKIP = new Set(['.git', '.github', '.vercel', 'dist', 'scripts', 'node_modules', 'vercel.json', 'README.md', 'index.html', 'sitemap.xml'])

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const pad = (n) => String(n).padStart(2, '0')
const json = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
const arrow = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>'

const clip = (text, max = 155) => {
  const plain = text.replace(/\s+/g, ' ').trim()
  if (plain.length <= max) return plain
  return `${plain.slice(0, max - 1).replace(/[\s,;:.·-]+\S*$/, '')}…`
}

const toolPath = (lang, slug) => (lang === 'en' ? `/en/tools/${slug}` : `/herramientas/${slug}`)
const homePath = (lang) => (lang === 'en' ? '/en' : '/')

const COPY = {
  es: {
    site: 'Directorio IA',
    home: 'Directorio',
    related: 'Otras herramientas',
    title: (name) => `${name}: qué es, precios y usos para negocios | Directorio IA`,
    crumb: 'Herramientas de IA',
  },
  en: {
    site: 'AI Tools Directory',
    home: 'Directory',
    related: 'More tools',
    title: (name) => `${name} for small business: uses and pricing | AI Tools Directory`,
    crumb: 'AI tools',
  },
}

function readData(html) {
  const start = html.lastIndexOf('<script>') + '<script>'.length
  const code = html.slice(start, html.lastIndexOf('</script>'))
  const slugs = code.match(/^const ARTICLE_SLUGS = .*$/m)?.[0]
  const articlesAt = code.indexOf('const ART_MUSE =')
  const articlesEnd = code.indexOf('const articleEl =')
  const dataEnd = code.indexOf('const $ = s=>')
  if (!slugs || articlesAt < 0 || articlesEnd < 0 || dataEnd < 0) throw new Error('index.html changed shape')
  const box = {}
  vm.createContext(box)
  vm.runInContext(
    `${code.slice(0, dataEnd)}\n${slugs}\n${code.slice(articlesAt, articlesEnd)}\n` +
      'globalThis.DATA={TOOLS,TOOLS_EN,CAT_EN,UI,ARTICLE_SLUGS,ARTICLES}',
    box,
  )
  const data = JSON.parse(JSON.stringify(box.DATA))
  if (!data.TOOLS.length || data.TOOLS.length !== data.TOOLS_EN.length) throw new Error('tool lists do not match')
  return data
}

function build(html, data, lastmod) {
  const { TOOLS, TOOLS_EN, CAT_EN, UI, ARTICLE_SLUGS, ARTICLES } = data
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0].replace(/\.art-body h3/g, '.art-body h2')
  const fonts = html.match(/<link rel="preconnect"[\s\S]*?rel="stylesheet">/)[0]

  const tools = TOOLS.map((tool, i) => {
    const slug = ARTICLE_SLUGS[tool.name]
    const article = slug && ARTICLES[slug]
    return {
      ...tool,
      index: i,
      slug: article?.es && article?.en ? slug : null,
      article,
      text: {
        es: { desc: tool.desc, price: tool.price, cat: tool.cat },
        en: { desc: TOOLS_EN[i].desc, price: TOOLS_EN[i].price, cat: CAT_EN[tool.cat] || tool.cat },
      },
    }
  })
  const withPage = tools.filter((t) => t.slug)

  const entry = (tool, lang) => {
    const t = tool.text[lang]
    const name = tool.slug
      ? `<a class="e-title-link" href="${toolPath(lang, tool.slug)}">${esc(tool.name)}</a>`
      : esc(tool.name)
    return `<article class="e v-row"><div class="e-top"><span class="e-idx">${pad(tool.index + 1)}</span><span class="e-cat">${esc(t.cat)}</span></div><h3 class="e-name">${name}</h3><p class="e-desc">${esc(t.desc)}</p><div class="e-meta"><span class="e-price">${esc(t.price)}</span><a class="e-link" href="${esc(tool.url)}" target="_blank" rel="noopener">${esc(UI[lang].visit)} ${arrow}<span class="sr"> ${esc(tool.name)}</span></a></div></article>`
  }

  const alternates = (es, en) =>
    `<link rel="alternate" hreflang="es" href="${SITE}${es}">\n<link rel="alternate" hreflang="en" href="${SITE}${en}">\n<link rel="alternate" hreflang="x-default" href="${SITE}${es}">`

  const social = (lang, title, description, url) =>
    `<meta property="og:type" content="website">\n<meta property="og:site_name" content="${COPY[lang].site}">\n<meta property="og:title" content="${esc(title)}">\n<meta property="og:description" content="${esc(description)}">\n<meta property="og:url" content="${url}">\n<meta property="og:image" content="${SITE}/og.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta name="twitter:card" content="summary_large_image">`

  const page = ({ lang, path, esPath, enPath, title, description, ld, body }) => {
    const u = UI[lang]
    const url = `${SITE}${path === '/' ? '/' : path}`
    return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#000000">
<link rel="canonical" href="${url}">
${alternates(esPath, enPath)}
${social(lang, title, description, url)}
${fonts}
${style}
<style>
.lang-switch a{display:inline-block;padding:7px 14px;font:600 12px var(--f-mono);text-decoration:none;color:var(--muted)}
.lang-switch a[aria-current]{background:var(--accent);color:var(--accent-ink)}
.art-related{margin-top:72px;max-width:68ch}
.art-related h2{margin:0 0 16px;font-weight:500;font-size:clamp(1.45rem,3vw,2rem);letter-spacing:-.025em}
.art-related ul{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.art-related li{border-bottom:1px solid var(--line)}
.art-related a{display:block;padding:14px 0;text-decoration:none}
.art-related a:hover{color:var(--accent)}
.index-head{padding:64px 0 32px}
.index-head h1{margin:0 0 20px;font-weight:600;letter-spacing:-.05em;line-height:.95;font-size:clamp(3rem,10vw,7rem)}
.index-head h1 em{font-family:var(--f-serif);font-weight:400;font-style:italic;letter-spacing:-.03em}
.index-head p{margin:0;max-width:52ch;color:var(--fg-2);line-height:1.65}
</style>
${ld.map(json).join('\n')}
</head>
<body class="ready">
<header class="wrap">
  <div class="top">
    <a class="brand" href="${homePath(lang)}">${u.brand}</a>
    <nav class="mono" aria-label="${esc(u.navLabel)}"><a href="${homePath(lang)}">${COPY[lang].home}</a></nav>
    <div class="top-right">
      <div class="lang-switch" role="group" aria-label="Idioma / Language">
        <a href="${esPath}" hreflang="es"${lang === 'es' ? ' aria-current="true"' : ''}>ES</a>
        <a href="${enPath}" hreflang="en"${lang === 'en' ? ' aria-current="true"' : ''}>EN</a>
      </div>
    </div>
  </div>
</header>
<main>
${body}
</main>
<footer><div class="wrap mono"><span>${esc(u.foot1)}</span><span>${esc(u.foot2)}</span></div></footer>
</body>
</html>
`
  }

  const relatedTo = (tool) => {
    const others = withPage.filter((t) => t !== tool)
    const same = others.filter((t) => t.cat === tool.cat)
    return [...same, ...others.filter((t) => t.cat !== tool.cat)].slice(0, 4)
  }

  const toolPage = (tool, lang) => {
    const a = tool.article[lang]
    const path = toolPath(lang, tool.slug)
    const title = COPY[lang].title(tool.name)
    const description = clip(a.verdict)
    const isMuse = tool.slug === 'muse'
    const foot = isMuse
      ? `<div class="art-foot"><div><div class="code-label mono">${esc(a.codeLabel)}</div><div class="art-code">QY02JG</div></div><a class="btn btn-primary" href="https://muse.ai/join" target="_blank" rel="noopener">${esc(a.visit)} Muse ${arrow}</a></div>`
      : `<div class="art-foot"><div><div class="code-label mono">${esc(a.official || '')}</div><div class="art-code" style="font-size:clamp(1.4rem,4vw,2.2rem);color:var(--fg)">${esc(tool.name)}</div></div><a class="btn btn-primary" href="${esc(tool.url)}" target="_blank" rel="noopener">${esc(a.visit)} ${esc(tool.name)} ${arrow}</a></div>`
    const related = relatedTo(tool)
      .map((t) => `<li><a href="${toolPath(lang, t.slug)}">${esc(t.name)}</a></li>`)
      .join('')
    return page({
      lang,
      path,
      esPath: toolPath('es', tool.slug),
      enPath: toolPath('en', tool.slug),
      title,
      description,
      ld: [
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: title,
          description,
          inLanguage: lang,
          mainEntityOfPage: `${SITE}${path}`,
          about: { '@type': 'SoftwareApplication', name: tool.name, url: tool.url, applicationCategory: tool.text[lang].cat },
          publisher: { '@type': 'Organization', name: 'Sunrise Digital', url: 'https://sunrisewebs.com' },
        },
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: COPY[lang].crumb, item: `${SITE}${homePath(lang)}` },
            { '@type': 'ListItem', position: 2, name: tool.name, item: `${SITE}${path}` },
          ],
        },
      ],
      body: `<article class="article wrap">
<a class="art-back" href="${homePath(lang)}">${esc(a.back)}</a>
<p class="mono art-kick">${a.kick}</p>
<h1 class="art-title">${esc(tool.name)}</h1>
<p class="art-verdict"><span class="vlabel">${esc(a.vlabel)}</span>${esc(a.verdict)}</p>
<div class="art-body">${a.sections.map((s) => `<h2>${s.h}</h2>${s.ps.map((p) => `<p>${p}</p>`).join('')}`).join('')}</div>
${foot}
<nav class="art-related" aria-label="${COPY[lang].related}"><h2>${COPY[lang].related}</h2><ul>${related}</ul></nav>
</article>`,
    })
  }

  const itemList = (lang) => ({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: UI[lang].title,
    numberOfItems: withPage.length,
    itemListElement: withPage.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      url: `${SITE}${toolPath(lang, t.slug)}`,
    })),
  })

  const englishHome = page({
    lang: 'en',
    path: '/en',
    esPath: '/',
    enPath: '/en',
    title: 'AI tools for small businesses, reviewed daily | AI Tools Directory',
    description: `${TOOLS.length} AI tools for small businesses, by category, with clear pricing and an article on each one. Checked every day.`,
    ld: [itemList('en')],
    body: `<section class="wrap"><div class="index-head"><h1>AI tools for <em>small businesses</em></h1><p>${UI.en.lede}</p></div><div class="dir">${tools.map((t) => entry(t, 'en')).join('')}</div></section>`,
  })

  // The Spanish home keeps its interactive page; it gains the same content as
  // plain HTML, real links to each article, and the tags it was missing.
  const HOME_ES = {
    title: 'Herramientas de IA para pequeños negocios: directorio con precios',
    description: `${TOOLS.length} herramientas de IA para negocios pequeños, por categoría, con precio claro y un artículo de cada una. Revisado cada día.`,
  }
  const legacyHash = `<script>(function(m){if(m)location.replace('/herramientas/'+m[1])})(location.hash.match(/^#articulo-([a-z]+)$/))</script>`
  const headExtra = [
    legacyHash,
    `<link rel="canonical" href="${SITE}/">`,
    alternates('/', '/en'),
    social('es', HOME_ES.title, HOME_ES.description, `${SITE}/`),
    json(itemList('es')),
  ].join('\n')
  const replaceOnce = (text, from, to) => {
    if (!text.includes(from)) throw new Error(`index.html is missing: ${from}`)
    return text.replace(from, () => to)
  }
  let home = replaceOnce(html, '</head>', `${headExtra}\n</head>`)
  // The page's own title and description are short and generic; search results
  // get a fuller version. Soft replacements: the daily review owns index.html.
  home = home
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(HOME_ES.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(HOME_ES.description)}">`)
    // The page script sets the title again on load from its own copy; keep them the same.
    .replace(/(es:\{title:)"[^"]*",meta:"[^"]*"/, (_, a) => `${a}${JSON.stringify(HOME_ES.title)},meta:${JSON.stringify(HOME_ES.description)}`)
  home = replaceOnce(home, '<div class="dir" id="dir"></div>', `<div class="dir" id="dir">${tools.map((t) => entry(t, 'es')).join('')}</div>`)
  home = replaceOnce(home, '<span id="foot-2">', '<a href="/en" hreflang="en">English</a>\n    <span id="foot-2">')
  // The numbers in index.html are typed by hand and go stale between reviews;
  // the plain HTML (what search engines and the first paint see) uses the data.
  // These are soft replacements: if the markup changes, the page still ships.
  const categories = new Set(TOOLS.map((t) => t.cat)).size
  const results = (n) => `${n} ${n === 1 ? UI.es.result : UI.es.results}`
  home = home
    .replace(/(<strong id="stat-total">)[^<]*(<\/strong>)/, `$1${TOOLS.length}$2`)
    .replace(/(<strong>)[^<]*(<\/strong><span id="stat-lbl-cats">)/, `$1${categories}$2`)
    .replace(/(<span[^>]*id="count"[^>]*>)[^<]*(<\/span>)/, (_, a, b) => `${a}${results(TOOLS.length)}${b}`)
    // The "nothing found" text is filled in by the page script only when a
    // search comes up empty; left in the HTML, readers without the script see
    // it under a full list.
    .replace(/(<p id="empty-title">)[^<]*(<\/p>)/, '$1$2')
    .replace(/(<span id="empty-text">)[^<]*(<\/span>)/, '$1$2')
    .replace(/(<button type="button" id="reset">)[^<]*(<\/button>)/, '$1$2')
  if (!home.includes('#articulo-${slug}')) throw new Error('article links changed')
  home = home.replaceAll('#articulo-${slug}', '${lang==="en"?"/en/tools/":"/herramientas/"}${slug}')

  const files = new Map([
    ['index.html', home],
    ['en.html', englishHome],
  ])
  for (const tool of withPage) {
    files.set(`herramientas/${tool.slug}.html`, toolPage(tool, 'es'))
    files.set(`en/tools/${tool.slug}.html`, toolPage(tool, 'en'))
  }

  // Every page lists its Spanish and English versions (hreflang) and the date of
  // the last review, which the daily review writes into the source sitemap.
  const pairs = [['/', '/en'], ...withPage.map((t) => [toolPath('es', t.slug), toolPath('en', t.slug)])]
  const links = (es, en) =>
    [['es', es], ['en', en], ['x-default', es]]
      .map(([code, loc]) => `\n    <xhtml:link rel="alternate" hreflang="${code}" href="${SITE}${loc}"/>`)
      .join('')
  const url = (loc, es, en) =>
    `  <url>\n    <loc>${SITE}${loc}</loc>\n    <lastmod>${lastmod}</lastmod>${links(es, en)}\n  </url>`
  files.set(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${pairs
      .flatMap(([es, en]) => [url(es, es, en), url(en, es, en)])
      .join('\n')}\n</urlset>\n`,
  )
  return files
}

const html = await readFile(join(root, 'index.html'), 'utf8')
const sourceSitemap = await readFile(join(root, 'sitemap.xml'), 'utf8').catch(() => '')
const lastmod = sourceSitemap.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] || new Date().toISOString().slice(0, 10)

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
for (const name of await readdir(root)) {
  if (!SKIP.has(name)) await cp(join(root, name), join(dist, name), { recursive: true })
}

let files
try {
  files = build(html, readData(html), lastmod)
} catch (error) {
  console.warn(`Publishing index.html as is: ${error.message}`)
  files = new Map([['index.html', html], ['sitemap.xml', sourceSitemap]])
}
for (const [name, content] of files) {
  const out = join(dist, name)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, content)
}
console.log(`Wrote ${files.size} files to dist/`)
