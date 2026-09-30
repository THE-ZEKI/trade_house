# Trade House — Design System & Directives d'implémentation

Document destiné à l'IA (ou au développeur) qui construit le front. Il complète
`DESIGN_BRIEF.md` (le **quoi**) avec le **comment ça doit se voir**.
Direction : **bleu ciel + blanc dominants**, touches douces de vert menthe,
ambre, rose et lavande. Ambiance : claire, aérée, calme, professionnelle.
Pas de noir, sauf la salle vidéo (§9).

---

## 0. Règles non négociables

1. **Codes stockés, libellés traduits.** Les statuts restent `correction_requested`,
   etc. Le front utilise une table `code → clé i18n → libellé`. Jamais de libellé en dur dans les données.
2. **Couleur jamais seule.** Tout statut = **icône + libellé + teinte**. Doit rester lisible en niveaux de gris.
3. **Chiffres alignés** : `font-variant-numeric: tabular-nums` sur tout montant, ratio, jour, heure, pourcentage.
4. **Rôle absent ≠ rôle masqué** : les entrées de menu interdites ne sont pas rendues dans le HTML.
5. **Audit en lecture seule** : aucun formulaire, aucun bouton d'édition.
6. **Les règles (délais, seuils, quotas) viennent de la base** : l'UI les affiche, ne les redéfinit pas.
7. **Français / anglais** : toute colonne, bouton, badge supporte **+30 % de caractères** (pas de largeur fixe en px sur du texte ; `min-width` + wrap / ellipsis avec `title`).
8. Le jeton de salle vidéo n'apparaît jamais dans le HTML visible.

---

## 1. Tokens (CSS variables)

