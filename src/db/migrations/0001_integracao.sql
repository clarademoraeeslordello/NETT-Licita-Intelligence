-- =====================================================================================
-- PROPOSTA DO AGENTE 02 — PENDENTE DE APROVAÇÃO DO AGENTE 01 (Arquitetura).
-- Schema isolado `integracao`: não altera nenhuma tabela de outros módulos.
-- Não aplicar em ambiente compartilhado/produção antes da aprovação registrada em
-- docs/coordination/CONTRACTS.md.
-- =====================================================================================
CREATE SCHEMA IF NOT EXISTS integracao;

CREATE TABLE integracao.fonte (
  id          text PRIMARY KEY,
  nome        text NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('licitacao', 'gestao')),
  habilitada  boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO integracao.fonte (id, nome, tipo) VALUES
  ('pncp', 'Portal Nacional de Contratações Públicas', 'licitacao'),
  ('comprasgov', 'Compras.gov.br — Dados Abertos', 'licitacao'),
  ('siga_rj', 'SIGA/RJ — Compras do Estado do Rio de Janeiro', 'licitacao'),
  ('trello', 'Trello — board comercial Nett (somente leitura)', 'gestao');

-- ---------------------------------------------------------------- oportunidades
CREATE TABLE integracao.oportunidade (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave_canonica                text NOT NULL UNIQUE,
  numero_controle_pncp          text,
  numero_compra                 text,
  ano                           integer,
  processo                      text,
  objeto                        text NOT NULL,
  informacao_complementar       text,
  orgao_cnpj                    text,
  orgao_nome                    text NOT NULL,
  unidade_nome                  text,
  municipio                     text,
  uf                            text,
  esfera                        text CHECK (esfera IN ('federal','estadual','municipal','distrital')),
  modalidade_id_pncp            integer,
  modalidade_nome               text NOT NULL,
  situacao                      text,
  srp                           boolean,
  amparo_legal                  text,
  data_publicacao               timestamptz,
  data_abertura_propostas       timestamptz,
  data_encerramento_propostas   timestamptz,
  data_atualizacao_fonte        timestamptz,
  valor_estimado                numeric(18,4),
  valor_homologado              numeric(18,4),
  link_oficial                  text NOT NULL,
  link_sistema_origem           text,
  cancelada                     boolean NOT NULL DEFAULT false,
  termos_dicionario             text[] NOT NULL DEFAULT '{}',
  status_processamento          text NOT NULL DEFAULT 'listada'
                                CHECK (status_processamento IN ('listada','processada','erro')),
  processada_em                 timestamptz,
  hash_conteudo                 text NOT NULL,
  -- Fonte de maior prioridade que já alimentou o registro (pncp > comprasgov > siga_rj).
  fonte_principal               text NOT NULL REFERENCES integracao.fonte(id),
  versao                        integer NOT NULL DEFAULT 1,
  primeira_coleta_em            timestamptz NOT NULL DEFAULT now(),
  atualizada_em                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oportunidade_controle_idx ON integracao.oportunidade (numero_controle_pncp);
CREATE INDEX oportunidade_orgao_idx ON integracao.oportunidade (orgao_cnpj, ano);
CREATE INDEX oportunidade_encerramento_idx ON integracao.oportunidade (data_encerramento_propostas);
CREATE INDEX oportunidade_atualizada_idx ON integracao.oportunidade (atualizada_em DESC);

-- Cada fonte que viu a oportunidade, com o ID externo original e o último payload bruto.
CREATE TABLE integracao.oportunidade_fonte (
  id                 bigserial PRIMARY KEY,
  oportunidade_id    uuid NOT NULL REFERENCES integracao.oportunidade(id) ON DELETE CASCADE,
  fonte_id           text NOT NULL REFERENCES integracao.fonte(id),
  id_externo         text NOT NULL,
  url_origem         text,
  hash_payload       text NOT NULL,
  payload            jsonb NOT NULL,
  primeira_coleta_em timestamptz NOT NULL DEFAULT now(),
  ultima_coleta_em   timestamptz NOT NULL DEFAULT now(),
  vezes_vista        integer NOT NULL DEFAULT 1,
  UNIQUE (fonte_id, id_externo)
);
CREATE INDEX oportunidade_fonte_op_idx ON integracao.oportunidade_fonte (oportunidade_id);

CREATE TABLE integracao.oportunidade_historico (
  id                bigserial PRIMARY KEY,
  oportunidade_id   uuid NOT NULL REFERENCES integracao.oportunidade(id) ON DELETE CASCADE,
  versao            integer NOT NULL,
  tipo              text NOT NULL CHECK (tipo IN ('criacao','atualizacao')),
  fonte_id          text NOT NULL REFERENCES integracao.fonte(id),
  campos_alterados  jsonb NOT NULL,
  alterado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oportunidade_id, versao)
);

