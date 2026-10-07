create table if not exists public.ai_credit_accounts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  monthly_limit bigint,
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  units bigint not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function public.consume_ai_credits(p_organization_id uuid,p_units bigint default 1)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_balance bigint;
begin
  select balance into v_balance from public.ai_credit_accounts where organization_id=p_organization_id for update;
  if v_balance is null then return jsonb_build_object('allowed',false,'remaining',0,'reason','NO_CREDIT_ACCOUNT'); end if;
  if v_balance < p_units then return jsonb_build_object('allowed',false,'remaining',v_balance,'reason','INSUFFICIENT_CREDITS'); end if;
  update public.ai_credit_accounts set balance=balance-p_units,updated_at=now() where organization_id=p_organization_id;
  insert into public.ai_credit_ledger(organization_id,units,reason) values(p_organization_id,-p_units,'ai_generation');
  return jsonb_build_object('allowed',true,'remaining',v_balance-p_units);
end $$;
create table if not exists public.ai_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid,
  message_id uuid,
  agent_id uuid,
  score numeric(5,3),
  flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_credit_ledger_org_created on public.ai_credit_ledger(organization_id,created_at desc);
create index if not exists idx_ai_evaluations_org_created on public.ai_evaluations(organization_id,created_at desc);