```css
:root {
  /* Bleu ciel — couleur dominante */
  --sky-50:  #F0F9FF;
  --sky-100: #E0F2FE;
  --sky-200: #BAE6FD;
  --sky-300: #7DD3FC;
  --sky-400: #38BDF8;
  --sky-500: #0EA5E9;   /* primaire : boutons, liens, focus */
  --sky-600: #0284C7;   /* hover */
  --sky-700: #0369A1;   /* texte bleu sur blanc (contraste AA) */
  --sky-900: #0C4A6E;

  /* Surfaces */
  --bg:          #F6FBFE;  /* fond de page */
  --surface:     #FFFFFF;  /* cartes, tableaux */
  --surface-alt: #EEF7FC;  /* lignes alternées, zones secondaires */
  --border:      #DCE9F2;
  --border-strong:#BFD5E4;

  /* Texte */
  --text:        #0F2A3D;
  --text-muted:  #55707F;
  --text-faint:  #7C93A1;
  --text-on-primary: #FFFFFF;

  /* Teintes sémantiques douces : fond / texte / bordure */
  --success-bg:#DDF5E8; --success-fg:#0F6B3F; --success-bd:#A8E3C3;
  --info-bg:   #E0F2FE; --info-fg:   #0369A1; --info-bd:   #9FD8F7;
  --warn-bg:   #FEF1D2; --warn-fg:   #8A5A00; --warn-bd:   #F6D98A;
  --danger-bg: #FDE6E8; --danger-fg: #B42332; --danger-bd: #F5B5BB;
  --neutral-bg:#EDF2F6; --neutral-fg:#4A5B68; --neutral-bd:#D3DEE6;
  --accent-bg: #ECE8FF; --accent-fg: #4B3FB5; --accent-bd: #CBC2FA;  /* live / accent */

  /* Forme */
  --radius-sm: 8px;  --radius-md: 12px;  --radius-lg: 16px;  --radius-pill: 999px;

---

## 2. Typographie

| Usage | Taille / graisse |
|---|---|
| Titre de page | 24–28px / 650 |
| Titre de carte | 16–18px / 600 |
| Corps | 14–15px / 400, interligne 1.55 |
| Libellé de champ | 13px / 500, `--text-muted` |
| Badge | 12px / 600 |
| Chiffre clé (KPI) | 32–36px / 700, `tabular-nums` |

Police : Inter (Google Fonts) avec repli système. Montants et ratios :
`tabular-nums` obligatoire, alignés à droite en colonne.

---

## 3. Vocabulaire visuel — table de référence

**Composant `StatusBadge`** : pastille arrondie, `icône 14px + libellé`, fond
`*-bg`, texte `*-fg`, bordure `*-bd`. Icônes : set **Lucide**. Chaque code
possède une clé i18n `status.<code>`.

### Statuts de rapport
| Code | Teinte | Icône |
|---|---|---|
| `draft` | neutral | `pencil` |
| `submitted` | info | `send` |
| `in_review` | info | `eye` |
| `correction_requested` | warn | `message-square-warning` |
| `resubmitted` | info | `refresh-cw` |
| `validated` | success | `check-circle-2` |
| `dismissed` | danger | `x-circle` |
| `declared` | neutral (jamais rouge) | `moon` |

### RSVP
`pending` neutral `clock` · `accepted` success `check` · `declined` danger `x` ·
`maybe` neutral `help-circle`

### Réunions
- Statut : `scheduled` info `calendar` · `live` accent `radio` (point pulsant,
  respecter `prefers-reduced-motion`) · `ended` neutral `check` ·
  `cancelled` danger `ban` + **texte barré**.
- Type : `internal` `building-2` · `external` `globe` · `instant` `zap`
  (chips neutres).
- Fournisseur : `zoom` `meet` `teams` `other` `internal` → chip + pictogramme
  `video`.

### Rappels
- Nature : `invitation` `mail` · `d_minus_1` `calendar-clock` (« J-1 ») ·
  `h_minus_1` `timer` (« H-1 ») · `custom` `sliders` · `manual` `hand`
- État : `scheduled` info · `sending` info (spinner) · `sent` success ·
  `failed` danger `alert-triangle` · `cancelled` neutral.

### Notifications
Canal : `email` `mail` · `in_app` `bell`.
État : `pending` neutral · `sending` info · `sent` success · `failed` danger ·
### Émotions — sélecteur de pastilles (pas de select)
Grille de 7 pastilles cliquables (radio visuel), 56×56 min (tactile), icône +
libellé dessous, sélection = fond `--sky-100` + bordure `--sky-500` + coche.
`calm` `leaf` · `confident` `shield-check` · `fomo` `flame` · `impatience`
`hourglass` · `stress` `zap` · `revenge` `swords` · `other`
`more-horizontal`. Teintes douces distinctes mais **l'icône et le libellé
portent le sens**.

### Correctifs
- Gravité : `mandatory` danger `octagon-alert` « Bloquant » · `suggestion` info
  `lightbulb` « Conseil ».
- Cible : `general` `file-text` · `field` `text-cursor-input` · `file` `image`.
- État : `open` warn · `done` success · `rejected` danger · `dropped` neutral
  (barré léger).

### Fichiers
`screenshot` `image` · `pdf` `file-type` · `correction_attachment` `paperclip`.

### Résultat de session
`gain` success `trending-up` **+1 250,00** · `loss` danger `trending-down`
**−420,00** · `breakeven` neutral `minus` **0,00**. Toujours signe explicite +
flèche + couleur. Montant en `tabular-nums`, aligné à droite.

### Badges d'alerte de rapport
`critique` danger `flame` (plein, plus contrasté) · `en retard` warn
`clock-alert` · `obsolete` neutral `history`. Les trois peuvent coexister : les
afficher en ligne, wrap autorisé.

### Plan respecté
Oui : success `check` « Plan respecté » · Non : warn `triangle-alert` « Plan non
respecté ». Libellé toujours visible.

---

## 4. Layout global & navigation

- **Desktop ≥ 1024px** : sidebar fixe 248px (blanche, bordure droite
  `--border`), logo en haut, item actif = fond `--sky-100` + barre gauche 3px
  `--sky-500` + texte `--sky-700`. Topbar 64px : recherche, cloche
  notifications (pastille compteur), sélecteur FR/EN, avatar + menu.
- **Tablette 640–1023px** : sidebar repliée en rail d'icônes (72px) avec
  tooltips.

---

## 5. Composants

- **Card** : fond blanc, bordure `--border`, rayon 16, ombre `--shadow-sm`,
  padding 20.
- **Button** : primaire (fond `--sky-500`, texte blanc, hover `--sky-600`),
  secondaire (blanc, bordure `--border-strong`, texte `--sky-700`), ghost,
  danger doux (fond `--danger-bg`, texte `--danger-fg`). Hauteur 40 (44 sur
  mobile). Les actions destructives demandent confirmation ; « rejeter » et
  « rouvrir » ouvrent une modale avec **motif obligatoire**.
- **Input / Textarea** : hauteur 44, rayon 10, bordure `--border-strong`, focus
  bordure `--sky-500` + halo `--sky-100`. Erreur : bordure `--danger-fg` +
  **icône + message** sous le champ. Textareas narratives : `min-height:
  140px`, redimensionnables, compteur discret.
- **KPI Card** : icône dans pastille ronde teintée, libellé, chiffre 32px,
  sous-texte (règle : « aucun rapport depuis 3 jours »). Cliquable vers la liste
  filtrée.
- **Table** (desktop) : en-tête `--surface-alt` sticky, lignes 56px, survol
  `--sky-50`, colonnes numériques alignées à droite en `tabular-nums`.
  **Mobile < 768px → cartes empilées** : statut en haut à droite, date +
  instrument en titre, trader, ancienneté, badges d'alerte en bas.
- **Tabs, Segmented control, Toast** (succès / erreur, `role="status"`),
  **Modal** (bottom-sheet sur mobile), **Tooltip**, **Pagination**, **Skeleton**
  de chargement.
- **Avatar** : initiales sur fond sky-100.
- **Timeline** verticale pour l'historique des versions (point + version +
  date + auteur).

---

## 6. Écrans — directives visuelles

### 6.1 Connexion / 2FA / invitation / mot de passe oublié
Page centrée, fond dégradé ciel, carte blanche 420px, logo au-dessus. Email +
mot de passe (bouton afficher/masquer). États d'erreur distincts avec icône :
identifiants invalides, compte désactivé, verrouillage temporaire (avec compte
à rebours), 2FA requis.
2FA : **6 cases** de saisie (auto-focus, collage accepté,
`inputmode="numeric"`). Lien « Utiliser un code de secours » → champ
alphanumérique + « Il vous reste **N** codes ».

### 6.2 Tableau de bord
- **Admin/Manager** : grille 4 KPI (À réviser · Correctifs en cours · Correctifs
  en retard · Traders silencieux) → 4 colonnes desktop, 2 tablette, 1 mobile (ou
  carrousel horizontal compact). Dessous : *File de révision* (plus ancien
  d'abord, avec ancienneté), *Prochaines réunions*, *Traders silencieux* (« 5
  jours » ou « Jamais »).
- **Trader** : Brouillons (CTA « Continuer »), Correctifs à traiter (avec
  échéance + gravité), Réunions à venir avec **RSVP en 3 boutons inline**
  (Accepter / Peut-être / Refuser).
- Bouton principal flottant mobile « Nouveau rapport » (trader).

### 6.3 Rapports — liste
Filtres en chips (statut, période, trader, instrument) + recherche. Colonnes :
date · instrument · trader (absente pour un trader) · statut · ancienneté ·
badges. Tri sur date et ancienneté. État vide dédié.

### 6.4 Rapport — détail
- En-tête collant : date, trader, `StatusBadge`, badges d'alerte, « Version N ».
- Colonne principale : cartes *Données de session* (grille de valeurs en
  `tabular-nums`), *Contexte* (stratégie, émotions en pastille, réussites,
  erreurs), *Correctifs* (liste filtrable par état), *Historique des versions*
  (timeline).
- Colonne latérale (sticky desktop, barre d'actions en bas sur mobile) : actions
  selon statut — Prendre en revue · Demander des correctifs (sélecteur
  d'échéance) · Valider · Rejeter · Rouvrir · Arbitrer (Garder / Retirer).
- **Visualisation R planifié vs réalisé** : deux barres horizontales
  superposées (planifié = contour sky-300, réalisé = plein sky-500 ; teinte
  success si ≥ planifié, warn sinon) + écart chiffré « −0,6 R ». Valeurs
  toujours en texte.

### 6.6 Réunions
- Liste : toggle **Liste / Calendrier**. Ligne : titre, date-heure, durée, type,
  statut, fournisseur, mon RSVP, avancement des rappels.
- Détail : participants avec RSVP + présence, rappels (envoyés / échoués / en
  attente) + bouton « Relancer », lien, message.
- **Création** (assistant ou formulaire en sections) : titre, description, type,
  date, durée, participants (multi-sélection avec chips), lien optionnel,
  message, **récurrence** (quotidienne/hebdo/mensuelle + fin).
- **Conflit d'horaire** : bandeau `warn` « Chevauchement avec … » — n'empêche
  **jamais** l'enregistrement.
- **Occurrence détachée** : bord gauche pointillé, icône `unlink` + libellé
  « Modifiée » ; membre de série : icône `repeat`.

### 6.7 Salle vidéo — seul écran sombre (voir §9)

### 6.8 Comptes (admin)
Tableau : nom, email, rôle, état, 2FA (icône `shield-check` / `shield-off`), nb
rapports, dernière connexion. Menu « ⋯ » par ligne : inviter, réactiver,
désactiver, réinitialiser le mot de passe, imposer 2FA, révoquer les sessions.
Modale d'invitation : email, rôle, manager associé, langue ; validité 7 jours
affichée, bouton « Renvoyer ».

### 6.9 Journal d'audit (admin)
Tableau compact, filtres (action, acteur, type, période), **aucun bouton
d'édition ni de suppression**. Icône `lock` discrète en en-tête + mention
« Lecture seule ».

### 6.10 Réglages (admin)
Sections pliables : Rapports & fichiers · Réunions & salle · Rappels &
invitations · Sécurité. Liste de lignes `clé — description — contrôle` **en
nombre variable** (rendu générique par type : nombre, booléen, durée, texte).
Barre « Enregistrer » collante.

### 6.11 Profil
Trois cartes : Identité (nom, téléphone, fuseau, langue), Sécurité (2FA,
sessions actives avec « Révoquer »), Activité.

### 6.12 Notifications
Groupes par catégorie (rapport déposé, correction demandée, réunion, rappel,
sécurité) — 30 types d'événements. Ligne : icône de catégorie, événement, date
relative, état. Non lues : point `--sky-500` + fond `--sky-50`. Action « Tout
marquer comme lu ».

---

## 7. Formulaire de dépôt de rapport (priorité 1)

Page à une colonne (max 760px), **sections en cartes**, barre de progression /
ancres en haut, **bouton « Enregistrer le brouillon » + « Déposer »** collés en
bas (mobile : barre fixe).

1. **Bloc chiffré** : date (obligatoire), instrument, résultat (segmenté
   **Gain / Perte / Neutre** avec flèche), montant (signe automatique selon le
   type), nb de trades, plan respecté (toggle Oui/Non avec icône), R planifié +
   R réalisé (avec aperçu de l'écart en direct).
2. **Bloc narratif** : stratégie, réussites, erreurs, notes — textareas
   généreuses ; **émotions** en pastilles (§3) + précision libre.
3. **« Pas de trading »** : gros bouton secondaire dédié en tête de formulaire
   (icône `moon`). Activé → le formulaire se **réduit** à : date, instrument,
   motif `no_trade_reason`. Ton **serein** : fond `--neutral-bg`, texte
   « Déclaration de non-trading », bouton de validation en bleu ciel. Aucun
   rouge, aucun mot « échec » ou « vide ».
4. **Dépôt tardif** : bandeau `warn` + champ `late_reason` obligatoire, apparu
   dynamiquement.
5. Validation inline, sauvegarde auto du brouillon (indicateur « Enregistré à
   14:32 »).

---

## 8. États vides (12) — à designer

Chacun : illustration légère (pastille bleu ciel + icône Lucide grande), **titre**,
phrase qui explique la suite, **bouton d'action**.

1. Aucun rapport → « Déposez votre premier rapport » [Nouveau rapport]
2. Aucun rapport à réviser → « Tout est à jour »
3. Aucune réunion → [Planifier une réunion]
4. Aucune correction → « Rien à corriger »
5. Aucune notification → « Vous êtes à jour »
6. Aucun trader → [Inviter un trader]
7. Aucun résultat de recherche → [Effacer les filtres]
8. Aucun fichier → [Ajouter une capture]
9. Aucune annotation → « Choisissez un outil pour annoter »
10. Aucun brouillon
11. Aucune entrée d'audit sur la période
12. Aucun compte correspondant / Aucun rappel planifié

---

## 9. Salle vidéo (exception sombre)

Page dédiée **sans sidebar ni topbar**. Thème sombre local :
`--room-bg:#0B1B27; --room-surface:#12293A; --room-text:#E8F3FA;
--room-accent:#38BDF8`. (Bleu nuit, pas noir pur : cohérent avec la marque.)
États : 1) **Connexion** (nom de la réunion, test micro/caméra, bouton
« Rejoindre »), 2) **iframe Daily.co plein écran** avec barre de contrôles
flottante (micro, caméra, partage, quitter, participants), 3) **Salle fermée**
(message + retour). Indicateur de présence (durée / seuil 50 %). Jeton géré
côté serveur, jamais rendu visible.

