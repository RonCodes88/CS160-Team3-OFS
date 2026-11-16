-- Payment recovery is a separate lease from the finalizer. Browser/webhook
-- confirmations still use the finalizer's own claim and provider idempotency keys.
alter table public.payment_attempts
  add column recovery_attempts integer not null default 0 check(recovery_attempts>=0),
  add column recovery_next_at timestamptz not null default now(),
  add column recovery_error_code text,
  add column recovery_manual boolean not null default false,
  add column recovery_token uuid,
  add column recovery_until timestamptz;
create index payment_recovery_due on public.payment_attempts(recovery_next_at)
  where finalize_step<>'DONE' and not recovery_manual;

create function public.checkout_claim_recovery(p_limit integer default 20)
returns setof public.payment_attempts language sql set search_path='' as $$
  with picked as (
    select id from public.payment_attempts
    where finalize_step<>'DONE' and not recovery_manual and recovery_next_at<=now()
      and created_at<now()-interval '2 minutes'
      and (recovery_until is null or recovery_until<now())
      and (processing_until is null or processing_until<now())
    order by recovery_next_at,id limit least(greatest(p_limit,0),100) for update skip locked
  )
  update public.payment_attempts p set recovery_token=gen_random_uuid(),
    recovery_until=now()+interval '5 minutes',recovery_attempts=recovery_attempts+1
  from picked where p.id=picked.id returning p.*;
$$;

create function public.checkout_finish_recovery(p_id uuid,p_token uuid,p_result text,p_error text default null)
returns void language plpgsql set search_path='' as $$
begin
  if p_result not in ('COMPLETED','WAITING','FAILED') then raise exception 'Invalid recovery outcome'; end if;
  update public.payment_attempts set recovery_token=null,recovery_until=null,
    recovery_attempts=case when p_result in ('COMPLETED','WAITING') then 0 else recovery_attempts end,
    recovery_error_code=case when p_result='FAILED' then left(p_error,100) else null end,
    recovery_manual=p_result='FAILED' and recovery_attempts>=8,
    recovery_next_at=now()+case when p_result='WAITING' then interval '5 minutes'
      else interval '1 minute'*least(60,power(2,least(recovery_attempts,6))::integer) end
  where id=p_id and recovery_token=p_token;
  if not found then raise exception using errcode='P0020',message='Recovery claim lost'; end if;
end;
$$;

-- Notification leases must identify their owner; an expired worker cannot
-- acknowledge a row reclaimed by another worker.
alter table public.notifications add column claim_token uuid;
create or replace function public.claim_notifications(p_limit integer,p_max_attempts integer default 3)
returns setof public.notifications language sql set search_path='' as $$
  with picked as (
    select n.id from public.notifications n
    where n.status in ('PENDING','FAILED') and n.attempts<p_max_attempts
      and (n.locked_until is null or n.locked_until<now())
    order by n.created_at,n.id limit least(greatest(p_limit,0),100) for update skip locked
  )
  update public.notifications n set attempts=n.attempts+1,
    locked_until=now()+interval '5 minutes',claim_token=gen_random_uuid()
  from picked where n.id=picked.id returning n.*;
$$;
create function public.finish_notification(p_id uuid,p_token uuid,p_error text default null)
returns void language plpgsql set search_path='' as $$
begin
  update public.notifications set status=case when p_error is null then 'SENT' else 'FAILED' end,
    sent_at=case when p_error is null then now() else null end,error_message=left(p_error,500),
    locked_until=null,claim_token=null
  where id=p_id and claim_token=p_token;
  if not found then raise exception using errcode='P0020',message='Notification claim lost'; end if;
end;
$$;
revoke execute on function public.checkout_claim_recovery(integer) from public,anon,authenticated;
revoke execute on function public.checkout_finish_recovery(uuid,uuid,text,text) from public,anon,authenticated;
revoke execute on function public.finish_notification(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.checkout_claim_recovery(integer) to service_role;
grant execute on function public.checkout_finish_recovery(uuid,uuid,text,text) to service_role;
grant execute on function public.finish_notification(uuid,uuid,text) to service_role;
