# Plan de développement du back-end — 4 phases

Cahier des charges v1.2 (30/09/2026) · Base `trade_house` en place et validée (67 assertions)

> **État au 30/09/2026** : les 4 phases sont terminées, côté back-end **et** interface.
> Deux modules sont venus après ce plan et n'y figurent pas : les **annotations
> d'images** (RG-46, migration 020) et le module **Formation** (migrations 021 à 025).
> Ce document reste le reference de la structure d'origine ; voir `README.md` pour
> l'état courant.

## Principe directeur

La base porte les règles (contraintes, déclencheurs, fonctions `app.*`). Le back-end ne
duplique aucune règle : il **appelle** `app.*`, traduit les erreurs en messages, et gère ce
qu'une base ne sait pas faire (HTTP, fichiers, e-mails, vidéo, rendu).

```
Navigateur ──HTTP──▶ Route Handler / Server Action ──SQL──▶ app.*  ──▶ public.*
                                       │
                                       └── gestion des erreurs « RG-xx », upload, e-mails, vidéo
```

Conséquences pratiques :
- pas d'ORM (Prisma/Drizzle) : ils dupliqueraient la logique et se battraient avec les règles ;
- toute écriture métier passe par une fonction `app.*` ou une vue ;
- les messages d'erreur de la base commencent par `RG-xx` → l'API en extrait le code (voir `src/lib/errors.ts`) ;
- les clés i18n se déduisent des énumérations PostgreSQL (une seule source de vérité, RG-53).

## Phase 1 — Socle & authentification *(CDC phase 1)*

| Livrable | Contenu |
|---|---|
| Socle | Projet Next.js (App Router, TypeScript), `pg` + pool de connexions, helpers de transaction, lecture de `DATABASE_URL`, gestion d'erreurs `RG-xx` |
| Auth | Connexion email + mot de passe (bcrypt), cookie de session `httpOnly`, déconnexion, expiration, `app.set_user()` à chaque requête |
| Invitations | Création de compte + invitation (A2), acceptation avec définition du mot de passe (RG-05), renvoi |
| 2FA | TOTP (A5), codes de secours, obligatoire pour les admins |
| Sécurité | Connexion en rôle `trade_house_app` (non propriétaire → RLS effectif), protection des routes, limitation du nombre de tentatives de connexion |

**Point de contrôle** : on se connecte avec admin / manager / trader ; un trader ne voit pas
les données d'un autre ; le manager ne voit pas le journal d'audit ; un utilisateur désactivé
ne peut plus se connecter.

## Phase 2 — Réunions & rappels *(CDC phase 2)*

| Livrable | Contenu |
|---|---|
| Réunions | Création (interne / externe / instantanée), participants, RSVP, conflits non bloquants (RG-10) |
| Liens | Lien principal + historique, lien ponctuel par rappel, « remplacer le lien de toute la réunion » (RG-11 à RG-13) |
| Rappels | Rappels par défaut, personnalisés, relance manuelle ciblée, suivi des envois par destinataire (B9) |
| E-mails | Intégration Resend/Brevo, gabarits i18n, bouton « Rejoindre » (C5) |
| Job cron | `send-reminders` chaque minute : réservation atomique, idempotence, relances RG-16 |

**Point de contrôle** : une réunion crée 3 rappels ; un participant ayant refusé n'est pas
relancé ; un échec d'envoi est relancé 3× à 10 min puis marqué « Échec » ; le lien contenu dans
l'email est bien celui résolu à l'envoi (RG-13).

## Phase 3 — Rapports & cycle de correction *(CDC phases 4 et 5)*

| Livrable | Contenu |
|---|---|
| Rapports | Brouillon, champs RG-31, déclaration « pas de trading » (D7), recherche et filtres, export PDF/CSV |
| Fichiers | Upload vers stockage privé, contrôle du type réel, liens signés temporaires (RG-32, RG-33) |
| Cycle | Revue, correctifs ciblés (champ / fichier), obligatoire ou suggestion, échéances (E1, E2) |
| Annotations | Éditeur Canvas (Fabric.js ou Konva) : flèches, cercles, rectangles, texte — stockées à part (RG-46) |
| Versions | Resoumission, version figée, comparaison de deux versions (E4, E6, RG-45) |
| Clôture | Validation, verrouillage, réouverture admin journalisée, clôture sans suite (E5, RG-35, RG-47) |

**Point de contrôle** : parcours complet `brouillon → soumis → en revue → correction demandée →
resoumis → validé`, avec 2 versions figées, 1 correction obligatoire traitée, 1 capture annotée ;
et la soumission refusée si une donnée obligatoire manque.

## Phase 4 — Visio, tableau de bord & production *(CDC phases 3 et 6)*

| Livrable | Contenu |
|---|---|
| Visio | Daily.co **ou** LiveKit (décision à prendre — voir `DECISIONS.md`), jeton d'accès, salon, modération (RG-25) |
| Présence | Webhooks entrée/sortie → `meeting_attendance`, calcul et figeage du résultat (RG-20 à RG-23) |
| Enregistrement | Activation par l'admin, avertissement, stockage, purge (RG-24, RG-64) |
| Pilotage | Tableau de bord admin (F1), fiche trader (F2), vue trader (F3), notifications in-app (F4) |
| i18n | `next-intl` FR/EN complet, formats de dates et nombres |
| Production | Rétention RGPD, sauvegardes, CI/CD, surveillance des envois, migration de la base vers Supabase |

**Point de contrôle** : deux traders et un admin en visio, présence correcte à la clôture,
salle fermée automatiquement 2 h après la fin (RG-20).

## Transverse — fait à chaque phase

- Un test SQL (`db/tests/smoke.sql`) passe avant toute livraison ; on l'étend à chaque règle
  couverte par le back-end.
- Chaque écran a ses états vide / chargement / erreur.
- Chaque action sensible passe par `app.fn_audit` (journal, RG-63).
- Chaque événement clé produit un email **et** une notification in-app (RG-50).
