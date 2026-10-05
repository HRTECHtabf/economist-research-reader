import test from "node:test";
import assert from "node:assert/strict";
import {
  FILTER_SPLIT_STRATEGY,
  mergeParagraphTranslations,
  needsFilterRetry,
  translatableParagraphs,
  translateWithFilterSplit,
  untranslatedParagraphFailures,
} from "../scripts/lib/filtered-paragraph-fallback.mjs";

const filteredError = () => new Error("The response was filtered due to the prompt triggering Azure OpenAI's content management policy.");

function fakeTranslator(blockedIndexes) {
  const calls = [];
  return {
    calls,
    async translate(chunk) {
      calls.push(chunk.map((paragraph) => paragraph.index));
      if (chunk.some((paragraph) => blockedIndexes.includes(paragraph.index))) throw filteredError();
      return {
        translations: chunk.map((paragraph) => ({ index: paragraph.index, textZh: `譯文${paragraph.index}` })),
        attempts: 1,
      };
    },
  };
}

const chunkOf = (count) => Array.from({ length: count }, (_, index) => ({ index, textEn: `Paragraph ${index}` }));

test("整批被內容安全篩選擋下時，對半拆批直到只剩觸發段落", async () => {
  const translator = fakeTranslator([2, 5]);
  const result = await translateWithFilterSplit(chunkOf(8), translator.translate);
  assert.deepEqual(result.filteredIndexes, [2, 5]);
  assert.deepEqual(result.translations.map((item) => item.index), [0, 1, 3, 4, 6, 7]);
  assert.equal(result.filterMessages.length, 2);
  assert.ok(translator.calls.length <= 11, `呼叫次數 ${translator.calls.length} 過多`);
});

test("沒有被篩選時只呼叫一次，不做多餘拆批", async () => {
  const translator = fakeTranslator([]);
  const result = await translateWithFilterSplit(chunkOf(6), translator.translate);
  assert.equal(translator.calls.length, 1);
  assert.deepEqual(result.filteredIndexes, []);
  assert.equal(result.translations.length, 6);
});

test("內容安全以外的錯誤照原樣拋出，交給既有重試與隔離流程", async () => {
  await assert.rejects(
    translateWithFilterSplit(chunkOf(3), async () => { throw new Error("HTTP 429"); }),
    /HTTP 429/,
  );
});

test("合併時被擋段落保留英文，其餘使用譯文；缺段會留下 undefined 供呼叫端擋下", () => {
  const paragraphsEn = ["A", "B", "C"];
  const merged = mergeParagraphTranslations(paragraphsEn, new Map([[0, "甲"], [2, "丙"]]), [1]);
  assert.deepEqual(merged, ["甲", "B", "丙"]);
  assert.equal(mergeParagraphTranslations(paragraphsEn, new Map([[0, "甲"]]), [1])[2], undefined);
  assert.deepEqual(translatableParagraphs(chunkOf(3), [1]).map((item) => item.index), [0, 2]);
});

test("舊版整篇隔離會重新嘗試；新版隔離與一般譯文不重跑，除非明確要求", () => {
  const legacy = { unavailable: true, unavailableReason: "azure_content_filter" };
  const current = { ...legacy, filterStrategy: FILTER_SPLIT_STRATEGY };
  const exhausted = { unavailable: true, unavailableReason: "retry_exhausted_after_3_attempts" };
  const partial = { paragraphsZh: ["甲", "B"], untranslatedParagraphs: [1] };
  assert.equal(needsFilterRetry(legacy), true);
  assert.equal(needsFilterRetry(current), false);
  assert.equal(needsFilterRetry(current, { retryFiltered: true }), true);
  assert.equal(needsFilterRetry(exhausted, { retryFiltered: true }), false);
  assert.equal(needsFilterRetry(partial), false);
  assert.equal(needsFilterRetry(partial, { retryFiltered: true }), true);
  assert.equal(needsFilterRetry(null), false);
});

test("稽核要求保留英文的段落與原文完全相同，且不可整篇都是英文", () => {
  const paragraphsEn = ["Alpha", "Beta", "Gamma"];
  const valid = {
    paragraphsZh: ["甲", "Beta", "丙"],
    untranslatedParagraphs: [1],
    untranslatedReason: "azure_content_filter",
  };
  assert.deepEqual(untranslatedParagraphFailures(valid, paragraphsEn), []);
  assert.deepEqual(untranslatedParagraphFailures({ paragraphsZh: ["甲", "乙", "丙"] }, paragraphsEn), []);
  assert.match(untranslatedParagraphFailures({ ...valid, paragraphsZh: ["甲", "乙", "丙"] }, paragraphsEn)[0], /保留英文原文/);
  assert.match(untranslatedParagraphFailures({ ...valid, untranslatedReason: "unknown" }, paragraphsEn)[0], /允許清單/);
  assert.match(untranslatedParagraphFailures({ ...valid, untranslatedParagraphs: [3] }, paragraphsEn)[0], /索引不正確/);
  assert.match(
    untranslatedParagraphFailures({ ...valid, paragraphsZh: paragraphsEn, untranslatedParagraphs: [0, 1, 2] }, paragraphsEn).at(-1),
    /整篇隔離/,
  );
});