---

## 10. Accessibilité & responsive — checklist

- Contraste AA minimum ; vérifier texte sur chaque `*-bg`.
- Cibles tactiles ≥ 44px. Navigation clavier complète, `aria-label` sur
  boutons-icônes.
- `prefers-reduced-motion` : désactiver pulsations et transitions longues.
- Transitions 150–200ms, ease-out. Pas d'animation décorative.
- Test obligatoire à 360, 768, 1024, 1440px, en FR **et** EN, et en niveaux de
  gris.
- Dates/nombres formatés selon la langue (`Intl`), fuseau du profil.
- Tables → cartes < 768px ; modales → bottom-sheets < 640px.

## 11. Ordre de livraison conseillé

1. Tokens, `StatusBadge`, table i18n des codes, layout + navigation (desktop /
   rail / drawer + tab bar).
2. Connexion / 2FA.
3. **Formulaire de rapport** (+ « pas de trading »).
4. **Revue + annotations** (détail de rapport, éditeur).
5. Tableaux de bord, listes rapports / réunions.
6. RSVP, création de réunion, rappels, salle vidéo.
7. Comptes, audit, réglages, profil, notifications.

- Rapport `declared` : bandeau calme neutre « Pas de trading déclaré » + motif.
  Jamais d'alerte, jamais de rouge.

