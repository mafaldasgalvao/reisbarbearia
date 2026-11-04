// Gera o site a partir de src/index.njk + src/_data/*.json (editados no painel, ver admin/README.md).
// Resultado em _site/, que é o que vai para o GitHub Pages.
export default function (eleventyConfig) {
  eleventyConfig.setNunjucksEnvironmentOptions({ autoescape: true });

  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/cookie-consent.js");
  eleventyConfig.addPassthroughCopy("src/politica-de-cookies.html");
  eleventyConfig.addPassthroughCopy("src/politica-de-privacidade.html");
  eleventyConfig.addPassthroughCopy("src/admin");
  eleventyConfig.addPassthroughCopy("src/robots.txt");
  eleventyConfig.addPassthroughCopy("src/sitemap.xml");

  eleventyConfig.addFilter("stars", (n) => {
    const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    return "★".repeat(v) + "☆".repeat(5 - v);
  });

  // "+351 960 116 858" → "351960116858", para os links tel: e wa.me.
  eleventyConfig.addFilter("digits", (s) => String(s ?? "").replace(/\D/g, ""));

  // Pesquisa do Google Maps: palavras separadas por "+".
  eleventyConfig.addFilter("plus_query", (s) =>
    String(s ?? "").trim().split(/\s+/).map(encodeURIComponent).join("+")
  );

  return {
    dir: { input: "src", output: "_site", data: "_data" },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk",
  };
}
