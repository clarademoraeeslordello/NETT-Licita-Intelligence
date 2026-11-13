-- Cota de análises com IA do Arremate (demonstração pública).
-- Schema próprio, fora da API REST: só as funções public.arremate_* acessam,
-- e todas exigem o segredo do servidor guardado em public.segredos.
create table if not exists public.segredos (nome text primary key, valor text not null);
alter table public.segredos enable row level security;

create schema if not exists arremate;

create table if not exists arremate.usos (
  id bigint generated always as identity primary key,
  -- IP com hash + sal no servidor: o banco nunca vê o IP em claro.
  ip_hash text not null,
  -- Identificador aleatório do navegador (localStorage), também com hash.
  dispositivo_hash text,
  estornado boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists usos_ip_idx on arremate.usos (ip_hash, criado_em desc);
create index if not exists usos_disp_idx on arremate.usos (dispositivo_hash, criado_em desc);
create index if not exists usos_criado_idx on arremate.usos (criado_em desc);

insert into public.segredos (nome, valor) values ('arremate', encode(gen_random_bytes(32), 'hex')) on conflict (nome) do nothing;

create or replace function arremate.autorizado(p_segredo text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.segredos where nome = 'arremate' and valor = p_segredo);
$$;

-- Situação da cota de quem pede (por IP OU por navegador: trocar só um não zera).
create or replace function arremate.situacao(p_ip text, p_disp text, p_janela interval)
returns table (usadas int, mais_antigo timestamptz) language sql stable security definer set search_path = '' as $$
  select count(*)::int, min(criado_em)
  from arremate.usos
  where not estornado
    and criado_em > now() - p_janela
    and (ip_hash = p_ip or (p_disp is not null and dispositivo_hash = p_disp));
$$;

create or replace function public.arremate_cota(
  p_segredo text, p_ip text, p_disp text, p_limite int, p_janela_horas int
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s record; janela interval := make_interval(hours => p_janela_horas);
begin
  if not arremate.autorizado(p_segredo) then raise exception 'NAO_AUTORIZADO'; end if;
  select * into s from arremate.situacao(p_ip, p_disp, janela);
  return jsonb_build_object(
    'usadas', s.usadas,
    'restantes', greatest(p_limite - s.usadas, 0),
    'libera_em', case when s.usadas >= p_limite then s.mais_antigo + janela end
  );
end $$;

create or replace function public.arremate_consumir(
  p_segredo text, p_ip text, p_disp text, p_limite int, p_janela_horas int, p_limite_diario int
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; janela interval := make_interval(hours => p_janela_horas); hoje int; novo bigint;
begin
  if not arremate.autorizado(p_segredo) then raise exception 'NAO_AUTORIZADO'; end if;
  -- Serializa pedidos simultâneos do mesmo IP (evita estourar a cota com cliques paralelos).
  perform pg_advisory_xact_lock(hashtext('arremate:' || p_ip));

  select * into s from arremate.situacao(p_ip, p_disp, janela);
  if s.usadas >= p_limite then
    return jsonb_build_object('ok', false, 'motivo', 'usuario', 'libera_em', s.mais_antigo + janela);
  end if;

  select count(*) into hoje from arremate.usos where not estornado and criado_em > now() - interval '24 hours';
  if hoje >= p_limite_diario then
    return jsonb_build_object('ok', false, 'motivo', 'global');
  end if;

  insert into arremate.usos (ip_hash, dispositivo_hash) values (p_ip, p_disp) returning id into novo;
  delete from arremate.usos where criado_em < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'id', novo, 'restantes', p_limite - s.usadas - 1);
end $$;

-- Devolve a cota quando a análise com IA não aconteceu (PDF inválido, IA fora do ar).
create or replace function public.arremate_estornar(p_segredo text, p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not arremate.autorizado(p_segredo) then raise exception 'NAO_AUTORIZADO'; end if;
  update arremate.usos set estornado = true where id = p_id;
end $$;

revoke all on function public.arremate_cota(text, text, text, int, int) from public;
revoke all on function public.arremate_consumir(text, text, text, int, int, int) from public;
revoke all on function public.arremate_estornar(text, bigint) from public;
grant execute on function public.arremate_cota(text, text, text, int, int) to anon;
grant execute on function public.arremate_consumir(text, text, text, int, int, int) to anon;
grant execute on function public.arremate_estornar(text, bigint) to anon;
revoke all on schema arremate from anon, authenticated;
