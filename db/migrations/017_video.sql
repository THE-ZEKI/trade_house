-- ============================================================================
-- trade_house - 017_video.sql
-- Module C : acces a la salle et presence automatique (C4, C6, C8, RG-25).
--
-- Le fournisseur (Daily, LiveKit, Jitsi...) n'est PAS fige ici. Ce que la base
-- garantit, c'est l'autorisation d'entrer dans une salle et le role detenU
-- dans la salle. Le jeton est donc emis par l'application, signe avec la meme
-- cle que les autres jetons, et le fournisseur n'en recoit qu'une projection
-- au moment d'entrer.
--
-- Pourquoi ne pas deleguer a 100 % au fournisseur : le jeton fournisseur
-- serait alors la seule source de verite, et il faudrait le stocker pour
-- reemettre une entree. En gardant le jeton maison, on peut le revoquer, et
-- le fournisseur devient un detail d'infrastructure.
-- ============================================================================
\set ON_ERROR_STOP on

-- Fournisseur de salle : daily | livekit | jitsi | external
alter table public.app_settings
  add column if not exists video_provider varchar not null default 'external',
  add column if not exists video_room_minutes int not null default 60,
  add column if not exists video_token_ttl_minutes int not null default 30;

comment on column public.app_settings.video_provider is
  'daily | livekit | jitsi | external (reunion B2 externe : simple lien)';

-- ---------------------------------------------------------------------------
-- Droits d'acces a la salle (C4, C6, RG-25).
--
-- La base ne signe pas : elle DECIDE. Elle verifie que l'appelant a le droit
-- d'entrer et lui renvoie ce qu'il a le droit de faire. La signature du jeton
-- est faite par l'application, avec node:crypto, comme les autres jetons.
--
-- Pourquoi ne pas laisser le fournisseur de visio gerer seul : son jeton
-- deviendrait l'unique source de verite, impossible a revoquer chez nous. En
-- gardant la decision ici, le fournisseur reste un detail d'infrastructure.
-- ---------------------------------------------------------------------------
create or replace function app.room_claims(
  p_meeting_id  uuid,
  p_ttl_minutes integer default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user     uuid := app.current_user_id();
  v_ttl      integer;
  v_role     text;
  v_is_admin boolean;
begin
  if v_user is null then
    raise exception 'C4 : authentification requise';
  end if;

  -- C4 : entrent les invites et l'organisateur. L'admin dispose en plus d'un
  -- canal de secours, pour qu'une reunion ne reste pas inaccessible apres une
  -- erreur d'ajout de participant.
  --
  -- L'organisateur est explicitement inclus : create_meeting ne l'ajoute pas
  -- forcement a la liste des invites, et il doit pouvoir ouvrir sa salle.
  v_is_admin := app.is_admin();
  if not v_is_admin and not exists (
    select 1 from public.meeting_participants mp
     where mp.meeting_id = p_meeting_id and mp.user_id = v_user
  ) and not exists (
    select 1 from public.meetings m
     where m.id = p_meeting_id and m.created_by = v_user
  ) then
    raise exception 'C4 : vous n''etes pas invite a cette reunion';
  end if;

  select coalesce(nullif(p_ttl_minutes, 0), video_token_ttl_minutes)
    into v_ttl from public.app_settings where id = 1;

  -- RG-25 : la hierarchie des droits est decidee en base, pas par l'interface.
  -- L'organisateur de la reunion est moderateur au meme titre que l'admin.
  if v_is_admin or app.is_manager() or exists (
       select 1 from public.meetings m
        where m.id = p_meeting_id and m.created_by = v_user)
  then
    v_role := 'moderator';
  else
    v_role := 'participant';
  end if;

  return jsonb_build_object(
    'v', 1,
    'm', p_meeting_id,
    'u', v_user,
    'r', v_role,
    'e', extract(epoch from now() + make_interval(mins => v_ttl))::bigint
  );
end;
$$;

comment on function app.room_claims(uuid, integer) is
  'Verifie le droit d''entrer en salle (C4) et renvoie les revendications a signer (RG-25).';