CREATE TABLE integracao.documento (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oportunidade_id   uuid NOT NULL REFERENCES integracao.oportunidade(id) ON DELETE CASCADE,
  fonte_id          text NOT NULL REFERENCES integracao.fonte(id),
  id_externo        text NOT NULL,
  titulo            text NOT NULL,
  tipo              text NOT NULL,
  url               text NOT NULL,
  publicado_em      timestamptz,
  ativo             boolean NOT NULL DEFAULT true,
  coletado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oportunidade_id, fonte_id, id_externo)
);

CREATE TABLE integracao.oportunidade_item (
  oportunidade_id          uuid NOT NULL REFERENCES integracao.oportunidade(id) ON DELETE CASCADE,
  numero                   integer NOT NULL,
  descricao                text NOT NULL,
  tipo                     text NOT NULL CHECK (tipo IN ('material','servico')),
  quantidade               numeric(18,4),
  unidade                  text,
  valor_unitario_estimado  numeric(18,4),
  valor_total_estimado     numeric(18,4),
  coletado_em              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (oportunidade_id, numero)
);

-- Duplicidades suspeitas entre chaves diferentes (não são mescladas automaticamente).
CREATE TABLE integracao.possivel_duplicata (
  id               bigserial PRIMARY KEY,
  oportunidade_a   uuid NOT NULL REFERENCES integracao.oportunidade(id) ON DELETE CASCADE,
  oportunidade_b   uuid NOT NULL REFERENCES integracao.oportunidade(id) ON DELETE CASCADE,
  motivo           text NOT NULL,
  similaridade     numeric(5,4) NOT NULL,
  status           text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmada','descartada')),
  detectada_em     timestamptz NOT NULL DEFAULT now(),
  CHECK (oportunidade_a < oportunidade_b),
  UNIQUE (oportunidade_a, oportunidade_b)
);

-- ---------------------------------------------------------------- fila persistente
CREATE TABLE integracao.fila_job (
  id               bigserial PRIMARY KEY,
  tipo             text NOT NULL,
  chave_dedupe     text,
  payload          jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','executando','concluido','falhou','morto')),
  prioridade       integer NOT NULL DEFAULT 100,
  tentativas       integer NOT NULL DEFAULT 0,
  max_tentativas   integer NOT NULL DEFAULT 5,
  disponivel_em    timestamptz NOT NULL DEFAULT now(),
  bloqueado_ate    timestamptz,
  bloqueado_por    text,
  ultimo_erro      text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  iniciado_em      timestamptz,
  concluido_em     timestamptz
);
-- Um mesmo trabalho não fica duplicado enquanto estiver aberto.
CREATE UNIQUE INDEX fila_job_dedupe_aberto ON integracao.fila_job (chave_dedupe)
  WHERE status IN ('pendente','executando','falhou');
CREATE INDEX fila_job_pronto_idx ON integracao.fila_job (status, tipo, disponivel_em, prioridade);
CREATE INDEX fila_job_concluido_idx ON integracao.fila_job (tipo, concluido_em) WHERE status = 'concluido';

-- ---------------------------------------------------------------- coleta e monitoramento
CREATE TABLE integracao.coleta_cursor (
  fonte_id          text NOT NULL REFERENCES integracao.fonte(id),
  chave             text NOT NULL,
  pagina_concluida  integer NOT NULL DEFAULT 0,
  total_paginas     integer,
  total_registros   integer,
  fechado           boolean NOT NULL DEFAULT false,
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fonte_id, chave)
);

