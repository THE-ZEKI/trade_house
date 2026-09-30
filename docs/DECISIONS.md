# Registre de decisions - base de donnees `trade_house`

Document de reference pour la base de donnees du projet **Plateforme de gestion et de suivi de
traders** (cahier des charges v1.2 du 30/09/2026). Chaque decision renvoie aux regles de gestion
(RG-xx) et aux exigences (A/B/C/D/E/F) du cahier des charges.

Date : 30/09/2026 - Cible : PostgreSQL 18 (dev), compatible Supabase (prod)

---

## D1 - Statuts de rapport : `resubmitted` conserve, `dismissed` et `declared` ajoutes

**Probleme.** RG-40 decrit `Correction demandee -> Resoumis -> En revision` et RG-41 reserve a
l'admin/manager les passages vers `En revision`, `Correction demandee` et `Valide`. Sans statut
intermediaire, le trader devrait lui-meme ecrire `in_review`, ce que RG-41 lui interdit.

**Decision.**
- `resubmitted` est **conserve** comme etat d'attente persistant : c'est la frontiere qui
  materialise la separation des pouvoirs (le trader soumet, le manager relit).
- Invariants garantis en base : `submitted <=> current_version = 1`, `resubmitted <=> current_version >= 2`,
  et une resoumission incremente exactement `current_version` (pas de saut de version).
- `dismissed` est **ajoute** : le CDC ne prevoyait qu'un `dismissed_at`, insuffisant car RG-47 exige
  deux effets (non modifiable + hors listes de travail) qui sont des regles de statut.
- `declared` est **ajoute** pour la declaration "pas de trading" (RG-37) : etat terminal, hors file
  de revision, mais compte comme jour en regle pour le tableau de bord (F1).
- `dropped` est ajoute a `correction_status` : l'arbitrage "maintien ou abandon" d'un correctif rejete
  par le trader (RG-43) a besoin d'un etat distinct de `open`.
- Un correctif `rejected` non arbitre **bloque la validation** (RG-49) : il n'est pas "traite".

**Implementation.** `app.fn_report_transition()` (matrice de transitions explicite + controles de role),
contraintes CHECK dans `reports`, `app.arbitrate_correction()`.

**Consequence.** `reports.status` compte 8 valeurs au lieu de 6 : les filtres (D5) doivent les exposer.

---

## D2 - "Hors delai" (RG-36) est **stocke**, RG-47/RG-48 restent **calcules**

**Probleme.** RG-36 est un fait date ("soumis plus de N jours apres la session"), alors que RG-47
("Retard critique") et RG-48 (badge "> 72 h") sont explicitement des indicateurs calcules a l'affichage.

**Decision.**
- `reports.is_late` est un **booleen fige au moment de la soumission**, calcule par le trigger
  `app.fn_report_validate()` a partir de `app_settings.late_submission_days`, accompagne du motif
  `late_reason` obligatoire. Un rapport soumis a J+3 ne devient donc jamais "hors delai" apres coup.
- `is_critical` (RG-47) et `is_stale` (RG-48) sont calcules dans la vue `public.v_report_flags`.
- Tous les seuils parametrables du CDC sont regroupes dans la table singleton **`app_settings`** :
  `late_submission_days`, `correction_critical_days`, `stale_submission_hours`,
  `attendance_present_ratio`, `late_arrival_minutes`, `room_open_before_minutes`,
  `room_close_after_minutes`, `reminder_retry_count`, `reminder_retry_minutes`, `invitation_ttl_days`,
  `max_files_per_report`, `max_screenshot_mb`, `max_pdf_mb`, `default_reminders`, `default_locale`,
  `available_locales`, stockage, durees de retention.

**Consequence.** Modifier un seuil ne change pas l'historique deja fige (comportement voulu pour RG-36).

---

## D3 - Authentification : le moteur fait le mot de passe, la base fait la politique

**Probleme.** A1/A2/A5 et RG-05 prevoient invitations, expiration a 7 jours, renvoi invalidant
l'ancien lien et 2FA, sans aucune table prevue dans le CDC (seuls `invited_at`/`invite_expires_at`).

