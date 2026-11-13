'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconCheckCircle, IconRadar, IconRefresh, IconX } from '@/components/icons';
import { MODALIDADES } from '@/lib/pncp/modalidades';
import type { Perfil } from '@/lib/plataforma/workspace';
import { useWorkspace } from './workspace-provider';
import { botaoPrimario, botaoSecundario, LinhasEsqueleto, PageHeader, Painel } from './ui';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const MODALIDADES_OFERTADAS = [6, 8, 4, 7, 12, 5];

function CampoTags({
  rotulo,
  ajuda,
  valores,
  onChange,
  placeholder,
  tom = 'brand',
  maximo,
}: {
  rotulo: string;
  ajuda: string;
  valores: string[];
  onChange: (valores: string[]) => void;
  placeholder: string;
  tom?: 'brand' | 'danger';
  maximo?: number;
}) {
  const [texto, setTexto] = useState('');
  const cheio = maximo !== undefined && valores.length >= maximo;
  const adicionar = () => {
    const novos = texto
      .split(',')
      .map((valor) => valor.trim().toLowerCase())
      .filter((valor) => valor.length >= 2 && !valores.includes(valor));
    if (novos.length) onChange([...valores, ...novos].slice(0, maximo ?? Infinity));
    setTexto('');
  };
  const chip = tom === 'brand' ? 'bg-brand-50 text-brand-800' : 'bg-danger-100/60 text-danger-700';

  return (
    <div>
      <p className="text-sm font-medium text-ink-800">{rotulo}</p>
      <p className="mt-0.5 text-xs text-ink-500">{ajuda}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 p-2 focus-within:border-brand-300">
        {valores.map((valor) => (
          <span key={valor} className={`inline-flex items-center gap-1 rounded-lg py-1 pl-2.5 pr-1 text-sm ${chip}`}>
            {valor}
            <button type="button" onClick={() => onChange(valores.filter((item) => item !== valor))} className="rounded p-0.5 opacity-60 hover:opacity-100" aria-label={`Remover ${valor}`}>
              <IconX size={13} />
            </button>
          </span>
        ))}
        <input
          value={texto}
          disabled={cheio}
          onChange={(event) => setTexto(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              adicionar();
            } else if (event.key === 'Backspace' && !texto && valores.length) {
              onChange(valores.slice(0, -1));
            }
          }}
          onBlur={adicionar}
          placeholder={cheio ? `Máximo de ${maximo}` : placeholder}
          className="min-w-40 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
        />
      </div>
    </div>
  );
}