CREATE TABLE integracao.execucao_coleta (
  id                  bigserial PRIMARY KEY,
  fonte_id            text NOT NULL REFERENCES integracao.fonte(id),
  tipo                text NOT NULL,
  status              text NOT NULL DEFAULT 'executando'
                      CHECK (status IN ('executando','sucesso','parcial','falha')),
  iniciada_em         timestamptz NOT NULL DEFAULT now(),
  finalizada_em       timestamptz,
  duracao_ms          integer,
  paginas_lidas       integer NOT NULL DEFAULT 0,
  registros_lidos     integer NOT NULL DEFAULT 0,
  registros_aderentes integer NOT NULL DEFAULT 0,
  novas               integer NOT NULL DEFAULT 0,
  atualizadas         integer NOT NULL DEFAULT 0,
  inalteradas         integer NOT NULL DEFAULT 0,
  enfileiradas        integer NOT NULL DEFAULT 0,
  erros               integer NOT NULL DEFAULT 0,
  detalhe             jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX execucao_coleta_fonte_idx ON integracao.execucao_coleta (fonte_id, iniciada_em DESC);

-- ---------------------------------------------------------------- eventos (outbox)
CREATE TABLE integracao.evento_saida (
  id            bigserial PRIMARY KEY,
  tipo          text NOT NULL,
  agregado_id   text NOT NULL,
  payload       jsonb NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evento_saida_tipo_idx ON integracao.evento_saida (tipo, id);

-- ---------------------------------------------------------------- Trello (somente leitura)
CREATE TABLE integracao.trello_board (
  id_externo      text PRIMARY KEY,
  nome            text NOT NULL,
  url             text,
  payload         jsonb NOT NULL,
  sincronizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integracao.trello_lista (
  id_externo      text PRIMARY KEY,
  board_id        text NOT NULL REFERENCES integracao.trello_board(id_externo),
  nome            text NOT NULL,
  posicao         double precision,
  arquivada       boolean NOT NULL DEFAULT false,
  payload         jsonb NOT NULL,
  sincronizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integracao.trello_etiqueta (
  id_externo      text PRIMARY KEY,
  board_id        text NOT NULL REFERENCES integracao.trello_board(id_externo),
  nome            text,
  cor             text,
  sincronizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integracao.trello_card (
  id_externo        text PRIMARY KEY,
  board_id          text NOT NULL REFERENCES integracao.trello_board(id_externo),
  lista_id          text NOT NULL,
  nome              text NOT NULL,
  descricao         text NOT NULL DEFAULT '',
  etiquetas         text[] NOT NULL DEFAULT '{}',
  prazo             timestamptz,
  prazo_concluido   boolean NOT NULL DEFAULT false,
  inicio            timestamptz,
  arquivado         boolean NOT NULL DEFAULT false,
  url               text,
  ultima_atividade  timestamptz,
  hash_conteudo     text NOT NULL,
  payload           jsonb NOT NULL,
  versao            integer NOT NULL DEFAULT 1,
  primeira_sinc_em  timestamptz NOT NULL DEFAULT now(),
  sincronizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trello_card_lista_idx ON integracao.trello_card (lista_id);

CREATE TABLE integracao.trello_checklist (
  id_externo      text PRIMARY KEY,
  card_id         text NOT NULL REFERENCES integracao.trello_card(id_externo) ON DELETE CASCADE,
  nome            text NOT NULL,
  itens           jsonb NOT NULL,
  sincronizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integracao.trello_anexo (
  id_externo      text PRIMARY KEY,
  card_id         text NOT NULL REFERENCES integracao.trello_card(id_externo) ON DELETE CASCADE,
  nome            text,
  url             text,
  mime            text,
  bytes           bigint,
  criado_em       timestamptz,
  sincronizado_em timestamptz NOT NULL DEFAULT now()
);

-- Ações do board: comentários, movimentações entre listas, alterações. Preserva o histórico.
-- Minimização: guarda apenas o id do membro autor, não nome/avatar.
CREATE TABLE integracao.trello_acao (
  id_externo      text PRIMARY KEY,
  board_id        text NOT NULL,
  card_id         text,
  tipo            text NOT NULL,
  ocorrida_em     timestamptz NOT NULL,
  membro_id       text,
  texto           text,
  lista_origem    text,
  lista_destino   text,
  dados           jsonb NOT NULL,
  origem_captura  text NOT NULL CHECK (origem_captura IN ('sincronizacao','webhook')),
  capturada_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trello_acao_card_idx ON integracao.trello_acao (card_id, ocorrida_em);

-- Vínculo card ↔ oportunidade (por número de controle PNCP ou link encontrado no card).
CREATE TABLE integracao.trello_card_oportunidade (
  card_id          text NOT NULL REFERENCES integracao.trello_card(id_externo) ON DELETE CASCADE,
  oportunidade_id  uuid REFERENCES integracao.oportunidade(id) ON DELETE SET NULL,
  numero_controle_pncp text NOT NULL,
  detectado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, numero_controle_pncp)
);

CREATE TABLE integracao.trello_webhook_recebido (
  id            bigserial PRIMARY KEY,
  action_id     text,
  tipo          text,
  card_id       text,
  assinatura_ok boolean NOT NULL,
  recebido_em   timestamptz NOT NULL DEFAULT now()
);
