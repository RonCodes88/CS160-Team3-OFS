-- Notification service (#35 order confirmation, #36 delivery notifications).
--
-- Notifications work as an outbox: triggers queue a PENDING row in the same
-- transaction as the status change, and a separate sender
-- (src/lib/notifications) delivers it later and marks it SENT or FAILED.
-- Queueing never fails the change that caused it, and sending happens outside
-- that transaction, so a send failure can't fail checkout or delivery.
--
-- Events:
--   order_status_history PAID             -> ORDER_CONFIRMED     (once per order)
--   order_status_history OUT_FOR_DELIVERY -> READY_FOR_DELIVERY  (once per order)
--   order_status_history DELIVERED        -> DELIVERED           (once per order)
--   delivery_stops DELAYED / ARRIVED / FAILED, or an ETA moving by
--   at least 5 minutes                    -> DELIVERY_UPDATE     (each time)

alter table public.notifications
  -- What happened, captured when the event fired (status, ETA, reason).
  add column payload      jsonb not null default '{}'::jsonb,
  -- Send attempts so far; FAILED rows are retried until this reaches 3.
  add column attempts     integer not null default 0 check (attempts >= 0),
  -- Set while a sender is working on the row so two senders can't both send it.
  add column locked_until timestamptz;

-- Notifications belong to their order, like order_items and order_status_history.
-- Orders are kept for history in practice; this lets test cleanup delete them.
alter table public.notifications
  drop constraint notifications_order_id_fkey,
  add constraint notifications_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete cascade;

-- At most one of each milestone message per order.
create unique index notifications_one_milestone_per_order
  on public.notifications (order_id, notification_type)
  where notification_type in ('ORDER_CONFIRMED', 'READY_FOR_DELIVERY', 'DELIVERED');

-- The sender reads the oldest unsent rows first.
create index notifications_unsent_idx
  on public.notifications (created_at)
  where status in ('PENDING', 'FAILED');

-- Queues one notification for an order. Never raises: a problem here is logged
-- as a warning and the caller's transaction carries on.
create function public.queue_order_notification(
  p_order_id uuid,
  p_type     text,
  p_payload  jsonb
) returns void
language plpgsql
set search_path = ''
as $$
begin
  begin
    insert into public.notifications (order_id, customer_id, notification_type, recipient_email, payload)
    select o.id, o.customer_id, p_type, u.email, coalesce(p_payload, '{}'::jsonb)
      from public.orders o
      join public.users u on u.id = o.customer_id
     where o.id = p_order_id
    on conflict (order_id, notification_type)
      where notification_type in ('ORDER_CONFIRMED', 'READY_FOR_DELIVERY', 'DELIVERED')
      do nothing;
  exception when others then
    raise warning 'could not queue % notification for order %: %', p_type, p_order_id, sqlerrm;
  end;
end;
$$;

create function public.notify_on_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text := case new.status
    when 'PAID' then 'ORDER_CONFIRMED'
    when 'OUT_FOR_DELIVERY' then 'READY_FOR_DELIVERY'
    when 'DELIVERED' then 'DELIVERED'
  end;
begin
  if v_type is not null then
    perform public.queue_order_notification(
      new.order_id,
      v_type,
      jsonb_build_object('status', new.status, 'changed_at', new.changed_at, 'notes', new.notes)
    );
  end if;
  return new;
end;
$$;

create trigger order_status_history_notify
  after insert on public.order_status_history
  for each row execute function public.notify_on_order_status();

-- Small ETA wobbles from the robot don't message the customer.
create function public.notify_on_delivery_stop()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reason text;
begin
  if new.status is distinct from old.status and new.status in ('DELAYED', 'ARRIVED', 'FAILED') then
    v_reason := new.status;
  elsif old.estimated_arrival is not null
    and new.estimated_arrival is not null
    and abs(extract(epoch from new.estimated_arrival - old.estimated_arrival)) >= 300 then
    v_reason := 'ETA_CHANGED';
  end if;

  if v_reason is not null then
    perform public.queue_order_notification(
      new.order_id,
      'DELIVERY_UPDATE',
      jsonb_build_object(
        'reason', v_reason,
        'stop_status', new.status,
        'estimated_arrival', new.estimated_arrival,
        'previous_estimated_arrival', old.estimated_arrival
      )
    );
  end if;
  return new;
end;
$$;

create trigger delivery_stops_notify
  after update of status, estimated_arrival on public.delivery_stops
  for each row execute function public.notify_on_delivery_stop();

-- Hands the sender up to p_limit unsent rows and leases them for 5 minutes.
-- SKIP LOCKED plus the lease means two senders never get the same row.
create function public.claim_notifications(p_limit integer, p_max_attempts integer default 3)
returns setof public.notifications
language sql
set search_path = ''
as $$
  with picked as (
    select n.id
      from public.notifications n
     where (n.status = 'PENDING' or (n.status = 'FAILED' and n.attempts < p_max_attempts))
       and (n.locked_until is null or n.locked_until < now())
     order by n.created_at
     limit greatest(p_limit, 0)
       for update skip locked
  )
  update public.notifications n
     set attempts = n.attempts + 1,
         locked_until = now() + interval '5 minutes'
    from picked
   where n.id = picked.id
  returning n.*;
$$;

revoke execute on function public.queue_order_notification(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_notifications(integer, integer) from public, anon, authenticated;
grant execute on function public.queue_order_notification(uuid, text, jsonb) to service_role;
grant execute on function public.claim_notifications(integer, integer) to service_role;