**Decision.**
- **Developpement PostgreSQL** : `public.users.password_hash` (bcrypt/argon2 produit par l'API),
  `public.user_sessions` (jeton hache, expiration, revocation), `public.mfa_factors` (secret TOTP
  chiffre), `public.mfa_backup_codes` (codes de secours a usage unique : sans eux, une perte de
  telephone = blocage definitif du compte).
- **`public.user_invitations`** porte la politique metier : `token_hash` (jamais le token en clair),
  `expires_at`, `consumed_at`, `revoked_at`, `sent_count`, `last_sent_at`. Un index unique partiel
  garantit **un seul lien actif** par (utilisateur, usage) : le renvoi revoque l'ancien (RG-05).
- `app.fn_password_meets_policy()` implemente RG-65 (>= 8 caracteres, 1 chiffre, 1 caractere special).
- **Production Supabase** : `auth.users` / `auth.sessions` / `auth.mfa_factors` remplacent ces tables ;
  `db/supabase_compat.sql` bascule l'identification sur `auth.uid()` et `public.users.id` devient une
  cle etrangere vers `auth.users(id)`.

**Consequence.** L'API d'authentification reste identique dans les deux environnements.

---

## D4 - Presence : un segment par connexion + resultat fige

**Probleme.** RG-23 exige le "cumul des temps de connexion (reconnexions incluses)" et la regle
"En retard" (> 10 min) : une ligne unique ecrasee perd l'historique et l'heure d'arrivee reelle.

**Decision.**
- `public.meeting_attendance` = **segments bruts**, une ligne par connexion, jamais fusionnes.
  Index unique partiel garantissant un seul segment ouvert par participant.
- `public.meeting_attendance_result` = **resultat fige** ecrit par `app.materialize_attendance()` a la
  cloture de la reunion : `total_seconds`, `first_joined_at`, `status` (`present`/`absent`/`late`) et
  `computed_with` (seuil et duree reelle utilises), pour que l'historique de F2 ne change jamais apres coup.
- `public.v_meeting_attendance_live` agrege les segments en cours (ecrans de la salle).
- Les segments orphelins (onglet ferme sans webhook) sont bornes par le job de cloture.
- `meetings.actual_started_at` / `actual_ended_at` ajoutes : la "duree reelle" de RG-23 n'est pas la
  duree planifiee.

**Point a confirmer avec le client.** RG-23 ne dit pas si le seuil de 50 % s'applique a la duree
planifiee ou reelle. **Choix retenu : duree reelle** (premiere arrivee -> derniere sortie).

---

## D5 - Rappels : l'evenement d'envoi et le suivi par destinataire sont separes

**Probleme.** B9 et RG-52 demandent un suivi par destinataire, alors que `meeting_reminders` est
decrit au niveau de la reunion. L'etat « sent »/« failed » ne distingue ni un envoi en cours,
ni un envoi partiel.

**Decision.**
- `meeting_reminders` porte l'**evenement d'envoi** : une ligne par rappel programme, avec
  `status` etendu a `scheduled | sending | sent | failed | cancelled`.
- `notifications_log` porte le **suivi par destinataire** : une ligne par (rappel, destinataire, canal)
  avec `status`, `attempts`, `error_message`, `sent_at`, `read_at`.
- **Idempotence** : index unique `(reminder_id, user_id, channel)` + `ON CONFLICT DO NOTHING`.
  Un cron execute deux fois n'envoie pas deux fois.
- **Claim atomique** : `app.claim_due_reminders()` utilise `FOR UPDATE SKIP LOCKED` pour que deux
  executions paralleles ne se marchent pas dessus.
- **Lien resolu a l'envoi** (RG-13) : `app.prepare_reminder()` fige dans `payload` le lien
  reellement utilise (lien ponctuel du rappel, sinon lien principal courant), la langue et le
  gabarit -> preuve d'envoi et support du bouton "Renvoyer" (B9).
- **Relances RG-16** : `next_attempt_at` + `app.mark_notification_failed()` planifie 3 tentatives
  espacees de 10 minutes, puis `failed`.
- Le statut du rappel est **deduit** de ses destinataires (`app.complete_reminder()`,
  `v_meeting_reminder_progress`).

**Consequence.** Le suivi « 5 envoyes / 2 echoues » est consultable (B9) sans colonne compteur
denormalisee qui pourrait desynchroniser.

---

## D6 - Regles appliquees en base, pas seulement dans l'API

**Probleme.** Le CDC est centre sur des regles metier. Si elles ne sont appliquees que dans
l'interface ou les Server Actions, un import, un script ou une requete manuelle peut les contourner.

**Decision.** Les regles structurantes sont des **contraintes et declencheurs** en base :
matrice de transitions de `reports`, RG-31/RG-36/RG-37 a la soumission, RG-41 separation des pouvoirs,
RG-43/RG-49 correctifs obligatoires, RG-35 verrouillage, RG-47 motif de cloture, RG-02 dernier admin
actif, RG-06 rattachement manager, RG-11 lien https obligatoire (contrainte differee), RG-14 rappel non
programme dans le passe, RG-32 plafonds de fichiers, RG-45 version figee automatique, RG-03 cascade
lors de la desactivation d'un manager.

Les regles metier non structurantes (envoi d'email, rendu des e-mails, annotations) restent dans l'API.
Les parametres d'URL de liaison et de stockage sont documentes dans les commentaires SQL.

---

## Points ouverts a valider avec le client

| # | Question | Choix par defaut dans le schema |
|---|---|---|
| 1 | Seuil de presence 50 % : duree reelle ou planifiee (RG-23) ? | duree reelle |
| 2 | Duree de retention des enregistrements et des rapports (RG-64) | `NULL` = non definit, a renseigner dans `app_settings` |
| 3 | Langues au lancement et langue par defaut (RG-53) | `fr` + `en` |
| 4 | Le manager peut-il rouvrir un rapport valide ? (RG-06) | **non**, admin uniquement (`app.reopen_report`) |
| 5 | Jour de reference pour « trader sans rapport depuis X jours » (F1) | a calculer sur `session_date` dans la vue de tableau de bord |
| 6 | Enregistrement video : qui declenche et ou sont stockes les fichiers (C7) | `meetings.recording_url`, stockage externe (Daily/LiveKit) |

