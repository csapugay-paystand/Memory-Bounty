/**
 * Edge-case fixture: arrow function text span (Sprint 2A, Task 1).
 *
 * After the fix, chunk.text for every symbol below must NOT include
 * "const <symbol> =" — it should contain only the arrow function expression.
 * The golden file asserts this via textMustNotContain.
 */

// Expression-body arrow (non-exported)
const addNumbers = (a: number, b: number): number => a + b;

// Block-body arrow (non-exported)
const formatDate = (date: Date): string => {
  const iso = date.toISOString();
  return iso.split("T")[0]!;
};

// Generic exported arrow
export const processItems = <T>(items: T[], fn: (item: T) => T): T[] =>
  items.map(fn);

// Async exported arrow with block body
export const createHandler = async (id: string): Promise<{ id: string }> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return { id };
};
