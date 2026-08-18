begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000001', 'capital-a@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'capital-b@example.com');

select has_table('public', 'virtual_cash_accounts', 'shared virtual cash table exists');
select has_column('public', 'virtual_transactions', 'gross_amount', 'transactions store gross amount');
select has_column('public', 'virtual_transactions', 'fee_amount', 'transactions store fees');
select has_column('public', 'virtual_transactions', 'cash_balance_after', 'transactions store post-trade cash');
select has_column('public', 'virtual_transactions', 'fee_profile_snapshot', 'transactions store fee profile');

select lives_ok(
  $$ select public.commit_signal_transition(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000001',
    'code', '000001', 'name', 'A', 'action', 'buy', 'intent', 'open',
    'price', 1500, 'suggested_shares', 100,
    'position_shares_at_signal', 0, 'available_shares_at_signal', 0,
    'signal_at', '2026-08-18T01:00:00Z',
    'message_kind', 'virtual_execution', 'virtual_tracking_status', 'pending',
    'strategy_id', 'realtime-technical', 'strategy_version', '1',
    'cycle_id', 'capital-buy-a', 'buy_direction', 'buy', 'sell_direction', 'hold',
    'virtual_execution_requested', true,
    'fee_profile', jsonb_build_object(
      'commissionRate', 0.0003, 'minimumCommission', 5,
      'sellStampDutyRate', 0.0005, 'transferFeeRate', 0.00001,
      'slippageMode', 'fixed', 'fixedSlippageRate', 0
    ),
    'average_daily_amount', 100000000
  )) $$,
  'first stock uses the shared cash account'
);

select is(
  (select cash_balance from public.virtual_cash_accounts
   where user_id = '00000000-0000-0000-0000-000000000001'),
  49953.50::numeric,
  'buy deducts gross amount plus validated fees'
);

select lives_ok(
  $$ insert into public.t_trade_cycles (id, user_id, position_scope, virtual_position_id, code, name, cycle_type, status, pre_cycle_average_cost, pre_cycle_total_shares, sold_shares, remaining_buyback_shares, fee_profile_snapshot, signal_basis_snapshot, strategy_id, strategy_version, trading_date, expires_at) values ('81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'virtual', (select id from public.virtual_positions where user_id = '00000000-0000-0000-0000-000000000001' and code = '000001'), '000001', 'A', 'profit_t', 'buyback_monitoring', 1500, 100, 100, 100, '{}'::jsonb, '{}'::jsonb, 'virtual-t', '1', '2026-08-18', '2026-08-18T07:00:00Z') $$,
  'virtual position can own a T cycle'
);

select throws_ok(
  $$ insert into public.t_trade_cycles (user_id, position_scope, position_id, virtual_position_id, code, name, cycle_type, status, pre_cycle_average_cost, pre_cycle_total_shares, sold_shares, remaining_buyback_shares, strategy_id, strategy_version, trading_date, expires_at) values ('00000000-0000-0000-0000-000000000001', 'virtual', '81000000-0000-0000-0000-000000000099', (select id from public.virtual_positions where user_id = '00000000-0000-0000-0000-000000000001' and code = '000001'), '000001', 'A', 'profit_t', 'buyback_monitoring', 1500, 100, 100, 100, 'virtual-t', '1', '2026-08-18', '2026-08-18T07:00:00Z') $$,
  '23514', null,
  'a T cycle cannot bind actual and virtual positions together'
);

select throws_ok(
  $$ insert into public.t_trade_cycles (user_id, position_scope, code, name, cycle_type, status, pre_cycle_average_cost, pre_cycle_total_shares, sold_shares, remaining_buyback_shares, strategy_id, strategy_version, trading_date, expires_at) values ('00000000-0000-0000-0000-000000000001', 'virtual', '000001', 'A', 'profit_t', 'buyback_monitoring', 1500, 100, 100, 100, 'virtual-t', '1', '2026-08-18', '2026-08-18T07:00:00Z') $$,
  '23514', null,
  'a T cycle must bind exactly one scoped position'
);

select lives_ok(
  $$ select public.commit_t_trade_signal(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000001', 'position_scope', 'virtual', 'virtual_position_id', (select id::text from public.virtual_positions where user_id = '00000000-0000-0000-0000-000000000001' and code = '000001'), 'code', '000001', 'name', 'A', 'price', 1505, 'signal_kind', 'virtual_t_expiry_risk', 'suggested_shares', 100, 'strategy_id', 'virtual-t', 'strategy_version', '1', 'trading_date', '2026-08-18', 'signal_at', '2026-08-18T02:00:00Z', 't_trade_cycle_id', '81000000-0000-0000-0000-000000000001')) $$,
  'service path accepts a virtual T signal'
);

select lives_ok(
  $$ select public.commit_signal_transition(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000001',
    'code', '000002', 'name', 'B', 'action', 'buy', 'intent', 'open',
    'price', 501, 'suggested_shares', 100,
    'position_shares_at_signal', 0, 'available_shares_at_signal', 0,
    'signal_at', '2026-08-18T01:01:00Z',
    'message_kind', 'virtual_execution', 'virtual_tracking_status', 'pending',
    'strategy_id', 'realtime-technical', 'strategy_version', '1',
    'cycle_id', 'capital-buy-b', 'buy_direction', 'buy', 'sell_direction', 'hold',
    'virtual_execution_requested', true,
    'fee_profile', jsonb_build_object(
      'commissionRate', 0.0003, 'minimumCommission', 5,
      'sellStampDutyRate', 0.0005, 'transferFeeRate', 0.00001,
      'slippageMode', 'fixed', 'fixedSlippageRate', 0
    ),
    'average_daily_amount', 100000000
  )) $$,
  'unaffordable buy becomes a blocked alert without rolling back the message'
);

select is(
  (select virtual_tracking_status from public.signal_alerts where cycle_id = 'capital-buy-b'),
  'blocked_cash',
  'unaffordable buy is visible as blocked cash'
);

select is(
  (select count(*)::integer from public.virtual_transactions
   where user_id = '00000000-0000-0000-0000-000000000001'),
  1,
  'blocked buy creates no virtual transaction'
);

select is(
  (select cash_balance from public.virtual_cash_accounts
   where user_id = '00000000-0000-0000-0000-000000000001'),
  49953.50::numeric,
  'blocked buy leaves shared cash unchanged'
);

select lives_ok(
  $$ select public.commit_signal_transition(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000001',
    'code', '000001', 'name', 'A', 'action', 'sell', 'intent', 'exit',
    'price', 1600, 'suggested_shares', 100,
    'position_shares_at_signal', 100, 'available_shares_at_signal', 100,
    'signal_at', '2026-08-19T01:00:00Z',
    'message_kind', 'virtual_execution', 'virtual_tracking_status', 'pending',
    'strategy_id', 'realtime-technical', 'strategy_version', '1',
    'cycle_id', 'capital-sell-a', 'buy_direction', 'hold', 'sell_direction', 'sell',
    'virtual_execution_requested', true,
    'fee_profile', jsonb_build_object(
      'commissionRate', 0.0003, 'minimumCommission', 5,
      'sellStampDutyRate', 0.0005, 'transferFeeRate', 0.00001,
      'slippageMode', 'fixed', 'fixedSlippageRate', 0
    ),
    'average_daily_amount', 100000000
  )) $$,
  'sell credits only net proceeds'
);

