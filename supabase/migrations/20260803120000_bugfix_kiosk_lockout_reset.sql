-- Bugfix: kiosk_verify_pin never reset consecutive_failures after a
-- lockout naturally expired, so the next attempt (even a wrong one) reused
-- the stale failure count, immediately hit >= 5 again, and re-locked with
-- zero fresh attempts given. Found during a full-project bug sweep.

create or replace function public.kiosk_verify_pin(p_store_id uuid, p_pin text)
returns table (ok boolean, locked_until timestamptz, attempts_remaining int)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pin_hash text;
  v_failures int;
  v_locked_until timestamptz;
begin
  insert into public.kiosk_pin_attempts (store_id)
  values (p_store_id)
  on conflict (store_id) do nothing;

  select consecutive_failures, kiosk_pin_attempts.locked_until
    into v_failures, v_locked_until
    from public.kiosk_pin_attempts
    where store_id = p_store_id
    for update;

  if v_locked_until is not null and v_locked_until > now() then
    return query select false, v_locked_until, 0;
    return;
  end if;

  -- Lockout has expired (or never existed) -- give a fresh count rather
  -- than carrying over the stale failure tally that triggered it.
  if v_locked_until is not null and v_locked_until <= now() then
    v_failures := 0;
  end if;

  select kiosk_settings.pin_hash into v_pin_hash
    from public.kiosk_settings
    where kiosk_settings.store_id = p_store_id;

  if v_pin_hash is not null and crypt(p_pin, v_pin_hash) = v_pin_hash then
    update public.kiosk_pin_attempts
      set consecutive_failures = 0, locked_until = null, last_attempt_at = now()
      where store_id = p_store_id;
    return query select true, null::timestamptz, 5;
    return;
  end if;

  v_failures := coalesce(v_failures, 0) + 1;

  if v_failures >= 5 then
    update public.kiosk_pin_attempts
      set consecutive_failures = v_failures, locked_until = now() + interval '15 minutes', last_attempt_at = now()
      where store_id = p_store_id;
    return query select false, (now() + interval '15 minutes'), 0;
    return;
  end if;

  update public.kiosk_pin_attempts
    set consecutive_failures = v_failures, last_attempt_at = now()
    where store_id = p_store_id;
  return query select false, null::timestamptz, (5 - v_failures);
end;
$$;
