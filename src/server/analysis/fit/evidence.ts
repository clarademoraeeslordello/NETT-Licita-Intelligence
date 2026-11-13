/** Single evidence registry per assessment; reasons, risks and requirements reference it by id. */
import type { Evidence } from './result';
import type { Passage } from './sections';
import { clip } from './text';

const EMPTY = { documentId: null, documentTitle: null, page: null, section: null, quote: null } as const;

export class EvidenceRegistry {
  private readonly list: Evidence[] = [];
  private readonly index = new Map<string, string>();

  private add(data: Omit<Evidence, 'id'>): string {
    const key = [data.status, data.documentId, data.page, data.section, data.quote ?? data.rationale].join('|');
    const existing = this.index.get(key);
    if (existing) return existing;
    const id = `ev-${String(this.list.length + 1).padStart(3, '0')}`;
    this.list.push({ id, ...data });
    this.index.set(key, id);
    return id;
  }

  /** Literal passage from a public document. */
  fromPassage(p: Passage, rationale: string): string {
    return this.add({ status: 'proven', documentId: p.documentId, documentTitle: p.documentTitle, page: p.page, section: p.section, quote: clip(p.text), rationale });
  }

  /** Literal field of the canonical Opportunity (source: Agent 02). */
  fromOpportunity(field: string, value: string, rationale: string): string {
    return this.add({ ...EMPTY, status: 'proven', section: `opportunity.${field}`, quote: clip(value), rationale });
  }

  /** Company data: proven when backed by an evidence document; otherwise declared = unverified. */
  fromCompany(section: string, description: string, backed: boolean): string {
    return this.add({
      ...EMPTY,
      status: backed ? 'proven' : 'unverified',
      section: `company.${section}`,
      rationale: backed ? `Dado da empresa com documento comprobatório: ${description}` : `Dado declarado pela empresa, sem documento comprobatório: ${description}`,
    });
  }

  inferred(rationale: string): string {
    return this.add({ ...EMPTY, status: 'inferred', rationale });
  }

  unverified(rationale: string): string {
    return this.add({ ...EMPTY, status: 'unverified', rationale });
  }

  all(): Evidence[] {
    return [...this.list];
  }
}
