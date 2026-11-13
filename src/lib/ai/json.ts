/**
 * Leitura tolerante da resposta do modelo.
 *
 * Modelos de linguagem não devolvem JSON de forma confiável: colocam cercas de
 * código, escrevem uma frase antes do objeto ou — o caso mais comum em schemas
 * grandes — são cortados no meio pelo limite de tokens de saída, deixando o JSON
 * sem fechar.
 *
 * Em vez de tratar tudo isso como "resposta inválida" e derrubar uma análise já
 * paga, este módulo tenta recuperar o máximo de informação possível e sinaliza
 * ao chamador quando o resultado veio de um reparo.
 */
import { AppError } from '../errors';

export type ParsedModelJson = {
  data: unknown;
  /** `true` quando o JSON só foi obtido após reparar uma resposta truncada. */
  repaired: boolean;
};

/** Remove cercas de código (` ```json ... ``` `) que o modelo insiste em adicionar. */
function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/**
 * Recorta o primeiro objeto `{...}` balanceado do texto.
 *
 * Diferente de `indexOf('{')`/`lastIndexOf('}')`, o scanner respeita strings e
 * escapes — um `}` dentro de um trecho citado do edital não encerra o objeto.
 */
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

/**
 * Fecha um fragmento de JSON interrompido.
 *
 * Se a resposta terminou dentro de uma string, fecha a string; em seguida
 * completa os `}`/`]` que ficaram abertos. Devolve `null` quando o fragmento
 * termina em um ponto sem valor (ex.: `{"a":`) — nesse caso o chamador deve
 * retroceder até o último elemento completo.
 */
function closeOpenStructures(piece: string): string | null {
  let out = piece.replace(/\s+$/, '');
  if (!out || out === '{') return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of out) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') stack.pop();
  }

  // Barra invertida solta no fim invalidaria a string recém-fechada.
  if (escaped) out = out.slice(0, -1);
  if (inString) out += '"';

  // Vírgula pendente (`[1,2,`) sobra depois de remover o último elemento.
  out = out.replace(/[,\s]+$/, '');

  // Terminou em `:` ou em uma chave recém-aberta: não há valor para o membro.
  if (/[:[{]$/.test(out)) return null;

  return out + stack.reverse().join('');
}

/**
 * Recupera um objeto JSON cortado pelo limite de tokens.
 *
 * Tenta primeiro fechar a resposta inteira (preservando o último elemento, que
 * muitas vezes só perdeu o `}`/`"` final); se o corte caiu em um ponto sem
 * valor, retrocede até o último elemento completo e tenta de novo.
 */
export function salvageTruncatedJson(text: string): unknown | null {
  const start = text.indexOf('{');
  const body = start >= 0 ? text.slice(start) : text;

  const candidates: number[] = [body.length];
  for (let index = body.length - 1; index >= 0 && candidates.length < 500; index -= 1) {
    const char = body[index];
    if (char === ',' || char === '}' || char === ']') candidates.push(index);
  }

  for (const cut of candidates) {
    const closed = closeOpenStructures(body.slice(0, cut));
    if (!closed) continue;
    try {
      return JSON.parse(closed);
    } catch {
      /* tenta o corte anterior */
    }
  }

  return null;
}

/**
 * Converte o texto devolvido pelo modelo em um objeto.
 *
 * Ordem das tentativas: JSON direto → primeiro objeto balanceado do texto →
 * (somente quando a resposta foi truncada) reparo do fragmento.
 *
 * @throws AppError quando nada é recuperável.
 */
export function parseModelJson(
  text: string,
  options: { truncated?: boolean; label?: string } = {},
): ParsedModelJson {
  const clean = stripCodeFence(text);

  try {
    return { data: JSON.parse(clean), repaired: false };
  } catch {
    /* segue para as estratégias seguintes */
  }

  const balanced = firstBalancedObject(clean);
  if (balanced) {
    try {
      return { data: JSON.parse(balanced), repaired: false };
    } catch {
      /* segue para o reparo */
    }
  }

  if (options.truncated) {
    const salvaged = salvageTruncatedJson(clean);
    if (salvaged !== null && typeof salvaged === 'object') {
      return { data: salvaged, repaired: true };
    }

    throw new AppError(
      'AI_INVALID_RESPONSE',
      'A resposta do modelo foi cortada pelo limite de tokens de saída e não pôde ser recuperada.',
      {
        status: 502,
        details: `${options.label ? `[${options.label}] ` : ''}finish_reason=length · ${clean.length} caracteres gerados`,
        hint: 'Aumente AI_MAX_OUTPUT_TOKENS (ex.: 32768) no .env ou envie um documento menor. O limite de saída é o que define quanto do relatório cabe na resposta.',
      },
    );
  }

  throw new AppError('AI_INVALID_RESPONSE', 'A IA retornou um conteúdo que não é JSON válido.', {
    status: 502,
    details: `${options.label ? `[${options.label}] ` : ''}${clean.slice(0, 300)}`,
    hint: 'Tente novamente. Se persistir, troque o modelo configurado em DEEPSEEK_MODEL.',
  });
}