### 6.5 Fichiers & outil d'annotation (écran à part entière)
- Galerie de vignettes avec type, taille, quota « 4/10 fichiers » ; limites
  10 Mo capture / 20 Mo PDF affichées à l'upload (zone glisser-déposer +
  bouton).
- **Éditeur** : canevas centré sur fond `--surface-alt`, barre d'outils verticale
  à gauche (Sélection, Flèche, Cercle, Rectangle, Texte, Main levée), sélecteur
  de couleur (6 pastilles : rouge, ambre, vert, bleu, violet, noir-bleu),
  épaisseur, annuler/rétablir, zoom. Poignées de redimensionnement sur sélection,
  déplacement par glisser.
- **Panneau des commentaires** à droite (drawer bas sur mobile) : chaque
  annotation numérotée (pastille sur l'image + carte dans la liste), gravité
  `mandatory`/`suggestion`, état. Clic liste ↔ surbrillance sur l'image.
- Formes stockées en JSON libre ; rendu en SVG au-dessus de l'image.

- **Mobile < 640px** : **pas de sidebar** → topbar avec bouton burger qui ouvre
  un **drawer** plein hauteur (focus piégé, fermeture par Échap / overlay)
  **+ barre d'onglets fixe en bas** (Tableau de bord, Rapports, Réunions,
  Notifications, Plus). Respecter `env(safe-area-inset-bottom)`.
