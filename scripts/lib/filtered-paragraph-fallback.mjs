import { CONTENT_FILTER_REASON, isContentFilterError } from "./content-filter-policy.mjs";

// 內容安全篩選以整批輸入判斷；整篇被擋時改為對半拆批，最後只讓真正觸發篩選的段落保留英文。
// 隔離檔若沒有這個策略標記，代表是舊版「整篇隔離」的結果，下次更新時要重新嘗試。
export const FILTER_SPLIT_STRATEGY = "paragraph-split-v1";

export async function translateWithFilterSplit(chunk, translateChunk) {
  try {
    const result = await translateChunk(chunk);
    return {
      translations: result.translations,
      attempts: result.attempts || 0,
      filteredIndexes: [],
      filterMessages: [],
    };
  } catch (error) {
    if (!isContentFilterError(error)) throw error;
    if (chunk.length <= 1) {
      return {
        translations: [],
        attempts: 1,
        filteredIndexes: chunk.map((paragraph) => paragraph.index),
        filterMessages: [error.message],
      };
    }
    const middle = Math.ceil(chunk.length / 2);
    const first = await translateWithFilterSplit(chunk.slice(0, middle), translateChunk);
    const second = await translateWithFilterSplit(chunk.slice(middle), translateChunk);
    return {
      translations: [...first.translations, ...second.translations],
      attempts: 1 + first.attempts + second.attempts,
      filteredIndexes: [...first.filteredIndexes, ...second.filteredIndexes],
      filterMessages: [...first.filterMessages, ...second.filterMessages],
    };
  }
}

export function translatableParagraphs(chunk, filteredIndexes = []) {
  const filtered = new Set(filteredIndexes);
  return chunk.filter((paragraph) => !filtered.has(paragraph.index));
}

export function mergeParagraphTranslations(paragraphsEn, translatedByIndex, filteredIndexes = []) {
  const filtered = new Set(filteredIndexes);
  return paragraphsEn.map((textEn, index) => {
    if (translatedByIndex.has(index)) return translatedByIndex.get(index);
    return filtered.has(index) ? textEn : undefined;
  });
}

export function needsFilterRetry(value, { retryFiltered = false } = {}) {
  if (value?.unavailable === true) {
    if (value.unavailableReason !== CONTENT_FILTER_REASON) return false;
    return retryFiltered || value.filterStrategy !== FILTER_SPLIT_STRATEGY;
  }
  return retryFiltered && Array.isArray(value?.untranslatedParagraphs) && value.untranslatedParagraphs.length > 0;
}

export function untranslatedParagraphFailures(value, paragraphsEn) {
  const indexes = value?.untranslatedParagraphs;
  if (indexes === undefined) return [];
  if (!Array.isArray(indexes) || !indexes.length) return ["保留英文的段落清單格式不正確"];
  if (value.untranslatedReason !== CONTENT_FILTER_REASON) return ["保留英文段落的原因不在允許清單"];
  const failures = [];
  const seen = new Set();
  for (const index of indexes) {
    if (!Number.isInteger(index) || index < 0 || index >= paragraphsEn.length || seen.has(index)) {
      failures.push(`保留英文的段落索引不正確：${index}`);
      continue;
    }
    seen.add(index);
    if (value.paragraphsZh?.[index] !== paragraphsEn[index]) failures.push(`第 ${index + 1} 段應保留英文原文`);
  }
  if (seen.size >= paragraphsEn.length) failures.push("所有段落都保留英文，應改為整篇隔離");
  return failures;
}
