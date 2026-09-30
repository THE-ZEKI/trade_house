-- Jeu de donnees de demonstration pour la page Rapports en tant que trader.
-- Idempotent : ne cree rien si le trader a deja un rapport.
begin;

select set_config('app.user_id', u.id::text, true)
  from public.users u where u.email = 'trader1@trade-house.local';

insert into public.reports (trader_id, session_date, instrument, result_type, result_amount,
                             strategy, nb_trades, plan_respected, rr_planned, rr_realized,
                             emotions, highlights, mistakes, notes)
select u.id, current_date - 1, 'EURUSD', 'gain', 250, 'Breakout range', 3, true, 2.5, 3.1,
       ARRAY['calm']::emotion_code[], 'Plan respecte sur les trois entrees', 'Sortie anticipee sur le dernier',
       'Donnee de demonstration creee pour la verification des ecrans.'
  from public.users u
 where u.email = 'trader1@trade-house.local'
   and not exists (select 1 from public.reports r where r.trader_id = u.id);

commit;
