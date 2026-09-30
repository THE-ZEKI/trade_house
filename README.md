# trade_house

Base de donnees du projet **Plateforme de gestion et de suivi de traders**
(cahier des charges v1.2 - 30/09/2026).

PostgreSQL en developpement, migrations compatibles Supabase pour la production.
Toutes les regles de gestion (RG-01 a RG-65) sont appliquees **en base**
(contraintes, declencheurs, fonctions), pas seulement dans l'interface.

---

## Installation

```powershell
# le mot de passe peut etre fourni ici ou via $env:PGPASSWORD
.\db\setup.ps1 -Password 'votre_mot_de_passe'

# ou en ligne de commande
$env:PGPASSWORD = 'votre_mot_de_passe'
psql -U postgres -d postgres -c "create database trade_house owner postgres encoding 'UTF8' template template0"
psql -U postgres -d trade_house -f db/install.sql
```

Options de `setup.ps1` :

| Option | Effet |
|---|---|
| `-Recreate` | supprime et recree la base (attention : perte de donnees) |
| `-SkipSeed` | installe le schema sans les comptes de developpement |
| `-Password` | mot de passe PostgreSQL (ou `$env:PGPASSWORD`) |
| `-DbName`, `-DbUser`, `-Host_`, `-Port` | parametres de connexion |

Les scripts `.sql` sont volontairement en **ASCII** (`db/tools/ascii-ify.ps1` verifie et convertit) :
sans cela, psql sous Windows peut afficher des messages d'erreur illisibles.

## Tests et outillage

### Fournisseur d'emails

`EMAIL_PROVIDER` choisit l'adaptateur, **sans changer une ligne de logique métier** :

| Valeur | Quand | Prérequis |
|---|---|---|
| `log` | développement | aucun — le message est écrit dans la sortie du serveur |
| `resend` | Vercel (recommandé) | `RESEND_API_KEY` + URL de webhook déclarée chez Resend pour les bounces |
| `smtp` | Postfix auto-hébergé, ou SMTP fourni par l'hébergeur | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` |

```powershell
npm run verify:email                      # valide l'adaptateur configuré
$env:EMAIL_PROVIDER='smtp'; npm run verify:email   # vérifie aussi le cas "SMTP injoignable"
```

Un échec d'envoi **ne lève jamais d'exception** : `sendEmail` renvoie `{ delivered: false, error }`,
le job cron journalise l'erreur et planifie les 3 relances de RG-16.

⚠️ Avec `smtp`, un envoi « accepté » signifie seulement que le serveur l'a pris (réponse 250).
Les bounces arrivent plus tard et **asynchronement** : sans webhook (bounce pipe Postfix,
ou SES/SNS si vous passez par AWS), `notifications_log.error_message` et `opened_at`
resteront vides. C'est le principal argument en faveur de l'API HTTP sur Vercel.

### delivering — à faire au déploiement

Quel que soit le fournisseur : domaine d'envoi dédié, `SPF`, `DKIM`, `DMARC`,
`Return-Path` personnalisé. Un SMTP mal configuré atterrit en spam tout comme une API.

### API disponibles

Toutes les regles metier vivent en base (fonctions `app.*` en `SECURITY DEFINER` + RLS).
Les routes ne font que valider l'entree et traduire la reponse.

| Domaine | Route | Regles |
|---|---|---|
| Auth | `/api/auth/*` | RG-01 a RG-09, RG-20 a RG-30 |
| Comptes | `GET/POST /api/users`, `GET/PATCH /api/users/:id` | A2, A3, RG-02, RG-05, RG-06 |
| Profil | `PATCH /api/me` | A4, RG-53 |
| Notifications | `GET/PUT /api/me/notifications` | F4 |
| Reunions | `/api/meetings/*` | B1 a B10, RG-10 a RG-26 |
| Rapports | `/api/reports/*` | D1 a D7, E1 a E7, RG-30 a RG-50 |
| Export | `GET /api/reports/export` (CSV), `GET /api/reports/:id/pdf` | D6 |
| Tableau de bord | `GET /api/dashboard` | F1, F3 |
| Fiche trader | `GET /api/traders/:id` | F2 |
| Audit | `GET /api/audit` | F5 (admin seul) |
| Reglages | `GET/PATCH /api/settings` | RG-06 (admin seul) |
| Cron | `POST /api/cron/send-reminders` | RG-52 |

