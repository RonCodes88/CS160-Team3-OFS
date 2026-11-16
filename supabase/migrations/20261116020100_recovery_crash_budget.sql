-- Expired worker leases consume the same bounded failure budget as explicit
-- provider failures. Otherwise a crashing worker could retry forever.
create or replace function public.checkout_claim_recovery(p_limit integer default 20)
returns setof public.payment_attempts language sql set search_path='' as $$
  with exhausted as (
    update public.payment_attempts set recovery_manual=true,
      recovery_error_code=coalesce(recovery_error_code,'RECOVERY_LEASE_EXHAUSTED')
    where finalize_step<>'DONE' and not recovery_manual and recovery_attempts>=8
      and (recovery_until is null or recovery_until<now()) returning id
  ), picked as (
    select id from public.payment_attempts
    where finalize_step<>'DONE' and not recovery_manual and recovery_attempts<8 and recovery_next_at<=now()
      and created_at<now()-interval '2 minutes'
      and (recovery_until is null or recovery_until<now())
      and (processing_until is null or processing_until<now())
    order by recovery_next_at,id limit least(greatest(p_limit,0),100) for update skip locked
  )
  update public.payment_attempts p set recovery_token=gen_random_uuid(),
    recovery_until=now()+interval '5 minutes',recovery_attempts=recovery_attempts+1
  from picked where p.id=picked.id returning p.*;
$$;
