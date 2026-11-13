-- Resultados das análises do Arremate.
-- Na Vercel cada requisição pode cair numa instância diferente: o job que rodou
-- a análise fica na memória de uma, e a página do relatório pode abrir em outra.
-- Gravar o resultado aqui faz o relatório abrir em qualquer instância e permite
-- reaproveitar a análise do mesmo PDF sem gastar IA de novo.
create table if not exists arremate.analises (
  id text primary key,
  -- hash do conteúdo do PDF + motor/modelo (mesma chave do cache em memória)
  hash text,
  job jsonb not null,
  criado_em timestamptz not null default now()
);
create index if not exists analises_hash_idx on arremate.analises (hash, criado_em desc);
create index if not exists analises_criado_idx on arremate.analises (criado_em);

create or replace function public.arremate_salvar_analise(p_segredo text, p_id text, p_hash text, p_job jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not arremate.autorizado(p_segredo) then raise exception 'NAO_AUTORIZADO'; end if;
  insert into arremate.analises (id, hash, job) values (p_id, p_hash, p_job)
  on conflict (id) do update set hash = excluded.hash, job = excluded.job;
  delete from arremate.analises where criado_em < now() - interval '30 days';
end $$;

create or replace function public.arremate_obter_analise(p_segredo text, p_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not arremate.autorizado(p_segredo) then raise exception 'NAO_AUTORIZADO'; end if;
  return (select job from arremate.analises where id = p_id);
end $$;

create or replace function public.arremate_analise_por_hash(p_segredo text, p_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not arremate.autorizado(p_segredo) then raise exception 'NAO_AUTORIZADO'; end if;
  return (select job from arremate.analises where hash = p_hash order by criado_em desc limit 1);
end $$;

revoke all on function public.arremate_salvar_analise(text, text, text, jsonb) from public;
revoke all on function public.arremate_obter_analise(text, text) from public;
revoke all on function public.arremate_analise_por_hash(text, text) from public;
grant execute on function public.arremate_salvar_analise(text, text, text, jsonb) to anon;
grant execute on function public.arremate_obter_analise(text, text) to anon;
grant execute on function public.arremate_analise_por_hash(text, text) to anon;
