import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [epubInput, outputInput = ".cache/articles.raw.json"] = process.argv.slice(2);

if (!epubInput) {
  console.error("用法：node scripts/parse-economist-epub.mjs <epub> [output.json]");
  process.exit(1);
}

const epubPath = resolve(epubInput);
const outputPath = resolve(outputInput);

function readFromEpub(path) {
  return execFileSync("unzip", ["-p", epubPath, `EPUB/${path}`], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function cleanText(value = "") {
  return decodeHtml(
    value
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractClass(html, tag, className) {
  const pattern = new RegExp(
    `<${tag}[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`,
    "i",
  );
  return cleanText(html.match(pattern)?.[1] || "");
}

function extractOriginUrl(html) {
  const withClass = html.match(
    /<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*origin_link[^"']*["'][^>]*>/i,
  );
  if (withClass) return decodeHtml(withClass[1]);

  const links = [...html.matchAll(/<a[^>]*href=["'](https:\/\/www\.economist\.com\/[^"']+)["'][^>]*>/gi)];
  return decodeHtml(links.at(-1)?.[1] || "");
}

function publishedDateFromUrl(sourceUrl) {
  const match = sourceUrl.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
  if (!match) return "";

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return "";

  const monthName = new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  const remainder = day % 100;
  const suffix = remainder >= 11 && remainder <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  return `${monthName} ${day}${suffix} ${year}`;
}

function extractArticle(path, section, tocTitle) {
  const html = readFromEpub(path);
  const sourceUrl = extractOriginUrl(html);
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const contentOnly = body
    .replace(/<p[^>]*class=["'][^"']*link_navbar[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<hr\s*\/?>/gi, "")
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, "")
    .replace(/<h3[^>]*>[\s\S]*?<\/h3>/gi, "")
    .replace(/<span[^>]*class=["'][^"']*te_section_title[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<span[^>]*class=["'][^"']*te_fly_span[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");

  return {
    id: path.replace(/\.html?$/i, ""),
    section,
    titleEn: extractClass(html, "h1", "te_article_title") || cleanText(tocTitle),
    rubricEn: extractClass(html, "h3", "te_article_rubric"),
    // EPUB 內的日期欄位可能把整期文章都標成同一天；官方文章網址的
    // /YYYY/MM/DD/ 才是逐篇發布日期，因此優先採用網址日期。
    publishedEn: publishedDateFromUrl(sourceUrl) || extractClass(html, "h3", "te_article_datePublished"),
    sourceUrl,
    sourceFile: path,
    textEn: cleanText(contentOnly),
  };
}

const toc = readFromEpub("book_toc.html");
const packageMetadata = readFromEpub("content.opf");
const issueDate = cleanText(toc.match(/<p[^>]*class=["']issue_date_p["'][^>]*>(.*?)<\/p>/i)?.[1] || "");
const issueKey = cleanText(
  packageMetadata.match(/<dc:title[^>]*>TheEconomist\.(\d{4}\.\d{2}\.\d{2})<\/dc:title>/i)?.[1] || "",
);
const sourceModifiedAt = cleanText(
  packageMetadata.match(/<meta[^>]*property=["']dcterms:modified["'][^>]*>(.*?)<\/meta>/i)?.[1] || "",
);
const sectionLinks = [...toc.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*sec_toc_item[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)].map(
  (match) => ({ path: match[1], name: cleanText(match[2]) }),
);

const articles = [];

for (const section of sectionLinks) {
  const sectionHtml = readFromEpub(section.path);
  const articleLinks = [...sectionHtml.matchAll(/<a[^>]*href=["']([^"']+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi)];

  for (const link of articleLinks) {
    const article = extractArticle(link[1], section.name, link[2]);
    if (article.titleEn && article.textEn.length > 200) articles.push(article);
  }
}

const payload = {
  publication: "The Economist",
  issueKey,
  issueFolder: `te_${issueKey}`,
  issueDate,
  sourceModifiedAt,
  parsedAt: new Date().toISOString(),
  sectionCount: sectionLinks.length,
  articleCount: articles.length,
  articles,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`已解析 ${payload.articleCount} 篇文章、${payload.sectionCount} 個欄目。`);
