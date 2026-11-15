/**
 * Semantic classification of the object into the Nett categories.
 *  1. stem + order-free proximity per expression;
 *  2. weight by section — object and items characterize the contract; boilerplate clauses
 *     ("a contratada deverá observar a LGPD") almost nothing;
 *  3. noisy-OR across distinct concepts (diminishing returns).
 */
import type { Dictionary, NettCategory } from './dictionary';
import type { Passage, SectionKind } from './sections';
import { matchesWithin, normalize, tokens } from './text';

export type Segment = {
  text: string;
  /** Relevance of where the text appears (0–1). */
  weight: number;
  origin: { type: 'opportunity'; field: string } | { type: 'passage'; passage: Passage };
};

export type ConceptMatch = { conceptId: string; label: string; strength: number; segments: Segment[] };
export type CategoryScore = { category: NettCategory; label: string; score: number; concepts: ConceptMatch[] };
export type Classification = { categories: CategoryScore[]; exclusions: { expression: string; segment: Segment }[] };

export const SECTION_WEIGHT: Record<SectionKind, number> = {
  object: 1,
  specification: 0.7,
  proposal: 0.35,
  participation: 0.25,
  qualification: 0.25,
  other: 0.25,
  payment: 0.1,
  obligations: 0.1,
  penalties: 0.05,
};

const BOILERPLATE_FACTOR = 0.15;

export function segmentsFromPassages(passages: Passage[], dictionary: Dictionary): Segment[] {
  const boilerplate = dictionary.boilerplate.map(normalize);
  return passages.map((passage) => {
    const isBoilerplate = boilerplate.some((b) => normalize(passage.text).includes(b));
    return { text: passage.text, weight: SECTION_WEIGHT[passage.sectionKind] * (isBoilerplate ? BOILERPLATE_FACTOR : 1), origin: { type: 'passage', passage } };
  });
}

export function classify(segments: Segment[], dictionary: Dictionary, objectSegments: Segment[], extraExclusions: string[] = []): Classification {
  const tokenized = segments.map((s) => ({ s, t: tokens(s.text) }));
  const categories = dictionary.categories.map((cat): CategoryScore => {
    const concepts: ConceptMatch[] = [];
    for (const concept of cat.concepts) {
      const matched = tokenized.filter(({ t }) => concept.expressions.some((e) => matchesWithin(t, e, concept.window ?? 8))).map(({ s }) => s);
      if (!matched.length) continue;
      matched.sort((a, b) => b.weight - a.weight);
      concepts.push({ conceptId: concept.id, label: concept.label, strength: concept.weight * matched[0]!.weight, segments: matched.slice(0, 3) });
    }
    concepts.sort((a, b) => b.strength - a.strength);
    const probability = 1 - concepts.reduce((acc, c) => acc * (1 - c.strength), 1);
    return { category: cat.id, label: cat.label, score: Math.round(probability * 100), concepts };
  });
  categories.sort((a, b) => b.score - a.score);

  const exclusions: Classification['exclusions'] = [];
  for (const segment of objectSegments) {
    const t = tokens(segment.text);
    for (const expression of [...dictionary.exclusions, ...extraExclusions]) if (matchesWithin(t, expression, 4)) exclusions.push({ expression, segment });
  }
  return { categories, exclusions };
}
