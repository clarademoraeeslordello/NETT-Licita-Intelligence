/**
 * Edital de demonstração.
 *
 * Este arquivo é o roteiro de um edital fictício, porém realista, usado no modo
 * demonstração do produto. Nada aqui é apresentado como dado real de cliente:
 * o arquivo gerado traz marca d'água "DOCUMENTO FICTÍCIO — DEMONSTRAÇÃO" e o
 * relatório sinaliza que a origem é o edital de demonstração.
 *
 * Cobre de propósito todas as categorias que o analisador precisa extrair:
 * identificação, datas, valores, itens/lotes, habilitação, obrigações,
 * penalidades, garantias e pontos de atenção.
 */
import { PdfBuilder } from '../pdf/builder';

export const DEMO_EDITAL = {
  fileName: 'edital-demo-pregão-eletronico-042-2025.pdf',
  orgao: 'Prefeitura Municipal de Vale Verde — Secretaria Municipal de Educação',
  numeroEdital: 'Pregão Eletrônico nº 042/2025',
  processo: 'Processo Administrativo nº 1.884/2025',
  modalidade: 'Pregão Eletrônico',
  portal: 'Portal Nacional de Contratações Públicas — www.gov.br/compras (Compras.gov.br)',
  objeto:
    'Aquisição de equipamentos de informática e mobiliário escolar, com entrega parcelada e instalação, destinados à implantação de duas salas de informática e à reforma do mobiliário de oito salas de aula da rede municipal de ensino.',
  valorEstimado: 'R$ 1.284.350,00',
  valorMaximo: 'R$ 1.284.350,00',
  uasg: '987654',
} as const;

const ITENS: Array<[string, string, string, string, string, string, string]> = [
  ['1', 'Notebook educacional, processador 6 núcleos, 16 GB RAM, SSD 512 GB, tela 14" Full HD, garantia on-site 36 meses', '80', 'UN', 'Lote 1', 'R$ 4.150,00', 'R$ 332.000,00'],
  ['2', 'Computador desktop tipo all-in-one, processador 8 núcleos, 16 GB RAM, SSD 512 GB, tela 23,8", garantia on-site 36 meses', '60', 'UN', 'Lote 1', 'R$ 3.980,00', 'R$ 238.800,00'],
  ['3', 'Monitor LED 23,8" Full HD, entrada HDMI e DisplayPort, regulagem de altura, garantia 36 meses', '60', 'UN', 'Lote 1', 'R$ 890,00', 'R$ 53.400,00'],
  ['4', 'Estabilizador 1 kVA, 6 tomadas, proteção contra surtos, garantia 24 meses', '140', 'UN', 'Lote 2', 'R$ 210,00', 'R$ 29.400,00'],
  ['5', 'Projetor multimídia 4.000 lúmens, resolução Full HD, com suporte de teto e instalção inclusa', '8', 'UN', 'Lote 2', 'R$ 3.450,00', 'R$ 27.600,00'],
  ['6', 'Lousa digital interativa 75", multitouch 20 pontos, com suporte, instalção e treinamento', '8', 'UN', 'Lote 2', 'R$ 12.900,00', 'R$ 103.200,00'],
  ['7', 'Switch gerenciável 24 portas Gigabit, rack 19", com instalação e configuração de VLAN', '10', 'UN', 'Lote 3', 'R$ 1.780,00', 'R$ 17.800,00'],
  ['8', 'Access point Wi-Fi 6 dual band, com controladora e instalação em forro', '24', 'UN', 'Lote 3', 'R$ 1.150,00', 'R$ 27.600,00'],
  ['9', 'Cabeamento estruturado categoria 6, incluindo materiais, certificação e mão de obra (ponto lógico)', '180', 'PT', 'Lote 3', 'R$ 390,00', 'R$ 70.200,00'],
  ['10', 'Mesa escolar para aluno, estrutura metálica, tampo MDP 18 mm, com cadeira, conforme ABNT NBR 14006', '400', 'CJ', 'Lote 4', 'R$ 690,00', 'R$ 276.000,00'],
  ['11', 'Cadeira giratória para professor, encosto em tela, braços reguláveis, rodízios, garantia 60 meses', '40', 'UN', 'Lote 4', 'R$ 780,00', 'R$ 31.200,00'],
  ['12', 'Armário de aço para armazenamento de equipamentos, 2 portas, com fechadura, 1,98 m', '24', 'UN', 'Lote 4', 'R$ 1.150,00', 'R$ 27.600,00'],
  ['13', 'Nobreak 1.500 VA senoidal, autonomia mínima de 15 minutos, garantia on-site 24 meses', '20', 'UN', 'Lote 2', 'R$ 1.240,00', 'R$ 24.800,00'],
  ['14', 'Serviço de instalação, configuração e treinamento de equipe (16 horas, presencial, 2 turmas)', '1', 'SV', 'Lote 5', 'R$ 24.750,00', 'R$ 24.750,00'],
];

