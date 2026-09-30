# Trade House — Cahier des charges interface

Document de référence pour la conception visuelle. Chaque donnée listée ici
**existe réellement en base** : les colonnes viennent de `information_schema`, les
listes de valeurs de `pg_enum`, les actions de `app.*`. Rien n'est supposé.

Une règle de lecture : **ce document décrit ce que l'interface doit pouvoir
afficher et faire**, pas ce qu'elle affiche aujourd'hui. Plusieurs écrans sont
encore en lecture seule ; les sections « actions » sont à designing même si
rien n'est encore cliquable.

---

## 1. Les trois rôles

| Rôle | Voit |
|---|---|
| **Admin** | Tout. Gère les comptes, le journal d'audit, les réglages. |
| **Manager** | Ses traders. Pas les comptes, pas l'audit, pas les réglages. |
| **Trader** | Uniquement ses propres rapports et les réunions où il est invité. |

La distinction n'est pas cosmétique : un manager **ne doit pas pouvoir** ouvrir
l'écran des comptes, même en tapant l'URL. Les entrées de menu correspondantes
n'existent pas dans son HTML.

---

## 2. Vocabulaire visuel — à verrouiller en premier

C'est le point le plus structurant. Une seule palette doit couvrir tous ces
états, sans que la couleur ne porte jamais seule l'information.

### Statuts de rapport
| Code | Signification | Teinte suggérée |
|---|---|---|
| `draft` | Brouillon | neutre |
| `submitted` | Déposé, en attente | info |
| `in_review` | En cours de revue | info |
| `correction_requested` | Correctifs demandés | attention |
| `resubmitted` | Resoumis | info |
| `validated` | Validé | succès |
| `dismissed` | Rejeté | danger |
| `declared` | « Pas de trading » déclaré | neutre |

### RSVP
`pending` · `accepted` (succès) · `declined` (danger) · `maybe` (neutre)

### Réunions
- Statut : `scheduled` · `live` (accent) · `ended` (neutre) · `cancelled` (danger, barré)
- Type : `internal` · `external` · `instant`
- Fournisseur de lien : `zoom` · `meet` · `teams` · `other` · `internal`

### Rappels
- Nature : `invitation` · `d_minus_1` · `h_minus_1` · `custom` · `manual`
- État : `scheduled` · `sending` · `sent` · `failed` (danger) · `cancelled`

### Notifications
- Canal : `email` · `in_app`
- État : `pending` · `sending` · `sent` · `failed` · `opened` · `cancelled`

### Présence en réunion
`present` · `absent` · `late` — calculé, avec la règle en dur :
**présent si ≥ 50 % de la durée** (`attendance_present_ratio`). À afficher tel
quel : un indicateur « 40 % → présent » doit rester lisible.

### Émotions (saisie par le trader)
`calm` · `confident` · `fomo` · `impatience` · `stress` · `revenge` · `other`

C'est une liste fermée de 7 valeurs. Elle mérite une **présentation par icône
ou pastille**, pas une liste déroulante : c'est une saisie émotionnelle, et un
menu de 7 lignes en masque la rapidité.