export function PerfilView() {
  const { ws, pronto, salvarPerfil, reiniciar } = useWorkspace();
  const [form, setForm] = useState<Perfil>(ws.perfil);
  const [salvo, setSalvo] = useState(false);
  const [confirmarReset, setConfirmarReset] = useState(false);

  useEffect(() => {
    if (pronto) setForm(ws.perfil);
  }, [pronto, ws.perfil]);

  useEffect(() => {
    if (!salvo) return;
    const timer = setTimeout(() => setSalvo(false), 3500);
    return () => clearTimeout(timer);
  }, [salvo]);

  const alterado = JSON.stringify(form) !== JSON.stringify(ws.perfil);
  const numero = (valor: string) => {
    const limpo = Number(valor.replace(/\D/g, ''));
    return valor.trim() && Number.isFinite(limpo) ? limpo : null;
  };
  const alternar = <T,>(lista: T[], item: T) => (lista.includes(item) ? lista.filter((valor) => valor !== item) : [...lista, item]);

  if (!pronto) return <LinhasEsqueleto linhas={3} altura="h-48" />;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        salvarPerfil({ ...form, empresa: form.empresa.trim() || 'Minha empresa' });
        setSalvo(true);
      }}
    >
      <PageHeader
        eyebrow="Empresa"
        titulo="Perfil e filtros"
        descricao="O que a empresa vende, onde atua e o tamanho de contrato que consegue assumir. O Radar usa essas informações para buscar e pontuar os editais."
        acoes={
          <>
            {salvo ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ok-700" role="status">
                <IconCheckCircle size={16} /> Perfil salvo
              </span>
            ) : null}
            <Link href="/radar" className={botaoSecundario}>
              <IconRadar size={16} /> Ver radar
            </Link>
            <button type="submit" className={botaoPrimario} disabled={!alterado}>
              Salvar perfil
            </button>
          </>
        }
      />

      {ws.inicio === 'zero' && ws.pipeline.length === 0 ? (
        <p className="mb-5 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          Pronto, começamos do zero. Diga o que a sua empresa vende e onde atua, salve e abra o <strong>Radar</strong>: os
          editais abertos no PNCP serão pontuados para o seu perfil.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Painel titulo="Empresa">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-ink-800">Razão social</span>
              <input value={form.empresa} onChange={(event) => setForm({ ...form, empresa: event.target.value })} className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-800">CNPJ</span>
              <input
                value={form.cnpj}
                onChange={(event) => setForm({ ...form, cnpj: event.target.value.replace(/[^\d./-]/g, '').slice(0, 18) })}
                placeholder="00.000.000/0000-00"
                className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-800">Porte</span>
              <select value={form.porte} onChange={(event) => setForm({ ...form, porte: event.target.value as Perfil['porte'] })} className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm">
                <option value="ME">Microempresa (ME)</option>
                <option value="EPP">Empresa de Pequeno Porte (EPP)</option>
                <option value="Demais">Demais</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-800">Ticket mínimo (R$)</span>
              <input inputMode="numeric" value={form.valorMin ?? ''} onChange={(event) => setForm({ ...form, valorMin: numero(event.target.value) })} placeholder="Sem mínimo" className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 font-mono text-sm" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-800">Capacidade máxima (R$)</span>
              <input inputMode="numeric" value={form.valorMax ?? ''} onChange={(event) => setForm({ ...form, valorMax: numero(event.target.value) })} placeholder="Sem limite" className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 font-mono text-sm" />
            </label>
          </div>
        </Painel>

        <Painel titulo="O que buscar">
          <div className="space-y-5">
            <CampoTags
              rotulo="Produtos e serviços"
              ajuda="Cada termo vira uma busca no PNCP (até 8). Use termos que aparecem no objeto dos editais."
              valores={form.termos}
              onChange={(termos) => setForm({ ...form, termos })}
              placeholder="Digite e pressione Enter"
              maximo={8}
            />
            <CampoTags
              rotulo="Excluir editais que mencionem"
              ajuda="Derruba a nota de editais fora do seu negócio."
              valores={form.termosExcluir}
              onChange={(termosExcluir) => setForm({ ...form, termosExcluir })}
              placeholder="Ex.: locação, obras"
              tom="danger"
            />
          </div>
        </Painel>

        <Painel
          titulo="Área de atuação"
          acao={
            <button type="button" onClick={() => setForm({ ...form, ufs: [] })} className="text-xs font-medium text-brand-700">
              Todo o Brasil
            </button>
          }
        >
          <p className="mb-3 text-xs text-ink-500">{form.ufs.length ? `${form.ufs.length} UF(s) selecionada(s)` : 'Nenhuma UF selecionada: o radar busca no país inteiro.'}</p>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
            {UFS.map((uf) => {
              const ativo = form.ufs.includes(uf);
              return (
                <button
                  key={uf}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setForm({ ...form, ufs: alternar(form.ufs, uf) })}
                  className={`rounded-lg py-2 font-mono text-xs font-medium transition ${ativo ? 'bg-brand-600 text-white shadow-soft' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}
                >
                  {uf}
                </button>
              );
            })}
          </div>
        </Painel>

        <Painel titulo="Modalidades de interesse">
          <div className="grid gap-2 sm:grid-cols-2">
            {MODALIDADES_OFERTADAS.map((id) => {
              const ativo = form.modalidades.includes(id);
              return (
                <label key={id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${ativo ? 'border-brand-300 bg-brand-50/60' : 'border-ink-200 hover:bg-ink-50'}`}>
                  <input type="checkbox" checked={ativo} onChange={() => setForm({ ...form, modalidades: alternar(form.modalidades, id) })} className="size-4 accent-brand-600" />
                  {MODALIDADES[id]}
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-ink-500">Sem nenhuma marcada, o radar considera todas as modalidades.</p>
        </Painel>
      </div>

      <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-danger-100 bg-white p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="text-sm font-medium text-ink-900">Restaurar dados de demonstração</p>
          <p className="text-xs text-ink-500">Apaga pipeline, documentos e perfil deste navegador e recria o cenário de exemplo.</p>
        </div>
        {confirmarReset ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmarReset(false)} className={botaoSecundario}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                reiniciar();
                setConfirmarReset(false);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-danger-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-danger-700"
            >
              Sim, restaurar
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmarReset(true)} className={botaoSecundario}>
            <IconRefresh size={16} /> Restaurar
          </button>
        )}
      </div>
    </form>
  );
}