export const DEMO_EDITAL_TEXT_MARKERS = {
  orgao: 'Prefeitura Municipal de Vale Verde',
  prazoEncerramento: '22/07/2025',
  horaEncerramento: '09:00',
  prazoAbertura: '22/07/2025',
  valorEstimado: 'R$ 1.284.350,00',
};

/** Monta o PDF do edital de demonstração. */
export function buildDemoEditalPdf(): Buffer {
  const pdf = new PdfBuilder({
    footer: 'DOCUMENTO FICTÍCIO — DEMONSTRAÇÃO',
    margin: { top: 70, bottom: 66, left: 54, right: 54 },
  });

  /* ------------------------------- Capa --------------------------------- */
  pdf.text('PREFEITURA MUNICIPAL DE VALE VERDE', { size: 15, bold: true, align: 'center', spaceAfter: 2 });
  pdf.text('SECRETARIA MUNICIPAL DE EDUCAÇÃO', { size: 10.5, align: 'center', spaceAfter: 1 });
  pdf.text('Praça Central, 100 — Centro — Vale Verde — CNPJ 12.345.678/0001-90', {
    size: 8.5,
    align: 'center',
    color: [0.42, 0.47, 0.56],
    spaceAfter: 16,
  });
  pdf.line([0.1, 0.14, 0.24], 1.6);
  pdf.spacer(10);

  pdf.text('AVISO DE LICITAÇÃO', { size: 12, bold: true, align: 'center', spaceAfter: 10 });
  pdf.text('PREGÃO ELETRÔNICO Nº 042/2025', { size: 18, bold: true, align: 'center', spaceAfter: 4 });
  pdf.text('PROCESSO ADMINISTRATIVO Nº 1.884/2025', { size: 10, align: 'center', spaceAfter: 2 });
  pdf.text('UASG 987654 — Edital nº 042/2025', { size: 9, align: 'center', color: [0.42, 0.47, 0.56], spaceAfter: 18 });

  pdf.text(
    'O MUNICÍPIO DE VALE VERDE, por intermédio da Secretaria Municipal de Educação, torna público que realizará licitação na modalidade PREGÃO, em forma ELETRÔNICA, com critério de julgamento de MENOR PREÇO POR LOTE, em regime de execução de empreitada por preço unitário, nos termos da Lei Federal nº 14.133, de 1º de abril de 2021, e das condições estabelecidas neste Edital e seus anexos.',
    { size: 10, lineHeight: 1.5, spaceAfter: 10 },
  );

  pdf.text(
    'A sessão pública eletrônica será realizada por meio do Portal Nacional de Contratações Públicas (Compras.gov.br), com início no dia 22/07/2025 às 09:00 (horário de Brasília). O prazo de recebimento das propostas será encerrado automaticamente pelo sistema às 09:00 do dia 22/07/2025, ocasião em que se dará início à abertura das propostas e à fase de disputa.',
    { size: 10, lineHeight: 1.5, spaceAfter: 12 },
  );

  pdf.table({
    columns: [
      { header: 'Informação', width: 170 },
      { header: 'Conteúdo', width: 317 },
    ],
    rows: [
      ['Órgão / entidade', 'Prefeitura Municipal de Vale Verde — Secretaria Municipal de Educação'],
      ['Número do edital', 'Pregão Eletrônico nº 042/2025'],
      ['Processo', 'Processo Administrativo nº 1.884/2025'],
      ['Modalidade', 'Pregão Eletrônico'],
      ['Modo de disputa', 'Aberto e fechado'],
      ['Critério de julgamento', 'Menor preço por lote'],
      ['Regime de execução', 'Empreitada por preço unitário'],
      ['Valor total estimado', 'R$ 1.284.350,00'],
      ['Valor máximo aceito', 'R$ 1.284.350,00'],
      ['Data de publicação', '01/07/2025'],
      ['Início do recebimento das propostas', '02/07/2025 às 08:00'],
      ['Encerramento do recebimento das propostas', '22/07/2025 às 09:00'],
      ['Abertura das propostas', '22/07/2025 às 09:00'],
      ['Sessão pública de disputa', '22/07/2025 às 10:00'],
      ['Vigência do contrato', '12 meses, prorrogável por até 60 meses'],
      ['Local', 'Portal Nacional de Contratações Públicas — www.gov.br/compras'],
    ],
    size: 9,
    spaceAfter: 16,
  });

  /* --------------------------- 1. DO OBJETO ----------------------------- */
  pdf.heading('1. DO OBJETO', { spaceBefore: 0 });
  pdf.text(
    '1.1. O objeto da presente licitação é a AQUISIÇÃO DE EQUIPAMENTOS DE INFORMÁTICA E MOBILIÁRIO ESCOLAR, COM ENTREGA PARCELADA E INSTALAÇÃO, destinados à implantação de duas salas de informática e à reforma do mobiliário de oito salas de aula da rede municipal de ensino, conforme especificações, quantidades e condições estabelecidas no Termo de Referência (Anexo I) e na planilha orçamentária (Anexo II).',
    { size: 10, lineHeight: 1.5, spaceAfter: 6 },
  );
  pdf.text(
    '1.2. A licitação será dividida em 5 (cinco) lotes, sendo 1 (um) lote para mobiliário escolar, 3 (três) lotes para equipamentos de informática e 1 (um) lote de serviços de instalação, configuração e treinamento.',
    { size: 10, lineHeight: 1.5, spaceAfter: 6 },
  );
  pdf.text(
    '1.3. A entrega dos bens deverá ocorrer em até 45 (quarenta e cinco) dias corridos, contados do recebimento da autorização de fornecimento, no Almoxarifado Central da Secretaria Municipal de Educação, situado na Praça Central, 100, Centro, Vale Verde.',
    { size: 10, lineHeight: 1.5, spaceAfter: 6 },
  );
  pdf.text(
    '1.4. Os serviços de instalação, configuração e treinamento deverão ser executados em até 30 (trinta) dias corridos após a entrega integral do lote correspondente.',
    { size: 10, lineHeight: 1.5, spaceAfter: 6 },
  );
  pdf.text(
    '1.5. Data de publicação do aviso de licitação: 01/07/2025, no Diário Oficial do Município e no Portal Nacional de Contratações Públicas.',
    { size: 10, lineHeight: 1.5, spaceAfter: 12 },
  );

  /* --------------------- 1-A. DO CRONOGRAMA DO CERTAME ------------------ */
  pdf.heading('1-A. DO CRONOGRAMA DO CERTAME');
  pdf.text(
    '1-A.1. Os prazos abaixo são os marcos oficiais deste certame, observado o horário oficial de Brasília:',
    { size: 10, lineHeight: 1.5, spaceAfter: 8 },
  );
  pdf.table({
    columns: [
      { header: 'Evento', width: 320 },
      { header: 'Data', width: 100, align: 'center' },
      { header: 'Hora', width: 67, align: 'center' },
    ],
    rows: [
      ['Publicação do aviso de licitação', '01/07/2025', '—'],
      ['Início do recebimento das propostas', '02/07/2025', '08:00'],
      ['Prazo limite para esclarecimentos', '11/07/2025', '17:00'],
      ['Prazo limite para impugnação do edital', '17/07/2025', '17:00'],
      ['Encerramento do recebimento das propostas', '22/07/2025', '09:00'],
      ['Abertura das propostas', '22/07/2025', '09:00'],
      ['Sessão pública de disputa de lances', '22/07/2025', '10:00'],
      ['Prazo de entrega dos bens (após autorização)', '05/09/2025', '—'],
      ['Prazo de execução dos serviços de instalação', '30/09/2025', '—'],
      ['Vigência do contrato', '12 meses da assinatura', '—'],
    ],
    size: 8.8,
    spaceAfter: 12,
  });

  /* ------------------ 2. DA PARTICIPAÇÃO NA LICITAÇÃO ------------------- */
  pdf.heading('2. DA PARTICIPAÇÃO NA LICITAÇÃO');
  pdf.text('2.1. Poderão participar desta licitação os interessados cujo ramo de atividade seja compatível com o objeto, que estejam com o cadastro ativo no sistema de cadastramento unificado de fornecedores e que apresentem toda a documentação exigida neste Edital.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('2.2. Será concedido tratamento diferenciado às microempresas e empresas de pequeno porte, nos termos da Lei Complementar nº 123/2006, incluindo a possibilidade de regularização de documentação fiscal e trabalhista posteriormente à fase de habilitação, e preferência de contratação em caso de empate.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('2.3. Será permitida a participação de empresas em consórcio, desde que comprovada a existência de compromisso público ou particular de constituição, e que a empresa líder atenda integralmente aos requisitos de qualificação técnica e econômico-financeira, vedada a participação de empresa consorciada em mais de um consórcio simultaneamente neste certame.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('2.4. Não poderão participar, direta ou indiretamente, as empresas em processo de falência, recuperação judicial ou extrajudicial, sob concurso de credores, em dissolução ou liquidação; as que estejam suspensas de licitar ou declaradas inidôneas por qualquer ente federativo; e os agentes públicos do órgão contratante, bem como seus cônjuges, companheiros e parentes até o terceiro grau.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('2.5. Será vedada a participação de sociedades cooperativas, salvo quando comprovada a compatibilidade entre o objeto social e o objeto desta licitação, na forma do item 2.1.', { size: 10, lineHeight: 1.5, spaceAfter: 12 });

  /* ------------------- 3. DA APRESENTAÇÃO DAS PROPOSTAS ----------------- */
  pdf.heading('3. DA APRESENTAÇÃO DAS PROPOSTAS');
  pdf.text('3.1. As propostas deverão ser cadastradas exclusivamente por meio eletrônico, no Portal Nacional de Contratações Públicas, até o dia 22/07/2025 às 09:00 (horário de Brasília).', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('3.2. A validade das propostas é de 60 (sessenta) dias corridos, contados da data de abertura.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('3.3. A proposta de preços deverá conter a descrição do objeto, a quantidade, a unidade, o preço unitário e total por item, o prazo de validade e as condições de pagamento, obrigatoriamente acompanhada da planilha de composição de custos.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('3.4. Os preços ofertados deverão incluir todos os custos, tributos, encargos trabalhistas, previdenciários, fiscais, comerciais, taxas, fretes, seguros, deslocamentos, instalação e quaisquer outras despesas necessárias à execução do objeto, não sendo admitida a cobrança posterior de qualquer valor adicional.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('3.5. Será admitida a apresentação de proposta de preços com valor superior ao estimado, hipótese em que a Administração poderá negociar a redução ou desclassificar a proposta caso o valor permaneça incompatível com o preço de mercado.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('3.6. Qualquer interessado poderá solicitar esclarecimentos ou impugnar o edital até 3 (três) dias úteis antes da data de abertura das propostas, ou seja, até 17/07/2025.', { size: 10, lineHeight: 1.5, spaceAfter: 12 });

  /* --------------- 4. DA HABILITAÇÃO — DOCUMENTAÇÃO --------------------- */
  pdf.heading('4. DA HABILITAÇÃO');
  pdf.text('4.1. Habilitação jurídica. Será exigida a apresentação de:', { size: 10, bold: true, spaceAfter: 3 });
  pdf.bullet('ato constitutivo, estatuto ou contrato social em vigor, devidamente registrado no órgão competente, com a última alteração consolidada;', { size: 9.5 });
  pdf.bullet('documento de identidade e CPF dos sócios e do representante legal, acompanhado de procuração pública ou particular com poderes específicos;', { size: 9.5 });
  pdf.bullet('certificado de inscrição no Cadastro Nacional da Pessoa Jurídica (CNPJ), emitido pela Receita Federal do Brasil.', { size: 9.5, spaceAfter: 8 });

  pdf.text('4.2. Habilitação fiscal, social e trabalhista. Serão exigidas as seguintes certidões, com validade na data da sessão:', { size: 10, bold: true, spaceAfter: 3 });
  pdf.bullet('Certidão Conjunta Negativa de Débitos relativos a Tributos Federais e à Dívida Ativa da União, emitida pela Receita Federal do Brasil e Procuradoria-Geral da Fazenda Nacional;', { size: 9.5 });
  pdf.bullet('Certidão de Regularidade do Fundo de Garantia do Tempo de Serviço (CRF/FGTS), emitida pela Caixa Econômica Federal;', { size: 9.5 });
  pdf.bullet('Certidão de Débitos Trabalhistas (CNDT), emitida pelo Tribunal Superior do Trabalho;', { size: 9.5 });
  pdf.bullet('Certidão Negativa de Débitos de Tributos Mobiliários, emitida pelo Município da sede do licitante.', { size: 9.5, spaceAfter: 8 });

  pdf.text('4.3. Qualificação técnica. O licitante deverá comprovar:', { size: 10, bold: true, spaceAfter: 3 });
  pdf.bullet('registro ou inscrição da empresa e do responsável técnico no Conselho Regional de Engenharia e Agronomia (CREA) ou no Conselho de Arquitetura e Urbanismo (CAU), conforme a natureza do lote disputado, com comprovação de anotação de responsabilidade técnica para os serviços de instalação;', { size: 9.5 });
  pdf.bullet('atestado de capacidade técnica emitido por pessoa jurídica de direito público ou privado, comprovando a execução de fornecimento de equipamentos de informática em quantidade mínima de 50 (cinquenta) unidades, compatível em características e quantidades com o objeto do lote;', { size: 9.5 });
  pdf.bullet('para o Lote 3, atestado específico de execução de cabeamento estruturado categoria 6 com certificação de no mínimo 100 (cem) pontos lógicos;', { size: 9.5 });
  pdf.bullet('declaração de disponibilidade de assistência técnica autorizada na região, com atendimento on-site em até 48 (quarenta e oito) horas úteis, comprovada por contrato ou carta de credenciamento do fabricante.', { size: 9.5, spaceAfter: 8 });

  pdf.text('4.4. Qualificação econômico-financeira. Será exigida a comprovação de:', { size: 10, bold: true, spaceAfter: 3 });
  pdf.bullet('certidão negativa de feitos sobre falência, recuperação judicial e extrajudicial, expedida pelo distribuidor da sede do licitante, com data de emissão não superior a 90 (noventa) dias;', { size: 9.5 });
  pdf.bullet('balanço patrimonial e demonstrações contábeis do último exercício social, já exigíveis e apresentados na forma da lei, vedada a substituição por balancetes ou balanços provisórios;', { size: 9.5 });
  pdf.bullet('comprovação de patrimônio líquido mínimo de 5% (cinco por cento) do valor estimado do lote disputado, ou de capital social integralizado igual ou superior a esse percentual;', { size: 9.5 });
  pdf.bullet('certidão negativa de débitos inscritos na dívida ativa do Município de Vale Verde.', { size: 9.5, spaceAfter: 8 });

  pdf.text('4.5. Visita técnica. A visita técnica é facultativa, porém recomenda-se o comparecimento para verificação das condições de instalação das salas de informática. Caso o licitante opte pela não realização, deverá apresentar declaração formal de pleno conhecimento das condições locais, sob pena de não poder alegar desconhecimento posterior.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('4.6. Amostra. Poderá ser exigida amostra ou prova de conceito dos equipamentos classificados em primeiro lugar, no prazo de 5 (cinco) dias úteis, para os itens dos Lotes 1 e 2, sendo o custo integral por conta do licitante.', { size: 10, lineHeight: 1.5, spaceAfter: 12 });

  /* ------------------- 5. DA PROPOSTA E DOS PREÇOS --------------------- */
  pdf.heading('5. DA PROPOSTA E DOS PREÇOS');
  pdf.text('5.1. O critério de julgamento é o de MENOR PREÇO POR LOTE, observados os limites do valor máximo estimado, sendo considerada vencedora a proposta que apresentar o menor preço total para o lote, desde que atenda integralmente às especificações técnicas do Termo de Referência.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('5.2. Serão desclassificadas as propostas que apresentarem preço manifestamente inexequível, caracterizado quando o valor ofertado for inferior a 70% (setenta por cento) do valor estimado do lote ou quando comprovadamente insuficiente para cobrir os custos dos insumos, ressalvada a apresentação de demonstrativo de viabilidade.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('5.3. O valor estimado total da contratação é de R$ 1.284.350,00 (um milhão, duzentos e oitenta e quatro mil, trezentos e cinquenta reais), conforme planilha orçamentária constante do Anexo II deste Edital, elaborada com base em pesquisa de preços junto ao Painel de Preços do Ministério da Gestão e da Inovação.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('5.4. O valor máximo aceito para cada lote corresponde ao valor estimado do respectivo lote, não sendo admitidas propostas que o excedam.', { size: 10, lineHeight: 1.5, spaceAfter: 12 });

  /* ------------------------ 6. DOS RECURSOS ---------------------------- */
  pdf.heading('6. DOS RECURSOS');
  pdf.text('6.1. A intenção de recorrer deverá ser manifestada imediatamente após o término da sessão pública, sob pena de preclusão, sendo assegurado o prazo de 3 (três) dias úteis para apresentação das razões recursais, contados da data de intimação ou de lavratura da ata.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('6.2. Os recursos serão dirigidos à autoridade competente, por intermédio do sistema eletrônico, e terão efeito suspensivo do ato ou da decisão recorrida até que sobrevenha decisão final.', { size: 10, lineHeight: 1.5, spaceAfter: 12 });

  /* ---------------------- 7. DAS OBRIGAÇÕES ---------------------------- */
  pdf.heading('7. DAS OBRIGAÇÕES');
  pdf.text('7.1. Obrigações da contratada:', { size: 10, bold: true, spaceAfter: 3 });
  pdf.bullet('executar o objeto conforme as especificações técnicas do Termo de Referência e as condições da proposta, respondendo integralmente por vícios, defeitos ou incorreções;', { size: 9.5 });
  pdf.bullet('entregar os equipamentos novos, sem uso, acompanhados de nota fiscal, termo de garantia e manual em português, no prazo de 45 (quarenta e cinco) dias corridos contados da autorização de fornecimento;', { size: 9.5 });
  pdf.bullet('realizar a instalação e a configuração dos equipamentos nos locais indicados, bem como o treinamento de 2 (duas) turmas de até 20 (vinte) servidores, com carga horária de 16 (dezesseis) horas, em até 30 (trinta) dias corridos após a entrega;', { size: 9.5 });
  pdf.bullet('prestar garantia técnica on-site de 36 (trinta e seis) meses para os itens dos Lotes 1 e 2, com atendimento em até 48 (quarenta e oito) horas úteis após a abertura do chamado;', { size: 9.5 });
  pdf.bullet('manter, durante toda a execução do contrato, as condições de habilitação e qualificação exigidas na licitação, bem como a regularidade fiscal e trabalhista;', { size: 9.5 });
  pdf.bullet('reparar, corrigir, remover, reconstruir ou substituir, às suas expensas, no total ou em parte, o objeto do contrato em que se verificarem vícios, defeitos ou incorreções;', { size: 9.5 });
  pdf.bullet('responder pelos danos causados diretamente ao órgão contratante ou a terceiros, decorrentes de sua culpa ou dolo na execução do contrato;', { size: 9.5 });
  pdf.bullet('comunicar ao fiscal do contrato, por escrito e imediatamente, qualquer fato que possa comprometer a execução do objeto, bem como manter sigilo sobre as informações a que tiver acesso.', { size: 9.5, spaceAfter: 8 });

  pdf.text('7.2. Obrigações da contratante:', { size: 10, bold: true, spaceAfter: 3 });
  pdf.bullet('exercer a fiscalização da execução do contrato, por meio de servidor especialmente designado, anotando em registro próprio todas as ocorrências relacionadas à execução;', { size: 9.5 });
  pdf.bullet('efetuar o pagamento no prazo estabelecido neste Edital, após o recebimento definitivo do objeto e a apresentação da documentação fiscal;', { size: 9.5 });
  pdf.bullet('prestar as informações e os esclarecimentos necessários à execução do objeto, bem como disponibilizar os locais e as condições de acesso para a instalação dos equipamentos;', { size: 9.5 });
  pdf.bullet('comunicar à contratada, por escrito, as ocorrências que possam afetar a execução do contrato.', { size: 9.5, spaceAfter: 8 });

  pdf.text('7.3. Subcontratação. É vedada a subcontratação total do objeto. Será admitida a subcontratação parcial de até 30% (trinta por cento) do valor do contrato, exclusivamente para os serviços de cabeamento estruturado e instalação elétrica do Lote 3, mediante autorização prévia e por escrito da Administração, mantida a responsabilidade integral da contratada perante o Município.', { size: 10, lineHeight: 1.5, spaceAfter: 12 });

  /* -------------------- 8. DO PAGAMENTO E GARANTIA --------------------- */
  pdf.heading('8. DO PAGAMENTO E DA GARANTIA');
  pdf.text('8.1. O pagamento será efetuado em até 30 (trinta) dias corridos, contados do recebimento definitivo do objeto, mediante apresentação de nota fiscal devidamente atestada pelo fiscal do contrato e acompanhada da comprovação da regularidade fiscal e trabalhista.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('8.2. Para os lotes de equipamentos, será admitido o pagamento parcelado por lote, desde que a entrega e a instalação tenham sido integralmente concluídas e atestadas.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('8.3. A contratada deverá apresentar garantia de execução contratual no percentual de 5% (cinco por cento) do valor total do contrato, em uma das seguintes modalidades: caução em dinheiro, título da dívida pública, fiança bancária ou seguro-garantia, no prazo de 10 (dez) dias úteis contados da assinatura do contrato.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('8.4. Nenhum pagamento será realizada enquanto pendente de liquidação qualquer obrigação financeira da contratada, sem que isso gere direito a reajustamento de preços ou compensação financeira.', { size: 10, lineHeight: 1.5, spaceAfter: 12 });

  /* ---------------------- 9. DAS PENALIDADES --------------------------- */
  pdf.heading('9. DAS PENALIDADES');
  pdf.text('9.1. Pelo descumprimento das obrigações contratuais, a contratada ficará sujeita às seguintes sanções, sem prejuízo das responsabilidades civil e criminal:', { size: 10, lineHeight: 1.5, spaceAfter: 3 });
  pdf.bullet('advertência escrita, em caso de faltas leves que não causem prejuízo relevante à Administração;', { size: 9.5 });
  pdf.bullet('multa moratória de 0,5% (meio por cento) por dia de atraso sobre o valor da parcela não entregue, limitada a 10% (dez por cento) do valor total do contrato;', { size: 9.5 });
  pdf.bullet('multa compensatória de até 20% (vinte por cento) sobre o valor total do contrato, em caso de inexecução total ou de recusa injustificada em assinar o contrato;', { size: 9.5 });
  pdf.bullet('suspensão temporária de participação em licitação e impedimento de contratar com a Administração por prazo não superior a 2 (dois) anos;', { size: 9.5 });
  pdf.bullet('declaração de inidoneidade para licitar ou contratar com a Administração Pública, pelo prazo de 3 (três) a 6 (seis) anos.', { size: 9.5, spaceAfter: 8 });
  pdf.text('9.2. A multa será descontada da garantia prestada ou, na sua ausência ou insuficiência, cobrada administrativamente ou judicialmente, aplicando-se o devido processo legal, o contraditório e a ampla defesa.', { size: 10, lineHeight: 1.5, spaceAfter: 12 });

  /* ------------------- 10. DO PRAZO E DA VIGÊNCIA ---------------------- */
  pdf.heading('10. DO PRAZO E DA VIGÊNCIA');
  pdf.text('10.1. O contrato terá vigência de 12 (doze) meses, contados da data de sua assinatura, podendo ser prorrogado por períodos sucessivos, até o limite de 60 (sessenta) meses, desde que comprovada a vantajosidade e a disponibilidade orçamentária.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('10.2. O prazo para assinatura do contrato é de 5 (cinco) dias úteis, contados da convocação formal do adjudicatário, sob pena de decair o direito à contratação.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('10.3. Os prazos de entrega e de execução dos serviços iniciam-se somente após o recebimento, pela contratada, da autorização de fornecimento emitida pela Secretaria Municipal de Educação.', { size: 10, lineHeight: 1.5, spaceAfter: 12 });

  /* ------------------------ 11. DISPOSIÇÕES FINAIS --------------------- */
  pdf.heading('11. DAS DISPOSIÇÕES FINAIS');
  pdf.text('11.1. Os casos omissos serão resolvidos pela autoridade competente, observadas as disposições da Lei Federal nº 14.133/2021, do Decreto Municipal nº 2.104/2023 e demais normas aplicáveis.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('11.2. O sistema eletrônico poderá ser fechado automaticamente para recebimento de propostas, não sendo admitidas alegações de desconhecimento do horário oficial de Brasília.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('11.3. As decisões, comunicados e avisos relativos a este certame serão divulgados no Portal Nacional de Contratações Públicas e no sítio eletrônico oficial do Município de Vale Verde, sendo de responsabilidade exclusiva do licitante o acompanhamento.', { size: 10, lineHeight: 1.5, spaceAfter: 6 });
  pdf.text('11.4. Os anexos integram este Edital para todos os efeitos: Anexo I — Termo de Referência; Anexo II — Planilha Orçamentária; Anexo III — Minuta do Contrato; Anexo IV — Modelos de Declarações; Anexo V — Estudo Técnico Preliminar.', { size: 10, lineHeight: 1.5, spaceAfter: 14 });

  pdf.line([0.1, 0.14, 0.24], 1.2);
  pdf.spacer(8);
  pdf.text('Vale Verde, 1º de julho de 2025.', { size: 10, align: 'center', spaceAfter: 18 });
  pdf.text('MARIA APARECIDA FONSECA', { size: 10, bold: true, align: 'center', spaceAfter: 1 });
  pdf.text('Secretária Municipal de Educação', { size: 9, align: 'center', color: [0.42, 0.47, 0.56], spaceAfter: 1 });
  pdf.text('Autoridade competente — Portaria nº 118/2025', { size: 8.5, align: 'center', color: [0.42, 0.47, 0.56], spaceAfter: 20 });

  /* --------------------- ANEXO II — ITENS E VALORES -------------------- */
  pdf.heading('ANEXO II — PLANILHA ORÇAMENTÁRIA (SÍNTESE)');
  pdf.text('Valores unitários e totais estimados por item, para fins de referência das propostas. Os valores abaixo são o valor máximo admitido para cada item.', { size: 9, lineHeight: 1.4, spaceAfter: 8 });
  pdf.table({
    columns: [
      { header: 'Item', width: 34, align: 'center' },
      { header: 'Descrição', width: 250 },
      { header: 'Qtd.', width: 40, align: 'right' },
      { header: 'Un.', width: 30, align: 'center' },
      { header: 'Lote', width: 44, align: 'center' },
      { header: 'Valor unit.', width: 60, align: 'right' },
      { header: 'Valor total', width: 65, align: 'right' },
    ],
    rows: ITENS.map((item) => [item[0], item[1], item[2], item[3], item[4], item[5], item[6]]),
    size: 8,
    spaceAfter: 10,
  });
  pdf.text(`Valor total estimado do certame: R$ 1.284.350,00 (um milhão, duzentos e oitenta e quatro mil, trezentos e cinquenta reais).`, {
    size: 9.5,
    bold: true,
    spaceAfter: 6,
  });
  pdf.text('Observação: os quantitativos de pontos lógicos de cabeamento poderão variar em até 10% para mais ou para menos, conforme levantamento final realizado in loco pela fiscalização.', {
    size: 9,
    lineHeight: 1.4,
    spaceAfter: 14,
  });

  pdf.heading('ANEXO IV — MODELO DE DECLARAÇÃO');
  pdf.text('Declaramos, sob as penas da lei, que a empresa __________________________, inscrita no CNPJ nº __________________, declara que:', { size: 9.5, lineHeight: 1.5, spaceAfter: 4 });
  pdf.bullet('não se encontra em processo de falência, recuperação judicial ou extrajudicial, concurso de credores, dissolução ou liquidação;', { size: 9.5 });
  pdf.bullet('cumpre o disposto no artigo 7º, inciso XXXIII, da Constituição Federal, no que se refere à proibição de trabalho noturno, perigoso ou insalubre a menores de 18 anos e de qualquer trabalho a menores de 16 anos;', { size: 9.5 });
  pdf.bullet('está ciente e concorda com as condições e exigências estabelecidas no Edital e seus anexos;', { size: 9.5 });
  pdf.bullet('tem pleno conhecimento das condições locais para a execução do objeto, inclusive quanto às condições de instalação.', { size: 9.5, spaceAfter: 14 });

  return pdf.build({
    title: 'Pregão Eletrônico nº 042/2025 — Prefeitura Municipal de Vale Verde (documento fictício de demonstração)',
    author: 'Prefeitura Municipal de Vale Verde — Secretaria Municipal de Educação',
    subject: 'Edital de licitação — documento fictício para demonstração do Analisador Inteligente de Editais',
  });
}
