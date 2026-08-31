import test from "node:test";
import assert from "node:assert/strict";
import { chooseNaturalizationResult } from "../scripts/lib/naturalization-fallback.mjs";

const isComplete = (value) => value?.valid === true;

test("自然化未用完一輪前仍回傳候選稿供精確修正", () => {
  const draft = { valid: true, name: "draft" };
  const candidate = { valid: false, name: "candidate" };
  const result = chooseNaturalizationResult({
    draft,
    candidate,
    attempt: 3,
    attemptsPerRound: 4,
    isComplete,
  });

  assert.equal(result.value, candidate);
  assert.equal(result.fellBack, false);
});

test("自然化用完一輪仍不合格時安全保留合格初稿", () => {
  const draft = { valid: true, name: "draft" };
  const candidate = { valid: false, name: "candidate" };
  const result = chooseNaturalizationResult({
    draft,
    candidate,
    attempt: 4,
    attemptsPerRound: 4,
    isComplete,
  });

  assert.equal(result.value, draft);
  assert.equal(result.fellBack, true);
});

test("初稿本身不合格時不得用回退繞過驗證", () => {
  const draft = { valid: false, name: "draft" };
  const candidate = { valid: false, name: "candidate" };
  const result = chooseNaturalizationResult({
    draft,
    candidate,
    attempt: 4,
    attemptsPerRound: 4,
    isComplete,
  });

  assert.equal(result.value, candidate);
  assert.equal(result.fellBack, false);
});