select is(
  (select cash_balance from public.virtual_cash_accounts
   where user_id = '00000000-0000-0000-0000-000000000001'),
  209823.90::numeric,
  'sell credits gross proceeds less commission stamp duty and transfer fee'
);

select is(
  (select fee_amount from public.virtual_transactions
   where user_id = '00000000-0000-0000-0000-000000000001'
     and transaction_type = 'sell'),
  129.60::numeric,
  'sell transaction stores its validated fee snapshot'
);

select is(
  (select count(*)::integer from public.virtual_cash_accounts
   where user_id = '00000000-0000-0000-0000-000000000002'),
  0,
  'another user does not receive or mutate this account cash'
);

select lives_ok(
  $$ select public.commit_signal_transition(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000002',
    'code', '600001', 'name', 'virtual-T', 'action', 'buy', 'intent', 'open',
    'price', 10, 'suggested_shares', 1000,
    'position_shares_at_signal', 0, 'available_shares_at_signal', 0,
    'signal_at', '2026-08-17T02:00:00Z',
    'message_kind', 'virtual_execution', 'virtual_tracking_status', 'pending',
    'strategy_id', 'realtime-technical', 'strategy_version', '1',
    'cycle_id', 'virtual-t-seed', 'buy_direction', 'buy', 'sell_direction', 'hold',
    'virtual_execution_requested', true,
    'fee_profile', jsonb_build_object(
      'commissionRate', 0.0003, 'minimumCommission', 5,
      'sellStampDutyRate', 0.0005, 'transferFeeRate', 0.00001,
      'slippageMode', 'fixed', 'fixedSlippageRate', 0
    ),
    'average_daily_amount', 100000000
  )) $$,
  'virtual T fixture starts with a matured virtual position'
);

select lives_ok(
  $$ select public.commit_virtual_t_trade(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000002',
    'position_scope', 'virtual',
    'virtual_position_id', (select id::text from public.virtual_positions where user_id = '00000000-0000-0000-0000-000000000002' and code = '600001'),
    'code', '600001', 'name', 'virtual-T', 'price', 12,
    'signal_kind', 'virtual_t_sell', 'suggested_shares', 100,
    'position_shares', 1000, 'available_shares', 1000,
    'strategy_id', 'virtual-t', 'strategy_version', '1',
    'trading_date', '2026-08-18', 'signal_at', '2026-08-18T02:00:00Z',
    'fee_profile', jsonb_build_object(
      'commissionRate', 0.0003, 'minimumCommission', 5,
      'sellStampDutyRate', 0.0005, 'transferFeeRate', 0.00001,
      'slippageMode', 'fixed', 'fixedSlippageRate', 0
    ),
    'average_daily_amount', 100000000,
    'signal_metadata', jsonb_build_object(
      'cycle_type', 'profit_t', 'sell_low', 11.9, 'sell_high', 12.1,
      'buyback_low', 11, 'buyback_high', 11.3, 'expected_net_profit', 80
    )
  )) $$,
  'virtual T sell executes atomically'
);

