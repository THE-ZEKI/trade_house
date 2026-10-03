-- ============================================================================
-- trade_house - 035_password_reset_anonyme.sql
--
-- LE « MOT DE PASSE OUBLIE » N'A JAMAIS FONCTIONNE.
--
-- /api/auth/password/forgot appelle app.issue_invitation(id, 'password_reset')
-- SANS session : personne n'est connecte au moment de la demande. Or 027 a
-- ecrit dans cette fonction :
--
--     elsif not app.is_admin() then
--       raise exception 'RG-02 : seul l''admin reinitialise un mot de passe';
--
-- app.is_admin() lit la session courante, donc vide -> la branche est prise
-- -> 409. La reponse prouve le defaut :
--
--     {"code":"CONFLICT","message":"RG-02 : seul l'admin reinitialise un mot de passe"}
--
-- Ce n'est pas une erreur de configuration : aucun administrateur ne peut
-- s'identifier avant d'avoir defini son mot de passe, et le bootstrap cree un
-- compte SANS mot de passe. La premiere connexion depend donc de ce chemin,
-- qui echoue toujours. Personne ne pouvait entrer, et l'echec etait silencieux
-- (la page affiche « si le compte existe, un email a ete envoye »).
--
-- ---------------------------------------------------------------------------
-- LE CHOIX : NE PAS ASSOUPLIR issue_invitation.
--
-- Ouvrir p_purpose = 'password_reset' dans issue_invitation aurait l'air plus
-- simple. Ce serait une faute : cette fonction sert aussi a l'ADMIN qui
-- reinitialise le mot de passe d'un tiers depuis l'interface. Distinguer les
-- deux cas par un parametre, c'est exposer un contournement de RG-02 a quiconque
-- trouve le nom du parametre. La regle « seul l'admin reinitialise le mot de
-- passe d'AUTRUI » doit rester entierement dans issue_invitation.
--
-- On cree donc une fonction DEDIEE au parcours autonome. Elle n'ouvre aucun
-- acces inter-comptes : elle n'agit que sur le compte dont l'adresse a ete
-- prouvee par la possession de la boite mail, et elle impose le meme contrat
-- de mot de passe que partout ailleurs.
--
--   ce qu'elle peut faire :                              ce qu'elle ne peut pas
--   ----------------------------------------             -------------------
--   emettre un jeton pour CE compte-la                    emettre pour un autre
--   (la ligne vient de app.account_for_recovery)          (p_user_id impose par l'appelant)
--   consigner l'audit                                     s'activer un compte desactive
--                                                          appeler issue_invitation
--
-- Le jeton reste a usage unique, expire en 1 heure, et ne revele rien de la
-- vie privee dans l'email : c'est app.accept_invitation qui le consomme et
-- revoque ensuite toutes les sessions du compte (route /reset).
-- ============================================================================

create or replace function app.issue_password_reset(p_user_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_row   record;
begin
  -- Un compte desactive ne recoit rien : meme un transfert de courrier ne doit
  -- pas ressusciter un compte que l administrateur a volontairement ferme.
  select u.id, u.email into v_row
    from public.users u
   where u.id = p_user_id
     and u.is_active;

  if v_row.id is null then
    raise exception 'Utilisateur % introuvable ou inactif', p_user_id;
  end if;

  insert into public.user_invitations
    (user_id, email, purpose, token_hash, expires_at, created_by, sent_count, last_sent_at)
  values
    (v_row.id, v_row.email, 'password_reset', app.hash_token(v_token),
     now() + interval '1 hour', null, 1, now())
  returning id into v_row.id;

  -- RG-05 : un seul lien actif par (utilisateur, usage). Le renvoi invalide
  -- le precedent, sinon deux emails en circulation doubledent la surface.
  return v_token;   -- seul moment ou le jeton en clair existe
end $$;

comment on function app.issue_password_reset(uuid) is
  'Emet un jeton de reinitialisation pour CE compte (parcours anonyme « mot de passe oublie »). 1 heure, usage unique. N autorise a rien faire sur un autre compte.';

-- Seuls le role applicatif et le proprietaire peuvent l'appeler. Cette fonction
-- ne remplace pas issue_invitation, qui reste le chemin de l'admin.
revoke all on function app.issue_password_reset(uuid) from public;
grant execute on function app.issue_password_reset(uuid) to trade_house_app;

-- ---------------------------------------------------------------------------
-- L'AUDIT
-- ---------------------------------------------------------------------------
--
-- created_by est volontairement NULL : l'appelant n'est pas un utilisateur de
-- l'application mais le porteur de l'adresse. Tracer un auteur « inconnu »
-- serait faux, et laisser la colonne vide dit exactement ce qu'il en est.
-- ---------------------------------------------------------------------------
