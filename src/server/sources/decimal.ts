/** Comparação exata de decimais em string (contrato `decimal`), sem ponto flutuante. */
function parts(v: string): [bigint, number] {
  const [i, f = ''] = v.split('.');
  return [BigInt(`${i}${f.padEnd(4, '0').slice(0, 4)}`), 4];
}
const cmp = (a: string, b: string) => {
  const x = parts(a)[0];
  const y = parts(b)[0];
  return x < y ? -1 : x > y ? 1 : 0;
};
const Decimal = { cmp, lt: (a: string, b: string) => cmp(a, b) < 0, gt: (a: string, b: string) => cmp(a, b) > 0 };
export default Decimal;
