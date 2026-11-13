/**
 * Nett semantic dictionary — v1.0.0 (SEED).
 *
 * Owned by Nett. This is the Agent 03 initial proposal and still needs commercial validation.
 * Changes create a new version (never edit a published one in place) and must go through
 * `backtest.ts` before being promoted.
 *
 * Each concept groups equivalent technical and administrative expressions, matched by stem and
 * proximity (order-free window), not by literal equality. `weight` ∈ (0, 1] says how strongly the
 * concept alone characterizes the category.
 */
import { z } from 'zod';

/** The six Nett commercial categories. Not a canonical contract entity yet (see handoff request). */
export const nettCategory = z.enum(['lgpd', 'audit_iso', 'software', 'data_bi_ai', 'security_infra', 'it_hardware']);
export type NettCategory = z.infer<typeof nettCategory>;

export type Concept = { id: string; label: string; weight: number; expressions: string[]; window?: number };
export type CategoryEntry = { id: NettCategory; label: string; product: string | null; concepts: Concept[] };
export type Dictionary = {
  version: string;
  categories: CategoryEntry[];
  /** Objects clearly outside the Nett profile. */
  exclusions: string[];
  /** Boilerplate contract clauses that do not characterize the object. */
  boilerplate: string[];
};

export const NETT_DICTIONARY_V1: Dictionary = {
  version: 'nett-dictionary-1.0.0',
  categories: [
    {
      id: 'lgpd',
      label: 'Adequação à LGPD',
      product: 'Adequa AI',
      concepts: [
        { id: 'lgpd.compliance', label: 'Adequação/conformidade à LGPD', weight: 1, expressions: ['adequação lgpd', 'adequação lei geral proteção dados', 'conformidade lgpd', 'implantação lgpd', 'programa de privacidade', 'governança em privacidade', 'adequação lei 13709'] },
        { id: 'lgpd.dpo', label: 'Encarregado de dados (DPO as a service)', weight: 0.9, expressions: ['encarregado pelo tratamento de dados', 'dpo as a service', 'encarregado de dados', 'data protection officer'] },
        { id: 'lgpd.ripd', label: 'RIPD / mapeamento de dados', weight: 0.8, expressions: ['relatório de impacto à proteção de dados', 'ripd', 'mapeamento de dados pessoais', 'inventário de dados pessoais', 'data mapping'] },
        { id: 'lgpd.consent', label: 'Gestão de consentimento e direitos do titular', weight: 0.6, expressions: ['gestão de consentimento', 'direitos dos titulares', 'portal do titular', 'gestão de cookies'] },
        { id: 'lgpd.mention', label: 'Menção à LGPD', weight: 0.35, expressions: ['lgpd', 'lei geral de proteção de dados', 'lei 13709', 'proteção de dados pessoais'] },
      ],
    },
    {
      id: 'audit_iso',
      label: 'Auditorias e ISO',
      product: 'Audit Cockpit / Audit Readiness Score',
      concepts: [
        { id: 'iso.implementation', label: 'Implantação/consultoria de norma ISO', weight: 1, expressions: ['implantação iso', 'consultoria iso', 'certificação iso', 'sistema de gestão da qualidade', 'sistema de gestão de segurança da informação', 'sgsi', 'adequação norma abnt nbr iso'] },
        { id: 'iso.audit', label: 'Auditoria interna/externa', weight: 0.9, expressions: ['auditoria interna', 'auditoria de conformidade', 'auditoria de sistemas', 'auditoria de ti', 'auditoria de segurança da informação', 'serviços de auditoria', 'auditoria independente de ti'] },
        { id: 'iso.grc', label: 'Governança, riscos e compliance', weight: 0.7, expressions: ['governança de ti', 'gestão de riscos', 'compliance', 'grc', 'controles internos', 'cobit', 'pdti'] },
        { id: 'iso.standards', label: 'Normas técnicas de gestão', weight: 0.4, expressions: ['iso 27001', 'iso 9001', 'iso 27701', 'iso 20000', 'iso 22301', 'iso 37001'] },
      ],
    },
    {
      id: 'software',
      label: 'Desenvolvimento e manutenção de software',
      product: null,
      concepts: [
        { id: 'sw.factory', label: 'Fábrica de software / desenvolvimento sob demanda', weight: 1, expressions: ['fábrica de software', 'desenvolvimento de software', 'desenvolvimento de sistemas', 'desenvolvimento sob demanda', 'pontos de função', 'unidade de serviço técnico', 'ust', 'desenvolvimento de aplicativos'] },
        { id: 'sw.maintenance', label: 'Manutenção e sustentação de sistemas', weight: 0.9, expressions: ['manutenção de sistemas', 'sustentação de sistemas', 'manutenção corretiva evolutiva', 'manutenção evolutiva', 'manutenção adaptativa', 'sustentação de aplicações'] },
        { id: 'sw.license', label: 'Licenciamento / cessão de uso de software', weight: 0.8, expressions: ['cessão de direito de uso de software', 'licença de uso de software', 'licenciamento de software', 'software como serviço', 'saas', 'locação de sistema', 'solução tecnológica integrada', 'sistema de gestão'] },
        { id: 'sw.web', label: 'Portais e sistemas web', weight: 0.6, expressions: ['portal web', 'sistema web', 'aplicação web', 'aplicativo móvel', 'portal da transparência'] },
      ],
    },
    {
      id: 'data_bi_ai',
      label: 'Dados, BI e inteligência artificial',
      product: null,
      concepts: [
        { id: 'data.bi', label: 'Business Intelligence e painéis', weight: 1, expressions: ['business intelligence', 'solução de bi', 'painéis gerenciais', 'dashboards', 'painel de indicadores', 'power bi', 'data visualization'] },
        { id: 'data.engineering', label: 'Engenharia e integração de dados', weight: 0.9, expressions: ['data warehouse', 'data lake', 'engenharia de dados', 'integração de dados', 'etl', 'governança de dados', 'qualidade de dados', 'ciência de dados'] },
        { id: 'data.ai', label: 'Inteligência artificial e analytics', weight: 1, expressions: ['inteligência artificial', 'aprendizado de máquina', 'machine learning', 'análise preditiva', 'processamento de linguagem natural', 'chatbot', 'assistente virtual', 'analytics'] },
      ],
    },
    {
      id: 'security_infra',
      label: 'Segurança cibernética e infraestrutura',
      product: null,
      concepts: [
        { id: 'sec.cyber', label: 'Segurança cibernética', weight: 1, expressions: ['segurança cibernética', 'segurança da informação', 'cibersegurança', 'teste de intrusão', 'pentest', 'análise de vulnerabilidades', 'soc', 'centro de operações de segurança', 'siem', 'resposta a incidentes'] },
        { id: 'sec.perimeter', label: 'Proteção de rede e endpoints', weight: 0.9, expressions: ['firewall', 'next generation firewall', 'antivírus', 'endpoint protection', 'edr', 'xdr', 'filtro de conteúdo', 'vpn', 'waf'] },
        { id: 'sec.infra', label: 'Infraestrutura de TI e datacenter', weight: 0.8, expressions: ['infraestrutura de ti', 'datacenter', 'computação em nuvem', 'serviços de nuvem', 'hospedagem de sistemas', 'backup', 'virtualização', 'virtualização de servidores', 'rede lógica', 'cabeamento estruturado', 'switches', 'wi-fi'] },
        { id: 'sec.operations', label: 'Suporte e operação de TI', weight: 0.6, expressions: ['service desk', 'suporte técnico de ti', 'outsourcing de ti', 'monitoramento de rede', 'noc', 'sustentação de infraestrutura'] },
      ],
    },
    {
      id: 'it_hardware',
      label: 'Materiais e periféricos de informática',
      product: null,
      concepts: [
        { id: 'hw.equipment', label: 'Equipamentos de informática', weight: 1, expressions: ['computadores', 'microcomputadores', 'notebooks', 'estações de trabalho', 'desktops', 'tablets', 'equipamentos de informática', 'servidor rack'] },
        { id: 'hw.peripherals', label: 'Periféricos e acessórios', weight: 0.9, expressions: ['periféricos de informática', 'monitores de vídeo', 'monitor led', 'teclados', 'mouses', 'webcams', 'headsets', 'nobreaks', 'estabilizadores', 'impressoras', 'scanners', 'projetores'] },
        { id: 'hw.supplies', label: 'Suprimentos e componentes', weight: 0.7, expressions: ['materiais de informática', 'suprimentos de informática', 'toner', 'cartuchos', 'memória ram', 'ssd', 'disco rígido', 'pen drive', 'cabos de rede', 'hd externo'] },
        { id: 'hw.printing', label: 'Outsourcing de impressão', weight: 0.6, expressions: ['outsourcing de impressão', 'locação de impressoras', 'serviço de impressão corporativa'] },
      ],
    },
  ],
  exclusions: [
    'obras de engenharia', 'construção civil', 'pavimentação', 'gêneros alimentícios', 'merenda escolar', 'combustíveis', 'medicamentos',
    'material médico hospitalar', 'locação de veículos', 'aquisição de veículos', 'coleta de resíduos', 'limpeza urbana',
    'serviços de limpeza e conservação', 'vigilância armada', 'transporte escolar', 'material de expediente', 'uniformes',
  ],
  boilerplate: [
    'a contratada deverá observar', 'a contratada deverá cumprir', 'a contratada obriga se', 'obriga se a contratada', 'obrigações da contratada',
    'em conformidade com a lei', 'nos termos da lei', 'sob pena de', 'tratamento de dados pessoais', 'dados pessoais a que tiver acesso',
    'sigilo e confidencialidade', 'observar as disposições',
  ],
};
