export function chooseNaturalizationResult({
  draft,
  candidate,
  attempt,
  attemptsPerRound,
  isComplete,
}) {
  if (isComplete(candidate)) return { value: candidate, fellBack: false };

  const exhaustedRound = attempt > 0 && attempt % attemptsPerRound === 0;
  if (exhaustedRound && isComplete(draft)) {
    return { value: draft, fellBack: true };
  }

  return { value: candidate, fellBack: false };
}
