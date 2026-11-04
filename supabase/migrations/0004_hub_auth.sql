-- 0004: dashboard login (hub) — users, passkeys, TOTP, backup codes, sessions, rate limits.
-- The hub does all crypto (scrypt, TOTP, WebAuthn) server-side and stores only hashes and
-- encrypted secrets here. Access is one service-role-only RPC, public.sm_auth(op, args).
-- Additive only. Safe to run twice.
-- Rollback: drop function public.sm_auth(text, jsonb);
--           drop table server_manager.hub_sessions, server_manager.hub_backup_codes,
--                      server_manager.hub_passkeys, server_manager.hub_rate, server_manager.hub_users;

begin;

create table if not exists server_manager.hub_users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique check (email = lower(email)),
  password_hash    text,                       -- scrypt$N$r$p$salt$hash
  totp_secret_enc  text,                       -- AES-256-GCM, key only in the hub env
  totp_enabled     boolean not null default false,
  disabled         boolean not null default false,
  created_at       timestamptz not null default now(),
  last_login_at    timestamptz
);

create table if not exists server_manager.hub_passkeys (
  id            text primary key,              -- credential id, base64url
  user_id       uuid not null references server_manager.hub_users (id) on delete cascade,
  public_key    text not null,                 -- base64url COSE key
  counter       bigint not null default 0,
  transports    text[] not null default '{}',
  name          text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create table if not exists server_manager.hub_backup_codes (
  user_id    uuid not null references server_manager.hub_users (id) on delete cascade,
  code_hash  text not null,                    -- sha256 of the normalized code
  used_at    timestamptz,
  primary key (user_id, code_hash)
);

create table if not exists server_manager.hub_sessions (
  token_hash    text primary key,              -- sha256 of the cookie token
  user_id       uuid not null references server_manager.hub_users (id) on delete cascade,
  mfa_done      boolean not null default false,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now(),
  ip            text,
  user_agent    text
);
create index if not exists hub_sessions_user_idx on server_manager.hub_sessions (user_id);

create table if not exists server_manager.hub_rate (
  key       text not null,                     -- e.g. 'login:ip:1.2.3.4', 'totp:user:<uuid>'
  at        timestamptz not null default now()
);
create index if not exists hub_rate_key_at_idx on server_manager.hub_rate (key, at);

alter table server_manager.hub_users        enable row level security;
alter table server_manager.hub_passkeys     enable row level security;
alter table server_manager.hub_backup_codes enable row level security;
alter table server_manager.hub_sessions     enable row level security;
alter table server_manager.hub_rate         enable row level security;
revoke all on all tables in schema server_manager from public, anon, authenticated;

create or replace function public.sm_auth(op text, args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = server_manager, pg_temp
as $$
declare
  v_user  hub_users;
  v_n     int;
  v_res   jsonb;
begin
  case op

  when 'user_by_email' then
    select * into v_user from hub_users where email = lower(args ->> 'email');
    return case when v_user.id is null then null else to_jsonb(v_user) ||
      jsonb_build_object('passkeys', (select count(*) from hub_passkeys where user_id = v_user.id)) end;

  when 'user_by_id' then
    select * into v_user from hub_users where id = (args ->> 'id')::uuid;
    return case when v_user.id is null then null else to_jsonb(v_user) ||
      jsonb_build_object('passkeys', (select count(*) from hub_passkeys where user_id = v_user.id)) end;

  when 'user_count' then
    return to_jsonb((select count(*) from hub_users));

  when 'user_create' then
    insert into hub_users (email, password_hash) values (lower(args ->> 'email'), args ->> 'password_hash')
    on conflict (email) do nothing returning * into v_user;
    return to_jsonb(v_user);

  when 'user_touch_login' then
    update hub_users set last_login_at = now() where id = (args ->> 'id')::uuid;
    return 'true'::jsonb;

  when 'totp_set' then
    update hub_users set totp_secret_enc = args ->> 'secret_enc', totp_enabled = coalesce((args ->> 'enabled')::boolean, false)
    where id = (args ->> 'id')::uuid;
    return 'true'::jsonb;

  when 'backup_codes_replace' then
    delete from hub_backup_codes where user_id = (args ->> 'id')::uuid;
    insert into hub_backup_codes (user_id, code_hash)
    select (args ->> 'id')::uuid, h from jsonb_array_elements_text(args -> 'hashes') h;
    return 'true'::jsonb;

  when 'backup_code_use' then
    update hub_backup_codes set used_at = now()
    where user_id = (args ->> 'id')::uuid and code_hash = args ->> 'hash' and used_at is null;
    get diagnostics v_n = row_count;
    return to_jsonb(v_n = 1);

  when 'passkey_add' then
    insert into hub_passkeys (id, user_id, public_key, counter, transports, name)
    values (args ->> 'cred_id', (args ->> 'user_id')::uuid, args ->> 'public_key', coalesce((args ->> 'counter')::bigint, 0),
            coalesce(array(select jsonb_array_elements_text(args -> 'transports')), '{}'), args ->> 'name')
    on conflict (id) do nothing;
    return 'true'::jsonb;

  when 'passkeys_for_user' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'transports', transports))
                     from hub_passkeys where user_id = (args ->> 'user_id')::uuid), '[]'::jsonb);

  when 'passkey_get' then
    return (select to_jsonb(k) from hub_passkeys k where id = args ->> 'cred_id');

  when 'passkey_touch' then
    update hub_passkeys set counter = (args ->> 'counter')::bigint, last_used_at = now() where id = args ->> 'cred_id';
    return 'true'::jsonb;

  when 'session_create' then
    insert into hub_sessions (token_hash, user_id, mfa_done, expires_at, ip, user_agent)
    values (args ->> 'token_hash', (args ->> 'user_id')::uuid, coalesce((args ->> 'mfa_done')::boolean, false),
            (args ->> 'expires_at')::timestamptz, args ->> 'ip', left(args ->> 'user_agent', 300));
    delete from hub_sessions where expires_at < now();
    return 'true'::jsonb;

  when 'session_get' then
    update hub_sessions s set last_seen_at = now()
    where s.token_hash = args ->> 'token_hash' and s.expires_at > now();
    select jsonb_build_object('user_id', s.user_id, 'mfa_done', s.mfa_done, 'expires_at', s.expires_at,
                              'email', u.email, 'disabled', u.disabled, 'totp_enabled', u.totp_enabled,
                              'passkeys', (select count(*) from hub_passkeys where user_id = u.id))
      into v_res
    from hub_sessions s join hub_users u on u.id = s.user_id
    where s.token_hash = args ->> 'token_hash' and s.expires_at > now();
    return v_res;

  when 'session_upgrade' then
    update hub_sessions set mfa_done = true, expires_at = (args ->> 'expires_at')::timestamptz
    where token_hash = args ->> 'token_hash';
    return 'true'::jsonb;

  when 'session_delete' then
    delete from hub_sessions where token_hash = args ->> 'token_hash';
    return 'true'::jsonb;

  -- sliding-window rate limit: records a hit and reports whether the key is over the limit
  when 'rate_hit' then
    delete from hub_rate where at < now() - interval '1 day';
    insert into hub_rate (key) values (args ->> 'key');
    select count(*) into v_n from hub_rate
    where key = args ->> 'key' and at > now() - make_interval(secs => (args ->> 'window_s')::int);
    return jsonb_build_object('count', v_n, 'limited', v_n > (args ->> 'max')::int,
      'retry_at', (select min(at) from hub_rate where key = args ->> 'key'
                   and at > now() - make_interval(secs => (args ->> 'window_s')::int)) + make_interval(secs => (args ->> 'window_s')::int));

  when 'rate_check' then
    select count(*) into v_n from hub_rate
    where key = args ->> 'key' and at > now() - make_interval(secs => (args ->> 'window_s')::int);
    return jsonb_build_object('count', v_n, 'limited', v_n >= (args ->> 'max')::int,
      'retry_at', (select min(at) from hub_rate where key = args ->> 'key'
                   and at > now() - make_interval(secs => (args ->> 'window_s')::int)) + make_interval(secs => (args ->> 'window_s')::int));

  when 'rate_clear' then
    delete from hub_rate where key = args ->> 'key';
    return 'true'::jsonb;

  else
    raise exception 'unknown op %', op;
  end case;
end;
$$;

revoke all on function public.sm_auth(text, jsonb) from public, anon, authenticated;
grant execute on function public.sm_auth(text, jsonb) to service_role;

commit;