- Contenu : `max-width: 1280px`, padding 24px (16px mobile).
- Menu par rôle :
  - Trader : Tableau de bord, Mes rapports, Réunions, Notifications, Profil.
  - Manager : + Traders.
  - Admin : + Comptes, Audit, Réglages.

Breakpoints : `sm 640 · md 768 · lg 1024 · xl 1280`. Approche mobile-first.

`opened` success (`mail-open`) · `cancelled` neutral.

### Présence
`present` success `user-check` · `absent` danger `user-x` · `late` warn
`user-clock`. Afficher l'indicateur **« 40 % → présent (seuil 50 %) »** :
mini-barre de progression avec trait vertical au seuil + texte. La valeur du
seuil vient de `attendance_present_ratio`.

  --shadow-sm: 0 1px 2px rgba(14,80,120,.06);
  --shadow-md: 0 4px 16px rgba(14,80,120,.08);
  --shadow-lg: 0 12px 32px rgba(14,80,120,.12);

  /* Espacement (base 4px) */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px; --s-6:32px; --s-7:48px;

  /* Typo */
  --font-sans: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
```

Fond de page : léger dégradé permis
`linear-gradient(180deg, var(--sky-50), var(--bg) 320px)`.
Focus clavier : `outline: 3px solid var(--sky-300); outline-offset: 2px` partout.
