import test from "node:test";
import assert from "node:assert/strict";
import { briefLengthProfile, lengthFeedback } from "../scripts/lib/brief-length-profile.mjs";

test("極短快訊採資訊量相稱的篇幅門檻，避免逼模型灌水", () => {
  const profile = briefLengthProfile({ textEn: "x".repeat(269) });

  assert.equal(profile.kind, "short");
  assert.equal(profile.summaryMin, 50);
  assert.equal(profile.pointMin, 18);
  assert.equal(profile.researchLensMin, 35);
  assert.match(profile.instruction, /不要為了湊字數補造背景/);
});

test("一般文章維持原有嚴格篇幅門檻", () => {
  const profile = briefLengthProfile({ textEn: "x".repeat(500) });

  assert.equal(profile.kind, "standard");
  assert.equal(profile.summaryMin, 130);
  assert.equal(profile.pointMin, 25);
});

test("長度不符時的修正提示會說明差距、方向與允許範圍", () => {
  assert.equal(lengthFeedback("摘要", 180, 130, 250), null);
  const short = lengthFeedback("摘要", 118, 130, 250);
  assert.match(short, /摘要長度 118 字，太短，需要再補 12 字以上/);
  assert.match(short, /須介於 130–250 字/);
  assert.match(short, /不要灌水或新增事實/);
  assert.match(lengthFeedback("研究角度", 150, 50, 135), /太長，需要刪減 15 字以上/);
});
