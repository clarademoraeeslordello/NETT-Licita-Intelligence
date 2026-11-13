/** Normalização de texto para comparação: minúsculas, sem acentos, espaços únicos. */
export function normalizar(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Verifica se `termo` aparece em `texto` no início de uma palavra.
 * "notebook" casa com "notebooks", mas "nota" não casa com "anotação".
 */
export function contemTermo(textoNormalizado: string, termo: string): boolean {
  const alvo = normalizar(termo);
  if (!alvo) return false;
  return ` ${textoNormalizado}`.includes(` ${alvo}`);
}

/** Palavras significativas de uma consulta (descarta preposições e artigos). */
const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'para', 'com', 'em', 'por', 'um', 'uma']);

export function palavrasChave(consulta: string): string[] {
  return normalizar(consulta)
    .split(' ')
    .filter((palavra) => palavra.length > 1 && !STOPWORDS.has(palavra));
}

/** Prefixos de organização que antecedem o nome do item ("Lote 1 - NOTEBOOK"). */
const PREFIXOS = new Set(['lote', 'item', 'grupo', 'kit']);

/**
 * O item casa quando TODAS as palavras da consulta aparecem na descrição e a
 * primeira delas abre a descrição (1ª ou 2ª palavra, ignorando "Lote 1 -").
 * Sem essa âncora, "Base cooler para notebook" entraria como amostra de notebook.
 */
export function itemCasa(descricao: string, palavras: string[]): boolean {
  const texto = normalizar(descricao);
  if (!palavras.every((palavra) => contemTermo(texto, palavra))) return false;
  const tokens = texto.split(' ');
  let inicio = 0;
  while (inicio < tokens.length && (PREFIXOS.has(tokens[inicio]) || /^\d+$/.test(tokens[inicio]))) inicio += 1;
  return contemTermo(tokens.slice(inicio, inicio + 2).join(' '), palavras[0]);
}