**Restant a faire** : le composant de salle (module C, C1 a C8). Le back-end est
pret et **independant du fournisseur** : voir ci-dessous.

### Module C — visio, independant du fournisseur

Le CDC exige deux choses qu'un lien de salon public ne sait pas faire :
**C4** ( jeton a duree de vie courte, reserve aux invites) et **C6 / RG-25**
( l'admin est moderateur : couper un micro, exclure, verrouiller ).

La base ne signe rien : `app.room_claims` **decide** (droit d'entrer + role), et
l'application signe les revendications avec `node:crypto` (30 min par defaut).
Le fournisseur de visio n'en recoit qu'une projection au moment d'entrer — on
peut donc changer de fournisseur sans toucher au metier.

| Route | Effet |
|---|---|
| `GET /api/meetings/:id/room-token` | jeton signe + role + fournisseur (C4, C5, RG-25) |
| `POST /api/meetings/:id/attendance` | `{event:'join'\|'leave'}` → presence mesuree par la base (C8) |

```powershell
npm run verify:room
```

La presence est mesuree **chez nous**, jamais chez le fournisseur (C8 + RG-23) :
un segment s'ouvre a la connexion et se ferme a la deconnexion, et le job de
cloture borne les segments orphelins (onglet ferme sans evenement).

Fournisseur a choisir : `video_provider` dans les reglages vaut `external` par
defaut (reunion B2 externe : simple lien). Passer a `daily` ou `livekit` ne
change rien au back-end ; seule l'integration du SDK cote interface compte.

### Export PDF (D6)

Genere par `src/lib/pdf.ts` (PDFKit), sans navigateur ni Chromium a deployer.
La police Helvetica est integree a la bibliotheque : aucune police a embarquer,
et les accents francais passent par l'encodage WinAnsi.

```powershell
npm run verify:export
```

Points a connaaitre :
- seules les images **PNG et JPEG** sont incorporees ; les PDF et WebP sont
  listes dans l'inventaire mais pas affiches (PDFKit ne les gere pas) ;
- les emojis sont retires a la generation, ils n'existent pas en WinAnsi ;
- un rapport invisible renvoie 404, jamais un PDF vide : le canal de telechargement
  ne peut pas contourner le RLS.

### Stockage des fichiers

`.storage/` en developpement, hors de `public/`. En production, basculer
`storage_provider` sur `s3` ou `supabase` (reglages) et brancher l'adaptateur.

```powershell
# tout-en-un : validation statique + recreation de la base + installation + 67 assertions
.\db\test.ps1 -Password 'votre_mot_de_passe'

# etape par etape
python db\tools\validate_sql.py       # syntaxe (analyseur PostgreSQL, aucun serveur requis)
python db\tools\validate_schema.py    # tables/colonnes/cles etrangeres referencees + contrat d'API
.\db\tools\ascii-ify.ps1 -Check        # les .sql doivent rester en ASCII
psql -U postgres -d trade_house -f db\tests\smoke.sql
```

Etat valide le 30/09/2026 sur PostgreSQL 18.1 : **67 assertions passent**.

`db/tests/smoke.sql` verifie que la base **refuse** les operations interdites, et que les
permissions sont reellement isolees (le test bascule sur le role `trade_house_app`, seul moyen
d'evaluer le RLS) :

| Regle | Comportement verifie |
|---|---|
| RG-01 / RG-05 / RG-65 | email unique, un seul lien d'invitation actif, politique de mot de passe |
| RG-02 | auto-desactivation refusee, dernier administrateur actif protege |
| RG-06 | le manager ne cree pas de compte et ne rouvre pas un rapport valide |
| RG-10 / RG-11 / RG-12 | au moins un participant, date future, lien https, un seul lien courant + historique, conflits non bloquants |
| RG-14 / RG-15 | 3 rappels par defaut, rappel dans le passe refuse, refus exclu des rappels |
| RG-31 / RG-32 / RG-36 | soumission sans piece jointe refusee, mime incoherent refuse, hors delai exige un motif |
| RG-41 / RG-42 / RG-43 | le trader ne pilote pas la relecture, demande vide refusee, resoumission bloquee |
| RG-45 / RG-49 / RG-35 | version 1 puis 2 figees, validation bloquee, rapport valide verrouille |
| RG-37 | declaration « pas de trading » : unicite, refus si rapport existant, annulation |
| RG-20 / RG-22 / RG-23 | fenetre de salle T-10 min a fin+2 h, acces reserve aux invites, cumul des reconnexions et statut « en retard » |
| RG-04 / RG-63 | un trader ne voit que ses rapports, un manager que ses traders, l'admin seul le journal d'audit |

Le test se termine par un `ROLLBACK` : la base n'est jamais modifiee.

## Verification



```sql
\dt public.*                       -- 19 tables + 6 vues
select * from app.settings();      -- parametres (RG-36/47/48/23/20/16...)
select email, role from public.users order by role;
```

Comptes de developpement crees par `009_seed.sql` (a supprimer avant la mise en ligne) :

| Email | Mot de passe | Role |
|---|---|---|
| admin@trade-house.local | `Admin!2345` | admin (2FA active) |
| manager@trade-house.local | `Manager!2345` | manager |
| trader1@trade-house.local | `Trader!2345` | trader (rattache au manager) |
| trader2@trade-house.local | `Trader!2345` | trader (rattache au manager) |

## Connexion applicative

L'application identifie l'utilisateur courant avec la variable de session `app.user_id` :

```sql
begin;
select app.set_user('11111111-1111-1111-1111-111111111111'::uuid);  -- id de public.users
select * from public.reports;   -- le RLS filtre selon le role
commit;
```

Sur Supabase, `db/supabase_compat.sql` remplace cette mecanique par `auth.uid()`.

**L'application doit se connecter avec un role non proprietaire** : le role `trade_house_app` est
cree par `009_seed.sql`. Connectee en `postgres`, les politiques RLS seraient contournees
(le proprietaire des tables les bypasse) et la separation des roles ne serait pas appliquee.

```sql
set role trade_house_app;
select app.set_user('11111111-1111-1111-1111-111111111111'::uuid);
select * from public.reports;   -- filtre par le role de l'utilisateur
```

## Arborescence

```
db/
  000_database.sql      rappel de la commande de creation
  install.sql           installe toutes les migrations dans l'ordre
  setup.ps1             cree la base + installe + verifie
  supabase_compat.sql   bascule vers auth.uid() (production)
  tools/ascii-ify.ps1   controle d'encodage des .sql
  migrations/
    001_core.sql          extensions, schema app, enumerations, helpers
    002_identity.sql      app_settings, users, sessions, 2FA, invitations, audit
    003_meetings.sql      reunions, liens, participants, rappels, presence
    004_reports.sql       rapports, versions, fichiers, correctifs, annotations
    005_notifications.sql notifications par destinataire
    006_functions.sql     API metier (creer, soumettre, relire, valider...)
    007_views.sql         indicateurs calcules et files de travail
    008_rls.sql           politiques d'acces par role
    009_seed.sql          parametres + comptes de developpement
docs/
  DECISIONS.md          registre de decisions (D1 a D6) et points ouverts
```

## Tables

| Table | Role |
|---|---|
| `app_settings` | singleton des seuils (tous les « parametrable » du CDC) |
| `users` | comptes, roles, rattachement manager (RG-01..06) |
| `user_sessions` | sessions hachees - remplace `auth.sessions` en production |
| `mfa_factors`, `mfa_backup_codes` | 2FA TOTP + codes de secours (A5) |
| `user_invitations` | invitations et reinitialisations, expiration 7 j (RG-05) |
| `audit_log` | journal d'audit (F5, RG-63), lecture admin uniquement (RG-06) |
| `meetings` | reunions internes / externes / instantanees (B1, B2, B8, B10) |
| `meeting_links` | historique des liens, un seul lien principal (RG-12) |
| `meeting_participants` | participants, RSVP, jeton de salle (RG-21) |
| `meeting_reminders` | evenement d'envoi d'un rappel (RG-14..18) |
| `meeting_attendance` | segments de presence, un par connexion (RG-23) |
| `meeting_attendance_result` | presence figee a la cloture (RG-23) |
| `reports` | rapports de session et declarations « pas de trading » (D1..D7) |
| `report_versions` | instantane immuable a chaque soumission (RG-45) |
| `report_files` | captures et PDF, stockage prive (RG-32, RG-33) |
| `report_corrections` | correctifs cibles, obligatoires ou suggestions (E1..E3) |
| `file_annotations` | annotations d'images, stockees a part (RG-46) |
| `notifications_log` | envoi par destinataire + notifications in-app (B9, RG-52) |

## Vues

| Vue | Contenu |
|---|---|
| `v_report_flags` | indicateurs calcules : `is_stale` (RG-48), `is_overdue` / `is_critical` (RG-47) |
| `v_report_worklist` | file de travail admin/manager (F1) |
| `v_meeting_room_window` | ouverture T-10 min, fermeture fin+2 h (RG-20) |
| `v_meeting_attendance_live` | presence en cours, reconnexions incluses |
| `v_meeting_reminder_progress` | envois par destinataire d'un rappel (B9) |
| `v_trader_open_items` | a traiter du trader (F3) |

## API metier (schema `app.`)

| Domaine | Fonctions |
|---|---|
| Comptes | `create_user`, `issue_invitation`, `accept_invitation`, `set_password`, `deactivate_user`, `reactivate_user`, `update_profile` |
| Reunions | `create_meeting`, `meeting_conflicts`, `cancel_meeting`, `reschedule_meeting`, `update_meeting_link`, `rsvp`, `send_manual_reminder` |
| Rappels | `claim_due_reminders`, `prepare_reminder`, `mark_notification_sent`, `mark_notification_failed`, `complete_reminder` |
| Salle / presence | `attendance_join`, `attendance_leave`, `materialize_attendance`, `close_meeting` |
| Rapports | `submit_report`, `resubmit_report`, `declare_no_trade`, `cancel_no_trade` |
| Correction | `start_review`, `add_correction`, `request_corrections`, `respond_correction`, `arbitrate_correction`, `validate_report`, `dismiss_report`, `reopen_report` |

## Taches planifiees (cron)

| Frequence | Appel |
|---|---|
| chaque minute | `select * from app.claim_due_reminders();` puis `app.prepare_reminder(id)` par rappel, envoi des emails, `app.mark_notification_sent` / `mark_notification_failed`, `app.complete_reminder(id)` |
| chaque minute | relances dues : lignes de `notifications_log` avec `next_attempt_at <= now()` et `status in ('pending','failed')` |
| chaque minute | RG-20 : `app.close_meeting(id)` a `fin + 2 h` |
| quotidien | RG-64 : purge selon `app_settings.retention_*_months` |
| quotidien | RG-47 / RG-48 : alertes (base sur `v_report_flags`, aucun calcul stocke) |

## Exemple de parcours complet (test manuel)

```sql
-- 1. se placer en tant qu'admin
select app.set_user((select id from public.users where role = 'admin'));

-- 2. creer un trader rattache au manager, puis inviter
select app.create_user('nouveau@trade-house.local', 'Nouveau Trader', 'trader',
                       (select id from public.users where role = 'manager'));
select app.issue_invitation((select id from public.users where email = 'nouveau@trade-house.local'));

-- 3. le trader cree un rapport (en tant que trader)
select app.set_user((select id from public.users where email = 'nouveau@trade-house.local'));
insert into public.reports (trader_id, session_date, instrument, result_type,
                            result_amount, nb_trades, plan_respected)
values (app.current_user_id(), current_date - 1, 'EURUSD', 'gain', 250.00, 3, true);
insert into public.report_files (report_id, kind, storage_path, original_name, mime_type, size_bytes)
select id, 'screenshot', 'dev/trader1/1.png', 'capture.png', 'image/png', 120000
  from public.reports where trader_id = app.current_user_id();

-- 4. soumission, relecture, correction, resoumission, validation
select app.submit_report((select id from public.reports where trader_id = app.current_user_id()));
select app.set_user((select id from public.users where role = 'admin'));
select app.start_review(id) from public.reports where trader_id is not null;
select app.add_correction((select id from public.reports where status = 'in_review'),
                          'Preciser le point d''entree', 'mandatory', 'field', 'notes');
select app.request_corrections((select id from public.reports where status = 'in_review'));
```