### Correctifs
- Gravité : `mandatory` (bloquant) · `suggestion` (conseil)
- Cible : `general` · `field` (champ précis) · `file` (zone d'un fichier)
- État : `open` · `done` · `rejected` · `dropped`

### Types de fichier
`screenshot` · `pdf` · `correction_attachment`

### Résultat de session
`gain` · `loss` · `breakeven` — trois valeurs qui méritent un indicateur
directionnel net (montant + ou −).

---

## 3. Écrans

### 3.1 Connexion
Email + mot de passe. Erreurs possibles : identifiants invalides, compte
désactivé, trop de tentatives (verrouillage temporaire), 2FA demandé.

**2FA** : saisie d'un code à 6 chiffres. **Codes de secours** : saisie d'un code
alphanumérique, avec compteur « combien il en reste ».

### 3.2 Tableau de bord — deux variantes

**Admin / Manager (F1)** — chiffres clés puis listes :

| Indicateur | Règle |
|---|---|
| À réviser | rapports en `submitted` ou `resubmitted` |
| Correctifs en cours | `open_corrections > 0` |
| Correctifs en retard | échéance dépassée **et** au moins 1 `mandatory` ouvert |
| Traders silencieux | aucun rapport depuis **3 jours** (réglable) |

Listes : file de révision (triée du dépôt le plus ancien), prochaines réunions,
traders sans rapport récent avec le nombre de **jours** écoulés ou « jamais ».

**Trader (F3)** — ses brouillons, ses correctifs à traiter, ses réunions à
venir avec son propre RSVP.

### 3.3 Rapports — liste
Colonnes : date de session · instrument · trader (absent pour un trader) ·
statut · ancienneté du dépôt · **badges d'alerte**.

Les badges à designing :

| Badge | Condition |
|---|---|
| `critique` | échéance de correction dépassée de plus de N jours (7) |
| `en retard` | `is_late` — dépôt hors délai |
| `obsolete` | `is_stale` — pas de réponse depuis 72 h |

### 3.4 Rapport — détail (le plus riche)

En-tête : date, trader, statut, badges, version courante.
Données de session : instrument, résultat, montant, nb trades, R planifié, R
réalisé, date de dépôt, échéance de correction.
Contexte libre : stratégie, émotions, réussites, erreurs, motif de « pas de
trading ».
Puis : liste des correctifs, puis historique des versions.

**Actions à designing** : prendre en revue, demander des correctifs (avec
échéance), valider, rejeter (motif obligatoire), rouvrir (motif), arbitrer un
correctif en désaccord (garder / retirer).

### 3.5 Fichiers et annotations
Chaque version peut porter : captures d'écran, PDF, pièces jointes. Limites :
10 fichiers par rapport, 10 Mo par capture, 20 Mo par PDF.

Une annotation est dessinée **sur l'image** : `arrow` (flèche) · `circle` ·
`rectangle` · `text` (zone de commentaire) · `freehand`. Les données de forme
sont en JSON libre.

**À designing** : l'outil d'annotation sur image est un écran à part entière,
avec sélection, déplacement, couleur, et panneau des commentaires.

### 3.6 Réunions — liste et détail
Créer une réunion : titre, description, type, date, durée, **liste des
participants**, lien optionnel, message, **règle de récurrence**.

La récurrence est récursive à l'infini : occurrences virtuelles générées à la
volée, modifiables une par une (`update_occurrence`). À designing : afficher une
occurrence « détachée » différemment d'un membre de la série.

**Rappels automatiques** : à l'invitation, à J-1, à H-1. Suivi par réunion :
envoyés / échoués / en attente. Relance manuelle possible.

**Chevauchements d'horaires** : le calcul existe et signale un conflit, mais
**ne bloque pas** la création. L'interface doit montrer l'avertissement sans
empêcher d'enregistrer.

### 3.7 Salle vidéo
La visio est externo (Daily.co). L'interface doit prévoir :
écran de connexion à la salle, **iframe plein écran**, contrôles de réunion,
indicateur de présence, et un état « salle fermée ».

Le jeton d'accès est à usage unique et expire (30 min par défaut). Il ne doit
jamais apparaître dans le HTML de la page.

### 3.8 Comptes (admin)
Liste : nom, email, rôle, état, 2FA, nb de rapports, dernière connexion.
Actions : inviter, réactiver, désactiver, réinitialiser le mot de passe,
imposer la 2FA, révoquer toutes les sessions.

Invitation : email, rôle, manager associé, langue. Lien valable 7 jours,
renvoyable.

### 3.9 Journal d'audit (admin)
Lecture seule. Date, action, acteur, type d'entité, détail. Filtrage par
action, acteur, type et période.

### 3.10 Réglages (admin)
Groupés : rapports et fichiers · réunions et salle · rappels et invitations ·
sécurité. Les clés sont en base, donc **nouvelles clés possibles** : la mise en
page doit accepter un nombre variable d'entrées.

### 3.11 Profil
Identité (nom, téléphone, fuseau, langue), sécurité (2FA, sessions actives),
activité (nombre de rapports).

### 3.12 Notifications
Liste groupée par type d'événement : rapport déposé, correction demandée,
réunion, rappel, sécurité. Chaque ligne : événement, date, état.
**30 types d'événements** au total — voir l'énumération dans `notification_event`.

**30 types d'événements** au total — voir l'énumération dans `notification_event`.

---

## 4. Champs de saisie — le formulaire de rapport

C'est le formulaire le plus important de l'application : le trader le remplit
chaque jour, et c'est ce que le manager relit.

**Bloc chiffré**
- `session_date` (date, obligatoire)
- `instrument` (texte libre)
- `result_type` : `gain` / `loss` / `breakeven`
- `result_amount` (montant, signe selon le type)
- `nb_trades`
- `plan_respected` (oui / non)
- `rr_planned` et `rr_realized` (ratio réalisé / ratio planifié)

**Bloc narratif** — champs texte longs, à laisser generously dimensionnés
- `strategy` · `highlights` (réussites) · `mistakes` (erreurs) · `notes`
- `emotions` (7 valeurs, voir §2) + `emotions_note` (précision libre)
- `rr_planned` comparé à `rr_realized` : l'écart **planifié vs réalisé** est
  l'indicateur que le manager suit. Il mérite une visualisation.

**Cas particulier : « pas de trading »**
Un bouton dedicate. Quand il est actif, le formulaire se simplifie : seuls la
date, l'instrument et `no_trade_reason` (motif) restent. C'est une déclaration
légitime, pas un rapport vide — **il ne doit jamais ressembler à un échec.**

**Dépôt tardif** : au-delà du délai, l'interface demande `late_reason` (motif).

---

## 5. Ce que la conception doit prendre en compte

### 5.1 Les nombres utilisent des chiffres alignés
Montants, ratios, jours, heures. Alignés en colonne, ils se comparent d'un coup
d'œil ; non alignés, la comparaison devient un travail. C'est une contrainte de
typo, pas de décoration.

### 5.2 La couleur ne doit jamais être le seul signal
« Plan non respecté » ou « en retard » doivent rester compréhensibles en
niveaux de gris, pour un daltonien ou sur un écran équivalent. Toujours
**icône ou libellé + couleur**.

### 5.3 La salle vidéo est le seul écran sombre
Tout le reste est clair. Une salle noire au milieu d'un layout clair donne un
aspect amateur ; l'inverse aussi. Prévoir une page dédiée, sans chrome autour.

### 5.4 Mobile
Un tableau de bord de trading se consulte beaucoup sur téléphone. La barre
latérale actuelle disparaît sous 1024 px : **il faut un menu mobile**. Tableaux
denses → cartes empilées sur petit écran.

### 5.5 Douze états vides à designing
Aucun rapport, aucune réunion, aucune correction, aucune notification, aucun
trader, aucun résultat de recherche… Un état vide doit expliquer l'action
suivante, pas seulement constater l'absence.

### 5.6 Langue
Français et anglais, choisis par l'utilisateur. Toute largeur de colonne doit
supporter **30 % de caractères en plus** en anglais sous peine de troncature.

---

## 6. Résumé du périmètre

| Écran | Statut | Priorité |
|---|---|---|
| Connexion, 2FA, invitation, mot de passe oublié | en styles inline | **1** |
| Tableau de bord (2 variantes) | fait, lecture | 2 |
| Rapports liste + détail | fait, lecture | 2 |
| Réunions liste + détail | fait, lecture | 2 |
| Fiche trader | fait, lecture | 3 |
| Comptes / Audit / Réglages / Profil / Notifications | fait, lecture | 3 |
| **Formulaire de dépôt de rapport** | absent | **1** |
| **Revue et annotations sur image** | absent | **1** |
| **RSVP, création de réunion, rappels** | absent | 2 |
| **Salle Daily.co** | absent | 2 |
| Gestion des comptes (inviter, désactiver) | absent | 3 |

Les trois lignes en gras sont le cœur du métier : sans elles l'application
affiche des données mais ne fait rien.

---

## 7. Conventions déjà en place

Le code existant pose quatre règles qu'un design devra respecter :

1. **Le code est stocké, le libellé est traduit à l'affichage.** Un statut en
   base est `correction_requested`, jamais « Correction demandée ». Un design
   qui translates dans les données casse les rapports et l'export PDF.
2. **Les règles sensibles vivent en base**, pas dans l'interface : délais,
   seuils, quotas. L'interface les affiche, elle ne les redéfinit pas.
3. **Un rôle absent n'est pas un rôle masqué.** Les entrées de menu
   interdites ne sont pas dans le HTML.
4. **Le journal d'audit n'a aucun formulaire.** Un journal que l'on peut
   modifier n'est plus un journal.

