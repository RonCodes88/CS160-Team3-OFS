create table public.auth_rate_limits (
  scope text not null check (scope in ('register-ip','login-ip','login-pair','login-account')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  primary key (scope,key_hash)
);
alter table public.auth_rate_limits enable row level security;
create index auth_rate_limits_expiry on public.auth_rate_limits(expires_at);

create function public.auth_consume_rate_limit(p_scope text,p_key_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_limit integer; v public.auth_rate_limits%rowtype; v_now timestamptz := clock_timestamp();
begin
  v_limit := case p_scope when 'register-ip' then 30 when 'login-ip' then 30
    when 'login-pair' then 10 when 'login-account' then 100 end;
  if v_limit is null or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid auth limit' using errcode='22023';
  end if;
  -- Bounded housekeeping avoids indefinitely retaining expired identity hashes.
  delete from public.auth_rate_limits where (scope,key_hash) in (
    select scope,key_hash from public.auth_rate_limits where expires_at<=v_now
    order by expires_at limit 100 for update skip locked
  );
  insert into public.auth_rate_limits(scope,key_hash,expires_at)
    values(p_scope,p_key_hash,v_now+interval '15 minutes') on conflict do nothing;
  select * into v from public.auth_rate_limits where scope=p_scope and key_hash=p_key_hash for update;
  if v.expires_at<=v_now then
    update public.auth_rate_limits set attempts=0,expires_at=v_now+interval '15 minutes'
      where scope=p_scope and key_hash=p_key_hash returning * into v;
  end if;
  if v.attempts>=v_limit then
    return jsonb_build_object('ok',false,'retryAfterSeconds',greatest(1,ceil(extract(epoch from v.expires_at-v_now))::integer));
  end if;
  update public.auth_rate_limits set attempts=attempts+1 where scope=p_scope and key_hash=p_key_hash;
  return jsonb_build_object('ok',true);
end;
$$;
create function public.auth_refund_rate_limit(p_scope text,p_key_hash text)
returns void language sql security definer set search_path='' as $$
  update public.auth_rate_limits set attempts=greatest(0,attempts-1)
    where scope=p_scope and key_hash=p_key_hash and expires_at>clock_timestamp();
$$;
revoke all on public.auth_rate_limits from anon,authenticated;
revoke execute on function public.auth_consume_rate_limit(text,text),public.auth_refund_rate_limit(text,text) from public,anon,authenticated;
grant execute on function public.auth_consume_rate_limit(text,text),public.auth_refund_rate_limit(text,text) to service_role;
