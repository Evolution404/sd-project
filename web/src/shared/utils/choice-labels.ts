/** Use context only where a primary business name is actually repeated. */
export function choiceLabels<T extends { id: string }>(
  choices: readonly T[],
  name: (choice: T) => string,
  context: (choice: T) => Array<string | number | null | undefined>,
) {
  const names = new Map(choices.map(choice => [choice.id, name(choice)]));
  const counts = new Map<string, number>();
  for (const title of names.values()) counts.set(title, (counts.get(title) ?? 0) + 1);
  return new Map(choices.map(choice => {
    const title = names.get(choice.id)!;
    return [choice.id, (counts.get(title) ?? 0) > 1
      ? [title, ...context(choice)].filter(Boolean).join(" · ") : title];
  }));
}