select is(
  (select shares from public.virtual_positions where user_id = '00000000-0000-0000-0000-000000000002' and code = '600001'),
  900,
  'virtual T sell reduces the virtual position'
);

select is(
  (select count(*)::integer from public.t_trade_cycles where user_id = '00000000-0000-0000-0000-000000000002' and position_scope = 'virtual' and status = 'buyback_monitoring'),
  1,
  'virtual T sell opens one scoped buyback cycle'
);

select is(
  (select cash_balance from public.virtual_cash_accounts where user_id = '00000000-0000-0000-0000-000000000002'),
  191189.29::numeric,
  'virtual T sell credits net proceeds to shared cash'
);

update public.virtual_cash_accounts set cash_balance = 100
where user_id = '00000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.commit_virtual_t_trade(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000002',
    'position_scope', 'virtual',
    'virtual_position_id', (select id::text from public.virtual_positions where user_id = '00000000-0000-0000-0000-000000000002' and code = '600001'),
    'code', '600001', 'name', 'virtual-T', 'price', 11,
    'signal_kind', 'virtual_t_buyback', 'suggested_shares', 100,
    'position_shares', 900, 'available_shares', 900,
    'strategy_id', 'virtual-t', 'strategy_version', '1',
    'trading_date', '2026-08-18', 'signal_at', '2026-08-18T03:00:00Z',
    't_trade_cycle_id', (select id::text from public.t_trade_cycles where user_id = '00000000-0000-0000-0000-000000000002' and position_scope = 'virtual'),
    'edge_id', 'blocked',
    'fee_profile', jsonb_build_object(
      'commissionRate', 0.0003, 'minimumCommission', 5,
      'sellStampDutyRate', 0.0005, 'transferFeeRate', 0.00001,
      'slippageMode', 'fixed', 'fixedSlippageRate', 0
    ),
    'average_daily_amount', 100000000
  )) $$,
  'unaffordable virtual T buyback becomes a blocked alert'
);

select is(
  (select count(*)::integer from public.virtual_transactions where user_id = '00000000-0000-0000-0000-000000000002'),
  2,
  'blocked virtual T buyback creates no transaction'
);

select is(
  (select remaining_buyback_shares from public.t_trade_cycles where user_id = '00000000-0000-0000-0000-000000000002' and position_scope = 'virtual'),
  100,
  'blocked virtual T buyback leaves the cycle open'
);

update public.virtual_cash_accounts set cash_balance = 5000
where user_id = '00000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.commit_virtual_t_trade(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000002',
    'position_scope', 'virtual',
    'virtual_position_id', (select id::text from public.virtual_positions where user_id = '00000000-0000-0000-0000-000000000002' and code = '600001'),
    'code', '600001', 'name', 'virtual-T', 'price', 11,
    'signal_kind', 'virtual_t_buyback', 'suggested_shares', 100,
    'position_shares', 900, 'available_shares', 900,
    'strategy_id', 'virtual-t', 'strategy_version', '1',
    'trading_date', '2026-08-18', 'signal_at', '2026-08-18T03:01:00Z',
    't_trade_cycle_id', (select id::text from public.t_trade_cycles where user_id = '00000000-0000-0000-0000-000000000002' and position_scope = 'virtual'),
    'edge_id', 'success',
    'fee_profile', jsonb_build_object(
      'commissionRate', 0.0003, 'minimumCommission', 5,
      'sellStampDutyRate', 0.0005, 'transferFeeRate', 0.00001,
      'slippageMode', 'fixed', 'fixedSlippageRate', 0
    ),
    'average_daily_amount', 100000000
  )) $$,
  'affordable virtual T buyback executes atomically'
);

select is(
  (select shares from public.virtual_positions where user_id = '00000000-0000-0000-0000-000000000002' and code = '600001'),
  1000,
  'virtual T buyback restores position shares'
);

select is(
  (select status from public.t_trade_cycles where user_id = '00000000-0000-0000-0000-000000000002' and position_scope = 'virtual'),
  'completed',
  'full virtual T buyback completes the cycle'
);

select is(
  (select cash_balance from public.virtual_cash_accounts where user_id = '00000000-0000-0000-0000-000000000002'),
  3894.99::numeric,
  'virtual T buyback deducts gross amount and validated fees'
);
select * from finish();

rollback;
